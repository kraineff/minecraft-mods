#!/usr/bin/env node
// check-secrets — похожее на секреты в файлах репозитория: токены Modrinth, GitHub, CurseForge,
// вебхуки Discord, ключи AWS и Google API, токены Slack и ботов Telegram, приватные ключи, JWT.
//
//   node scripts/checks/check-secrets.mjs [путь…]    — файлы из git (CI, check-all)
//   node scripts/checks/check-secrets.mjs --pending  — всё, что может уйти в коммит: добавленные
//                                                     строки индекса и рабочей копии, новые файлы
//
// `--pending` запускает хук перед `git commit` (`.claude/hooks/before-bash.mjs`): в команде
// `git add … && git commit` хук срабатывает раньше `git add`, поэтому одного индекса мало.
// Смотрит текстовые файлы из git (двоичные и lock-файлы — мимо). `--tests` и `--info` ничего не
// меняют. Ограничения: только известные форматы — пароль или ключ без узнаваемого вида не
// найдётся. Токен Modrinth для публикации живёт только в секрете CI `MODRINTH_TOKEN`.
// Подавление: `// check-secrets: причина` на строке находки или строкой выше (например,
// заведомо фальшивый токен в тесте).

import { extname } from 'node:path';
import {
  CheckError,
  emptySuppressions,
  errorText,
  filesCount,
  git,
  gitFiles,
  isMain,
  read,
  runCli,
  suppressed,
} from './lib/cli.mjs';

const NAME = 'secrets';

/** Узнаваемые форматы секретов: имя → шаблон. */
export const PATTERNS = [
  ['токен Modrinth', /\bmrp_[A-Za-z0-9]{30,}\b/g],
  ['ключ API CurseForge', /\$2a\$10\$[./A-Za-z0-9]{53}/g],
  ['вебхук Discord', /\bdiscord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]{20,}/g],
  ['ключ AWS', /\bAKIA[0-9A-Z]{16}\b/g],
  ['токен Slack', /\bxox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['приватный ключ', /-----BEGIN[ A-Z]* PRIVATE KEY-----/g],
  ['токен GitHub', /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g],
  ['ключ Google API', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['токен бота Telegram', /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g],
];

/** Двоичное и сгенерированное: смотреть бессмысленно. */
const SKIP_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.tgz',
  '.zip',
  '.pdf',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.mp3',
  '.opus',
  '.ogg',
  '.wav',
  '.jar',
  '.nbt',
  '.mca',
]);
const SKIP_FILE = /(^|\/)(package-lock\.json|gradle-wrapper\.jar)$/;

/** Находки в тексте: `[{ line, text }]`; первая строка — номер строки `firstLine`. */
export function findSecrets(source, firstLine = 1, { suppress = true } = {}) {
  const lines = source.split('\n');
  const problems = [];
  lines.forEach((text, index) => {
    for (const [name, pattern] of PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(text);
      if (!match) continue;
      if (suppress && suppressed(lines, index + 1, NAME)) continue;
      const shown = `${match[0].slice(0, 6)}…`;
      problems.push({ line: firstLine + index, text: `похоже на ${name}: ${shown}` });
    }
  });
  if (suppress) problems.push(...emptySuppressions(lines, NAME));
  return problems;
}

/** Добавленные строки из `git diff -U0`: `[{ file, line, text }]` по заголовкам hunk `@@ … +N …`. */
export function diffAdditions(diff) {
  const added = [];
  let file;
  let line = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.startsWith('+++ b/') ? raw.slice(6) : undefined;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!file) continue;
    if (raw.startsWith('+')) {
      added.push({ file, line, text: raw.slice(1) });
      line += 1;
    } else if (!raw.startsWith('-') && !raw.startsWith('\\')) line += 1;
  }
  return added;
}

const scannable = (file) => !SKIP_EXT.has(extname(file).toLowerCase()) && !SKIP_FILE.test(file);

export const checker = {
  name: NAME,
  run({ paths }) {
    const files = gitFiles(['.'], { roots: paths }).filter(scannable);
    const problems = [];
    for (const file of files) {
      const source = read(file);
      if (source.includes('\0')) continue; // двоичный файл без расширения
      for (const problem of findSecrets(source)) problems.push({ file, ...problem });
    }
    return {
      title: 'Похоже на секреты в файлах репозитория:',
      ok: `Секретов не видно: проверено ${filesCount(files.length)}`,
      problems,
    };
  },
};

/** Есть ли в репозитории коммит: до первого `git diff HEAD` не с чем сравнить. */
function hasHead() {
  try {
    git(['rev-parse', '--verify', '--quiet', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Находки во всём, что может уйти в коммит: `[{ file, line, text }]`. Добавленные строки индекса
 * и рабочей копии относительно HEAD плюс новые файлы целиком; подавление смотрится по файлу на
 * диске — комментарий может стоять строкой выше вне hunk.
 */
export function pendingSecrets() {
  const diffs = [['diff', '--cached', '-U0', '--no-color']];
  if (hasHead()) diffs.push(['diff', 'HEAD', '-U0', '--no-color']);
  const additions = diffs.flatMap((args) => diffAdditions(git(args)));
  for (const file of git(['ls-files', '--others', '--exclude-standard']).split('\n')) {
    if (!file || !scannable(file)) continue;
    const source = read(file);
    if (source.includes('\0')) continue;
    source.split('\n').forEach((text, index) => {
      additions.push({ file, line: index + 1, text });
    });
  }
  const seen = new Set();
  const problems = [];
  for (const addition of additions) {
    if (!scannable(addition.file)) continue;
    for (const problem of findSecrets(addition.text, addition.line, { suppress: false })) {
      const key = `${addition.file}:${problem.line}:${problem.text}`;
      if (seen.has(key) || isSuppressedOnDisk(addition.file, problem.line)) continue;
      seen.add(key);
      problems.push({ file: addition.file, ...problem });
    }
  }
  return problems;
}

function isSuppressedOnDisk(file, line) {
  try {
    return suppressed(read(file).split('\n'), line, NAME);
  } catch {
    return false;
  }
}

if (isMain(import.meta.url) && process.argv.includes('--pending')) {
  try {
    const problems = pendingSecrets();
    if (problems.length > 0) {
      process.stderr.write(
        `Похоже на секреты в том, что уйдёт в коммит:\n${problems.map((p) => `${p.file}:${p.line}  ${p.text}`).join('\n')}\n`,
      );
    }
    process.exitCode = problems.length > 0 ? 1 : 0;
  } catch (error) {
    process.stderr.write(
      errorText(NAME, error instanceof CheckError ? error : new CheckError(String(error))),
    );
    process.exitCode = 2;
  }
} else {
  runCli(import.meta.url, checker);
}
