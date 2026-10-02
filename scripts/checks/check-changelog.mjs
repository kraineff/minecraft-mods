#!/usr/bin/env node
// check-changelog — `docs/CHANGELOG.md` мода по Keep a Changelog и сходится с версией:
//   — первым разделом `## [Unreleased]`, дальше `## [x.y.z] - YYYY-MM-DD` по убыванию версий;
//   — подразделы — только Added / Changed / Deprecated / Removed / Fixed / Security, пункты —
//     строками `- …`, пустых разделов версий нет;
//   — последний выпущенный раздел — это `mod_version` из gradle.properties: по нему CI берёт
//     changelog для Modrinth (скилл release); у мода без выпусков разделов версий ещё нет;
//   — текст для игроков на Modrinth — по-английски: кириллица в CHANGELOG и docs/MODRINTH.md —
//     находка.
//
//   node scripts/checks/check-changelog.mjs [путь…]
//
// Подавление: `<!-- check-changelog: причина -->` на строке находки или строкой выше.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { compareSemver, modProperties } from '../lib/repo.mjs';
import { read, runCli, selectMods, unsuppressed } from './lib/cli.mjs';

const NAME = 'changelog';
const SECTIONS = new Set(['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']);
const RELEASE = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/;
const CYRILLIC = /[А-Яа-яЁё]/;

/** Находки в тексте CHANGELOG: `[{ line, text }]`; `version` — mod_version мода. */
export function checkChangelog(text, version) {
  const problems = [];
  const lines = text.split('\n');
  const releases = [];
  let current;
  let unreleasedSeen = false;
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (raw.startsWith('## ')) {
      if (current?.release && current.entries === 0) {
        problems.push({ line: current.line, text: `раздел ${current.title} без пунктов` });
      }
      if (raw === '## [Unreleased]') {
        if (unreleasedSeen || releases.length > 0) problems.push({ line, text: '[Unreleased] — один и первым разделом' });
        unreleasedSeen = true;
        current = { title: '[Unreleased]', line, entries: 0, release: false };
        return;
      }
      const match = RELEASE.exec(raw);
      if (!match) {
        problems.push({ line, text: `заголовок версии — «## [x.y.z] - YYYY-MM-DD»: ${raw}` });
        current = undefined;
        return;
      }
      if (!unreleasedSeen) problems.push({ line, text: 'первым разделом — ## [Unreleased]' });
      if (Number.isNaN(Date.parse(match[2]))) problems.push({ line, text: `дата ${match[2]} не читается` });
      const previous = releases.at(-1);
      if (previous && compareSemver(previous.version, match[1]) <= 0) {
        problems.push({ line, text: `версии — по убыванию: ${match[1]} после ${previous.version}` });
      }
      releases.push({ version: match[1], line });
      current = { title: `[${match[1]}]`, line, entries: 0, release: true };
      unreleasedSeen = true;
    } else if (raw.startsWith('### ')) {
      const name = raw.slice(4).trim();
      if (!SECTIONS.has(name)) problems.push({ line, text: `подраздел «${name}» — один из ${[...SECTIONS].join(', ')}` });
    } else if (raw.startsWith('- ') && current) {
      current.entries += 1;
    }
    if (CYRILLIC.test(raw)) problems.push({ line, text: 'по-русски — changelog уходит игрокам на Modrinth по-английски' });
  });
  if (current?.release && current.entries === 0) {
    problems.push({ line: current.line, text: `раздел ${current.title} без пунктов` });
  }
  if (!unreleasedSeen) problems.push({ line: 1, text: 'нет раздела ## [Unreleased]' });
  const latest = releases[0];
  if (version && latest && latest.version !== version) {
    const why = compareSemver(version, latest.version) > 0 ? 'нет раздела для неё' : 'она отстала от раздела';
    problems.push({ line: latest.line, text: `mod_version=${version}, последний раздел — ${latest.version}: ${why}` });
  }
  return problems;
}

/** Кириллица в тексте страницы Modrinth: `[{ line, text }]`. */
export function checkModrinthPage(text) {
  return text.split('\n').flatMap((raw, index) =>
    CYRILLIC.test(raw) ? [{ line: index + 1, text: 'по-русски — страница Modrinth по-английски' }] : [],
  );
}

export const checker = {
  name: NAME,
  run({ paths }) {
    const mods = selectMods(paths);
    const problems = [];
    for (const dir of mods) {
      const changelog = join(dir, 'docs/CHANGELOG.md');
      if (existsSync(changelog)) {
        const text = read(changelog);
        const found = checkChangelog(text, modProperties(dir, process.cwd()).mod_version);
        for (const problem of unsuppressed(text, found, NAME)) problems.push({ file: changelog, ...problem });
      }
      const page = join(dir, 'docs/MODRINTH.md');
      if (existsSync(page)) {
        const text = read(page);
        for (const problem of unsuppressed(text, checkModrinthPage(text), NAME)) problems.push({ file: page, ...problem });
      }
    }
    return {
      title: 'CHANGELOG или страница Modrinth не по правилам (скилл release):',
      ok: `CHANGELOG в порядке: проверено модов — ${mods.length}`,
      problems,
    };
  },
};

runCli(import.meta.url, checker);
