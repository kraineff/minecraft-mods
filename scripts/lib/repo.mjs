// Устройство монорепозитория для скриптов: корень, моды `mods/<id>/`, каталог целей Minecraft
// `gradle/versions.json`, свойства мода из `gradle.properties` и цели, под которые он собирается.
// Те же правила, что у плагина сборки `build-logic/src/main/groovy/kraineff.fabric-mod.gradle`:
// цели мода — каталог начиная с `mc_since`, цель по умолчанию — последний релиз.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Корень репозитория: скрипт лежит в `scripts/lib/`. */
export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const VERSIONS_FILE = 'gradle/versions.json';

/** Каталог версий `gradle/versions.json`: Java, Loader, Loom, Minotaur, Checkstyle и цели. */
export function readVersions(root = ROOT) {
  return JSON.parse(readFileSync(join(root, VERSIONS_FILE), 'utf8'));
}

/** Моды: `mods/<id>` с `settings.gradle`, по алфавиту. */
export function modDirs(root = ROOT) {
  const base = join(root, 'mods');
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(base, entry.name, 'settings.gradle')))
    .map((entry) => `mods/${entry.name}`)
    .sort();
}

/** Мод файла: `mods/stallium/src/x.java` → `mods/stallium`; вне модов — `undefined`. */
export function modOf(file) {
  return /^mods\/[^/]+/.exec(file.replace(/^\.\//, ''))?.[0];
}

/** Id мода по каталогу: `mods/stallium` → `stallium`. */
export const modId = (dir) => dir.split('/').pop();

/** `key=value` из `.properties`: без комментариев и пустых строк, пробелы вокруг `=` срезаны. */
export function parseProperties(text) {
  const props = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const at = line.search(/[=:]/);
    if (at < 0) continue;
    props[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return props;
}

/** `gradle.properties` мода; нет файла — `{}`. */
export function modProperties(dir, root = ROOT) {
  const file = join(root, dir, 'gradle.properties');
  return existsSync(file) ? parseProperties(readFileSync(file, 'utf8')) : {};
}

/** Пререлиз Minecraft: снапшот, pre или rc (`26.4-snapshot-2`, `26.3-pre-1`). */
export const isPrerelease = (minecraft) => minecraft.includes('-');

const STAGES = { snapshot: 0, pre: 1, rc: 2 };

/**
 * Версия Minecraft новой схемы (с 26.1): `26.3`, `26.1.2`, `26.4-snapshot-2`, `26.3-pre-1`,
 * `26.3-rc-3` → `{ major, minor, patch, stage, n }` (`stage` 3 — релиз); иначе `undefined`
 * (старые `1.21.x`, первоапрельские `26w14a`).
 */
export function parseMinecraft(version) {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?(?:-(snapshot|pre|rc)-(\d+))?$/.exec(version);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0),
    stage: match[4] ? STAGES[match[4]] : 3,
    n: Number(match[5] ?? 0),
  };
}

/** Порядок версий Minecraft: снапшоты < pre < rc < релиз < его патчи; линии — по номеру. */
export function compareMinecraft(a, b) {
  const [x, y] = [parseMinecraft(a), parseMinecraft(b)];
  if (!x || !y) return a.localeCompare(b);
  for (const key of ['major', 'minor', 'patch', 'stage', 'n']) {
    if (x[key] !== y[key]) return x[key] - y[key];
  }
  return 0;
}

/** Линия версии: `26.4-snapshot-2` → `26.4`, `26.1.2` → `26.1`. */
export function lineOf(minecraft) {
  const match = /^(\d+)\.(\d+)/.exec(minecraft);
  return match ? `${match[1]}.${match[2]}` : minecraft;
}

/**
 * Цели мода — каталог начиная с `mc_since`. Ошибка — строкой в `error`: нет `mc_since` или
 * такой цели нет в каталоге.
 */
export function modTargets(props, versions) {
  const since = props.mc_since;
  if (!since) return { targets: [], error: 'нет mc_since — первой цели Minecraft мода' };
  const first = versions.targets.findIndex((target) => target.minecraft === since);
  if (first < 0) {
    const known = versions.targets.map((target) => target.minecraft).join(', ');
    return { targets: [], error: `mc_since=${since} нет среди целей ${VERSIONS_FILE} (${known})` };
  }
  return { targets: versions.targets.slice(first) };
}

/** Цель по умолчанию: последний релиз, а без релизов — последняя цель. */
export function defaultTarget(targets) {
  const releases = targets.filter((target) => !isPrerelease(target.minecraft));
  return (releases.at(-1) ?? targets.at(-1))?.minecraft;
}

/**
 * Диапазон версий Minecraft для `fabric.mod.json` по цели: релиз `X.Y` — `>=X.Y <X.(Y+1)-`
 * (патчи `X.Y.Z` входят), пререлиз линии — `>=X.Y- <X.(Y+1)-` (все её снапшоты и релиз).
 */
export function rangeOf(minecraft) {
  const [major, minor] = lineOf(minecraft).split('.').map(Number);
  const lower = isPrerelease(minecraft) ? `${major}.${minor}-` : lineOf(minecraft);
  return `>=${lower} <${major}.${minor + 1}-`;
}

/** Таблица целей мода для README: сборка (JAR) и версии Minecraft, куда она публикуется. */
export function renderTargetsTable(id, props, targets) {
  const rows = targets.map((target) => [
    `\`${id}-${props.mod_version}+${target.minecraft}.jar\``,
    target.modrinth.join(', '),
  ]);
  const header = ['Сборка', 'Minecraft'];
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells) => `| ${cells.map((cell, k) => cell.padEnd(widths[k])).join(' | ')} |`;
  return [
    line(header),
    `|${widths.map((width) => '-'.repeat(width + 2)).join('|')}|`,
    ...rows.map(line),
  ].join('\n');
}

export const TARGETS_START = '<!-- targets: генерирует npm run sync -->';
export const TARGETS_END = '<!-- /targets -->';

/**
 * README с обновлённым блоком целей между метками; `undefined` — меток нет. Блок целиком
 * выводится из каталога и `gradle.properties`, руками его не правят.
 */
export function withTargetsTable(readme, table) {
  const start = readme.indexOf(TARGETS_START);
  const end = readme.indexOf(TARGETS_END);
  if (start < 0 || end < start) return undefined;
  return `${readme.slice(0, start + TARGETS_START.length)}\n${table}\n${readme.slice(end)}`;
}

/** Форма слова по числу: `plural(4, 'сборка', 'сборки', 'сборок')` → `сборки`. */
export function plural(n, one, few, many) {
  const tens = Math.abs(n) % 100;
  const units = tens % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;
  return many;
}
