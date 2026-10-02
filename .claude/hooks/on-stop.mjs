#!/usr/bin/env node
// Stop: перед концом хода —
//   — проверки того, что задели изменения (`scripts/verify-changed.mjs`): статические проверки,
//     тесты скриптов, сборка с Checkstyle затронутых модов;
//   — предложение сделать что-то в последнем ответе без записи в TODO (`scripts/journals.mjs`):
//     иначе оно потеряется вместе с чатом.
// Ход без правок файлов — разговор: отпечаток рабочей копии (`worktreePrint`) тот же, что в конце
// прошлого хода. Тогда проверки не повторяются, если прошлый прогон был зелёным, а предложения не
// ищутся. Отпечаток и итог прогона хранятся на сессию во временной папке. Находки не дают
// завершить ход и уходят модели (код 2). Повторный запуск в том же завершении
// (`stop_hook_active`) пропускается, чтобы не зациклиться на том, что не исправить.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lastAssistantText, offerToRecord, worktreePrint } from '../../scripts/journals.mjs';
import { block, hookInput, ROOT } from './hook.mjs';

const input = await hookInput();
if (input.stop_hook_active) process.exit(0);

const stateFile = join(tmpdir(), `claude-stop-mods-${input.session_id ?? 'default'}.json`);
let state = {};
try {
  state = JSON.parse(readFileSync(stateFile, 'utf8'));
} catch {
  // первый ход сессии — сравнивать не с чем, ход считается рабочим
}
const changed = worktreePrint() !== state.print;

const reports = [];
let green = state.green === true;
if (changed || !green) {
  const verify = spawnSync(process.execPath, [join(ROOT, 'scripts', 'verify-changed.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  green = verify.status === 0;
  if (!green) reports.push(`${verify.stderr}${verify.stdout}`.trim());
}

if (typeof input.transcript_path === 'string') {
  let offer;
  try {
    offer = offerToRecord(lastAssistantText(input.transcript_path), { changed });
  } catch {
    // журнал сессии не прочитан — проверять нечего
  }
  if (offer) {
    reports.push(
      `В ответе предложение без записи в TODO: «${offer}». Запиши его в docs/TODO.md мода или корня ` +
        '(раздел «Предложено», с датой) и скажи в ответе, куда записал (.claude/rules/journals.md).',
    );
  }
}

try {
  writeFileSync(stateFile, JSON.stringify({ print: worktreePrint(), green }));
} catch {
  // не записался — следующий ход просто проверит всё заново
}
if (reports.length > 0) block(reports.join('\n\n'));
