#!/usr/bin/env node
// gallery — пересобрать галерею проекта Modrinth из `mods/<мод>/docs/gallery.json` и
// `docs/screenshots/`: удалить всё, что там сейчас, и залить текущие картинки по порядку
// (первая — featured). Проще, чем сравнивать хеши, и даёт тот же результат: новый снимок
// появится, изменённый — заменит старый.
//
//   MODRINTH_TOKEN=… node scripts/gallery.mjs <мод>
//
// Запускает только CI при публикации (`.github/workflows/publish.yml`, скилл release): это
// запись в публичный проект. Проект — `modrinth_id` из gradle.properties мода, иначе id мода.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from './checks/lib/cli.mjs';
import { modProperties, ROOT } from './lib/repo.mjs';

const API = 'https://api.modrinth.com/v2/project';
const HEADERS = { 'user-agent': 'kraineff/minecraft-mods (scripts/gallery.mjs)' };

async function request(method, url, token, body) {
  const response = await fetch(url, {
    method,
    body,
    headers: { ...HEADERS, ...(token ? { authorization: token } : {}) },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`${method} ${url} → ${response.status} ${await response.text()}`);
  return response;
}

async function main([mod]) {
  const token = process.env.MODRINTH_TOKEN;
  if (!mod) throw new Error('нужен мод: node scripts/gallery.mjs <мод>');
  if (!token) throw new Error('MODRINTH_TOKEN не задан');
  const dir = join(ROOT, 'mods', mod);
  const project = modProperties(`mods/${mod}`).modrinth_id ?? mod;
  const { images } = JSON.parse(readFileSync(join(dir, 'docs/gallery.json'), 'utf8'));

  const current = await (await request('GET', `${API}/${project}`)).json();
  for (const item of current.gallery ?? []) {
    await request('DELETE', `${API}/${project}/gallery?url=${encodeURIComponent(item.url)}`, token);
    process.stdout.write(`Удалено: ${item.url}\n`);
  }
  for (const [index, image] of images.entries()) {
    const query = new URLSearchParams({
      ext: image.file.split('.').pop(),
      featured: String(index === 0),
      ordering: String(index),
      title: image.title,
      description: image.description,
    });
    const body = readFileSync(join(dir, 'docs/screenshots', image.file));
    await request('POST', `${API}/${project}/gallery?${query}`, token, body);
    process.stdout.write(`Загружено: ${image.file}\n`);
  }
  process.stdout.write(`Галерея ${project}: ${images.length} картинок\n`);
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`gallery: ${error.message}\n`);
    process.exitCode = 1;
  });
}
