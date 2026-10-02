#!/usr/bin/env node
// check-targets — каталог целей Minecraft `gradle/versions.json` и цели модов в порядке:
//   — `java`, `loader`, `loom`, `minotaur`, `checkstyle` заданы;
//   — цели — по возрастанию, по одной на линию (`26.3`, `26.4-snapshot-2`): у линии либо релиз,
//     либо последний пререлиз; `fabricApi` — сборка Fabric API своей линии (`…+26.3`);
//     `range` — диапазон линии (`>=26.3 <26.4-`, у пререлиза `>=26.4- <26.5-`); `modrinth` —
//     версии той же линии, среди них сама цель;
//   — у мода в gradle.properties есть `mod_version` (x.y.z) и `mc_since` из каталога;
//   — блок целей в README мода совпадает с каталогом (генерирует `npm run sync`).
//
//   node scripts/checks/check-targets.mjs [путь…]
//
// Обновляет каталог `npm run versions -- --write` (скилл targets). Подавления нет: каталог —
// JSON, расхождение исправляется.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  compareMinecraft,
  lineOf,
  modId,
  modProperties,
  modTargets,
  parseMinecraft,
  rangeOf,
  readVersions,
  renderTargetsTable,
  TARGETS_END,
  TARGETS_START,
  VERSIONS_FILE,
  withTargetsTable,
} from '../lib/repo.mjs';
import { lineAt, read, runCli, selectMods, underRoot } from './lib/cli.mjs';

const NAME = 'targets';
const SEMVER = /^\d+\.\d+\.\d+$/;

/** Находки каталога: `[{ file, line, text }]`; `text` — исходник для номеров строк. */
export function checkCatalog(versions, text = '') {
  const problems = [];
  const at = (needle, message) => {
    const offset = needle ? text.indexOf(needle) : -1;
    problems.push({ file: VERSIONS_FILE, line: offset < 0 ? 1 : lineAt(text, offset), text: message });
  };
  if (!Number.isInteger(versions.java)) at('"java"', 'java — номер версии Java (25)');
  for (const key of ['loader', 'loom', 'minotaur', 'checkstyle']) {
    if (typeof versions[key] !== 'string' || !SEMVER.test(versions[key])) at(`"${key}"`, `${key} — версия x.y.z`);
  }
  if (!Array.isArray(versions.targets) || versions.targets.length === 0) {
    at('"targets"', 'нет целей');
    return problems;
  }
  const lines = new Set();
  versions.targets.forEach((target, index) => {
    const mc = target?.minecraft;
    const here = `"minecraft": "${mc}"`;
    if (typeof mc !== 'string' || !parseMinecraft(mc)) {
      at(here, `цель ${index + 1}: minecraft «${mc}» не версия новой схемы (26.3, 26.4-snapshot-2)`);
      return;
    }
    const line = lineOf(mc);
    if (lines.has(line)) at(here, `${mc}: вторая цель линии ${line} — у линии одна цель (релиз или последний пререлиз)`);
    lines.add(line);
    const previous = versions.targets[index - 1]?.minecraft;
    if (previous && parseMinecraft(previous) && compareMinecraft(previous, mc) >= 0) {
      at(here, `${mc}: цели — по возрастанию (после ${previous})`);
    }
    const api = /^\d+\.\d+\.\d+\+(.+)$/.exec(target.fabricApi ?? '');
    if (!api) at(here, `${mc}: fabricApi — версия Fabric API вида 0.161.0+26.3`);
    else if (lineOf(api[1]) !== line) at(here, `${mc}: fabricApi ${target.fabricApi} — сборка для линии ${lineOf(api[1])}, а не ${line}`);
    if (target.range !== rangeOf(mc)) at(here, `${mc}: range — "${rangeOf(mc)}"`);
    if (!Array.isArray(target.modrinth) || !target.modrinth.includes(mc)) {
      at(here, `${mc}: modrinth — версии для публикации, среди них сама ${mc}`);
    } else {
      for (const version of target.modrinth) {
        if (lineOf(version) !== line) at(here, `${mc}: modrinth ${version} — не линия ${line}`);
      }
    }
  });
  return problems;
}

/** Находки мода: свойства и блок целей в README. */
export function checkMod(dir, versions) {
  const problems = [];
  const props = modProperties(dir, process.cwd());
  const file = join(dir, 'gradle.properties');
  const propsText = existsSync(file) ? read(file) : '';
  const at = (key) => {
    const offset = propsText.indexOf(`${key}=`);
    return offset < 0 ? 1 : lineAt(propsText, offset);
  };
  if (!SEMVER.test(props.mod_version ?? '')) {
    problems.push({ file, line: at('mod_version'), text: 'mod_version — версия мода x.y.z' });
  }
  const { targets, error } = modTargets(props, versions);
  if (error) {
    problems.push({ file, line: at('mc_since'), text: error });
    return problems;
  }
  const readme = join(dir, 'README.md');
  if (!existsSync(readme)) return problems; // нет README — находка check-project
  const text = read(readme);
  const table = renderTargetsTable(modId(dir), props, targets);
  const synced = withTargetsTable(text, table);
  if (synced === undefined) {
    problems.push({ file: readme, line: 1, text: `нет блока целей ${TARGETS_START} … ${TARGETS_END}` });
  } else if (synced !== text) {
    const offset = text.indexOf(TARGETS_START);
    problems.push({ file: readme, line: lineAt(text, offset), text: 'блок целей отстал от gradle/versions.json — npm run sync' });
  }
  return problems;
}

export const checker = {
  name: NAME,
  run({ paths }) {
    const text = read(VERSIONS_FILE);
    const versions = readVersions(process.cwd());
    const catalog = paths.length === 0 || paths.some((path) => underRoot(VERSIONS_FILE, path));
    const mods = selectMods(paths);
    return {
      title: 'Цели Minecraft не в порядке (скилл targets):',
      ok: `Цели в порядке: ${versions.targets.length} в каталоге, модов — ${mods.length}`,
      problems: [
        ...(catalog ? checkCatalog(versions, text) : []),
        ...mods.flatMap((dir) => checkMod(dir, versions)),
      ],
    };
  },
};

runCli(import.meta.url, checker);
