#!/usr/bin/env node
// new-mod — каркас нового мода `mods/<id>/` по правилам монорепозитория (скилл mod-new):
// сборка через kraineff.fabric-mod, gradle.properties с последним релизом в mc_since,
// fabric.mod.json, точки входа, пустой конфиг миксинов, переводы en_us/ru_ru, иконка-заглушка,
// CLAUDE.md, README с блоком целей, docs/CHANGELOG.md и docs/MODRINTH.md. Каркас сразу
// проходит check-all и собирается.
//
//   node scripts/new-mod.mjs <id> "<Название>" [--client]
//
// `id` — id мода Fabric: латиница в нижнем регистре, цифры, дефис (`horse-tweaks`).
// `--client` — только клиентский мод (как stallium): `environment: client`, код — в src/client;
// без флага — мод для обеих сторон: ModInitializer в src/main и ClientModInitializer в src/client.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { isMain } from './checks/lib/cli.mjs';
import { defaultTarget, parseProperties, ROOT, readVersions } from './lib/repo.mjs';
import { pendingReadmes } from './sync.mjs';

const ID = /^[a-z][a-z0-9-]{1,63}$/;

/** Имя класса из названия: «Horse Tweaks» → `HorseTweaks`. */
export function pascal(name) {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');
}

/** PNG `size`×`size` одного цвета — иконка-заглушка, пока нет настоящей. */
export function solidPng(size, [r, g, b]) {
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) raw.set([r, g, b], y * row + 1 + x * 3);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 бит, RGB, без чересстрочности
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Файлы каркаса: `{ путь: содержимое }` (пути — внутри `mods/<id>/`). */
export function scaffold({ id, name, client, since, java, gradleProps }) {
  const pkg = `com.kraineff.${id.replace(/[^a-z0-9]/g, '')}`;
  const path = pkg.replaceAll('.', '/');
  const cls = pascal(name);
  const mainClass = `${pkg}.${cls}`;
  const clientClass = `${pkg}.${cls}Client`;
  const daemon = Object.entries(gradleProps)
    .filter(([key]) => key.startsWith('org.gradle.'))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const entrypoints = client ? { client: [clientClass] } : { main: [mainClass], client: [clientClass] };
  const files = {};

  files['settings.gradle'] = `// Сборка мода — общая для монорепозитория: плагин kraineff.fabric-mod из build-logic/.
// Из корня: ./gradlew -p mods/${id} build [-PtargetMc=<цель>]
pluginManagement {
	includeBuild '../../build-logic'
	// Откуда брать Loom и Minotaur — зависимости плагина build-logic
	repositories {
		maven {
			name = 'Fabric'
			url = 'https://maven.fabricmc.net/'
		}
		gradlePluginPortal()
	}
}

rootProject.name = '${id}'
`;
  files['build.gradle'] = `plugins {
	id 'kraineff.fabric-mod'
}
`;
  files['gradle.properties'] = `# Каждый мод — отдельная сборка Gradle: настройки демона у него свои.
${daemon}

# Версия мода и первая цель Minecraft; цели — gradle/versions.json (скилл targets)
mod_version=0.1.0
mc_since=${since}
`;
  files['src/main/resources/fabric.mod.json'] = `${JSON.stringify(
    {
      schemaVersion: 1,
      id,
      version: '${version}',
      name,
      description: 'TODO: one sentence for players.',
      authors: ['Kraineff'],
      contact: { homepage: `https://modrinth.com/mod/${id}` },
      license: 'MIT',
      icon: `assets/${id}/icon.png`,
      environment: client ? 'client' : '*',
      entrypoints,
      mixins: [{ config: `${id}.client.mixins.json`, environment: 'client' }],
      depends: {
        fabricloader: '>=0.19.0',
        minecraft: '${minecraft_range}',
        java: `>=${java}`,
        'fabric-api': '*',
      },
    },
    null,
    '\t',
  )}\n`;
  files[`src/client/resources/${id}.client.mixins.json`] = `${JSON.stringify(
    {
      required: true,
      package: `${pkg}.mixin`,
      compatibilityLevel: `JAVA_${java}`,
      client: [],
      injectors: { defaultRequire: 1 },
      overwrites: { requireAnnotations: true },
    },
    null,
    '\t',
  )}\n`;
  files[`src/main/resources/assets/${id}/lang/en_us.json`] = '{}\n';
  files[`src/main/resources/assets/${id}/lang/ru_ru.json`] = '{}\n';

  const logger = (className) =>
    `\tprivate static final Logger log = LoggerFactory.getLogger("${pkg}.${className}");\n`;
  if (!client) {
    files[`src/main/java/${path}/${cls}.java`] = `package ${pkg};

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ${cls} implements ModInitializer {
	public static final String MOD_ID = "${id}";

${logger(cls)}
	@Override
	public void onInitialize() {
		log.info("[${name}]: Initialized");
	}
}
`;
    files[`src/client/java/${path}/${cls}Client.java`] = `package ${pkg};

import net.fabricmc.api.ClientModInitializer;

public class ${cls}Client implements ClientModInitializer {
	@Override
	public void onInitializeClient() {
	}
}
`;
  } else {
    files[`src/client/java/${path}/${cls}Client.java`] = `package ${pkg};

import net.fabricmc.api.ClientModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ${cls}Client implements ClientModInitializer {
	public static final String MOD_ID = "${id}";

${logger(`${cls}Client`)}
	@Override
	public void onInitializeClient() {
		log.info("[${name}]: Initialized");
	}
}
`;
  }

  files['CLAUDE.md'] = `# ${name}

${client ? 'Клиентский' : 'Fabric-'}мод монорепозитория: <!-- заполнить: что делает мод, одним абзацем -->

Общие правила — корневой \`CLAUDE.md\` и \`.claude/rules/\`. Сборка, цели и проверки — как у всех
модов (скиллы \`targets\`, \`checks\`); здесь — только то, что свойственно этому моду.

## Как устроено

\`\`\`
${pkg}
├── ${client ? `${cls}Client      — точка входа (клиент)` : `${cls}            — точка входа (обе стороны)\n├── ${cls}Client      — точка входа (клиент)`}
└── mixin/            — миксины (${id}.client.mixins.json)
\`\`\`

## Документы

- \`README.md\` — для людей: возможности, версии, сборка.
- \`docs/CHANGELOG.md\` — изменения для игроков (по-английски, уходит на Modrinth).
- \`docs/MODRINTH.md\` — страница проекта на Modrinth (по-английски).
`;
  files['README.md'] = `# ${name}

<!-- заполнить: что делает мод — для игроков, по-русски -->

## Версии

${client ? 'Клиентский мод: на сервер ставить не нужно. ' : ''}Требует Fabric Loader ≥ 0.19 и Fabric API.

<!-- targets: генерирует npm run sync -->
<!-- /targets -->

## Сборка

Команды — из корня монорепозитория:

\`\`\`bash
./gradlew -p mods/${id} build                     # цель по умолчанию — последний релиз
./gradlew -p mods/${id} runClient                 # запустить клиент с модом
npm run build -- ${id} --all-targets              # все цели подряд
\`\`\`

## Релиз

Тег \`${id}/x.y.z\` на GitHub Release — CI соберёт все цели и опубликует их на Modrinth
(скилл \`release\`).
`;
  files['docs/CHANGELOG.md'] = `# Changelog

All notable changes to ${name} are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this changelog
is what gets published to Modrinth for each release. One line per entry,
written for players — what changed for you, not how it was implemented.

## [Unreleased]
`;
  files['docs/MODRINTH.md'] = `${name} — TODO: what the mod does, for players.

## Features

- TODO

## Requirements

Requires Fabric Loader and Fabric API.
`;
  return files;
}

function main(argv) {
  const client = argv.includes('--client');
  const [id, name] = argv.filter((arg) => !arg.startsWith('--'));
  if (!id || !name) throw new Error('node scripts/new-mod.mjs <id> "<Название>" [--client]');
  if (!ID.test(id)) throw new Error(`id «${id}» — латиница в нижнем регистре, цифры, дефис; с буквы`);
  const base = join(ROOT, 'mods', id);
  if (existsSync(base)) throw new Error(`mods/${id} уже есть`);
  const versions = readVersions();
  const since = defaultTarget(versions.targets);
  const gradleProps = parseProperties(readFileSync(join(ROOT, 'gradle.properties'), 'utf8'));
  const files = scaffold({ id, name, client, since, java: versions.java, gradleProps });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(base, path)), { recursive: true });
    writeFileSync(join(base, path), text);
  }
  const hue = [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const icon = join(base, `src/main/resources/assets/${id}/icon.png`);
  writeFileSync(icon, solidPng(128, [(hue * 53) % 200 + 30, (hue * 97) % 200 + 30, (hue * 151) % 200 + 30]));
  for (const { file, text } of pendingReadmes().pending) writeFileSync(join(ROOT, file), text);
  process.stdout.write(
    `Создан mods/${id} (mc_since=${since}${client ? ', клиентский' : ''}).\n` +
      `Дальше (скилл mod-new): заполнить CLAUDE.md, README.md, docs/MODRINTH.md и description\n` +
      `в fabric.mod.json, заменить иконку; проверить: npm run verify:changed.\n`,
  );
}

if (isMain(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`new-mod: ${error.message}\n`);
    process.exitCode = 1;
  }
}
