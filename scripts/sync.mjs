#!/usr/bin/env node
// sync — то, что выводится из каталога целей `gradle/versions.json`: блок целей в README каждого
// мода (между метками `<!-- targets: … -->` и `<!-- /targets -->`) — JAR и версии Minecraft.
// Запускают `npm run sync` и `npm run versions -- --write`; расхождение ловит check-targets.
//
//   node scripts/sync.mjs          — переписать блоки
//   node scripts/sync.mjs --check  — только проверить: код 1, если что-то отстало
//
// README без меток пропускается с предупреждением: блок туда добавляют руками один раз.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from './checks/lib/cli.mjs';
import {
  modDirs,
  modId,
  modProperties,
  modTargets,
  ROOT,
  readVersions,
  renderTargetsTable,
  withTargetsTable,
} from './lib/repo.mjs';

/** README, где блок целей отстал: `[{ file, text }]` — путь и новое содержимое; `missing` — без меток. */
export function pendingReadmes(root = ROOT) {
  const versions = readVersions(root);
  const pending = [];
  const missing = [];
  for (const dir of modDirs(root)) {
    const file = join(dir, 'README.md');
    if (!existsSync(join(root, file))) continue;
    const props = modProperties(dir, root);
    const { targets, error } = modTargets(props, versions);
    if (error) continue; // находка check-targets
    const text = readFileSync(join(root, file), 'utf8');
    const next = withTargetsTable(text, renderTargetsTable(modId(dir), props, targets));
    if (next === undefined) missing.push(file);
    else if (next !== text) pending.push({ file, text: next });
  }
  return { pending, missing };
}

if (isMain(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { pending, missing } = pendingReadmes();
  for (const file of missing) process.stderr.write(`sync: в ${file} нет блока целей — пропущен\n`);
  if (check) {
    for (const { file } of pending) process.stderr.write(`sync: блок целей отстал — ${file}\n`);
    process.exitCode = pending.length > 0 ? 1 : 0;
  } else {
    for (const { file, text } of pending) {
      writeFileSync(join(ROOT, file), text);
      process.stdout.write(`sync: обновлён ${file}\n`);
    }
    if (pending.length === 0) process.stdout.write('sync: всё актуально\n');
  }
}
