#!/usr/bin/env node
// modrinth — проект мода на Modrinth для CI (`.github/workflows/ci.yml`, скилл release).
//
//   MODRINTH_TOKEN=… node scripts/modrinth.mjs upload <мод> <цель> <jar> [--dry-run]
//       — выложить JAR, собранный в job build: версия `<mod_version>+<цель>`, версии игры —
//       `modrinth` цели из каталога, changelog — раздел CHANGELOG этой версии, зависимость Fabric
//       API — если она есть в fabric.mod.json. Уже выложенная под эту цель версия пропускается:
//       повтор прогона и порт (та же версия на новую цель) безопасны; номер, занятый сборкой под
//       другие версии игры, — ошибка. В CI пишет `uploaded=true|false` в $GITHUB_OUTPUT.
//       `--dry-run` — только показать, что отправится (токен не нужен)
//   node scripts/modrinth.mjs published <мод> <номер версии>  — `published=true|false`: такая версия
//       уже выложена (публичный API, без токена)
//   MODRINTH_TOKEN=… node scripts/modrinth.mjs sync <мод> [--dry-run]
//       — привести проект к репозиторию: ссылки на исходники и трекер (из `contact` в
//       fabric.mod.json), описание (docs/MODRINTH.md), галерея (docs/gallery.json и
//       docs/screenshots/). Меняется только то, что отличается; галерея пересобирается целиком,
//       если её подписи расходятся или картинки менялись с прошлого релиза (тег `<мод>/<версия>`).
//       `--dry-run` — только показать, что изменится (токен не нужен).
//
// Проект — `modrinth_id` из gradle.properties мода. `upload` и `sync` пишут в публичный проект:
// их запускает только CI (хук перед командой откажет модели).

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { changelogSection } from './ci.mjs';
import { isMain } from './checks/lib/cli.mjs';
import { modProperties, ROOT, readVersions } from './lib/repo.mjs';

const API = 'https://api.modrinth.com/v2';
const HEADERS = { 'user-agent': 'kraineff/minecraft-mods (scripts/modrinth.mjs)' };

async function request(method, path, { token, body, json } = {}) {
  const headers = { ...HEADERS, ...(token ? { authorization: token } : {}) };
  if (json !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : body,
    signal: AbortSignal.timeout(60_000),
  });
  return response;
}

async function expectOk(response, what) {
  if (!response.ok) throw new Error(`${what} → ${response.status} ${await response.text()}`);
  return response;
}

/** Проект мода: `modrinth_id`; нет — мод не публикуется. */
function projectOf(mod) {
  const id = modProperties(`mods/${mod}`).modrinth_id;
  if (!id) throw new Error(`у мода ${mod} нет modrinth_id в gradle.properties — он не публикуется`);
  return id;
}

/** Галерея проекта совпадает с описанием: те же подписи, порядок и featured у первой. */
export function galleryMatches(current, images) {
  const sorted = [...current].sort((a, b) => a.ordering - b.ordering);
  return (
    sorted.length === images.length &&
    sorted.every(
      (item, index) =>
        item.title === images[index].title &&
        item.description === images[index].description &&
        item.featured === (index === 0),
    )
  );
}

/** Картинки галереи менялись после прошлого релиза мода (последний тег `<мод>/…`, кроме `version`). */
function screenshotsChanged(mod, version) {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const previous = git('tag', '--list', `${mod}/*`, '--sort=-v:refname')
    .split('\n')
    .find((tag) => tag && tag !== `${mod}/${version}`);
  if (!previous) return true;
  try {
    git('diff', '--quiet', previous, 'HEAD', '--', `mods/${mod}/docs/screenshots`, `mods/${mod}/docs/gallery.json`);
    return false;
  } catch {
    return true;
  }
}

/** Выложенная версия проекта с таким номером или `undefined`. */
async function findVersion(id, number) {
  const response = await request('GET', `/project/${id}/version/${encodeURIComponent(number)}`);
  if (response.status === 404) return undefined;
  return (await expectOk(response, `версия ${number}`)).json();
}

async function published(mod, number) {
  process.stdout.write(`published=${(await findVersion(projectOf(mod), number)) !== undefined}\n`);
}

/** Итог загрузки для следующих шагов CI (`steps.<id>.outputs.uploaded`). */
function report(uploaded) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `uploaded=${uploaded}\n`);
}

/** Поле `data` запроса POST /version: версия мода под одну цель (схема CreatableVersion). */
export function versionData({ projectId, versionNumber, changelog, gameVersions, requires }) {
  return {
    name: versionNumber,
    version_number: versionNumber,
    changelog,
    dependencies: requires.map((id) => ({ project_id: id, dependency_type: 'required' })),
    game_versions: gameVersions,
    version_type: 'release',
    loaders: ['fabric'],
    featured: false,
    status: 'listed',
    project_id: projectId,
    file_parts: ['file'],
    primary_file: 'file',
  };
}

async function upload(mod, target, jar, dryRun) {
  const token = process.env.MODRINTH_TOKEN;
  if (!token && !dryRun) throw new Error('MODRINTH_TOKEN не задан');
  if (!jar || !existsSync(jar)) throw new Error(`нет JAR ${jar} — его собирает job build`);
  const slug = projectOf(mod);
  const dir = join(ROOT, 'mods', mod);
  const version = modProperties(`mods/${mod}`).mod_version;
  const number = `${version}+${target}`;
  if (basename(jar) !== `${mod}-${number}.jar`) throw new Error(`JAR ${basename(jar)} — не версия ${number}`);
  const entry = readVersions().targets.find((item) => item.minecraft === target);
  if (!entry) throw new Error(`цели ${target} нет в gradle/versions.json`);
  const changelog = changelogSection(readFileSync(join(dir, 'docs/CHANGELOG.md'), 'utf8'), version);
  if (changelog === undefined) throw new Error(`в CHANGELOG мода нет раздела [${version}]`);
  const existing = await findVersion(slug, number);
  if (existing) {
    if (!existing.game_versions.some((game) => entry.modrinth.includes(game))) {
      throw new Error(
        `номер ${number} на Modrinth занят сборкой под ${existing.game_versions.join(', ')} — ` +
          'переименуйте её на Modrinth (скилл release, «Порт»)',
      );
    }
    process.stdout.write(`${slug} ${number}: уже выложена — пропускаю\n`);
    report(false);
    return;
  }
  const projectId = (await (await expectOk(await request('GET', `/project/${slug}`), `проект ${slug}`)).json()).id;
  const modJson = JSON.parse(readFileSync(join(dir, 'src/main/resources/fabric.mod.json'), 'utf8'));
  const requires = [];
  if (modJson.depends?.['fabric-api']) {
    requires.push((await (await expectOk(await request('GET', '/project/fabric-api'), 'проект fabric-api')).json()).id);
  }
  const data = versionData({ projectId, versionNumber: number, changelog, gameVersions: entry.modrinth, requires });
  if (dryRun) {
    process.stdout.write(`[dry-run] POST /version, файл ${basename(jar)}:\n${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  const form = new FormData();
  form.append('data', JSON.stringify(data));
  form.append('file', new Blob([readFileSync(jar)]), basename(jar));
  const created = await (await expectOk(await request('POST', '/version', { token, body: form }), `загрузка ${number}`)).json();
  process.stdout.write(`${slug} ${number}: выложена — https://modrinth.com/mod/${slug}/version/${created.id}\n`);
  report(true);
}

async function sync(mod, dryRun) {
  const token = process.env.MODRINTH_TOKEN;
  if (!token && !dryRun) throw new Error('MODRINTH_TOKEN не задан');
  const id = projectOf(mod);
  const dir = join(ROOT, 'mods', mod);
  const modJson = JSON.parse(readFileSync(join(dir, 'src/main/resources/fabric.mod.json'), 'utf8'));
  const body = readFileSync(join(dir, 'docs/MODRINTH.md'), 'utf8');
  const { images } = JSON.parse(readFileSync(join(dir, 'docs/gallery.json'), 'utf8'));
  const version = modProperties(`mods/${mod}`).mod_version;
  const say = (text) => process.stdout.write(`${dryRun ? '[dry-run] ' : ''}${text}\n`);

  const project = await (await expectOk(await request('GET', `/project/${id}`), `проект ${id}`)).json();
  const patch = {};
  if (modJson.contact?.sources && project.source_url !== modJson.contact.sources) patch.source_url = modJson.contact.sources;
  if (modJson.contact?.issues && project.issues_url !== modJson.contact.issues) patch.issues_url = modJson.contact.issues;
  if (project.body.trim() !== body.trim()) patch.body = body;
  if (Object.keys(patch).length > 0) {
    say(`Проект ${id}: ${Object.keys(patch).join(', ')}`);
    if (!dryRun) await expectOk(await request('PATCH', `/project/${id}`, { token, json: patch }), `правка проекта ${id}`);
  } else say(`Проект ${id}: ссылки и описание уже совпадают`);

  if (galleryMatches(project.gallery ?? [], images) && !screenshotsChanged(mod, version)) {
    say(`Галерея ${id}: без изменений`);
    return;
  }
  for (const item of project.gallery ?? []) {
    say(`Галерея ${id}: удалить ${item.url}`);
    if (!dryRun) await expectOk(await request('DELETE', `/project/${id}/gallery?url=${encodeURIComponent(item.url)}`, { token }), 'удаление картинки');
  }
  for (const [index, image] of images.entries()) {
    const query = new URLSearchParams({
      ext: image.file.split('.').pop(),
      featured: String(index === 0),
      ordering: String(index),
      title: image.title,
      description: image.description,
    });
    say(`Галерея ${id}: загрузить ${image.file}`);
    if (!dryRun) {
      const bytes = readFileSync(join(dir, 'docs/screenshots', image.file));
      await expectOk(await request('POST', `/project/${id}/gallery?${query}`, { token, body: bytes }), `загрузка ${image.file}`);
    }
  }
}

async function main([command, mod, ...rest]) {
  const usage = 'upload <мод> <цель> <jar> [--dry-run] | sync <мод> [--dry-run] | published <мод> <номер>';
  if (!mod) throw new Error(`node scripts/modrinth.mjs ${usage}`);
  const dryRun = rest.includes('--dry-run');
  const args = rest.filter((arg) => arg !== '--dry-run');
  if (command === 'upload') return upload(mod, args[0], args[1], dryRun);
  if (command === 'sync') return sync(mod, dryRun);
  if (command === 'published') return published(mod, args[0]);
  throw new Error(`неизвестная команда ${command}: ${usage}`);
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`modrinth: ${error.message}\n`);
    process.exitCode = 1;
  });
}
