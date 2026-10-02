#!/usr/bin/env node
// check-json — каждый JSON репозитория читается: fabric.mod.json, конфиги миксинов, lang,
// шрифты и модели ресурсов, каталог gradle/versions.json, галереи, package.json. Битый JSON
// ломает сборку не сразу: ресурс мода падает только в игре, а lang молча показывает ключи.
//
//   node scripts/checks/check-json.mjs [путь…]
//
// Смотрит все `*.json` из git (сборка — мимо). Сверку ключей lang между языками делает
// check-lang. Подавления нет: в JSON нет комментариев.

import { filesCount, gitFiles, read, runCli } from './lib/cli.mjs';

const NAME = 'json';

/**
 * Строка ошибки разбора по сообщению `JSON.parse`: `(line L column C)` или `position N`; без
 * позиции — 1, а фрагмент вокруг ошибки остаётся в тексте сообщения.
 */
function errorLine(text, error) {
  const message = String(error.message);
  const line = /line (\d+) column \d+/.exec(message)?.[1];
  if (line !== undefined) return Number(line);
  const position = /position (\d+)/.exec(message)?.[1];
  if (position === undefined) return 1;
  return text.slice(0, Number(position)).split('\n').length;
}

/** Разбор: `{ value }` или `{ line, text }` с причиной. */
export function parseJson(text) {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { line: errorLine(text, error), text: `JSON не читается: ${error.message}` };
  }
}

export const checker = {
  name: NAME,
  run({ paths }) {
    const files = gitFiles(['*.json'], { roots: paths });
    const problems = [];
    for (const file of files) {
      const result = parseJson(read(file));
      if (!('value' in result)) problems.push({ file, line: result.line, text: result.text });
    }
    return {
      title: 'JSON не читается:',
      ok: `JSON читается: проверено ${filesCount(files.length)}`,
      problems,
    };
  },
};

runCli(import.meta.url, checker);
