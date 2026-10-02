import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPlan, parseBuildArgs } from '../build.mjs';
import { changelogSection, ciPlan, grownVersions } from '../ci.mjs';
import { galleryMatches } from '../modrinth.mjs';
import { verifyPlan } from '../verify-changed.mjs';

const versions = {
  targets: [{ minecraft: '26.1' }, { minecraft: '26.2' }, { minecraft: '26.3' }, { minecraft: '26.4-snapshot-2' }],
};
const props = {
  'mods/a': { mc_since: '26.1', mod_version: '1.1.0', modrinth_id: 'a' },
  'mods/b': { mc_since: '26.3', mod_version: '0.2.0' },
  'mods/c': { mc_since: '26.3', mod_version: '2.0.0', modrinth_id: 'c-mod' },
};
const mods = Object.keys(props);
// Версии в базе пуша: a и b подняты, c — без изменений
const atBase = { 'mods/a': '1.0.0', 'mods/b': '0.1.0', 'mods/c': '2.0.0' };
const deps = (changedFiles, base = atBase) => ({
  changed: () => changedFiles,
  version: (dir, ref) => (ref === 'HEAD' ? props[dir].mod_version : base[dir]),
  known: () => true,
  mods,
  props: (dir) => props[dir],
  versions,
});
const BEFORE = 'a1b2c3d4';

test('ciPlan: пуш с бампом публикует только публикуемый мод с выросшей версией', () => {
  const plan = ciPlan({ event: 'push', before: BEFORE }, deps(['mods/a/gradle.properties', 'mods/b/gradle.properties']));
  assert.equal(plan.full, false);
  assert.equal(plan.base, BEFORE);
  assert.deepEqual(
    plan.build.map((item) => `${item.mod} ${item.target}${item.publish ? ` → ${item.version}` : ''}`),
    ['a 26.1 → 1.1.0', 'a 26.2 → 1.1.0', 'a 26.3 → 1.1.0', 'a 26.4-snapshot-2 → 1.1.0', 'b 26.3', 'b 26.4-snapshot-2'],
    'JAR публикуемого a job build отдаёт в publish',
  );
  assert.deepEqual(plan.release, [{ mod: 'a', version: '1.1.0' }], 'у b нет modrinth_id — не публикуется');
  assert.deepEqual(
    plan.publish.map((item) => `${item.mod} ${item.version}+${item.target}`),
    ['a 1.1.0+26.1', 'a 1.1.0+26.2', 'a 1.1.0+26.3', 'a 1.1.0+26.4-snapshot-2'],
  );
});

test('ciPlan: PR и документация — без публикации; правка конвейера — полный прогон', () => {
  const pr = ciPlan({ event: 'pull_request', base: BEFORE }, deps(['mods/a/gradle.properties']));
  assert.deepEqual(pr.publish, []);
  const unchanged = Object.fromEntries(mods.map((dir) => [dir, props[dir].mod_version]));
  const docs = ciPlan({ event: 'push', before: BEFORE }, deps(['mods/c/README.md'], unchanged));
  assert.deepEqual([docs.build, docs.release], [[], []]);
  const pipeline = ciPlan({ event: 'push', before: BEFORE }, deps(['.github/workflows/ci.yml']));
  assert.equal(pipeline.full, true);
  assert.equal(pipeline.build.length, 8);
});

test('ciPlan: первый пуш без базы — полный прогон без публикации; ручной запуск перевыкладывает мод', () => {
  const first = ciPlan({ event: 'push', before: '0000000000000000000000000000000000000000' }, deps([]));
  assert.equal(first.full, true);
  assert.deepEqual(first.release, []);
  const manual = ciPlan({ event: 'workflow_dispatch', publish: 'c' }, deps([]));
  assert.deepEqual(manual.release, [{ mod: 'c', version: '2.0.0' }]);
  assert.equal(manual.publish.length, 2);
  assert.throws(() => ciPlan({ event: 'workflow_dispatch', publish: 'b' }, deps([])), /не публикует.*публикуются: a, c/);
});

test('grownVersions: только рост, понижение и новый мод — не релиз', () => {
  const table = { x: { base: '1.0.0', head: '1.0.1' }, y: { base: '2.0.0', head: '1.9.0' }, z: { base: undefined, head: '0.1.0' } };
  const version = (dir, ref) => table[dir][ref === 'HEAD' ? 'head' : 'base'];
  assert.deepEqual(grownVersions(['x', 'y', 'z'], version, 'base', 'HEAD'), [{ dir: 'x', from: '1.0.0', to: '1.0.1' }]);
});

test('changelogSection: раздел версии без заголовка, до следующей версии', () => {
  const text = '# Changelog\n\n## [Unreleased]\n\n## [1.1.0] - 2026-10-02\n\n### Added\n\n- A\n\n## [1.0.0] - 2026-07-24\n\n- B\n';
  assert.equal(changelogSection(text, '1.1.0'), '### Added\n\n- A');
  assert.equal(changelogSection(text, '1.0.0'), '- B');
  assert.equal(changelogSection(text, '2.0.0'), undefined);
});

test('galleryMatches: подписи, порядок и featured; описание null — не совпадает', () => {
  const images = [
    { file: 'a.png', title: 'A', description: 'a' },
    { file: 'b.png', title: 'B', description: 'b' },
  ];
  const current = [
    { title: 'B', description: 'b', ordering: 1, featured: false },
    { title: 'A', description: 'a', ordering: 0, featured: true },
  ];
  assert.equal(galleryMatches(current, images), true);
  assert.equal(galleryMatches([{ ...current[1], description: null }, current[0]], images), false);
  assert.equal(galleryMatches(current.slice(0, 1), images), false);
});

test('verifyPlan: мод — его сборка, общая сборка — все, документация — ничего', () => {
  const all = ['mods/a', 'mods/b'];
  assert.deepEqual(verifyPlan(['mods/a/src/client/java/X.java'], { mods: all }), { mods: ['mods/a'], scripts: false });
  assert.deepEqual(verifyPlan(['build-logic/src/main/groovy/kraineff.fabric-mod.gradle'], { mods: all }).mods, all);
  assert.deepEqual(verifyPlan(['gradle/versions.json'], { mods: all }).mods, all);
  assert.deepEqual(verifyPlan(['mods/a/README.md', 'mods/b/docs/CHANGELOG.md'], { mods: all }), { mods: [], scripts: false });
  assert.equal(verifyPlan(['scripts/versions.mjs'], { mods: all }).scripts, true);
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
