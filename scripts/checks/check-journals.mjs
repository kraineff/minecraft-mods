#!/usr/bin/env node
// check-journals — `docs/TODO.md` корня и модов в формате, который читают скрипты и хуки
// (`scripts/journals.mjs`, правила — `.claude/rules/journals.md`): разделы `##` — только статусы
// (Предложено, Согласовано, Проверить вживую, Ждёт), пункты — `- [ ] YYYY-MM-DD · что и зачем`;
// сделанное удаляют, а не отмечают `[x]`.
//
//   node scripts/checks/check-journals.mjs [путь…]
//
// `--tests` и `--info` ничего не меняют. Подавления нет: формат журнала правится в самом журнале.

import { JOURNAL, TODO_SECTIONS } from '../journals.mjs';
import { filesCount, gitFiles, read, runCli } from './lib/cli.mjs';

const NAME = 'journals';

/** Находки в `TODO.md`: `[{ line, text }]`. */
export function checkTodo(text) {
  const problems = [];
  let section;
  text.split('\n').forEach((line, index) => {
    const header = /^## (.+?)\s*$/.exec(line);
    if (header) {
      section = header[1];
      if (!TODO_SECTIONS.includes(section)) {
        problems.push({ line: index + 1, text: `раздел «${section}» — не статус (${TODO_SECTIONS.join(', ')})` });
      }
    } else if (/^\s*- \[[xX]\]/.test(line)) {
      problems.push({ line: index + 1, text: 'сделанный пункт — удалить, а не отмечать' });
    } else if (/^- \[ \]/.test(line)) {
      if (!section) problems.push({ line: index + 1, text: 'пункт вне раздела-статуса' });
      if (!/^- \[ \] \d{4}-\d{2}-\d{2} · \S/.test(line)) {
        problems.push({ line: index + 1, text: 'пункт — «- [ ] YYYY-MM-DD · что и зачем»' });
      }
    }
  });
  return problems;
}

export const checker = {
  name: NAME,
  run({ paths }) {
    const files = gitFiles(['.'], { roots: paths }).filter((file) => JOURNAL.test(file));
    const problems = [];
    for (const file of files) {
      for (const problem of checkTodo(read(file))) problems.push({ file, ...problem });
    }
    return {
      title: 'Журналы не в своём формате (.claude/rules/journals.md):',
      ok: `Журналы в формате: проверено ${filesCount(files.length)}`,
      problems,
    };
  },
};

runCli(import.meta.url, checker);
