#!/usr/bin/env node
// Журналы репозитория (правила — `.claude/rules/journals.md`): дела — `docs/TODO.md` корня и
// `mods/<мод>/docs/TODO.md`. Отсюда же политика хуков: предложение без записи в TODO
// (`offerToRecord`) и отпечаток рабочей копии (`worktreePrint`) — по нему хук завершения хода
// отличает работу от разговора.
//
//   node scripts/journals.mjs — сводка открытого (её показывает хук начала сессии)

import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { git, gitFiles, isMain, modOf } from './checks/lib/cli.mjs';
import { ROOT } from './lib/repo.mjs';

/** Разделы `TODO.md` — статусы дел, в этом порядке. */
export const TODO_SECTIONS = ['Предложено', 'Согласовано', 'Проверить вживую', 'Ждёт'];
/** Файлы журналов. */
export const JOURNAL = /(^|\/)docs\/TODO\.md$/;

/** Открытые пункты `TODO.md` по разделам `## …`: `{ [раздел]: число }`. */
export function todoCounts(text) {
  const counts = {};
  let section;
  for (const line of text.split('\n')) {
    const header = /^## (.+?)\s*$/.exec(line);
    if (header) section = header[1];
    else if (section && /^- \[ \]/.test(line)) counts[section] = (counts[section] ?? 0) + 1;
  }
  return counts;
}

const LETTER = String.raw`\p{L}`;
const SENTENCE = String.raw`(?:^|[.!?:]\s+|\n\s*(?:[-*]\s+)?)`;
/** Предложение сделать что-то: «Могу …», «Предлагаю …», «Если хочешь …», «Сделать …?». */
const OFFERS = [
  new RegExp(`${SENTENCE}Могу(?!${LETTER})`, 'u'),
  new RegExp(`(?<!${LETTER})предлагаю(?!${LETTER})`, 'iu'),
  new RegExp(`(?<!${LETTER})если хочешь(?!${LETTER})`, 'iu'),
  new RegExp(`${SENTENCE}Хочешь(?!${LETTER})`, 'u'),
  new RegExp(
    `${SENTENCE}(?:Делать|Сделать|Добавить|Переделать|Ускорить|Убрать|Разрешить|Снять|Перенести|Поставить|Включить|Обновить|Опубликовать)(?!${LETTER})[^.!?\\n]{0,120}\\?`,
    'u',
  ),
];

/**
 * Предложение дела в ответе без записи в TODO: фраза с ним или `undefined`. Ответ, где названа
 * запись в TODO, проходит — значит, предложение записано.
 */
export function unrecordedOffer(text) {
  if (!text || /TODO/.test(text)) return undefined;
  for (const pattern of OFFERS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const word = match.index + match[0].search(/\p{L}/u);
    const from =
      Math.max(...['.', '!', '?', '\n'].map((mark) => text.lastIndexOf(mark, word - 1))) + 1;
    const end = text.slice(word).search(/[.!?\n]/);
    return text.slice(from, end < 0 ? undefined : word + end + 1).trim();
  }
  return undefined;
}

/** Ответ кончается вопросом пользователю: решение ждёт его прямо в чате и с ним не потеряется. */
export function endsWithQuestion(text) {
  return /\?[\s*_`»"')]*$/u.test(text ?? '');
}

/**
 * Предложение, которое пора записать в TODO. Только в ходе, где менялись файлы: пока идёт разговор
 * (пользователь спрашивает и выбирает), варианты живут в чате. Ответ, который кончается вопросом
 * пользователю, тоже проходит — решение за ним.
 */
export function offerToRecord(text, { changed }) {
  if (!changed || endsWithQuestion(text)) return undefined;
  return unrecordedOffer(text);
}

/**
 * Отпечаток рабочей копии: HEAD, индекс, правки и новые файлы с содержимым. Не изменился с прошлого
 * хода — ход был разговором: файлы не правились ни редактором, ни из `Bash`.
 */
export function worktreePrint(root = ROOT) {
  const hash = createHash('sha1');
  const tryGit = (args) => {
    try {
      return git(args, root);
    } catch {
      return ''; // у пустого репозитория HEAD нет
    }
  };
  hash.update(tryGit(['rev-parse', 'HEAD']));
  hash.update(git(['diff', '--cached', '--binary'], root));
  hash.update(tryGit(['diff', 'HEAD', '--binary']));
  for (const file of git(['ls-files', '--others', '--exclude-standard'], root).split('\n')) {
    if (!file) continue;
    hash.update(file);
    try {
      hash.update(readFileSync(join(root, file)));
    } catch {
      // файл исчез между командами — хватает имени
    }
  }
  return hash.digest('hex');
}

/**
 * Текст последнего ответа модели из журнала сессии (JSONL): блоки `text` записей `assistant`
 * после последней записи `user` (сообщение или результат инструмента). Читается только хвост файла.
 */
export function lastAssistantText(path, tailBytes = 1 << 20) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - tailBytes);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    const texts = [];
    for (let index = lines.length - 1; index >= 0; index--) {
      let entry;
      try {
        entry = JSON.parse(lines[index]);
      } catch {
        continue;
      }
      if (entry.type === 'user') break;
      if (entry.type !== 'assistant' || !Array.isArray(entry.message?.content)) continue;
      const blocks = entry.message.content.filter((block) => block.type === 'text');
      texts.unshift(...blocks.map((block) => block.text));
    }
    return texts.join('\n');
  } finally {
    closeSync(fd);
  }
}

const scopeOf = (file) => (modOf(file) ?? 'корень').replace(/^mods\//, '');

/** Сводка открытого по журналам — строка для начала сессии. */
export function journalStatus(root = ROOT) {
  const todos = gitFiles(['.'], { cwd: root })
    .filter((file) => JOURNAL.test(file))
    .map((file) => {
      const counts = todoCounts(readFileSync(join(root, file), 'utf8'));
      const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
      const parts = TODO_SECTIONS.filter((section) => counts[section]).map(
        (section) => `${section.toLowerCase()} ${counts[section]}`,
      );
      return total > 0 ? `${scopeOf(file)} ${total} (${parts.join(', ')})` : undefined;
    })
    .filter(Boolean);
  return `Журналы (правила — .claude/rules/journals.md): TODO — ${todos.length > 0 ? todos.join('; ') : 'пусто'}`;
}

if (isMain(import.meta.url)) {
  process.stdout.write(`${journalStatus()}\n`);
}
