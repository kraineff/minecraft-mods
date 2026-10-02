// Сообщение коммита по правилу `~/dotfiles/config/claude/rules/git.md`: `тип(область): Суть` —
// Conventional Commits по-русски, повелительно, с заглавной, без точки в конце. Проверяет его
// хук перед командой `git commit` (`.claude/hooks/before-bash.mjs`).

const TYPES = ['feat', 'fix', 'docs', 'chore', 'refactor', 'perf', 'build', 'ci'];
const SUBJECT = new RegExp(`^(${TYPES.join('|')})\\(([a-z0-9][a-z0-9/,-]*)\\): (.+)$`);
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1([^\n]*)\n([\s\S]*?)\n\s*\2\s*(?=\n|$)/g;

/**
 * Команда без тел heredoc: текст, который пишут в файл, — не команды. Хвост строки после метки
 * (`cat <<EOF | curl …`) остаётся — это команды.
 */
export function withoutHeredocs(command) {
  return command.replace(HEREDOC, (_all, _quote, tag, rest) => `<<${tag}${rest}`);
}

/** Тела heredoc команды — текст, который уйдёт в файл или на stdin. */
export function heredocBodies(command) {
  return [...command.matchAll(HEREDOC)].map((match) => match[4]);
}

/**
 * Сообщение из команды `git commit`: тело heredoc после `-F -` или первое `-m "…"` / `-m '…'`
 * (и в связке коротких флагов: `-am`, `-qam`); не разобрать (`-F файл`, `--no-edit`,
 * редактор) — `undefined`.
 */
export function commitMessage(command) {
  const heredoc = /-F\s+-\s*<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n\s*\2\s*(?:\n|$)/.exec(
    command,
  );
  if (heredoc) return heredoc[3];
  const inline = /\s-[a-zA-Z]*m\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(command);
  if (inline) return (inline[1] ?? inline[2]).replace(/\\(["\\$`])/g, '$1');
  return undefined;
}

/** Что не так с первой строкой сообщения: `[]` — всё по правилу. */
export function subjectProblems(message) {
  const subject = message.split('\n')[0].trim();
  if (/^(Merge|Revert) /.test(subject)) return [];
  const match = SUBJECT.exec(subject);
  if (!match) {
    return [
      `первая строка — «тип(область): Суть», тип — ${TYPES.join(', ')}; область — имя модуля или папки`,
    ];
  }
  const summary = match[3];
  const problems = [];
  if (!/^\p{Lu}/u.test(summary)) problems.push('суть — с заглавной буквы');
  if (!/[А-Яа-яЁё]/.test(summary)) problems.push('суть — по-русски');
  if (/\.$/.test(summary)) problems.push('без точки в конце');
  return problems;
}
