#!/usr/bin/env node
// verify-changed — проверки того, что задели изменённые файлы (`git status`): как
// `npm run verify`, но только для затронутого. Запускают хук завершения хода Claude Code
// (`.claude/hooks/on-stop.mjs`) и `npm run verify:changed`; с `--since` — CI (`ci.yml`).
//
//   node scripts/verify-changed.mjs                   — изменения рабочей копии
//   node scripts/verify-changed.mjs --since <коммит>  — изменения коммитов от `<коммит>` до HEAD
//
// Шаги:
//   1. статические проверки `check-all --changed` (скилл checks);
//   2. тесты скриптов — при правке `scripts/` или `.claude/hooks/`;
//   3. `./gradlew -p mods/<мод> build` (компиляция и Checkstyle) под цель по умолчанию —
//      для затронутых модов; правка общей сборки (`build-logic/`, `gradle/`, `config/`,
//      корневой gradle.properties) — для всех. Документация (`*.md`, `docs/`) сборку не задевает.
// Шаги 1–2 идут параллельно со сборками; сборки модов — по очереди. Код выхода: 0 — чисто,
// 1 — ошибки (сводка в stderr), 2 — ошибка запуска.

import { spawn } from 'node:child_process';
import { runGradle, tail } from './build.mjs';
import { changedFiles, takeSince } from './checks/check-all.mjs';
import { isMain, modOf } from './checks/lib/cli.mjs';
import { modDirs, plural, ROOT } from './lib/repo.mjs';

/** Общая сборка: её правка задевает все моды. */
const SHARED_BUILD = /^(build-logic\/|gradle\/|config\/|gradle\.properties$|settings\.gradle$)/;
/** Документация: сборку и тесты не задевает. */
const DOCS = /(\.md$|(^|\/)docs\/)/;

/**
 * План по изменённым файлам: `{ mods, scripts }` — моды для сборки и гонять ли тесты скриптов.
 * `exists(path)` — есть ли мод на диске: удалённый собирать нечего.
 */
export function verifyPlan(changed, { mods, exists = () => true }) {
  const code = changed.filter((file) => !DOCS.test(file));
  const everything = code.some((file) => SHARED_BUILD.test(file));
  const touched = new Set(code.map(modOf));
  return {
    mods: mods.filter((mod) => (everything || touched.has(mod)) && exists(mod)),
    scripts: code.some((file) => file.startsWith('scripts/') || file.startsWith('.claude/hooks/')),
  };
}

/** Команда с собранным выводом → `{ name, ok, output }`. */
function step(name, command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: '0' } });
    let output = '';
    const collect = (chunk) => {
      output += chunk;
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => resolve({ name, ok: false, output: String(error) }));
    child.on('close', (code) => resolve({ name, ok: code === 0, output }));
  });
}

/** Сборки модов по очереди: Loom не любит параллельные сборки на одном кеше. */
async function buildMods(mods) {
  const results = [];
  for (const mod of mods) {
    const result = await runGradle(mod, ['build']);
    results.push({ name: `gradle build ${mod}`, ok: result.ok, output: result.output });
  }
  return results;
}

async function main(argv) {
  process.chdir(ROOT);
  const { since } = takeSince(argv);
  const changed = changedFiles(ROOT, since);
  if (changed.length === 0) {
    process.stdout.write('verify-changed: изменений нет\n');
    return 0;
  }
  const plan = verifyPlan(changed, { mods: modDirs() });
  const sinceArgs = since === undefined ? [] : ['--since', since];
  const parallel = await Promise.all([
    step('check-all --changed', process.execPath, ['scripts/checks/check-all.mjs', '--changed', ...sinceArgs]),
    plan.scripts
      ? step('тесты скриптов', process.execPath, ['--test', 'scripts/tests/*.test.mjs', 'scripts/checks/tests/*.test.mjs'])
      : [],
    buildMods(plan.mods),
  ]);
  const results = parallel.flat();
  const failed = results.filter((result) => !result.ok);
  if (failed.length === 0) {
    const scope = plan.mods.length > 0 ? plan.mods.join(', ') : 'моды не задеты';
    const steps = plural(results.length, 'шаг', 'шага', 'шагов');
    process.stdout.write(`verify-changed: чисто (${results.length} ${steps}; ${scope})\n`);
    return 0;
  }
  for (const result of failed) process.stderr.write(`[FAIL] ${result.name}\n${tail(result.output)}\n\n`);
  process.stderr.write(`verify-changed: ошибки — ${failed.map((result) => result.name).join(', ')}\n`);
  return 1;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`verify-changed: ${error.stack ?? error}\n`);
      process.exitCode = 2;
    },
  );
}
