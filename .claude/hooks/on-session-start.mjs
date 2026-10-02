#!/usr/bin/env node
// SessionStart: в контекст сессии —
//   — готово ли окружение: Node ≥ 22.2 и Java ≥ версии из gradle/versions.json;
//   — сводка журналов (`scripts/journals.mjs`): открытые дела TODO;
//   — что нового у Minecraft и инструментов (`scripts/versions.mjs`): не чаще раза в 12 часов,
//     результат — в `.cache/versions.json`; нет сети или ответ дольше 8 с — молча пропускается.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './hook.mjs';

const CACHE = join(ROOT, '.cache', 'versions.json');
const CACHE_MS = 12 * 60 * 60 * 1000;
const FETCH_MS = 8000;

process.chdir(ROOT);
const { readVersions } = await import('../../scripts/lib/repo.mjs');
const catalog = readVersions(ROOT);

const problems = [];
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 2)) problems.push(`Node ${process.versions.node}, а нужен 22.2 или новее`);
const java = spawnSync('java', ['-version'], { encoding: 'utf8' });
const javaVersion = Number(/version "(\d+)/.exec(`${java.stderr}${java.stdout}`)?.[1]);
if (!(javaVersion >= catalog.java)) {
  problems.push(`Java ${javaVersion || 'не найдена'}, а сборке нужна ${catalog.java}+ (JAVA_HOME или java в PATH)`);
}

const parts = [];
if (problems.length > 0) parts.push(`Окружение не готово:\n- ${problems.join('\n- ')}`);
try {
  const { journalStatus } = await import('../../scripts/journals.mjs');
  parts.push(journalStatus(ROOT));
} catch (error) {
  parts.push(`Сводка журналов не собрана: ${error.message}`);
}

async function freshReport() {
  try {
    if (Date.now() - statSync(CACHE).mtimeMs < CACHE_MS) return JSON.parse(readFileSync(CACHE, 'utf8'));
  } catch {
    // кеша нет или он битый — спросим сеть
  }
  const { collect } = await import('../../scripts/versions.mjs');
  const report = await Promise.race([
    collect(catalog, ROOT),
    new Promise((resolve) => setTimeout(() => resolve(undefined), FETCH_MS).unref()),
  ]);
  if (report) {
    mkdirSync(join(ROOT, '.cache'), { recursive: true });
    writeFileSync(CACHE, JSON.stringify(report));
  }
  return report;
}

try {
  const report = await freshReport();
  if (report) {
    const { describe, toolLines } = await import('../../scripts/versions.mjs');
    const lines = [...report.changes.map(describe), ...toolLines(report.tools)];
    if (lines.length > 0) {
      parts.push(`Версии (npm run versions, скилл targets):\n- ${lines.join('\n- ')}`);
    }
  }
} catch {
  // сеть недоступна — о версиях в этот раз молчим
}

const context = parts.join('\n\n');
process.stdout.write(
  `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } })}\n`,
);
process.exit(0);
