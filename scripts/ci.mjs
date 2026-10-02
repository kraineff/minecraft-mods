#!/usr/bin/env node
// ci — данные для GitHub Actions (`.github/workflows/`): что собирать и что публиковать.
// Цели берутся из каталога `gradle/versions.json` — матрицы в workflow не пишутся руками.
//
//   node scripts/ci.mjs matrix [--since <коммит>]  — `matrix=[{"mod","target"}…]` для сборки:
//       с `--since` — моды, задетые коммитами (правка общей сборки — все), без — все моды;
//       каждый мод — по всем своим целям
//   node scripts/ci.mjs release <тег>              — тег релиза `<мод>/<x.y.z>`: `mod=`,
//       `version=`, `targets=[…]`; версия должна совпадать с mod_version мода
//   node scripts/ci.mjs changelog <мод> <версия>   — раздел docs/CHANGELOG.md этой версии
//       (текст для Modrinth)
//
// Вывод `ключ=значение` — для `>> "$GITHUB_OUTPUT"`. Ошибка — текст в stderr, код 1.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changedFiles, takeSince } from './checks/check-all.mjs';
import { isMain } from './checks/lib/cli.mjs';
import { modDirs, modProperties, modTargets, ROOT, readVersions } from './lib/repo.mjs';
import { verifyPlan } from './verify-changed.mjs';

/** Матрица сборок: каждый мод из `mods` — по всем своим целям. */
export function buildMatrix(mods, versions, props = (dir) => modProperties(dir)) {
  return mods.flatMap((dir) =>
    modTargets(props(dir), versions).targets.map((target) => ({
      mod: dir.split('/').pop(),
      target: target.minecraft,
    })),
  );
}

/** Тег релиза `<мод>/<x.y.z>` → `{ mod, version }`; не тот вид — исключение. */
export function parseTag(tag) {
  const match = /^([a-z0-9][a-z0-9_-]*)\/(\d+\.\d+\.\d+)$/.exec(tag ?? '');
  if (!match) throw new Error(`тег релиза — «<мод>/<x.y.z>» (например stallium/1.1.0), а не «${tag}»`);
  return { mod: match[1], version: match[2] };
}

/** Раздел CHANGELOG версии без заголовка; нет раздела — `undefined`. */
export function changelogSection(text, version) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## ['));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

function main([command, ...args]) {
  process.chdir(ROOT);
  const versions = readVersions();
  if (command === 'matrix') {
    const { since } = takeSince(args);
    const mods = since === undefined ? modDirs() : verifyPlan(changedFiles(ROOT, since), { mods: modDirs(), exists: existsSync }).mods;
    process.stdout.write(`matrix=${JSON.stringify(buildMatrix(mods, versions))}\n`);
    return 0;
  }
  if (command === 'release') {
    const { mod, version } = parseTag(args[0]);
    const dir = `mods/${mod}`;
    if (!modDirs().includes(dir)) throw new Error(`нет мода ${mod}`);
    const props = modProperties(dir);
    if (props.mod_version !== version) {
      throw new Error(`тег ${args[0]}, а mod_version мода — ${props.mod_version}: подними версию до релиза (скилл release)`);
    }
    const section = changelogSection(readFileSync(join(dir, 'docs/CHANGELOG.md'), 'utf8'), version);
    if (!section) throw new Error(`в mods/${mod}/docs/CHANGELOG.md нет раздела [${version}]`);
    const targets = modTargets(props, versions).targets.map((target) => target.minecraft);
    process.stdout.write(`mod=${mod}\nversion=${version}\ntargets=${JSON.stringify(targets)}\n`);
    return 0;
  }
  if (command === 'changelog') {
    const [mod, version] = args;
    const section = changelogSection(readFileSync(join('mods', mod, 'docs/CHANGELOG.md'), 'utf8'), version);
    if (section === undefined) throw new Error(`в mods/${mod}/docs/CHANGELOG.md нет раздела [${version}]`);
    process.stdout.write(`${section}\n`);
    return 0;
  }
  throw new Error('команда: matrix | release <тег> | changelog <мод> <версия>');
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`ci: ${error.message}\n`);
    process.exitCode = 1;
  }
}
