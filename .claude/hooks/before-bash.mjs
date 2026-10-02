#!/usr/bin/env node
// PreToolUse (Bash): страховка команд модели — отказ блокирует команду (код 2).
//   — публикация — работа пользователя (скилл release): задачи Gradle `modrinth` /
//     `modrinthSyncBody`, `scripts/gallery.mjs` (запись в проект Modrinth) и `gh release create`
//     (релиз запускает публикацию в CI) — отказ;
//   — `git commit`: сообщение по правилу коммитов (`scripts/commit-message.mjs`), похожее на
//     секреты во всём, что может попасть в коммит (`check-secrets.mjs --pending`: индекс, правки
//     и новые файлы — в `git add … && git commit` хук срабатывает раньше `git add`); один
//     `git commit` на команду.
// Команда узнаётся в начале строки или после `&&`, `||`, `;`, `|`, `(`; текст в кавычках
// (`grep "git commit"`) и тела heredoc (содержимое файла) не срабатывают.

import { isMain } from '../../scripts/checks/lib/cli.mjs';
import { commitMessage, subjectProblems, withoutHeredocs } from '../../scripts/commit-message.mjs';

const AT_COMMAND = String.raw`(?:^|[;&|(\n])\s*`;
// Переменные окружения перед командой: `MODRINTH_TOKEN=… node …`
const ENV = String.raw`(?:\w+=\S*\s+)*`;
const PUBLISH = [
  [new RegExp(`${AT_COMMAND}${ENV}\\S*gradlew\\b[^;&|\\n]*\\s(modrinth|modrinthSyncBody)\\b`), 'публикация на Modrinth (задача Gradle modrinth)'],
  [new RegExp(`${AT_COMMAND}${ENV}(?:node\\s+)?\\S*scripts/gallery\\.mjs\\b`), 'запись галереи Modrinth (scripts/gallery.mjs)'],
  [new RegExp(`${AT_COMMAND}${ENV}gh\\s+release\\s+create\\b`), 'GitHub Release — он запускает публикацию на Modrinth'],
];
const GIT_COMMIT_SOURCE = `${AT_COMMAND}git\\b(?:\\s+-[cC]\\s+\\S+)*\\s+commit\\b`;
const GIT_COMMIT = new RegExp(GIT_COMMIT_SOURCE);

/** Сколько `git commit` в команде: путь `scripts/commit-message.mjs` в `git add` — не коммит. */
export function commitCount(command) {
  return (withoutHeredocs(command).match(new RegExp(GIT_COMMIT_SOURCE, 'g')) ?? []).length;
}

/** Что делает хук с командой: `'forbidden'` (с объяснением), `'commit'` — проверить коммит, `undefined` — пропустить. */
export function classify(command) {
  const commands = withoutHeredocs(command).replace(/"[^"\n]*"|'[^'\n]*'/g, '""');
  for (const [pattern, what] of PUBLISH) {
    if (pattern.test(commands)) return { kind: 'forbidden', what };
  }
  if (GIT_COMMIT.test(commands)) return { kind: 'commit' };
  return undefined;
}

if (isMain(import.meta.url)) {
  const { block, hookInput, ROOT } = await import('./hook.mjs');
  const input = await hookInput();
  const command = String(input.tool_input?.command ?? '');
  const verdict = classify(command);
  if (verdict?.kind === 'forbidden') {
    block(`${verdict.what}: публикует пользователь (скилл release) — попроси его.`);
  }
  if (verdict?.kind === 'commit') {
    process.chdir(ROOT);
    if (commitCount(command) > 1) {
      block('По одному git commit на команду: хук проверяет сообщение и файлы каждого коммита отдельно.');
    }
    const reports = [];
    const message = commitMessage(command);
    const wording = message === undefined ? [] : subjectProblems(message);
    if (wording.length > 0) {
      reports.push(
        `Сообщение коммита не по правилу (~/dotfiles/config/claude/rules/git.md): ${wording.join('; ')}. ` +
          'Формат: «тип(область): Суть» — по-русски, повелительно, с заглавной, без точки.',
      );
    }
    const { pendingSecrets } = await import('../../scripts/checks/check-secrets.mjs');
    const secrets = pendingSecrets();
    if (secrets.length > 0) {
      const lines = secrets.map((p) => `${p.file}:${p.line}  ${p.text}`).join('\n');
      reports.push(`Похоже на секреты в том, что уйдёт в коммит:\n${lines}`);
    }
    if (reports.length > 0) block(`Коммит заблокирован.\n\n${reports.join('\n\n')}`);
  }
}
