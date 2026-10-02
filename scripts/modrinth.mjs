#!/usr/bin/env node
// modrinth — проект мода на Modrinth для CI (`.github/workflows/ci.yml`, скилл release).
//
//   node scripts/modrinth.mjs published <мод> <номер версии>  — `published=true|false`: такая версия
//       уже выложена (публичный API, без токена) — повтор прогона её пропускает
//   MODRINTH_TOKEN=… node scripts/modrinth.mjs sync <мод> [--dry-run]
//       — привести проект к репозиторию: ссылки на исходники и трекер (из `contact` в
//       fabric.mod.json), описание (docs/MODRINTH.md), галерея (docs/gallery.json и
//       docs/screenshots/). Меняется только то, что отличается; галерея пересобирается целиком,
//       если её подписи расходятся или картинки менялись с прошлого релиза (тег `<мод>/<версия>`).
//       `--dry-run` — только показать, что изменится (токен не нужен).
//
// Проект — `modrinth_id` из gradle.properties мода. `sync` пишет в публичный проект: его
// запускает только CI после публикации (хук перед командой откажет модели).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from './checks/lib/cli.mjs';
import { modProperties, ROOT } from './lib/repo.mjs';

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

async function published(mod, number) {
  const response = await request('GET', `/project/${projectOf(mod)}/version/${encodeURIComponent(number)}`);
  if (response.status !== 404) await expectOk(response, `версия ${number}`);
  process.stdout.write(`published=${response.ok}\n`);
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
  if (!mod) throw new Error('node scripts/modrinth.mjs published <мод> <номер версии> | sync <мод> [--dry-run]');
  if (command === 'published') return published(mod, rest[0]);
  if (command === 'sync') return sync(mod, rest.includes('--dry-run'));
  throw new Error(`неизвестная команда ${command}: published | sync`);
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`modrinth: ${error.message}\n`);
    process.exitCode = 1;
  });
}
