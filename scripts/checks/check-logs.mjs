#!/usr/bin/env node
// check-logs — логи модов по правилу логов (`~/dotfiles/config/claude/rules/logging.md`, скилл
// `logging`) на SLF4J:
//   — логгер: `private static final Logger log = LoggerFactory.getLogger("<пакет>.<Класс>")` —
//     поле `log`, имя — строковый литерал с полным именем своего класса;
//   — сообщение — строковый литерал без склейки `+`: только параметризация `{}`;
//   — формат `[Контекст]: Факт` (перед контекстом может стоять `[владелец]`), факт с заглавной;
//   — число `{}` равно числу аргументов (throwable последним аргументом — без `{}`);
//   — `error` — с throwable последним аргументом: сломанное состояние пишется со стеком;
//   — `System.out` / `System.err` и `printStackTrace()` — нельзя: только логгер.
//
//   node scripts/checks/check-logs.mjs [--tests] [путь…]
//
// Throwable узнаётся по имени аргумента (`e`, `ex`, `t`, `error`, `exception`, `throwable`,
// `cause`) или по `new …Exception(…)` / `new …Error(…)`: тип переменной без компилятора не
// виден. Gametests по умолчанию пропускаются (`--tests` — смотреть и их).
// Подавление: `// check-logs: причина` на строке находки или строкой выше.

import { basename } from 'node:path';
import { checkEachJavaFile, filesCount, lineAt, runCli } from './lib/cli.mjs';
import { findCalls, literalValue, maskJava, packageOf } from './lib/java.mjs';

const NAME = 'logs';
const LOG_CALL = /\blog\s*\.\s*(trace|debug|info|warn|error)\s*\(/g;
const THROWABLE_NAME = /^(e|ex|t|err|error|exception|throwable|cause)$/;
const THROWABLE_NEW = /^new\s+[\w.]*(Exception|Error|Throwable)\s*\(/;
// `[владелец] [Контекст >> Объект]: Факт` — скобки, двоеточие после последней, затем текст
const FORMAT = /^(?:\[[^\]\n]+\] )*\[[^\]\n]+\]: \S/;

const isThrowable = (text) => THROWABLE_NAME.test(text.trim()) || THROWABLE_NEW.test(text.trim());

/** Находки в исходнике Java: `[{ line, text }]`. */
export function checkLogs(source, file) {
  const masked = maskJava(source);
  const problems = [];
  const at = (offset) => lineAt(source, offset);

  for (const call of findCalls(source, LOG_CALL, masked)) {
    const level = call.match[1];
    const [message, ...rest] = call.args;
    if (!message) continue;
    const text = literalValue(message.text);
    if (text === undefined) {
      const why = /"\s*\+|\+\s*"/.test(message.text) ? 'склейка строк' : 'не литерал';
      problems.push({
        line: at(call.start),
        text: `log.${level}: сообщение — один строковый литерал с {} (${why})`,
      });
      continue;
    }
    if (!FORMAT.test(text)) {
      problems.push({
        line: at(call.start),
        text: `log.${level}("${text}"): формат «[Контекст]: Факт» (rules/logging.md)`,
      });
    } else {
      const fact = text.replace(/^(?:\[[^\]\n]+\] )*\[[^\]\n]+\]: /, '');
      if (/^\p{Ll}/u.test(fact)) {
        problems.push({ line: at(call.start), text: `log.${level}("${text}"): факт — с заглавной` });
      }
    }
    const holes = text.split('{}').length - 1;
    const throwableLast = rest.length > 0 && isThrowable(rest.at(-1).text);
    const params = rest.length - (throwableLast && holes < rest.length ? 1 : 0);
    if (throwableLast && holes === rest.length) {
      problems.push({
        line: at(call.start),
        text: `log.${level}: throwable попал в {} — передай его последним аргументом без {}, а причину для warn — текстом (e.getMessage())`,
      });
    } else if (holes !== params) {
      problems.push({
        line: at(call.start),
        text: `log.${level}: плейсхолдеров {} — ${holes}, аргументов — ${params}`,
      });
    }
    if (level === 'error' && !throwableLast) {
      problems.push({
        line: at(call.start),
        text: 'log.error без throwable последним аргументом: сломанное состояние — со стеком, восстановимое — warn',
      });
    }
  }

  for (const call of findCalls(source, /\bLoggerFactory\s*\.\s*getLogger\s*\(/g, masked)) {
    const expected = `${packageOf(source, masked) ?? ''}.${basename(file, '.java')}`;
    const name = call.args.length === 1 ? literalValue(call.args[0].text) : undefined;
    if (name !== expected) {
      problems.push({
        line: at(call.start),
        text: `логгер: LoggerFactory.getLogger("${expected}") — полное имя класса литералом`,
      });
    }
    const declaration = masked.slice(masked.lastIndexOf(';', call.start) + 1, call.start);
    if (!/\bprivate\s+static\s+final\s+Logger\s+log\s*=\s*$/.test(declaration.replace(/\s+/g, ' '))) {
      problems.push({
        line: at(call.start),
        text: 'логгер: private static final Logger log = LoggerFactory.getLogger(…)',
      });
    }
  }

  for (const match of masked.matchAll(/\bSystem\s*\.\s*(out|err)\s*\.\s*print|\.\s*printStackTrace\s*\(/g)) {
    problems.push({
      line: at(match.index),
      text: `${match[1] ? `System.${match[1]}` : 'printStackTrace()'} — только через логгер log`,
    });
  }
  return problems;
}

export const checker = {
  name: NAME,
  run(options) {
    const { files, problems } = checkEachJavaFile(options, NAME, checkLogs);
    return {
      title: 'Логи не по правилу (rules/logging.md, скилл logging):',
      ok: `Логи по правилу: проверено ${filesCount(files.length)} Java`,
      problems,
    };
  },
};

runCli(import.meta.url, checker);
