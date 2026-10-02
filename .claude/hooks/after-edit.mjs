#!/usr/bin/env node
// PostToolUse (Edit|Write): правленый файл сразу сверяется с правилами — те проверки
// `scripts/checks/`, которые он задевает (план — `changedPlan` из check-all): Java — логи и
// миксины мода, lang — переводы мода, JSON — разбор, каталог целей — цели. Что нашлось — модели
// (код 2). Файл вне репозитория — мимо. Сборку и Checkstyle здесь не гоняем — это хук
// завершения хода (`on-stop.mjs`).

import { existsSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { block, hookInput, ROOT } from './hook.mjs';

const input = await hookInput();
const path = input.tool_input?.file_path ?? input.tool_response?.filePath;
if (typeof path !== 'string') process.exit(0);
const file = relative(ROOT, isAbsolute(path) ? path : join(input.cwd ?? process.cwd(), path));
if (file.startsWith('..') || isAbsolute(file) || !existsSync(join(ROOT, file))) process.exit(0);
process.chdir(ROOT);

// Правку самих скриптов и хуков стерегут их тесты (npm run test:scripts, хук завершения хода)
if (file.startsWith('scripts/') || file.startsWith('.claude/')) process.exit(0);

const { changedPlan } = await import('../../scripts/checks/check-all.mjs');
const { modDirs } = await import('../../scripts/lib/repo.mjs');
const plan = changedPlan([file], { mods: modDirs(ROOT) });

const reports = [];
for (const { name, paths } of plan) {
  const { checker } = await import(`../../scripts/checks/check-${name}.mjs`);
  const result = await checker.run({ paths, tests: true, info: false });
  const problems = result.problems.filter((problem) => problem.level !== 'info');
  if (problems.length > 0) {
    reports.push(`check-${name}:\n${problems.map((p) => `${p.file}:${p.line}  ${p.text}`).join('\n')}`);
  }
}
if (reports.length > 0) block(`После правки ${file} — находки проверок (скилл checks):\n\n${reports.join('\n\n')}`);
