import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPlan, parseBuildArgs } from '../build.mjs';
import { buildMatrix, changelogSection, parseTag } from '../ci.mjs';
import { verifyPlan } from '../verify-changed.mjs';

const versions = {
  targets: [{ minecraft: '26.1' }, { minecraft: '26.2' }, { minecraft: '26.3' }, { minecraft: '26.4-snapshot-2' }],
};
const props = { 'mods/a': { mc_since: '26.1' }, 'mods/b': { mc_since: '26.3' } };

test('parseTag: <мод>/<x.y.z>, остальное — ошибка с подсказкой', () => {
  assert.deepEqual(parseTag('stallium/1.1.0'), { mod: 'stallium', version: '1.1.0' });
  assert.deepEqual(parseTag('horse-tweaks/0.1.0'), { mod: 'horse-tweaks', version: '0.1.0' });
  assert.throws(() => parseTag('1.0.0'), /<мод>\/<x\.y\.z>/);
  assert.throws(() => parseTag('stallium/v1.0'), /stallium\/1\.1\.0/);
});

test('changelogSection: раздел версии без заголовка, до следующей версии', () => {
  const text = '# Changelog\n\n## [Unreleased]\n\n## [1.1.0] - 2026-10-02\n\n### Added\n\n- A\n\n## [1.0.0] - 2026-07-24\n\n- B\n';
  assert.equal(changelogSection(text, '1.1.0'), '### Added\n\n- A');
  assert.equal(changelogSection(text, '1.0.0'), '- B');
  assert.equal(changelogSection(text, '2.0.0'), undefined);
});

test('buildMatrix: каждый мод по своим целям', () => {
  assert.deepEqual(buildMatrix(['mods/b'], versions, (dir) => props[dir]), [
    { mod: 'b', target: '26.3' },
    { mod: 'b', target: '26.4-snapshot-2' },
  ]);
});

test('verifyPlan: мод — его сборка, общая сборка — все, документация — ничего', () => {
  const mods = ['mods/a', 'mods/b'];
  assert.deepEqual(verifyPlan(['mods/a/src/client/java/X.java'], { mods }), { mods: ['mods/a'], scripts: false });
  assert.deepEqual(verifyPlan(['build-logic/src/main/groovy/kraineff.fabric-mod.gradle'], { mods }).mods, mods);
  assert.deepEqual(verifyPlan(['gradle/versions.json'], { mods }).mods, mods);
  assert.deepEqual(verifyPlan(['mods/a/README.md', 'mods/b/docs/CHANGELOG.md'], { mods }), { mods: [], scripts: false });
  assert.equal(verifyPlan(['scripts/versions.mjs'], { mods }).scripts, true);
});

test('build: аргументы и план сборок', () => {
  const known = ['mods/a', 'mods/b'];
  assert.deepEqual(parseBuildArgs(['a', '--all-targets'], known), { mods: ['mods/a'], all: true, target: undefined, task: 'build' });
  assert.throws(() => parseBuildArgs(['c'], known), /нет мода c/);
  assert.throws(() => parseBuildArgs(['--all-targets', '--target', '26.1'], known), /что-то одно/);
  const plan = (argv) => buildPlan(parseBuildArgs(argv, known), versions, (dir) => props[dir]);
  assert.deepEqual(plan(['a', 'b']), [
    { dir: 'mods/a', target: '26.3' },
    { dir: 'mods/b', target: '26.3' },
  ]);
  assert.deepEqual(plan(['a', 'b', '--target', '26.1']), [{ dir: 'mods/a', target: '26.1' }]);
  assert.equal(plan(['a', '--all-targets']).length, 4);
});
