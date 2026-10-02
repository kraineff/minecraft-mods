#!/usr/bin/env node
// build — задача Gradle для модов по целям Minecraft: `./gradlew -p mods/<мод> <задача>
// -PtargetMc=<цель>` по очереди (параллельные сборки Loom дерутся за кеш и память).
//
//   node scripts/build.mjs [мод…] [--all-targets | --target <цель>] [--task <задача>]
//
// Мод — id (`stallium`) или путь (`mods/stallium`); без модов — все. Цель по умолчанию —
// цель мода по умолчанию (последний релиз), `--all-targets` — все цели мода из каталога,
// `--target` — одна (мод без неё пропускается). Задача — `build` (компиляция и Checkstyle).
// Вывод — строка на сборку: `[ok] stallium 26.3 build (21 с)` или `[FAIL]` с хвостом лога.
// Код выхода: 0 — все сборки прошли, 1 — есть упавшие, 2 — неверный аргумент.

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { isMain } from './checks/lib/cli.mjs';
import {
  defaultTarget,
  modDirs,
  modId,
  modProperties,
  modTargets,
  plural,
  ROOT,
  readVersions,
} from './lib/repo.mjs';

const TAIL_LINES = 40;

/** Разбор аргументов: `{ mods, all, target, task }`; ошибка — исключение с текстом. */
export function parseBuildArgs(argv, known) {
  const options = { mods: [], all: false, target: undefined, task: 'build' };
  for (let k = 0; k < argv.length; k++) {
    const arg = argv[k];
    if (arg === '--all-targets') options.all = true;
    else if (arg === '--target' || arg === '--task') {
      const value = argv[++k];
      if (!value || value.startsWith('--')) throw new Error(`${arg} — нужно значение`);
      options[arg.slice(2)] = value;
    } else if (arg.startsWith('--')) throw new Error(`неизвестный флаг ${arg}`);
    else {
      const dir = arg.startsWith('mods/') ? arg.replace(/\/+$/, '') : `mods/${arg}`;
      if (!known.includes(dir)) throw new Error(`нет мода ${arg} (есть: ${known.map(modId).join(', ')})`);
      options.mods.push(dir);
    }
  }
  if (options.all && options.target) throw new Error('--all-targets и --target — что-то одно');
  return options;
}

/** Сборки по плану: `[{ dir, target }]`. */
export function buildPlan(options, versions, props = (dir) => modProperties(dir)) {
  const dirs = options.mods.length > 0 ? options.mods : modDirs();
  const plan = [];
  for (const dir of dirs) {
    const { targets } = modTargets(props(dir), versions);
    const names = targets.map((target) => target.minecraft);
    const chosen = options.all ? names : options.target ? names.filter((name) => name === options.target) : [defaultTarget(targets)];
    for (const target of chosen.filter(Boolean)) plan.push({ dir, target });
  }
  return plan;
}

/** `./gradlew -p <мод> <задачи> -PtargetMc=<цель>` с собранным выводом → `{ ok, output, seconds }`. */
export function runGradle(dir, tasks, target, { root = ROOT, extra = [] } = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    const args = ['-p', dir, ...tasks, ...(target ? [`-PtargetMc=${target}`] : []), '--console=plain', ...extra];
    const child = spawn(join(root, 'gradlew'), args, { cwd: root, env: { ...process.env, TERM: 'dumb' } });
    let output = '';
    const collect = (chunk) => {
      output += chunk;
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => resolve({ ok: false, output: String(error), seconds: 0 }));
    child.on('close', (code) => resolve({ ok: code === 0, output, seconds: Math.round((Date.now() - started) / 1000) }));
  });
}

/** Служебные строки Gradle: задачи без сбоя, настройка, подсказки — причину они не объясняют. */
const NOISE = /^(> Task (?!.*FAILED)|> Configure project|Fabric Loom: |\[Incubating\]|\* Try:|> Run with|> Get more help|\d+ actionable tasks?:)/;

/** Хвост вывода Gradle без пустых и служебных строк — его хватает, чтобы увидеть причину. */
export const tail = (output) =>
  output
    .split('\n')
    .filter((line) => line.trim() !== '' && !NOISE.test(line.trim()))
    .slice(-TAIL_LINES)
    .join('\n');

async function main(argv) {
  let options;
  try {
    options = parseBuildArgs(argv, modDirs());
  } catch (error) {
    process.stderr.write(`build: ${error.message}\n`);
    return 2;
  }
  const plan = buildPlan(options, readVersions());
  if (plan.length === 0) {
    process.stdout.write('build: собирать нечего\n');
    return 0;
  }
  const failed = [];
  for (const { dir, target } of plan) {
    const result = await runGradle(dir, [options.task], target);
    const title = `${modId(dir)} ${target} ${options.task} (${result.seconds} с)`;
    if (result.ok) process.stdout.write(`[ok] ${title}\n`);
    else {
      failed.push(`${modId(dir)} ${target}`);
      process.stderr.write(`[FAIL] ${title}\n${tail(result.output)}\n`);
    }
  }
  if (failed.length > 0) {
    process.stderr.write(`build: упало ${failed.length} из ${plan.length} — ${failed.join(', ')}\n`);
    return 1;
  }
  process.stdout.write(`build: ${plan.length} ${plural(plan.length, 'сборка', 'сборки', 'сборок')} — ok\n`);
  return 0;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
