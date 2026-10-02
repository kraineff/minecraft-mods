#!/usr/bin/env node
// ci — план GitHub Actions (`.github/workflows/ci.yml`, скиллы checks и release) по тому, что
// изменил пуш или PR, — той же логикой, что `verify-changed` локально: какие моды собрать по всем
// целям и у каких выросла версия — их CI публикует на Modrinth после зелёных проверок.
//
//   node scripts/ci.mjs plan                      — строки для `$GITHUB_OUTPUT`: base, full, build,
//                                                   publish, release
//   node scripts/ci.mjs changelog <мод> <версия>  — раздел docs/CHANGELOG.md версии (текст для
//                                                   Modrinth и GitHub Release)
//
// Вход `plan` — окружение шага: EVENT (`github.event_name`), BEFORE (`github.event.before` у
// push), BASE (база PR), PUBLISH (мод ручного запуска). База — коммит, от которого считаются
// изменения: у push — прежняя вершина ветки, у PR — его база. Полный прогон (все моды по всем
// целям) — ручной запуск, нет базы (первый пуш, push --force поверх неизвестного коммита) и
// правка самого конвейера.
// Публикация — только push в main: моды с `modrinth_id`, у которых `mod_version` выросла против
// базы (бамп не последним коммитом пуша тоже считается). Ручной запуск с PUBLISH — выложить
// версию, которая уже в репозитории. Повтор безопасен: опубликованные цели CI пропускает.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changedFiles } from './checks/check-all.mjs';
import { isMain } from './checks/lib/cli.mjs';
import {
  compareSemver,
  modDirs,
  modId,
  modProperties,
  modTargets,
  parseProperties,
  ROOT,
  readVersions,
} from './lib/repo.mjs';
import { verifyPlan } from './verify-changed.mjs';

/** Правка конвейера CI — собрать всё: план и сама сборка в CI могли сломаться. */
const PIPELINE = /^\.github\/|^scripts\/ci\.mjs$/;
const NO_COMMIT = /^0*$/;

/** Моды, чья версия выросла: `[{ dir, from, to }]` — `version(dir, ref)` даёт mod_version в коммите. */
export function grownVersions(dirs, version, fromRef, toRef) {
  return dirs.flatMap((dir) => {
    const [from, to] = [version(dir, fromRef), version(dir, toRef)];
    return from !== undefined && to !== undefined && compareSemver(to, from) > 0 ? [{ dir, from, to }] : [];
  });
}

/**
 * План по событию: `{ base, full, build, publish, release }` — `build` — `[{ mod, target }]`
 * задетых модов по всем целям (у публикуемого — ещё `publish: true` и `version`: его JAR job build
 * отдаёт в publish и в GitHub Release), `publish` — `[{ mod, version, target }]`, `release` —
 * `[{ mod, version }]`. Зависимости: `changed(base)` — изменённые файлы от базы,
 * `version(dir, ref)` — mod_version мода в коммите (`undefined` — его там нет), `known(ref)` —
 * коммит есть в истории, `mods` — моды репозитория, `props(dir)` — gradle.properties мода,
 * `versions` — каталог целей.
 */
export function ciPlan({ event, before, base, publish }, { changed, version, known, mods, props, versions }) {
  const publishable = mods.filter((dir) => props(dir).modrinth_id);
  if (publish && !publishable.includes(`mods/${publish}`)) {
    const list = publishable.map(modId).join(', ') || '—';
    throw new Error(`мод ${publish} CI не публикует: нет такого мода или modrinth_id (публикуются: ${list})`);
  }
  const from = { push: before, pull_request: base }[event];
  const valid = Boolean(from) && !NO_COMMIT.test(from) && known(from);
  const files = valid ? changed(from) : undefined;
  const full = event === 'workflow_dispatch' || files === undefined || files.some((file) => PIPELINE.test(file));
  const affected = full ? mods : verifyPlan(files, { mods }).mods;

  let released = [];
  if (event === 'workflow_dispatch' && publish) released = [`mods/${publish}`];
  else if (event === 'push' && valid) released = grownVersions(publishable, version, from, 'HEAD').map((item) => item.dir);

  const targetsOf = (dir) => modTargets(props(dir), versions).targets.map((target) => target.minecraft);
  const built = [...new Set([...affected, ...released])];
  return {
    base: full ? undefined : from,
    full,
    build: built.flatMap((dir) =>
      targetsOf(dir).map((target) =>
        released.includes(dir)
          ? { mod: modId(dir), target, publish: true, version: props(dir).mod_version }
          : { mod: modId(dir), target },
      ),
    ),
    publish: released.flatMap((dir) =>
      targetsOf(dir).map((target) => ({ mod: modId(dir), version: props(dir).mod_version, target })),
    ),
    release: released.map((dir) => ({ mod: modId(dir), version: props(dir).mod_version })),
  };
}

/** Раздел CHANGELOG версии без заголовка; нет раздела — `undefined`. */
export function changelogSection(text, version) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## ['));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

/** Вывод git; сбой — `undefined`. */
function gitOut(args, cwd = ROOT) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined;
  }
}

/** mod_version мода в коммите (`ref`) или на диске (`ref` = `undefined`). */
export function versionAt(dir, ref, root = ROOT) {
  const text =
    ref === undefined
      ? existsSync(join(root, dir, 'gradle.properties')) ? readFileSync(join(root, dir, 'gradle.properties'), 'utf8') : undefined
      : gitOut(['show', `${ref}:${dir}/gradle.properties`], root);
  return text === undefined ? undefined : parseProperties(text).mod_version;
}

/**
 * Что опубликует пуш ветки main: моды с `modrinth_id`, чья версия выросла против upstream —
 * в HEAD или, с `worktree`, на диске (коммит в той же команде ещё не сделан). Для хука перед
 * `git push`: не main или нет upstream — `[]`.
 */
export function pendingReleases({ root = ROOT, worktree = false } = {}) {
  if (gitOut(['rev-parse', '--abbrev-ref', 'HEAD'], root)?.trim() !== 'main') return [];
  const upstream = gitOut(['rev-parse', '--verify', '--quiet', '@{upstream}'], root)?.trim();
  if (!upstream) return [];
  const publishable = modDirs(root).filter((dir) => modProperties(dir, root).modrinth_id);
  return grownVersions(publishable, (dir, ref) => versionAt(dir, ref, root), upstream, worktree ? undefined : 'HEAD');
}

function main([command, ...args]) {
  process.chdir(ROOT);
  if (command === 'plan') {
    const { EVENT, BEFORE, BASE, PUBLISH } = process.env;
    const plan = ciPlan(
      { event: EVENT, before: BEFORE, base: BASE, publish: PUBLISH || undefined },
      {
        changed: (from) => changedFiles(ROOT, from),
        version: (dir, ref) => versionAt(dir, ref),
        known: (ref) => gitOut(['cat-file', '-e', `${ref}^{commit}`]) !== undefined,
        mods: modDirs(),
        props: (dir) => modProperties(dir),
        versions: readVersions(),
      },
    );
    const scope = plan.full ? 'полный прогон' : `от ${plan.base.slice(0, 9)}`;
    const published = plan.release.map((item) => `${item.mod} ${item.version}`).join(', ') || '—';
    process.stderr.write(`ci: ${EVENT}, ${scope}; сборок — ${plan.build.length}; публикация: ${published}\n`);
    process.stdout.write(
      `base=${plan.base ?? ''}\nfull=${plan.full}\nbuild=${JSON.stringify(plan.build)}\n` +
        `publish=${JSON.stringify(plan.publish)}\nrelease=${JSON.stringify(plan.release)}\n`,
    );
    return 0;
  }
  if (command === 'changelog') {
    const [mod, version] = args;
    const section = changelogSection(readFileSync(join('mods', mod, 'docs/CHANGELOG.md'), 'utf8'), version);
    if (section === undefined) throw new Error(`в mods/${mod}/docs/CHANGELOG.md нет раздела [${version}]`);
    process.stdout.write(`${section}\n`);
    return 0;
  }
  throw new Error('команда: plan | changelog <мод> <версия>');
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`ci: ${error.message}\n`);
    process.exitCode = 1;
  }
}
