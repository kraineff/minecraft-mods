#!/usr/bin/env node
// check-project — устройство мода `mods/<id>/` (rules/project.md, скилл mod-new):
//   — settings.gradle подключает build-logic (`includeBuild '../../build-logic'`) и называет
//     сборку именем папки; build.gradle применяет `kraineff.fabric-mod` и не дублирует его:
//     ни Loom, ни Minotaur, ни зависимостей minecraft / fabric-loader / fabric-api, ни блоков
//     loom / modrinth / checkstyle;
//   — gradle.properties: настройки демона `org.gradle.*` — как в корневом gradle.properties;
//   — своих gradlew, gradle/, .gitignore, .gitattributes, .github нет — они общие, в корне;
//   — есть CLAUDE.md, README.md, docs/CHANGELOG.md, docs/MODRINTH.md, fabric.mod.json;
//   — код — в пакете `com.kraineff.<id без дефисов>`, ресурсы — в `assets/<id>/` (или
//     `assets/minecraft/` для замены ванильных);
//   — docs/gallery.json (галерея Modrinth): файлы из `docs/screenshots/` существуют, у каждого
//     есть title и description.
//
//   node scripts/checks/check-project.mjs [путь…]
//
// Подавления нет: устройство исправляется, а исключение из правила — правка этой проверки.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { modId, parseProperties, ROOT } from '../lib/repo.mjs';
import { gitFiles, lineAt, read, runCli, selectMods } from './lib/cli.mjs';

const NAME = 'project';
const REQUIRED = ['CLAUDE.md', 'README.md', 'docs/CHANGELOG.md', 'docs/MODRINTH.md', 'src/main/resources/fabric.mod.json'];
const SHARED = ['gradlew', 'gradlew.bat', 'gradle', '.gitignore', '.gitattributes', '.github'];
const DUPLICATED = [
  [/net\.fabricmc\.fabric-loom|['"]fabric-loom['"]/, 'плагин Loom'],
  [/com\.modrinth\.minotaur/, 'плагин Minotaur'],
  [/com\.mojang:minecraft/, 'зависимость minecraft'],
  [/net\.fabricmc:fabric-loader/, 'зависимость fabric-loader'],
  [/net\.fabricmc\.fabric-api:fabric-api/, 'зависимость fabric-api'],
  [/^\s*(loom|modrinth|checkstyle)\s*\{/m, 'блок настройки'],
];

const at = (text, needle) => {
  const offset = text.search(needle);
  return offset < 0 ? 1 : lineAt(text, offset);
};

/** Находки мода `dir` (`root` — корень репозитория для общих настроек). */
export function checkMod(dir, root = ROOT) {
  const id = modId(dir);
  const problems = [];
  const add = (file, line, text) => problems.push({ file, line, text });

  for (const file of REQUIRED) {
    if (!existsSync(join(root, dir, file))) add(dir, 1, `нет ${file}`);
  }
  for (const name of SHARED) {
    if (existsSync(join(root, dir, name))) add(`${dir}/${name}`, 1, `${name} — общий, в корне репозитория; у мода своего нет`);
  }

  const settingsFile = `${dir}/settings.gradle`;
  const settings = existsSync(join(root, settingsFile)) ? read(join(root, settingsFile)) : '';
  if (!/includeBuild\s*\(?\s*['"]\.\.\/\.\.\/build-logic['"]/.test(settings)) {
    add(settingsFile, 1, "pluginManagement { includeBuild '../../build-logic' } — общая сборка");
  }
  if (!new RegExp(`rootProject\\.name\\s*=\\s*['"]${id}['"]`).test(settings)) {
    add(settingsFile, at(settings, /rootProject\.name/), `rootProject.name = '${id}' — имя папки мода`);
  }

  const buildFile = `${dir}/build.gradle`;
  const build = existsSync(join(root, buildFile)) ? read(join(root, buildFile)) : '';
  if (!/id\s*\(?\s*['"]kraineff\.fabric-mod['"]/.test(build)) {
    add(buildFile, 1, "plugins { id 'kraineff.fabric-mod' } — общий плагин сборки");
  }
  for (const [pattern, what] of DUPLICATED) {
    if (pattern.test(build)) add(buildFile, at(build, pattern), `${what} — уже в kraineff.fabric-mod (build-logic)`);
  }

  const propsFile = `${dir}/gradle.properties`;
  const propsText = existsSync(join(root, propsFile)) ? read(join(root, propsFile)) : '';
  const props = parseProperties(propsText);
  const rootProps = existsSync(join(root, 'gradle.properties'))
    ? parseProperties(read(join(root, 'gradle.properties')))
    : {};
  for (const [key, value] of Object.entries(rootProps).filter(([key]) => key.startsWith('org.gradle.'))) {
    if (props[key] !== value) add(propsFile, at(propsText, new RegExp(`^${key.replaceAll('.', '\\.')}`, 'm')), `${key}=${value} — как в корневом gradle.properties`);
  }

  const pkg = `com/kraineff/${id.replace(/[^a-z0-9]/g, '')}/`;
  for (const file of gitFiles([`${dir}/src`], { cwd: root })) {
    const java = /^mods\/[^/]+\/src\/[^/]+\/java\/(.+)$/.exec(file);
    if (java && file.endsWith('.java') && !java[1].startsWith(pkg)) {
      add(file, 1, `код — в пакете ${pkg.replaceAll('/', '.').slice(0, -1)}`);
    }
    const asset = /^mods\/[^/]+\/src\/[^/]+\/resources\/assets\/([^/]+)\//.exec(file);
    if (asset && asset[1] !== id && asset[1] !== 'minecraft') {
      add(file, 1, `ресурсы — в assets/${id}/ (или assets/minecraft/ для замены ванильных)`);
    }
  }

  const galleryFile = `${dir}/docs/gallery.json`;
  if (existsSync(join(root, galleryFile))) {
    const text = read(join(root, galleryFile));
    let gallery;
    try {
      gallery = JSON.parse(text);
    } catch {
      gallery = undefined; // находка check-json
    }
    for (const item of gallery?.images ?? []) {
      const line = at(text, new RegExp(`"${String(item.file).replaceAll('.', '\\.')}"`));
      if (!existsSync(join(root, dir, 'docs/screenshots', String(item.file)))) add(galleryFile, line, `нет docs/screenshots/${item.file}`);
      if (!item.title || !item.description) add(galleryFile, line, `${item.file}: нужны title и description`);
    }
    if (gallery && !Array.isArray(gallery.images)) add(galleryFile, 1, 'images — список картинок галереи');
  }
  return problems;
}

/** Каталоги внутри `mods/`, которые не моды (нет settings.gradle): забытые или недоделанные. */
function strayDirs(root) {
  const base = join(root, 'mods');
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !existsSync(join(base, entry.name, 'settings.gradle')))
    .map((entry) => `mods/${entry.name}`);
}

export const checker = {
  name: NAME,
  run({ paths }) {
    const mods = selectMods(paths);
    const stray = paths.length === 0 ? strayDirs(process.cwd()) : [];
    return {
      title: 'Устройство мода не по правилам (rules/project.md):',
      ok: `Устройство модов в порядке: проверено — ${mods.length}`,
      problems: [
        ...mods.flatMap((dir) => checkMod(dir, process.cwd())),
        ...stray.map((dir) => ({ file: dir, line: 1, text: 'папка в mods/ без settings.gradle — не мод' })),
      ],
    };
  },
};

runCli(import.meta.url, checker);
