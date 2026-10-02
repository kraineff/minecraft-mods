#!/usr/bin/env node
// check-mixins — миксины мода сходятся с конфигами и написаны по правилам (rules/code.md):
//   — конфиг из `mixins` в fabric.mod.json существует; в нём `required: true`,
//     `injectors.defaultRequire: 1` (не применившаяся инъекция — падение при запуске, а не тихая
//     поломка), `compatibilityLevel: JAVA_<java>` из gradle/versions.json;
//   — каждый класс из списков конфига есть в своём наборе исходников (`client` — в src/client,
//     если наборы раздельные; `mixins` и `server` — в src/main), а каждый класс с @Mixin —
//     в каком-то конфиге: неуказанный миксин молча не применится;
//   — обработчики инъекций (@Inject, @Redirect, @Modify…, @Wrap…) — с префиксом `<мод>$`;
//     поля — @Shadow или @Unique; методы без инъекции — @Shadow, @Unique, @Accessor, @Invoker;
//     @Overwrite — нельзя: ломает чужие миксины на тот же метод;
//   — обычный код не импортирует классы миксинов (кроме интерфейсов-аксессоров `…Accessor` /
//     `…Invoker`): класс миксина нельзя загрузить напрямую.
//
//   node scripts/checks/check-mixins.mjs [путь…]
//
// Подавление в Java: `// check-mixins: причина` на строке находки или строкой выше.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { modId, readVersions } from '../lib/repo.mjs';
import {
  javaFiles,
  lineAt,
  read,
  runCli,
  selectMods,
  suppressed,
  unsuppressed,
} from './lib/cli.mjs';
import { importsOf, maskJava, members, packageOf, topType } from './lib/java.mjs';

const NAME = 'mixins';
const INJECTORS = new Set([
  'Inject', 'Redirect', 'ModifyArg', 'ModifyArgs', 'ModifyVariable', 'ModifyConstant',
  'ModifyExpressionValue', 'ModifyReturnValue', 'ModifyReceiver', 'WrapOperation',
  'WrapWithCondition', 'WrapMethod',
]);
const MEMBER_OK = new Set(['Shadow', 'Unique', 'Accessor', 'Invoker']);
const LISTS = { mixins: 'main', server: 'main', client: 'client' };

/** Наборы исходников мода: `main`, `client`, `gametest`… — папки `src/<набор>/`. */
function sourceSets(dir) {
  const base = join(dir, 'src');
  return existsSync(base) ? readdirSync(base).filter((name) => existsSync(join(base, name, 'java'))) : [];
}

/** Ресурс мода по относительному пути: первый `src/<набор>/resources/<путь>`, иначе `undefined`. */
function findResource(dir, path) {
  const base = join(dir, 'src');
  if (!existsSync(base)) return undefined;
  for (const set of readdirSync(base)) {
    const file = join(base, set, 'resources', path);
    if (existsSync(file)) return file;
  }
  return undefined;
}

/** Строка ключа в тексте JSON (с 1); нет — 1. */
function keyLine(text, key) {
  const at = text.indexOf(`"${key}"`);
  return at < 0 ? 1 : lineAt(text, at);
}

/** Находки в классе миксина: `[{ line, text }]` (без подавлений). */
export function checkMixinClass(source, prefix) {
  const masked = maskJava(source);
  const type = topType(source, masked);
  if (!type) return [];
  const problems = [];
  for (const member of members(source, masked)) {
    const names = member.annotations.map((annotation) => annotation.name);
    const line = lineAt(source, member.start);
    if (names.includes('Overwrite')) {
      problems.push({ line, text: `@Overwrite ${member.name}: ломает чужие миксины — @Inject / @WrapOperation` });
      continue;
    }
    if (member.kind === 'method' && names.some((name) => INJECTORS.has(name))) {
      if (!member.name.startsWith(prefix)) {
        problems.push({ line, text: `обработчик ${member.name}: имя с префиксом ${prefix}` });
      }
      continue;
    }
    if (member.kind === 'field' && !names.some((name) => MEMBER_OK.has(name))) {
      problems.push({ line, text: `поле ${member.name}: @Shadow (поле цели) или @Unique (своё)` });
    }
    const constructor = member.name === type.name;
    if (member.kind === 'method' && !constructor && !names.some((name) => MEMBER_OK.has(name))) {
      problems.push({ line, text: `метод ${member.name}: @Shadow, @Unique или аннотация инъекции` });
    }
  }
  return problems;
}

/** Находки мода `dir`: `[{ file, line, text }]`. */
export function checkMod(dir, versions) {
  const problems = [];
  const modJsonFile = join(dir, 'src/main/resources/fabric.mod.json');
  if (!existsSync(modJsonFile)) return problems; // нет fabric.mod.json — находка check-modjson
  let modJson;
  try {
    modJson = JSON.parse(read(modJsonFile));
  } catch {
    return problems; // битый JSON — находка check-json
  }
  const id = modJson.id ?? modId(dir);
  const prefix = `${id.replace(/[^A-Za-z0-9_]/g, '_')}$`;
  const sets = sourceSets(dir);
  const split = sets.includes('client');
  const files = javaFiles([dir]);
  const listed = new Map();

  for (const entry of modJson.mixins ?? []) {
    const name = typeof entry === 'string' ? entry : entry?.config;
    if (typeof name !== 'string') continue;
    const file = findResource(dir, name);
    if (!file) {
      problems.push({ file: modJsonFile, line: keyLine(read(modJsonFile), 'mixins'), text: `конфиг миксинов ${name} не найден в src/*/resources` });
      continue;
    }
    const text = read(file);
    let config;
    try {
      config = JSON.parse(text);
    } catch {
      continue; // находка check-json
    }
    const at = (key) => ({ file, line: keyLine(text, key) });
    if (config.required !== true) problems.push({ ...at('required'), text: 'required: true — без него сбой миксина молча пропускается' });
    if (config.injectors?.defaultRequire !== 1) problems.push({ ...at('injectors'), text: 'injectors.defaultRequire: 1 — неприменившаяся инъекция должна ронять запуск' });
    if (config.compatibilityLevel !== `JAVA_${versions.java}`) problems.push({ ...at('compatibilityLevel'), text: `compatibilityLevel: JAVA_${versions.java} (Java из gradle/versions.json)` });
    if (typeof config.package !== 'string') {
      problems.push({ ...at('package'), text: 'нет package' });
      continue;
    }
    for (const [list, set] of Object.entries(LISTS)) {
      for (const short of config[list] ?? []) {
        const fqn = `${config.package}.${short}`;
        const path = `${fqn.replaceAll('.', '/')}.java`;
        const where = files.find((candidate) => candidate.endsWith(`/java/${path}`));
        const expected = split ? set : 'main';
        if (!where) {
          problems.push({ ...at(list), text: `миксин ${short} из «${list}» не найден (${path})` });
          continue;
        }
        if (!where.startsWith(`${dir}/src/${expected}/`)) {
          problems.push({ ...at(list), text: `миксин ${short} из «${list}» лежит в ${where.split('/')[3]}, а должен в src/${expected}` });
        }
        listed.set(fqn, where);
      }
    }
  }

  const mixinPackages = new Set();
  for (const file of files) {
    const source = read(file);
    const masked = maskJava(source);
    const type = topType(source, masked);
    if (!type?.annotations.some((annotation) => annotation.name === 'Mixin')) continue;
    const fqn = `${packageOf(source, masked)}.${type.name}`;
    mixinPackages.add(packageOf(source, masked));
    if (!listed.has(fqn)) {
      problems.push({ file, line: 1, text: `@Mixin ${type.name} нет ни в одном конфиге миксинов — не применится` });
    }
    for (const problem of unsuppressed(source, checkMixinClass(source, prefix), NAME)) {
      problems.push({ file, ...problem });
    }
  }

  for (const file of files) {
    const source = read(file);
    const masked = maskJava(source);
    const own = packageOf(source, masked);
    if (mixinPackages.has(own)) continue;
    const lines = source.split('\n');
    for (const imported of importsOf(source, masked)) {
      const pkg = imported.slice(0, imported.lastIndexOf('.'));
      if (!mixinPackages.has(pkg) || /(Accessor|Invoker)$/.test(imported)) continue;
      const line = lineAt(source, masked.indexOf(imported));
      if (suppressed(lines, line, NAME)) continue;
      problems.push({ file, line, text: `импорт класса миксина ${imported}: его нельзя загрузить напрямую` });
    }
  }
  return problems;
}

export const checker = {
  name: NAME,
  run({ paths }) {
    const versions = readVersions(process.cwd());
    const mods = selectMods(paths);
    const problems = mods.flatMap((dir) => checkMod(dir, versions));
    return {
      title: 'Миксины не сходятся с конфигами или нарушают правила (rules/code.md):',
      ok: `Миксины в порядке: проверено модов — ${mods.length}`,
      problems,
    };
  },
};

runCli(import.meta.url, checker);
