#!/usr/bin/env node
// PreToolUse (Bash): страховка команд модели.
//   — публикация — у CI и пользователя (скилл release): `scripts/modrinth.mjs upload` и `sync`
//     (запись в проект Modrinth) и `gh release create` (релизы и теги создаёт CI после
//     публикации) — отказ (код 2). Пробный прогон (`--dry-run`) и `modrinth.mjs published`
//     ничего не пишут;
//   — `git push` ветки main, после которого CI опубликует моды с выросшей `mod_version`
//     (`scripts/ci.mjs`, `pendingReleases`), — вопрос пользователю в окне подтверждения:
//     пуш с бампом и есть релиз;
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
/** Команды публикации: шаблон, что это, и пробный прогон, который ничего не пишет. */
const PUBLISH = [
  [
    new RegExp(`${AT_COMMAND}${ENV}(?:node\\s+)?\\S*scripts/modrinth\\.mjs\\s+(upload|sync)\\b[^;&|\\n]*`),
    'запись в Modrinth (scripts/modrinth.mjs upload / sync)',
    /\s--dry-run\b/,
  ],
  [
    new RegExp(`${AT_COMMAND}${ENV}gh\\s+release\\s+create\\b[^;&|\\n]*`),
    'GitHub Release — релизы и теги создаёт CI после публикации',
    undefined,
  ],
];
const GIT_COMMIT_SOURCE = `${AT_COMMAND}git\\b(?:\\s+-[cC]\\s+\\S+)*\\s+commit\\b`;
const GIT_COMMIT = new RegExp(GIT_COMMIT_SOURCE);
const GIT_PUSH = new RegExp(`${AT_COMMAND}${ENV}git\\b(?:\\s+-[cC]\\s+\\S+)*\\s+push\\b`);

/** Сколько `git commit` в команде: путь `scripts/commit-message.mjs` в `git add` — не коммит. */
export function commitCount(command) {
  return (withoutHeredocs(command).match(new RegExp(GIT_COMMIT_SOURCE, 'g')) ?? []).length;
}

/**
 * Что делает хук с командой: `{ kind: 'forbidden', what }`, иначе `{ commit, push }` — есть ли в
 * команде `git commit` и `git push`; нечего проверять — `undefined`.
 */
export function classify(command) {
  const commands = withoutHeredocs(command).replace(/"[^"\n]*"|'[^'\n]*'/g, '""');
  for (const [pattern, what, dryRun] of PUBLISH) {
    const match = pattern.exec(commands);
    if (match && !(dryRun && dryRun.test(match[0]))) return { kind: 'forbidden', what };
  }
  const commit = GIT_COMMIT.test(commands);
  const push = GIT_PUSH.test(commands);
  return commit || push ? { kind: 'git', commit, push } : undefined;
}

/** Ответ хука «спросить пользователя» — окно подтверждения с причиной. */
function ask(reason) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason },
    })}\n`,
  );
  process.exit(0);
}

if (isMain(import.meta.url)) {
  const { block, hookInput, ROOT } = await import('./hook.mjs');
  const input = await hookInput();
  const command = String(input.tool_input?.command ?? '');
  const verdict = classify(command);
  if (verdict?.kind === 'forbidden') {
    block(`${verdict.what}: публикует CI по росту mod_version (скилл release).`);
  }
  if (verdict?.commit) {
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
  if (verdict?.push) {
    const { pendingReleases } = await import('../../scripts/ci.mjs');
    // Коммит в той же команде ещё не сделан — версию берём с диска
    const releases = pendingReleases({ root: ROOT, worktree: verdict.commit });
    if (releases.length > 0) {
      const list = releases.map((item) => `${item.dir.replace('mods/', '')} ${item.from} → ${item.to}`).join(', ');
      ask(`Этот пуш опубликует на Modrinth (CI, скилл release): ${list}. Релиз согласован?`);
    }
  }
}
