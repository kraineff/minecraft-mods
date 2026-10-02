import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareMinecraft,
  defaultTarget,
  lineOf,
  modTargets,
  parseMinecraft,
  parseProperties,
  plural,
  rangeOf,
  renderTargetsTable,
  TARGETS_END,
  TARGETS_START,
  withTargetsTable,
} from '../lib/repo.mjs';

const catalog = {
  targets: [
    { minecraft: '26.1', modrinth: ['26.1', '26.1.1'] },
    { minecraft: '26.2', modrinth: ['26.2'] },
    { minecraft: '26.3', modrinth: ['26.3'] },
    { minecraft: '26.4-snapshot-2', modrinth: ['26.4-snapshot-2'] },
  ],
};

test('parseProperties: ключи, комментарии, пробелы вокруг =', () => {
  assert.deepEqual(parseProperties('# c\nmod_version = 1.0.0\n\nmc_since=26.1\n! bang\n'), {
    mod_version: '1.0.0',
    mc_since: '26.1',
  });
});

test('версии Minecraft: разбор, линия, порядок пререлизов и патчей', () => {
  assert.equal(parseMinecraft('26w14a'), undefined);
  assert.equal(parseMinecraft('1.21.11').major, 1);
  assert.equal(lineOf('26.4-snapshot-2'), '26.4');
  assert.equal(lineOf('26.1.2'), '26.1');
  const sorted = ['26.3', '26.3-rc-1', '26.3-snapshot-10', '26.3-pre-2', '26.3.1', '26.2', '26.3-snapshot-9'].sort(
    compareMinecraft,
  );
  assert.deepEqual(sorted, ['26.2', '26.3-snapshot-9', '26.3-snapshot-10', '26.3-pre-2', '26.3-rc-1', '26.3', '26.3.1']);
});

test('rangeOf: релиз покрывает патчи, пререлиз — всю линию', () => {
  assert.equal(rangeOf('26.3'), '>=26.3 <26.4-');
  assert.equal(rangeOf('26.4-snapshot-2'), '>=26.4- <26.5-');
  assert.equal(rangeOf('26.1.2'), '>=26.1 <26.2-');
});

test('modTargets и defaultTarget: с mc_since, по умолчанию последний релиз', () => {
  const { targets } = modTargets({ mc_since: '26.2' }, catalog);
  assert.deepEqual(
    targets.map((t) => t.minecraft),
    ['26.2', '26.3', '26.4-snapshot-2'],
  );
  assert.equal(defaultTarget(targets), '26.3');
  assert.equal(defaultTarget([{ minecraft: '26.4-snapshot-2' }]), '26.4-snapshot-2');
  assert.match(modTargets({}, catalog).error, /нет mc_since/);
  assert.match(modTargets({ mc_since: '25.9' }, catalog).error, /нет среди целей/);
});

test('таблица целей: выравнивание и подстановка между метками', () => {
  const table = renderTargetsTable('demo', { mod_version: '1.2.0' }, catalog.targets.slice(0, 2));
  assert.equal(
    table,
    [
      '| Сборка                | Minecraft    |',
      '|-----------------------|--------------|',
      '| `demo-1.2.0+26.1.jar` | 26.1, 26.1.1 |',
      '| `demo-1.2.0+26.2.jar` | 26.2         |',
    ].join('\n'),
  );
  const readme = `# Demo\n\n${TARGETS_START}\nстарое\n${TARGETS_END}\n\nхвост\n`;
  assert.equal(withTargetsTable(readme, 'T'), `# Demo\n\n${TARGETS_START}\nT\n${TARGETS_END}\n\nхвост\n`);
  assert.equal(withTargetsTable('# без меток', 'T'), undefined);
});

test('plural: формы слова по числу', () => {
  const word = (n) => plural(n, 'сборка', 'сборки', 'сборок');
  assert.deepEqual([1, 2, 5, 11, 21, 22, 112].map(word), ['сборка', 'сборки', 'сборок', 'сборок', 'сборка', 'сборки', 'сборок']);
});
