// Общее для хуков Claude Code этого репозитория (`.claude/settings.json`): корень репозитория,
// вход хука и отказ с объяснением. Проверки живут в `scripts/`, у хука — только разбор входа и
// решение, что из них запустить.

import { fileURLToPath } from 'node:url';

/** Корень репозитория: хуки лежат в `.claude/hooks/`. */
export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Вход хука — JSON из stdin; пустой или битый — `{}`. */
export async function hookInput() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** Отказ: текст уходит модели, код 2 блокирует действие (команду, завершение) или просит исправить. */
export function block(text) {
  process.stderr.write(text.endsWith('\n') ? text : `${text}\n`);
  process.exit(2);
}
