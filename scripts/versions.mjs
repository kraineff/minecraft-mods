#!/usr/bin/env node
// versions — что вышло нового против каталога `gradle/versions.json` (скилл targets):
// версии Minecraft (манифест Mojang), Fabric API под каждую (Modrinth), Fabric Loader,
// Loom, Checkstyle и Gradle. Маппинги не нужны: с 26.1 игра выходит без обфускации.
//
//   node scripts/versions.mjs            — отчёт: что обновить и что ещё ждёт Fabric API
//   node scripts/versions.mjs --write    — применить к каталогу цели и Loader, обновить mc_since
//                                          модов и блоки целей в README (scripts/sync.mjs)
//   node scripts/versions.mjs --json     — то же данными (хук начала сессии)
//
// Правила целей (`--write`):
//   — Fabric API цели — последняя сборка для её версии Minecraft;
//   — у линии одна цель: пререлиз (`26.4-snapshot-2`) сменяется более новым пререлизом или
//     релизом линии, как только под него вышел Fabric API; мод с `mc_since` на старой цели
//     переходит на новую;
//   — патчи релиза (`26.3.1`) добавляются в `modrinth` цели, если их поддерживает Fabric API
//     цели: JAR тот же, диапазон `>=26.3 <26.4-` их уже покрывает;
//   — новая линия (`26.5-snapshot-1`) добавляется целью в конец, когда под неё есть Fabric API.
// Loom, Checkstyle и Gradle — только в отчёте: их обновление может потребовать правок
// сборки, его делают руками (скилл targets). Сеть недоступна — код 2.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from './checks/lib/cli.mjs';
import {
  compareMinecraft,
  compareSemver,
  isPrerelease,
  lineOf,
  modDirs,
  modProperties,
  parseMinecraft,
  ROOT,
  rangeOf,
  readVersions,
  VERSIONS_FILE,
} from './lib/repo.mjs';
import { pendingReadmes } from './sync.mjs';

const SOURCES = {
  mojang: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  fabricApi: 'https://api.modrinth.com/v2/project/fabric-api/version',
  loader: 'https://meta.fabricmc.net/v2/versions/loader',
  loom: 'https://maven.fabricmc.net/net/fabricmc/fabric-loom/maven-metadata.xml',
  checkstyle: 'https://repo1.maven.org/maven2/com/puppycrawl/tools/checkstyle/maven-metadata.xml',
  gradle: 'https://services.gradle.org/versions/current',
};
// Modrinth просит узнаваемый User-Agent
const HEADERS = { 'user-agent': 'kraineff/minecraft-mods (scripts/versions.mjs)' };
const TIMEOUT_MS = 20_000;

// ===== Чистая логика (тесты — scripts/tests/versions.test.mjs) =====

/** Последняя сборка Fabric API для версии Minecraft из списка Modrinth (новые первыми). */
export function latestApi(apiVersions, minecraft) {
  return apiVersions
    .filter((version) => version.game_versions.includes(minecraft))
    .sort((a, b) => compareSemver(b.version_number, a.version_number))[0]?.version_number;
}

/**
 * Изменения каталога: `[{ kind, … }]`.
 *   `api`     — `{ minecraft, from, to }`: новая сборка Fabric API для цели;
 *   `replace` — `{ from, to, fabricApi }`: пререлиз линии сменяется более новым или релизом;
 *   `patch`   — `{ minecraft, add }`: патчи релиза в `modrinth` цели;
 *   `add`     — `{ minecraft, fabricApi }`: цель новой линии;
 *   `waiting` — `{ minecraft, instead?, patchOf? }`: вышла версия, а Fabric API под неё ещё нет
 *               (у патча — сборка цели его не покрывает: нужна проверка руками).
 * `mojang` — id версий Minecraft новой схемы, `api(mc)` — последняя сборка Fabric API или `undefined`.
 */
export function planTargets(catalog, mojang, api) {
  const changes = [];
  const known = mojang.filter((id) => parseMinecraft(id)).sort(compareMinecraft);
  const lines = new Set(catalog.targets.map((target) => lineOf(target.minecraft)));

  for (const target of catalog.targets) {
    const line = lineOf(target.minecraft);
    const ofLine = known.filter((id) => lineOf(id) === line);
    if (isPrerelease(target.minecraft)) {
      const newer = ofLine.filter((id) => compareMinecraft(id, target.minecraft) > 0 && parseMinecraft(id).patch === 0);
      const release = newer.find((id) => !isPrerelease(id));
      const candidates = (release ? [release] : []).concat([...newer].reverse().filter((id) => isPrerelease(id)));
      const next = candidates.find((id) => api(id));
      if (next) {
        changes.push({ kind: 'replace', from: target.minecraft, to: next, fabricApi: api(next) });
        continue;
      }
      if (newer.length > 0) changes.push({ kind: 'waiting', minecraft: newer.at(-1), instead: target.minecraft });
    } else {
      const patches = ofLine.filter(
        (id) => !isPrerelease(id) && parseMinecraft(id).patch > 0 && !target.modrinth.includes(id),
      );
      const latest = api(target.minecraft);
      const supported = patches.filter((id) => latest && api(id) === latest);
      if (supported.length > 0) changes.push({ kind: 'patch', minecraft: target.minecraft, add: supported });
      for (const id of patches.filter((patch) => !supported.includes(patch))) {
        changes.push({ kind: 'waiting', minecraft: id, patchOf: target.minecraft });
      }
    }
    const latest = api(target.minecraft);
    if (latest && compareSemver(latest, target.fabricApi) > 0) {
      changes.push({ kind: 'api', minecraft: target.minecraft, from: target.fabricApi, to: latest });
    }
  }

  const last = catalog.targets.at(-1)?.minecraft;
  const newLines = [...new Set(known.filter((id) => !last || compareMinecraft(lineOf(id), lineOf(last)) > 0).map(lineOf))]
    .filter((line) => !lines.has(line))
    .sort(compareMinecraft);
  for (const line of newLines) {
    const ofLine = known.filter((id) => lineOf(id) === line && parseMinecraft(id).patch === 0);
    const release = ofLine.find((id) => !isPrerelease(id));
    const candidates = (release ? [release] : []).concat([...ofLine].reverse().filter((id) => isPrerelease(id)));
    const next = candidates.find((id) => api(id));
    if (next) changes.push({ kind: 'add', minecraft: next, fabricApi: api(next) });
    else changes.push({ kind: 'waiting', minecraft: ofLine.at(-1) });
  }
  return changes;
}

/** Каталог после изменений `planTargets` (без `waiting`); исходный не меняется. */
export function applyTargets(catalog, changes) {
  const next = structuredClone(catalog);
  for (const change of changes) {
    if (change.kind === 'api') {
      next.targets.find((target) => target.minecraft === change.minecraft).fabricApi = change.to;
    } else if (change.kind === 'replace') {
      const target = next.targets.find((item) => item.minecraft === change.from);
      Object.assign(target, {
        minecraft: change.to,
        fabricApi: change.fabricApi,
        range: rangeOf(change.to),
        modrinth: [change.to],
      });
    } else if (change.kind === 'patch') {
      const target = next.targets.find((item) => item.minecraft === change.minecraft);
      target.modrinth = [...target.modrinth, ...change.add].sort(compareMinecraft);
    } else if (change.kind === 'add') {
      next.targets.push({
        minecraft: change.minecraft,
        fabricApi: change.fabricApi,
        range: rangeOf(change.minecraft),
        modrinth: [change.minecraft],
      });
    }
  }
  return next;
}

/** Каталог JSON в стиле репозитория: табы, короткие массивы строк — в одну строку. */
export function formatCatalog(catalog) {
  return `${JSON.stringify(catalog, null, '\t').replace(/\[\n\t+("[^"\n]*"(?:,\n\t+"[^"\n]*")*)\n\t+\]/g, (_all, items) => `[${items.replace(/,\n\t+/g, ', ')}]`)}\n`;
}

/** Строка изменения для отчёта. */
export function describe(change) {
  switch (change.kind) {
    case 'api':
      return `${change.minecraft}: Fabric API ${change.from} → ${change.to}`;
    case 'replace':
      return `${change.from} → ${change.to} (Fabric API ${change.fabricApi})`;
    case 'patch':
      return `${change.minecraft}: + ${change.add.join(', ')} в версии Modrinth`;
    case 'add':
      return `новая цель ${change.minecraft} (Fabric API ${change.fabricApi})`;
    default:
      if (change.patchOf) {
        return `вышел ${change.minecraft}: Fabric API цели ${change.patchOf} его не покрывает — проверить руками`;
      }
      return `вышел ${change.minecraft}${change.instead ? ` (после ${change.instead})` : ''} — Fabric API под него ещё нет`;
  }
}

// ===== Сеть =====

async function get(url, as = 'json') {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  return as === 'json' ? response.json() : response.text();
}

/** Версии из maven-metadata.xml. */
export function mavenVersions(xml) {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
}

/** Последняя стабильная версия x.y.z; с `prefix` — внутри ветки (`1.17.` → 1.17.21). */
export function latestStable(versions, prefix = '') {
  return versions
    .filter((version) => /^\d+\.\d+\.\d+$/.test(version) && version.startsWith(prefix))
    .sort(compareSemver)
    .at(-1);
}

/** Версия Gradle из gradle-wrapper.properties. */
export function wrapperGradle(root = ROOT) {
  const text = readFileSync(join(root, 'gradle/wrapper/gradle-wrapper.properties'), 'utf8');
  return /gradle-([\d.]+)-(?:bin|all)\.zip/.exec(text)?.[1];
}

/** Всё, что нужно отчёту: манифест Mojang, Fabric API, инструменты. */
export async function collect(catalog = readVersions(), root = ROOT) {
  const manifest = await get(SOURCES.mojang);
  const first = catalog.targets[0]?.minecraft;
  const mojang = manifest.versions
    .map((version) => version.id)
    .filter((id) => parseMinecraft(id) && (!first || compareMinecraft(lineOf(id), lineOf(first)) >= 0));
  const query = encodeURIComponent(JSON.stringify([...new Set([...mojang, ...catalog.targets.map((t) => t.minecraft)])]));
  const [apiVersions, loader, loom, checkstyle, gradle] = await Promise.all([
    get(`${SOURCES.fabricApi}?loaders=%5B%22fabric%22%5D&game_versions=${query}`),
    get(SOURCES.loader),
    get(SOURCES.loom, 'text'),
    get(SOURCES.checkstyle, 'text'),
    get(SOURCES.gradle),
  ]);
  const loomVersions = mavenVersions(loom);
  const loomBranch = catalog.loom.split('.').slice(0, 2).join('.');
  return {
    latest: manifest.latest,
    changes: planTargets(catalog, mojang, (mc) => latestApi(apiVersions, mc)),
    tools: {
      loader: { current: catalog.loader, latest: loader.find((item) => item.stable)?.version },
      loom: {
        current: catalog.loom,
        latest: latestStable(loomVersions, `${loomBranch}.`),
        next: latestStable(loomVersions),
      },
      checkstyle: { current: catalog.checkstyle, latest: latestStable(mavenVersions(checkstyle)) },
      gradle: { current: wrapperGradle(root), latest: gradle.version },
    },
  };
}

/** Строки отчёта по инструментам: что отстало. */
export function toolLines(tools) {
  const lines = [];
  for (const [name, info] of Object.entries(tools)) {
    const behind = info.latest && info.current && compareSemver(info.latest, info.current) > 0;
    const branch = info.next && info.latest !== info.next && compareSemver(info.next, info.current) > 0;
    if (behind) lines.push(`${name} ${info.current} → ${info.latest}${branch ? ` (есть и ${info.next})` : ''}`);
    else if (branch) lines.push(`${name} ${info.current} — свежий в ветке, есть ${info.next}`);
  }
  return lines;
}

// ===== Запись =====

/** Моды, чей `mc_since` указывал на сменённую цель: `[{ dir, from, to }]`. */
function sinceUpdates(changes, root) {
  const replaced = new Map(changes.filter((c) => c.kind === 'replace').map((c) => [c.from, c.to]));
  return modDirs(root)
    .map((dir) => ({ dir, from: modProperties(dir, root).mc_since }))
    .filter(({ from }) => replaced.has(from))
    .map(({ dir, from }) => ({ dir, from, to: replaced.get(from) }));
}

function write(report, catalog, root) {
  const targets = report.changes.filter((change) => change.kind !== 'waiting');
  const next = applyTargets(catalog, targets);
  const loader = report.tools.loader;
  if (loader.latest && compareSemver(loader.latest, loader.current) > 0) next.loader = loader.latest;
  writeFileSync(join(root, VERSIONS_FILE), formatCatalog(next));
  for (const { dir, from, to } of sinceUpdates(targets, root)) {
    const file = join(root, dir, 'gradle.properties');
    writeFileSync(file, readFileSync(file, 'utf8').replace(`mc_since=${from}`, `mc_since=${to}`));
    process.stdout.write(`${dir}: mc_since ${from} → ${to}\n`);
  }
  for (const { file, text } of pendingReadmes(root).pending) {
    writeFileSync(join(root, file), text);
    process.stdout.write(`${file}: блок целей обновлён\n`);
  }
}

async function main(argv) {
  const root = ROOT;
  const catalog = readVersions(root);
  const report = await collect(catalog, root);
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  const out = [`Minecraft: релиз ${report.latest.release}, снапшот ${report.latest.snapshot}`];
  const ready = report.changes.filter((change) => change.kind !== 'waiting');
  const waiting = report.changes.filter((change) => change.kind === 'waiting');
  out.push(ready.length > 0 ? 'Цели — обновить:' : 'Цели — актуальны');
  for (const change of ready) out.push(`  ${describe(change)}`);
  for (const change of waiting) out.push(`  ${describe(change)}`);
  const tools = toolLines(report.tools);
  out.push(tools.length > 0 ? 'Инструменты:' : 'Инструменты — актуальны');
  for (const line of tools) out.push(`  ${line}`);
  process.stdout.write(`${out.join('\n')}\n`);

  const loaderBehind = report.tools.loader.latest && compareSemver(report.tools.loader.latest, catalog.loader) > 0;
  if (!argv.includes('--write')) {
    if (ready.length > 0 || loaderBehind) process.stdout.write('\nПрименить цели и Loader: npm run versions -- --write\n');
    return 0;
  }
  if (ready.length === 0 && !loaderBehind) {
    process.stdout.write('\nПрименять нечего.\n');
    return 0;
  }
  write(report, catalog, root);
  process.stdout.write(
    `\n${VERSIONS_FILE} обновлён. Дальше (скилл targets): npm run build -- --all-targets, ` +
      'скриншот-тест новых целей, запись в [Unreleased] CHANGELOG модов.\n',
  );
  return 0;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`versions: ${error.message}\n`);
      process.exitCode = 2;
    },
  );
}
