// Разбор исходников Java без парсера — столько, сколько нужно проверкам: маска комментариев и
// строк (позиции сохраняются), строковые литералы, вызовы с аргументами верхнего уровня,
// члены класса с аннотациями. Конструкции, которых проверки не ждут, просто не находятся.
// Известное ограничение: запятая в типовых аргументах прямо в аргументе вызова
// (`f(Map.<A, B>of())`) делит аргумент надвое.

/**
 * Код без комментариев и содержимого строк: длина и переводы строк те же, комментарии и текст
 * литералов — пробелы, кавычки остаются. По маске ищут конструкции кода, а значения берут из
 * исходника по тем же смещениям.
 */
export function maskJava(source) {
  const out = source.split('');
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end < 0 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (source.startsWith('"""', i)) {
      const end = source.indexOf('"""', i + 3);
      const stop = end < 0 ? source.length : end;
      blank(i + 3, stop);
      i = stop + 3;
    } else if (ch === '"' || ch === "'") {
      let k = i + 1;
      while (k < source.length && source[k] !== ch && source[k] !== '\n') {
        k += source[k] === '\\' ? 2 : 1;
      }
      blank(i + 1, k);
      i = k + 1;
    } else i += 1;
  }
  return out.join('');
}

const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', s: ' ', '0': '\0' };

/** Значение литерала Java без кавычек: `\n`, `\"`, `\\`, `\uXXXX`. */
export function unescapeJava(text) {
  return text.replace(/\\(u+[0-9a-fA-F]{4}|.)/g, (_all, code) => {
    if (code[0] === 'u') return String.fromCharCode(Number.parseInt(code.replace(/^u+/, ''), 16));
    return ESCAPES[code] ?? code;
  });
}

/** Аргумент — ровно один строковый литерал: его значение, иначе `undefined`. */
export function literalValue(text) {
  const match = /^\s*"((?:[^"\\\n]|\\.)*)"\s*$/.exec(text);
  return match ? unescapeJava(match[1]) : undefined;
}

/** Смещение парной закрывающей скобки для `open` по маске; не нашлась — `-1`. */
export function matchingBracket(masked, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [pairs[masked[open]]];
  for (let k = open + 1; k < masked.length; k++) {
    const ch = masked[k];
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return k;
    }
  }
  return -1;
}

/** Аргументы между скобками `open`…`close`: `[{ start, end, text, masked }]` по запятым верхнего уровня. */
export function splitArgs(source, masked, open, close) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let k = open + 1; k <= close; k++) {
    const ch = masked[k];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if ((ch === ')' || ch === ']' || ch === '}') && k < close) depth -= 1;
    if ((ch === ',' && depth === 0) || k === close) {
      const text = source.slice(start, k);
      if (text.trim() !== '' || args.length > 0) {
        args.push({ start, end: k, text, masked: masked.slice(start, k) });
      }
      start = k + 1;
    }
  }
  return args;
}

/**
 * Вызовы, чьё начало совпадает с `pattern` (флаг `g`; совпадение кончается на `(`):
 * `[{ match, start, open, close, args }]`. Ищется по маске — в строках и комментариях не найдётся.
 */
export function findCalls(source, pattern, masked = maskJava(source)) {
  const calls = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(masked); match; match = pattern.exec(masked)) {
    const open = match.index + match[0].length - 1;
    if (masked[open] !== '(') continue;
    const close = matchingBracket(masked, open);
    if (close < 0) continue;
    calls.push({ match, start: match.index, open, close, args: splitArgs(source, masked, open, close) });
  }
  return calls;
}

/** Пакет файла: `package com.kraineff.stallium;` → `com.kraineff.stallium`. */
export function packageOf(source, masked = maskJava(source)) {
  return /^\s*package\s+([\w.]+)\s*;/m.exec(masked)?.[1];
}

/** Импорты файла: полные имена. */
export function importsOf(source, masked = maskJava(source)) {
  return [...masked.matchAll(/^\s*import\s+(?:static\s+)?([\w.*]+)\s*;/gm)].map((m) => m[1]);
}

/** Аннотации в начале текста: `[{ name, args }]` и смещение, где они кончились. */
export function leadingAnnotations(masked, from = 0) {
  const annotations = [];
  let k = from;
  for (;;) {
    while (/\s/.test(masked[k] ?? '')) k += 1;
    const match = /^@([A-Za-z_$][\w$.]*)/.exec(masked.slice(k, k + 200));
    if (!match || match[1] === 'interface') break;
    k += match[0].length;
    let args = '';
    let j = k;
    while (/\s/.test(masked[j] ?? '')) j += 1;
    if (masked[j] === '(') {
      const close = matchingBracket(masked, j);
      if (close < 0) break;
      args = masked.slice(j + 1, close);
      k = close + 1;
    }
    annotations.push({ name: match[1].split('.').pop(), args });
  }
  return { annotations, end: k };
}

const TYPE_KEYWORD = /\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/;

/**
 * Верхний тип файла: `{ kind, name, annotations, bodyStart, bodyEnd }` — первая объявленная
 * сущность `class` / `interface` / `enum` / `record` с её аннотациями; не нашлось — `undefined`.
 */
export function topType(source, masked = maskJava(source)) {
  const afterImports = lastImportEnd(masked);
  const match = TYPE_KEYWORD.exec(masked.slice(afterImports));
  if (!match) return undefined;
  const at = afterImports + match.index;
  const { annotations } = leadingAnnotations(masked, afterImports);
  let bodyStart = -1;
  for (let k = at + match[0].length; k < masked.length; k++) {
    if (masked[k] === '(') k = matchingBracket(masked, k);
    else if (masked[k] === '{') {
      bodyStart = k;
      break;
    }
    if (k < 0) return undefined;
  }
  if (bodyStart < 0) return undefined;
  return {
    kind: match[1],
    name: match[2],
    annotations,
    bodyStart,
    bodyEnd: matchingBracket(masked, bodyStart),
  };
}

function lastImportEnd(masked) {
  let end = 0;
  for (const match of masked.matchAll(/^\s*(?:package|import)\b[^;]*;/gm)) {
    end = match.index + match[0].length;
  }
  return end;
}

/**
 * Члены верхнего типа: `[{ kind, name, annotations, modifiers, start }]`; `kind` — `field`,
 * `method`, `type` (вложенный тип) или `init` (блок инициализации). `start` — смещение начала
 * члена с его аннотациями: метка подавления строкой выше накрывает его целиком; строку даёт `lineAt`.
 */
export function members(source, masked = maskJava(source)) {
  const type = topType(source, masked);
  if (!type || type.bodyEnd < 0) return [];
  const result = [];
  let chunkStart = type.bodyStart + 1;
  for (let k = chunkStart; k < type.bodyEnd; k++) {
    const ch = masked[k];
    if (ch === '(' || ch === '[') {
      k = matchingBracket(masked, k);
      if (k < 0) break;
    } else if (ch === ';' || ch === '{') {
      const headerEnd = k;
      if (ch === '{') {
        k = matchingBracket(masked, k);
        if (k < 0) break;
      }
      const member = describe(masked, chunkStart, headerEnd);
      if (member) result.push(member);
      chunkStart = k + 1;
    }
  }
  return result;
}

const MODIFIERS = new Set([
  'public', 'protected', 'private', 'static', 'final', 'abstract', 'native',
  'synchronized', 'transient', 'volatile', 'strictfp', 'default', 'sealed', 'non-sealed',
]);

function describe(masked, from, headerEnd) {
  let start = from;
  while (/\s/.test(masked[start] ?? '')) start += 1;
  const { annotations, end } = leadingAnnotations(masked, from);
  const header = masked.slice(end, headerEnd).replace(/\s+/g, ' ').trim();
  if (header === '' || header === 'static') {
    return annotations.length > 0 || header ? { kind: 'init', name: '', annotations, modifiers: [], start } : undefined;
  }
  const words = header.split(/[\s(=<]/).filter(Boolean);
  const modifiers = words.filter((word) => MODIFIERS.has(word));
  const nested = TYPE_KEYWORD.exec(header);
  if (nested && !header.slice(0, nested.index).includes('(')) {
    return { kind: 'type', name: nested[2], annotations, modifiers, start };
  }
  const paren = header.indexOf('(');
  const assign = header.indexOf('=');
  if (paren >= 0 && (assign < 0 || paren < assign)) {
    const name = /([A-Za-z_$][\w$]*)\s*$/.exec(header.slice(0, paren))?.[1] ?? '';
    return { kind: 'method', name, annotations, modifiers, start };
  }
  const declaration = assign >= 0 ? header.slice(0, assign) : header;
  const name = /([A-Za-z_$][\w$]*)\s*(?:\[\s*\]\s*)*$/.exec(declaration.trim())?.[1] ?? '';
  return { kind: 'field', name, annotations, modifiers, start };
}
