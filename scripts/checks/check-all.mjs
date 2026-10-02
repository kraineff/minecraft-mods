#!/usr/bin/env node
// check-all — все проверки `scripts/checks/check-*.mjs` одним запуском, в одном процессе.
//
//   node scripts/checks/check-all.mjs [--tests] [--info] [путь…]
//   node scripts/checks/check-all.mjs --changed [--since <коммит>] [--tests] [--info]
//
// Без путей — весь репозиторий; пути передаются каждой проверке как есть. `--changed` —
// файлы из `git status` (изменённые, новые, переименованные), с `--since` — изменённые
// коммитами от `<коммит>` до HEAD (так CI проверяет пуш):
//   — проверки «по файлу» (logs) получают изменённые файлы Java модов;
//   — проверки «по репозиторию» (json, secrets, journals) — изменённые файлы своего вида;
//   — проверки «по моду» (targets, project, modjson, mixins, lang, changelog) — затронутые
//     моды целиком;
//   — правка самой проверки, `lib/`, каталога `gradle/versions.json` или корневого
//     gradle.properties запускает зависящие от них проверки по всему репозиторию.
// Вывод сгруппирован по проверкам: `[ok] check-<имя>: итог` или `[FAIL]`/`[ERROR]` с
// находками, в конце — строка итога. Код выхода: 0 — всё чисто, 1 — есть находки,
// 2 — ошибка запуска какой-либо проверки или неверный аргумент.

import { existsSync } from 'node:fs';
import { modDirs, plural } from '../lib/repo.mjs';
import { CheckError, errorText, git, isGenerated, isMain, modOf, parseArgs, render } from './lib/cli.mjs';

/**
 * Проверки в порядке вывода. `scope`: `file` — находка зависит только от файла Java, `repo` —
 * от любого файла репозитория своего вида (`match`), `mod` — от файлов мода целиком.
 */
export const CHECKS = [
  { name: 'json', scope: 'repo', match: /\.json$/ },
  { name: 'secrets', scope: 'repo' },
  { name: 'journals', scope: 'repo', match: /(^|\/)docs\/TODO\.md$/ },
  { name: 'logs', scope: 'file', match: /\.java$/ },
  { name: 'targets', scope: 'mod' },
  { name: 'project', scope: 'mod' },
  { name: 'modjson', scope: 'mod' },
  { name: 'mixins', scope: 'mod' },
  { name: 'lang', scope: 'mod' },
  { name: 'changelog', scope: 'mod' },
];

/** Файлы, при изменении которых проверка идёт по всему репозиторию. */
const GLOBAL_TRIGGERS = [
  [/^scripts\/(checks\/)?lib\//, CHECKS.map((check) => check.name)],
  [/^gradle\/versions\.json$/, ['targets', 'modjson', 'mixins']],
  [/^gradle\.properties$/, ['project']],
  [/^scripts\/journals\.mjs$/, ['journals']],
  ...CHECKS.map((check) => [new RegExp(`^scripts/checks/check-${check.name}\\.mjs$`), [check.name]]),
];

/** Изменённые файлы из `git status --porcelain -z`: новые пути, у переименования — оба. */
export function parseStatus(output) {
  const entries = output.split('\0');
  const files = [];
  for (let k = 0; k < entries.length; k++) {
    const entry = entries[k];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    files.push(entry.slice(3));
    // Переименование и копия: следующая запись — старый путь.
    if (/[RC]/.test(status)) files.push(entries[++k]);
  }
  return files.filter((file) => file && !isGenerated(file));
}

/**
 * Изменённые файлы: рабочей копии (`git status`) или, с `since`, коммитов от его общего предка
 * с HEAD до HEAD — у переименования оба пути.
 */
export function changedFiles(cwd = process.cwd(), since = undefined) {
  if (since === undefined) {
    return parseStatus(git(['status', '--porcelain', '-z', '--untracked-files=all'], cwd));
  }
  const out = git(['diff', '--name-only', '-z', '--no-renames', `${since}...HEAD`], cwd);
  return [...new Set(out.split('\0'))].filter((file) => file && !isGenerated(file));
}

/** `--since <коммит>` из аргументов: `{ since, rest }`; без значения — ошибка запуска. */
export function takeSince(argv) {
  const at = argv.indexOf('--since');
  if (at < 0) return { since: undefined, rest: argv };
  const since = argv[at + 1];
  if (!since || since.startsWith('--')) throw new CheckError('--since — нужен коммит');
  return { since, rest: [...argv.slice(0, at), ...argv.slice(at + 2)] };
}

/**
 * План проверок по изменённым файлам: `[{ name, paths }]`, `paths: []` — весь репозиторий;
 * проверки, которым смотреть нечего, в план не попадают. `mods` — все моды репозитория,
 * `exists(path)` — есть ли файл на диске (удалённые проверять нечего).
 */
export function changedPlan(changed, { mods, exists = existsSync }) {
  const whole = new Set();
  for (const file of changed) {
    for (const [pattern, names] of GLOBAL_TRIGGERS) {
      if (pattern.test(file)) for (const name of names) whole.add(name);
    }
  }
  const existing = changed.filter((file) => exists(file));
  const touched = [...new Set(changed.map(modOf))].filter((mod) => mod && mods.includes(mod) && exists(mod));

  const plan = [];
  for (const { name, scope, match } of CHECKS) {
    let paths;
    if (whole.has(name)) paths = [];
    else if (scope === 'file' || scope === 'repo') {
      paths = existing.filter((file) => (!match || match.test(file)) && (scope === 'repo' || modOf(file)));
      if (paths.length === 0) continue;
    } else {
      paths = touched;
      if (paths.length === 0) continue;
    }
    plan.push({ name, paths });
  }
  return plan;
}

/** Запуск проверки в процессе → обещание `{ stdout, stderr, code }` по общим правилам вывода. */
function start(name, loaded, options) {
  const fail = (error) => ({ stdout: '', stderr: errorText(name, error), code: 2 });
  if (loaded.error) return Promise.resolve(fail(loaded.error));
  try {
    return Promise.resolve(loaded.module.checker.run(options)).then(
      (result) => render(result, options),
      fail,
    );
  } catch (error) {
    return Promise.resolve(fail(error));
  }
}

const checksWord = (n) => plural(n, 'проверка', 'проверки', 'проверок');

function scopeText(paths) {
  if (paths.length === 0) return '';
  if (paths.length <= 3) return ` (${paths.join(', ')})`;
  return ` (${paths.length} путей)`;
}

async function main(argv) {
  const { since, rest } = takeSince(argv);
  const options = parseArgs(rest, { extra: ['--changed'] });
  if (since !== undefined && !options.changed) throw new CheckError('--since — только с --changed');
  if (options.changed && options.paths.length > 0) throw new CheckError('--changed не сочетается с путями');
  const plan = options.changed
    ? changedPlan(changedFiles(process.cwd(), since), { mods: modDirs(process.cwd()) })
    : CHECKS.map(({ name }) => ({ name, paths: options.paths }));
  if (plan.length === 0) {
    process.stdout.write('check-all: изменённых файлов для проверок нет\n');
    return 0;
  }

  const loaded = new Map(
    await Promise.all(
      plan.map(({ name }) =>
        import(`./check-${name}.mjs`).then(
          (module) => [name, { module }],
          (error) => [name, { error }],
        ),
      ),
    ),
  );

  const failed = [];
  const broken = [];
  for (const step of plan) {
    const { stdout, stderr, code } = await start(step.name, loaded.get(step.name), { ...options, paths: step.paths });
    const title = `check-${step.name}${scopeText(step.paths)}`;
    const body = `${stdout}${stderr}`.trimEnd();
    if (code === 0 && !body.includes('\n')) {
      process.stdout.write(`[ok] ${title}: ${body}\n`);
      continue;
    }
    const label = { 0: 'ok', 1: 'FAIL', 2: 'ERROR' }[code];
    (code === 0 ? process.stdout : process.stderr).write(`[${label}] ${title}\n${body}\n`);
    if (code === 1) failed.push(step.name);
    if (code === 2) broken.push(step.name);
  }

  if (failed.length === 0 && broken.length === 0) {
    process.stdout.write(`check-all: ${plan.length} ${checksWord(plan.length)} — чисто\n`);
    return 0;
  }
  const parts = [];
  if (failed.length > 0) parts.push(`находки: ${failed.join(', ')}`);
  if (broken.length > 0) parts.push(`ошибка запуска: ${broken.join(', ')}`);
  process.stderr.write(`check-all: ${plan.length} ${checksWord(plan.length)}, ${parts.join('; ')}\n`);
  return broken.length > 0 ? 2 : 1;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(errorText('all', error));
      process.exitCode = 2;
    },
  );
}
