// Общий каркас проверок `scripts/checks/check-*.mjs`: список файлов из git, моды по путям,
// подавления `// check-<имя>: причина`, разбор аргументов, вывод и коды выхода.
//
// Соглашения для всех проверок:
//   node scripts/checks/check-<имя>.mjs [--tests] [--info] [путь…]
//   --tests — смотреть и gametests (где проверка по умолчанию их пропускает);
//   --info  — показать находки уровня info (иначе печатается только их число).
// Путь сужает проверку до мода, папки или файла; несуществующий путь и неизвестный флаг —
// ошибка запуска.
// Вывод: чисто — одна строка итога в stdout, код 0; находки — заголовок и строки
// `файл:строка  текст` в stderr (находки в тестах — отдельным блоком `tests:`), код 1;
// ошибка запуска или окружения — сообщение в stderr, код 2.
// Подавление: `// check-<имя>: причина` (или `/* … */`, `<!-- … -->`) на строке находки или
// строкой выше. Причина обязательна: метка без неё — сама находка.
//
// Проверка экспортирует `checker = { name, run(options) }`: `run` возвращает (или обещает)
// `{ title, ok, problems, infoTitle?, note? }`, а `runCli` печатает его по этим правилам.
// Так же проверки запускает `check-all.mjs` — в одном процессе.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { modDirs, modOf, plural } from '../../lib/repo.mjs';

// ===== Файлы =====

/** Сборка, кеши Gradle, запуски клиента и зависимости: в git их нет, но на всякий случай — мимо. */
const GENERATED = /(^|\/)(node_modules|build|\.gradle|run|bin|out)(\/|$)/;
export const isGenerated = (file) => GENERATED.test(file);

/**
 * Файлы репозитория по маскам `git ls-files` — отслеживаемые и новые, не игнорируемые;
 * без сборки и удалённых до коммита. `roots` — пути из аргументов.
 */
export function gitFiles(patterns = ['.'], { roots = [], cwd = process.cwd() } = {}) {
  const out = git(
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...patterns],
    cwd,
  );
  return [...new Set(out.split('\n'))]
    .filter((file) => file && !isGenerated(file))
    .filter((file) => existsSync(join(cwd, file)))
    .filter((file) => roots.length === 0 || roots.some((root) => underRoot(file, root)))
    .sort();
}

/** Вывод git; ошибка git (не репозиторий, нет git) — ошибка запуска с его сообщением. */
export function git(args, cwd = process.cwd()) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new CheckError(
      `git ${args[0]} не отработал: ${String(error.stderr || error.message).trim()}`,
    );
  }
}

/** Исходники Java модов (`mods/<id>/src/<набор>/java/**.java`). */
export function javaFiles(roots = []) {
  return gitFiles(['mods'], { roots }).filter((file) =>
    /^mods\/[^/]+\/src\/[^/]+\/java\/.+\.java$/.test(file),
  );
}

/** Файл внутри пути из аргументов: `mods/stallium`, `mods/stallium/`, сам файл, `.`. */
export function underRoot(file, root) {
  const clean = root.replace(/^\.\//, '').replace(/\/+$/, '');
  return clean === '.' || clean === '' || file === clean || file.startsWith(`${clean}/`);
}

/** Моды по путям: мод берётся, если путь лежит в нём или он — в пути; без путей — все. */
export function selectMods(paths, cwd = process.cwd()) {
  const mods = modDirs(cwd);
  if (paths.length === 0) return mods;
  const norm = paths.map((path) => path.replace(/^\.\//, '').replace(/\/+$/, ''));
  return mods.filter((mod) =>
    norm.some(
      (path) =>
        path === '.' || path === '' || path === mod || path.startsWith(`${mod}/`) || mod.startsWith(`${path}/`),
    ),
  );
}

export { modOf };

/** Файл тестов: gametests мода (`src/gametest/`) и тесты скриптов (`tests/`). */
export const isTestPath = (file) => /(^|\/)src\/gametest\//.test(file) || /(^|\/)tests\//.test(file);

export const read = (file) => readFileSync(file, 'utf8');

/** «N файлов» с нужной формой слова — для строк итога. */
export const filesCount = (n) => `${n} ${plural(n, 'файл', 'файла', 'файлов')}`;

/** Номер строки (с 1) по смещению в тексте. */
export function lineAt(text, offset) {
  let line = 1;
  for (let k = 0; k < offset && k < text.length; k++) if (text.charCodeAt(k) === 10) line += 1;
  return line;
}

// ===== Подавления =====

const markers = new Map();
function marker(name) {
  if (!markers.has(name)) {
    markers.set(name, new RegExp(`(?://|/\\*|<!--|#)\\s*check-${name}(?![\\w-])(:?)(.*)$`));
  }
  return markers.get(name);
}

/** Метка на строке текста: `'ok'` (с причиной), `'empty'` (без причины) или `undefined`. */
function markerState(text, name) {
  const match = text === undefined ? null : marker(name).exec(text);
  if (!match) return undefined;
  const reason = match[2].replace(/\s*(?:\*\/|-->).*$/, '').trim();
  if (!match[1]) return reason ? undefined : 'empty';
  return reason ? 'ok' : 'empty';
}

/**
 * Подавление находки на строке `line` (с 1): метка на ней или строкой выше. `'ok'` — с
 * причиной, `'empty'` — без причины (находка остаётся, а метку отдельно ловит
 * `emptySuppressions`), `undefined` — метки нет.
 */
export function suppressionAt(lines, line, name) {
  return markerState(lines[line - 1], name) ?? markerState(lines[line - 2], name);
}

/** Находка на строке `line` подавлена меткой с причиной. */
export const suppressed = (lines, line, name) => suppressionAt(lines, line, name) === 'ok';

/** Метки без причины: `[{ line, text }]` — каждая сама находка (уровня error). */
export function emptySuppressions(lines, name) {
  return lines.flatMap((text, index) =>
    markerState(text, name) === 'empty'
      ? [{ line: index + 1, text: `подавление check-${name} без причины` }]
      : [],
  );
}

/** Находки файла без подавленных, плюс пустые метки: общий хвост проверок «по файлу». */
export function unsuppressed(source, problems, name) {
  const lines = source.split('\n');
  return [
    ...problems.filter((problem) => !suppressed(lines, problem.line, name)),
    ...emptySuppressions(lines, name),
  ];
}

// ===== Аргументы и вывод =====

/** Ошибка запуска или окружения: печатается сообщением, код выхода 2. */
export class CheckError extends Error {}

const FLAGS = new Set(['--tests', '--info']);

/** `[--tests] [--info] [путь…]` → `{ paths, tests, info }`; `extra` — ещё флаги (`--changed`). */
export function parseArgs(argv, { extra = [], cwd = process.cwd() } = {}) {
  const options = { paths: [], tests: false, info: false };
  for (const arg of argv) {
    if (FLAGS.has(arg) || extra.includes(arg)) options[arg.slice(2)] = true;
    else if (arg.startsWith('--'))
      throw new CheckError(`неизвестный флаг ${arg} (есть: ${[...FLAGS, ...extra].join(', ')})`);
    else if (!existsSync(join(cwd, arg))) throw new CheckError(`путь не найден: ${arg}`);
    else options.paths.push(arg);
  }
  return options;
}

const format = (problem) => `${problem.file}:${problem.line}  ${problem.text}`;

/**
 * Результат проверки → `{ stdout, stderr, code }`. Находки уровня `info` не валят проверку;
 * остальные (`error`, без уровня) — валят.
 */
export function render(result, { info = false } = {}) {
  const errors = result.problems.filter((p) => p.level !== 'info');
  const infos = result.problems.filter((p) => p.level === 'info');
  let stdout = '';
  let stderr = '';
  if (info && infos.length > 0) {
    stdout += `${result.infoTitle ?? 'Info:'}\n${infos.map(format).join('\n')}\n`;
  }
  if (errors.length > 0) {
    const main = errors.filter((p) => !isTestPath(p.file));
    const tests = errors.filter((p) => isTestPath(p.file));
    const parts = [result.title];
    if (main.length > 0) parts.push(main.map(format).join('\n'));
    if (tests.length > 0) parts.push(`tests:\n${tests.map(format).join('\n')}`);
    stderr += `${parts.join('\n')}\n`;
    if (!info && infos.length > 0) stderr += `(ещё ${infos.length} info — покажет --info)\n`;
    if (result.note) stderr += `(${result.note})\n`;
    return { stdout, stderr, code: 1 };
  }
  const suffix = infos.length > 0 ? `, info: ${infos.length} (--info)` : '';
  const note = result.note ? ` (${result.note})` : '';
  stdout += `${result.ok}${suffix}${note}\n`;
  return { stdout, stderr, code: 0 };
}

/** Ошибка запуска → текст для stderr: своя — сообщением, чужая — со стеком. */
export function errorText(name, error) {
  const text = error instanceof CheckError ? error.message : (error?.stack ?? String(error));
  return `check-${name}: ${text}\n`;
}

/** Модуль запущен напрямую (`node file.mjs`), а не импортирован тестом или check-all. */
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === metaUrl;
  } catch {
    return false;
  }
}

/**
 * Запуск проверки из командной строки, если модуль запущен напрямую. Итог — в `process.exitCode`:
 * обещание не возвращается, вызов в конце модуля проверки ничего не ждёт.
 */
export function runCli(metaUrl, checker) {
  if (!isMain(metaUrl)) return;
  const fail = (error) => {
    process.stderr.write(errorText(checker.name, error));
    process.exitCode = 2;
  };
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error);
    return;
  }
  Promise.resolve()
    .then(() => checker.run(options))
    .then((result) => {
      const { stdout, stderr, code } = render(result, options);
      process.stdout.write(stdout);
      process.stderr.write(stderr);
      process.exitCode = code;
    })
    .catch(fail);
}

/**
 * Проверка «по файлу» над исходниками Java: `check(source, file)` → `[{ line, text }]`.
 * Без `tests` gametests пропускаются. Подавления применяются здесь.
 */
export function checkEachJavaFile({ paths, tests }, name, check) {
  const files = javaFiles(paths).filter((file) => tests || !isTestPath(file));
  const problems = [];
  for (const file of files) {
    const source = read(file);
    for (const problem of unsuppressed(source, check(source, file), name)) {
      problems.push({ file, ...problem });
    }
  }
  return { files, problems };
}
