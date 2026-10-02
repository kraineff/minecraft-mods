#!/usr/bin/env node
// check-modjson — `fabric.mod.json` мода сходится со сборкой и кодом:
//   — `id` — имя папки мода; `version` — `${version}`, `depends.minecraft` — `${minecraft_range}`
//     (их подставляет плагин сборки по цели); `depends.java` — `>=<java>` из gradle/versions.json;
//     `depends.fabricloader` задан; `depends.fabric-api` — если код импортирует Fabric API;
//   — есть `name`, `description`, `authors`, `license`, `icon`, и иконка лежит в ресурсах;
//   — классы точек входа (`entrypoints`) есть в исходниках; у мода для обеих сторон
//     (`environment` не `client`) точки `main` и `server` — в src/main: клиентский набор на
//     сервере не загрузится;
//   — `mixins` и `accessWidener` указывают на существующие файлы;
//   — gametest-мод (`src/gametest`): id `<мод>-gametest`, зависит от мода, точки входа есть.
//
//   node scripts/checks/check-modjson.mjs [путь…]
//
// Подавления нет: в JSON нет комментариев — расхождение исправляется.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { modId, readVersions } from '../lib/repo.mjs';
import { javaFiles, lineAt, read, runCli, selectMods } from './lib/cli.mjs';

const NAME = 'modjson';

const keyLine = (text, key) => {
  const at = text.indexOf(`"${key}"`);
  return at < 0 ? 1 : lineAt(text, at);
};

/** Ресурс мода по относительному пути: `src/<набор>/resources/<путь>` или `undefined`. */
function findResource(dir, path) {
  const src = join(dir, 'src');
  if (!existsSync(src)) return undefined;
  for (const set of readdirSync(src)) {
    const file = join(src, set, 'resources', path);
    if (existsSync(file)) return file;
  }
  return undefined;
}

/** Класс точки входа: строка или `{ value }`; `Класс::поле` → класс. */
const entryClass = (entry) => String(typeof entry === 'string' ? entry : entry?.value).split('::')[0];

/** Файл класса в исходниках мода или `undefined`. */
const classFile = (files, fqn) => files.find((file) => file.endsWith(`/java/${fqn.replaceAll('.', '/')}.java`));

/** Находки основного `fabric.mod.json` мода. */
export function checkModJson(dir, json, text, { java, files }) {
  const file = join(dir, 'src/main/resources/fabric.mod.json');
  const problems = [];
  const at = (key, message) => problems.push({ file, line: keyLine(text, key), text: message });
  const id = modId(dir);

  if (json.id !== id) at('id', `id «${json.id}» — должен совпадать с папкой мода «${id}»`);
  if (json.version !== '${version}') at('version', 'version — "${version}": версию подставляет сборка');
  for (const key of ['name', 'description', 'license', 'icon']) {
    if (typeof json[key] !== 'string' || json[key].trim() === '') at(key, `нет ${key}`);
  }
  if (!Array.isArray(json.authors) || json.authors.length === 0) at('authors', 'нет authors');
  if (typeof json.icon === 'string' && !findResource(dir, json.icon)) {
    at('icon', `иконки ${json.icon} нет в ресурсах`);
  }

  const depends = json.depends ?? {};
  if (depends.minecraft !== '${minecraft_range}') {
    at('minecraft', 'depends.minecraft — "${minecraft_range}": диапазон подставляет сборка по цели');
  }
  if (depends.java !== `>=${java}`) at('java', `depends.java — ">=${java}" (gradle/versions.json)`);
  if (!depends.fabricloader) at('depends', 'нет depends.fabricloader');
  const usesApi = files.some((path) => /^import\s+net\.fabricmc\.fabric\.api\./m.test(read(path)));
  if (usesApi && !depends['fabric-api']) at('depends', 'код использует Fabric API — нужен depends.fabric-api');

  const bothSides = json.environment !== 'client' && json.environment !== 'server';
  for (const [kind, entries] of Object.entries(json.entrypoints ?? {})) {
    for (const entry of entries) {
      const fqn = entryClass(entry);
      const where = classFile(files, fqn);
      if (!where) {
        at(kind, `точка входа ${kind}: класса ${fqn} нет в исходниках`);
      } else if (bothSides && (kind === 'main' || kind === 'server') && !where.startsWith(`${dir}/src/main/`)) {
        at(kind, `точка входа ${kind}: ${fqn} — в src/main, клиентский набор на сервере не загрузится`);
      }
    }
  }
  for (const entry of json.mixins ?? []) {
    const config = typeof entry === 'string' ? entry : entry?.config;
    if (typeof config === 'string' && !findResource(dir, config)) at('mixins', `конфига миксинов ${config} нет в ресурсах`);
  }
  if (typeof json.accessWidener === 'string' && !findResource(dir, json.accessWidener)) {
    at('accessWidener', `access widener ${json.accessWidener} не найден`);
  }
  return problems;
}

/** Находки `fabric.mod.json` gametest-мода. */
export function checkGametestJson(dir, json, text, { files }) {
  const file = join(dir, 'src/gametest/resources/fabric.mod.json');
  const problems = [];
  const at = (key, message) => problems.push({ file, line: keyLine(text, key), text: message });
  const id = modId(dir);
  if (json.id !== `${id}-gametest`) at('id', `id gametest-мода — «${id}-gametest» (плагин сборки)`);
  if (!json.depends?.[id]) at('depends', `gametest-мод зависит от мода: depends.${id}`);
  for (const [kind, entries] of Object.entries(json.entrypoints ?? {})) {
    for (const entry of entries) {
      const fqn = entryClass(entry);
      if (!classFile(files, fqn)) at(kind, `точка входа ${kind}: класса ${fqn} нет в исходниках`);
    }
  }
  return problems;
}

/** Находки мода `dir`. */
export function checkMod(dir, versions) {
  const files = javaFiles([dir]);
  const main = join(dir, 'src/main/resources/fabric.mod.json');
  if (!existsSync(main)) return [{ file: dir, line: 1, text: 'нет src/main/resources/fabric.mod.json' }];
  const problems = [];
  const parse = (file) => {
    try {
      const text = read(file);
      return { text, json: JSON.parse(text) };
    } catch {
      return undefined; // битый JSON — находка check-json
    }
  };
  const parsed = parse(main);
  if (parsed) problems.push(...checkModJson(dir, parsed.json, parsed.text, { java: versions.java, files }));
  const gametest = join(dir, 'src/gametest/resources/fabric.mod.json');
  if (existsSync(join(dir, 'src/gametest'))) {
    const test = existsSync(gametest) ? parse(gametest) : undefined;
    if (!existsSync(gametest)) problems.push({ file: dir, line: 1, text: 'есть src/gametest, но нет src/gametest/resources/fabric.mod.json' });
    else if (test) problems.push(...checkGametestJson(dir, test.json, test.text, { files }));
  }
  return problems;
}

export const checker = {
  name: NAME,
  run({ paths }) {
    const versions = readVersions(process.cwd());
    const mods = selectMods(paths);
    return {
      title: 'fabric.mod.json расходится со сборкой или кодом:',
      ok: `fabric.mod.json в порядке: проверено модов — ${mods.length}`,
      problems: mods.flatMap((dir) => checkMod(dir, versions)),
    };
  },
};

runCli(import.meta.url, checker);
