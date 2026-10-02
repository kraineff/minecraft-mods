#!/usr/bin/env node
// check-lang — переводы мода (`assets/<мод>/lang/*.json`) сходятся с кодом и между собой:
//   — ключ из кода есть в en_us.json: первый аргумент-литерал `Component.translatable…(…)`,
//     `I18n.get(…)`, `new KeyMapping(…)`; категория клавиш
//     `KeyMapping.Category.register(Identifier.fromNamespaceAndPath(<мод>, "<путь>"))` —
//     ключ `key.category.<мод>.<путь>`;
//   — у каждого языка тот же набор ключей, что у en_us, и те же подстановки (`%s`, `%1$s`, `%d`);
//   — в en_us нет кириллицы: английский текст по-русски — частая забытая правка.
// Ключ из lang, который ни разу не встречается в коде литералом, — info: ключ мог собираться
// из кусков. Ключи ModMenu (`modmenu.*`) читает сам ModMenu — не находка.
//
//   node scripts/checks/check-lang.mjs [--info] [путь…]
//
// Подавление в Java: `// check-lang: причина` на строке находки или строкой выше; в JSON
// комментариев нет — расхождение в lang исправляется.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { javaFiles, lineAt, read, runCli, selectMods, unsuppressed } from './lib/cli.mjs';
import { findCalls, literalValue, maskJava } from './lib/java.mjs';
import { modId } from '../lib/repo.mjs';

const NAME = 'lang';
const KEY_CALL =
  /\b(?:Component\s*\.\s*translatable(?:WithFallback|Escape)?|I18n\s*\.\s*get|new\s+KeyMapping)\s*\(/g;
const CATEGORY_CALL = /\bKeyMapping\s*\.\s*Category\s*\.\s*register\s*\(/g;
const CYRILLIC = /[А-Яа-яЁё]/;

/** Подстановки строки перевода по порядку: `%s`, `%1$s`, `%d` (без `%%`). */
export function placeholders(text) {
  return [...text.replaceAll('%%', '').matchAll(/%(?:\d+\$)?[a-zA-Z]/g)].map((m) => m[0]).sort();
}

/** Ключи переводов в исходнике: `[{ key, line }]`; `mod` — пространство имён для MOD_ID. */
export function usedKeys(source, mod) {
  const masked = maskJava(source);
  const keys = [];
  for (const call of findCalls(source, KEY_CALL, masked)) {
    const key = call.args[0] && literalValue(call.args[0].text);
    if (key !== undefined) keys.push({ key, line: lineAt(source, call.start) });
  }
  for (const call of findCalls(source, CATEGORY_CALL, masked)) {
    const text = source.slice(call.open + 1, call.close);
    const id = /fromNamespaceAndPath\s*\(\s*([^,]+?)\s*,\s*"([^"]+)"\s*\)/.exec(text);
    if (!id) continue;
    const namespace = literalValue(id[1]) ?? mod;
    keys.push({ key: `key.category.${namespace}.${id[2]}`, line: lineAt(source, call.start) });
  }
  return keys;
}

/** Строковые литералы исходника — чтобы не считать неиспользуемым ключ, собранный в коде. */
function literals(source) {
  return new Set([...source.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]));
}

/** Каталоги lang мода: `src/<набор>/resources/assets/<ns>/lang`. */
function langDirs(dir) {
  const dirs = [];
  const src = join(dir, 'src');
  if (!existsSync(src)) return dirs;
  for (const set of readdirSync(src)) {
    const assets = join(src, set, 'resources', 'assets');
    if (!existsSync(assets)) continue;
    for (const ns of readdirSync(assets)) {
      const lang = join(assets, ns, 'lang');
      if (existsSync(lang)) dirs.push(lang);
    }
  }
  return dirs;
}

const keyLine = (text, key) => {
  const at = text.indexOf(`"${key}"`);
  return at < 0 ? 1 : lineAt(text, at);
};

/** Находки мода `dir`: `[{ file, line, text, level? }]`. */
export function checkMod(dir) {
  const mod = modId(dir);
  const problems = [];
  const langs = new Map();
  for (const langDir of langDirs(dir)) {
    for (const name of readdirSync(langDir).filter((file) => file.endsWith('.json'))) {
      const file = join(langDir, name);
      const text = read(file);
      try {
        langs.set(file, { text, values: JSON.parse(text), locale: name.replace(/\.json$/, '') });
      } catch {
        // битый JSON — находка check-json
      }
    }
  }
  const english = [...langs.entries()].filter(([, lang]) => lang.locale === 'en_us');
  const known = new Map();
  for (const [file, lang] of english) {
    for (const [key, value] of Object.entries(lang.values)) {
      known.set(key, value);
      if (typeof value === 'string' && CYRILLIC.test(value)) {
        problems.push({ file, line: keyLine(lang.text, key), text: `«${key}» в en_us — по-русски` });
      }
    }
  }

  for (const [file, lang] of langs) {
    if (lang.locale === 'en_us') continue;
    const own = new Set(Object.keys(lang.values));
    for (const [key, value] of known) {
      if (!own.has(key)) {
        problems.push({ file, line: 1, text: `нет ключа «${key}» (есть в en_us)` });
        continue;
      }
      const theirs = lang.values[key];
      if (typeof value === 'string' && typeof theirs === 'string') {
        const [want, got] = [placeholders(value).join(' '), placeholders(theirs).join(' ')];
        if (want !== got) {
          problems.push({ file, line: keyLine(lang.text, key), text: `«${key}»: подстановки «${got}», в en_us — «${want}»` });
        }
      }
    }
    for (const key of own) {
      if (!known.has(key)) problems.push({ file, line: keyLine(lang.text, key), text: `лишний ключ «${key}» (нет в en_us)` });
    }
  }

  const seen = new Set();
  for (const file of javaFiles([dir])) {
    const source = read(file);
    for (const literal of literals(source)) seen.add(literal);
    const missing = usedKeys(source, mod)
      .filter(({ key }) => !known.has(key))
      .map(({ key, line }) => ({ line, text: `ключа «${key}» нет в en_us.json` }));
    for (const problem of unsuppressed(source, missing, NAME)) problems.push({ file, ...problem });
    for (const { key } of usedKeys(source, mod)) seen.add(key);
  }

  for (const [file, lang] of english) {
    for (const key of Object.keys(lang.values)) {
      if (seen.has(key) || key.startsWith('modmenu.')) continue;
      problems.push({ file, line: keyLine(lang.text, key), text: `«${key}» не встречается в коде литералом`, level: 'info' });
    }
  }
  return problems;
}

export const checker = {
  name: NAME,
  run({ paths }) {
    const mods = selectMods(paths);
    return {
      title: 'Переводы расходятся с кодом или между языками:',
      ok: `Переводы сходятся: проверено модов — ${mods.length}`,
      infoTitle: 'Ключи без литерала в коде (могли собираться из кусков):',
      problems: mods.flatMap(checkMod),
    };
  },
};

runCli(import.meta.url, checker);
