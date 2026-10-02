import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyTargets,
  compareSemver,
  describe,
  formatCatalog,
  latestApi,
  latestStable,
  planTargets,
  toolLines,
} from '../versions.mjs';

const target = (minecraft, fabricApi, modrinth = [minecraft]) => ({ minecraft, fabricApi, range: 'x', modrinth });
const apiOf = (table) => (mc) => table[mc];

test('compareSemver и latestStable: часть до +, ветка, без пререлизов', () => {
  assert.ok(compareSemver('0.161.0+26.3', '0.160.7+26.3') > 0);
  assert.equal(compareSemver('1.17.17', '1.17.17'), 0);
  const loom = ['1.17.9', '1.17.21', '1.18.0-alpha.3', '1.18.2', '1.18-SNAPSHOT'];
  assert.equal(latestStable(loom), '1.18.2');
  assert.equal(latestStable(loom, '1.17.'), '1.17.21');
});

test('latestApi: последняя сборка, где есть версия игры', () => {
  const versions = [
    { version_number: '0.161.1+26.4', game_versions: ['26.4-snapshot-1'] },
    { version_number: '0.161.2+26.4', game_versions: ['26.4-snapshot-2'] },
    { version_number: '0.155.3+26.1.2', game_versions: ['26.1', '26.1.1', '26.1.2'] },
    { version_number: '0.155.2+26.1.2', game_versions: ['26.1', '26.1.1', '26.1.2'] },
  ];
  assert.equal(latestApi(versions, '26.1'), '0.155.3+26.1.2');
  assert.equal(latestApi(versions, '26.4-snapshot-2'), '0.161.2+26.4');
  assert.equal(latestApi(versions, '26.5'), undefined);
});

test('planTargets: снапшот → релиз и новая линия — как переход 26.3-snapshot-9 → 26.3 + 26.4', () => {
  const catalog = { targets: [target('26.2', '0.155.2+26.2'), target('26.3-snapshot-9', '0.157.2+26.3')] };
  const mojang = ['26.4-snapshot-2', '26.4-snapshot-1', '26.3', '26.3-rc-3', '26.3-snapshot-9', '26.2'];
  const changes = planTargets(
    catalog,
    mojang,
    apiOf({
      '26.2': '0.161.0+26.2',
      '26.3': '0.161.0+26.3',
      '26.3-rc-3': '0.160.5+26.3',
      '26.4-snapshot-1': '0.161.1+26.4',
      '26.4-snapshot-2': '0.161.2+26.4',
    }),
  );
  assert.deepEqual(changes, [
    { kind: 'api', minecraft: '26.2', from: '0.155.2+26.2', to: '0.161.0+26.2' },
    { kind: 'replace', from: '26.3-snapshot-9', to: '26.3', fabricApi: '0.161.0+26.3' },
    { kind: 'add', minecraft: '26.4-snapshot-2', fabricApi: '0.161.2+26.4' },
  ]);
  const next = applyTargets(catalog, changes);
  assert.deepEqual(next.targets.at(1), {
    minecraft: '26.3',
    fabricApi: '0.161.0+26.3',
    range: '>=26.3 <26.4-',
    modrinth: ['26.3'],
  });
  assert.equal(next.targets.at(2).range, '>=26.4- <26.5-');
  assert.equal(catalog.targets.length, 2, 'исходный каталог не меняется');
});

test('planTargets: без Fabric API — ждём, снапшот сменяется только на поддержанный', () => {
  const catalog = { targets: [target('26.4-snapshot-2', '0.161.2+26.4')] };
  const changes = planTargets(catalog, ['26.4-snapshot-3', '26.4-snapshot-2'], apiOf({ '26.4-snapshot-2': '0.161.2+26.4' }));
  assert.deepEqual(changes, [{ kind: 'waiting', minecraft: '26.4-snapshot-3', instead: '26.4-snapshot-2' }]);
  assert.match(describe(changes[0]), /Fabric API под него ещё нет/);
});

test('planTargets: патч релиза — в modrinth, если его покрывает та же сборка Fabric API', () => {
  const catalog = { targets: [target('26.3', '0.161.0+26.3'), target('26.2', '0.161.0+26.2')] };
  const changes = planTargets(
    catalog,
    ['26.3.2', '26.3.1', '26.3'],
    apiOf({ '26.3': '0.162.0+26.3.1', '26.3.1': '0.162.0+26.3.1', '26.3.2': '0.163.0+26.3.2' }),
  );
  assert.deepEqual(changes, [
    { kind: 'patch', minecraft: '26.3', add: ['26.3.1'] },
    { kind: 'waiting', minecraft: '26.3.2', patchOf: '26.3' },
    { kind: 'api', minecraft: '26.3', from: '0.161.0+26.3', to: '0.162.0+26.3.1' },
  ]);
  const next = applyTargets(catalog, changes);
  assert.deepEqual(next.targets[0].modrinth, ['26.3', '26.3.1']);
  assert.equal(next.targets[0].fabricApi, '0.162.0+26.3.1');
});

test('formatCatalog: табы, короткие массивы строк в одну строку', () => {
  const text = formatCatalog({ java: 25, targets: [{ minecraft: '26.1', modrinth: ['26.1', '26.1.1'] }] });
  assert.equal(
    text,
    '{\n\t"java": 25,\n\t"targets": [\n\t\t{\n\t\t\t"minecraft": "26.1",\n\t\t\t"modrinth": ["26.1", "26.1.1"]\n\t\t}\n\t]\n}\n',
  );
});

test('toolLines: только отставшие и следующая ветка', () => {
  const lines = toolLines({
    loader: { current: '0.19.5', latest: '0.19.5' },
    loom: { current: '1.17.17', latest: '1.17.21', next: '1.18.2' },
    gradle: { current: '9.8.0', latest: '9.8.0' },
    minotaur: { current: '2.10.0', latest: '2.10.0', next: '3.0.0' },
  });
  assert.deepEqual(lines, ['loom 1.17.17 → 1.17.21 (есть и 1.18.2)', 'minotaur 2.10.0 — свежий в ветке, есть 3.0.0']);
});
