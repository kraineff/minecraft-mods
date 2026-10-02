// Проверки уровня мода на настоящем каркасе (`scripts/new-mod.mjs`) во временном репозитории git:
// чистый каркас проходит всё, заложенные дефекты находятся.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { renderTargetsTable, withTargetsTable } from '../../lib/repo.mjs';
import { scaffold, solidPng } from '../../new-mod.mjs';

const MOD_CHECKS = ['targets', 'project', 'modjson', 'mixins', 'lang', 'changelog'];
const versions = {
  java: 25,
  loader: '0.19.5',
  loom: '1.17.17',
  minotaur: '2.9.0',
  checkstyle: '14.3.0',
  targets: [{ minecraft: '26.3', fabricApi: '0.161.0+26.3', range: '>=26.3 <26.4-', modrinth: ['26.3'] }],
};
let root;
let previous;

const write = (path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const read = (path) => readFileSync(join(root, path), 'utf8');

async function problems(names = MOD_CHECKS) {
  const found = [];
  for (const name of names) {
    const { checker } = await import(`../check-${name}.mjs`);
    const result = await checker.run({ paths: [], tests: false, info: false });
    found.push(...result.problems.filter((p) => p.level !== 'info').map((p) => `${name}: ${p.file}: ${p.text}`));
  }
  return found;
}

before(() => {
  previous = process.cwd();
  root = mkdtempSync(join(tmpdir(), 'mods-checks-'));
  write('gradle/versions.json', `${JSON.stringify(versions, null, '\t')}\n`);
  write('gradle.properties', 'org.gradle.jvmargs=-Xmx2G\n');
  const files = scaffold({ id: 'demo', name: 'Demo', client: true, since: '26.3', java: 25, gradleProps: { 'org.gradle.jvmargs': '-Xmx2G' } });
  for (const [path, text] of Object.entries(files)) write(`mods/demo/${path}`, text);
  write('mods/demo/src/main/resources/assets/demo/icon.png', solidPng(2, [1, 2, 3]).toString('latin1'));
  const table = renderTargetsTable('demo', { mod_version: '0.1.0' }, versions.targets);
  write('mods/demo/README.md', withTargetsTable(read('mods/demo/README.md'), table));
  execFileSync('git', ['init', '-q'], { cwd: root });
  process.chdir(root);
});

after(() => {
  process.chdir(previous);
  rmSync(root, { recursive: true, force: true });
});

test('каркас нового мода проходит проверки уровня мода', async () => {
  assert.deepEqual(await problems(), []);
});

test('дефекты мода находятся', async () => {
  write(
    'mods/demo/src/client/java/com/kraineff/demo/mixin/LostMixin.java',
    'package com.kraineff.demo.mixin;\n\n@Mixin(Entity.class)\npublic class LostMixin {\n}\n',
  );
  write(
    'mods/demo/src/client/java/com/kraineff/demo/Screen.java',
    'package com.kraineff.demo;\n\nclass Screen {\n\tvoid a() {\n\t\tComponent.translatable("screen.demo.missing");\n\t}\n}\n',
  );
  write('mods/demo/build.gradle', "plugins {\n\tid 'kraineff.fabric-mod'\n\tid 'net.fabricmc.fabric-loom'\n}\n");
  const modJson = JSON.parse(read('mods/demo/src/main/resources/fabric.mod.json'));
  modJson.id = 'other';
  modJson.depends.minecraft = '>=26.3';
  modJson.contact.sources = 'https://github.com/kraineff/stallium';
  write('mods/demo/src/main/resources/fabric.mod.json', JSON.stringify(modJson, null, '\t'));
  write('mods/demo/gradle.properties', read('mods/demo/gradle.properties').replace('mod_version=0.1.0', 'mod_version=0.2.0'));

  const found = await problems();
  const has = (pattern) => assert.ok(found.some((line) => pattern.test(line)), `нет находки ${pattern}:\n${found.join('\n')}`);
  has(/^mixins: .*LostMixin.java: @Mixin LostMixin нет ни в одном конфиге/);
  has(/^lang: .*Screen.java: ключа «screen\.demo\.missing» нет в en_us\.json/);
  has(/^project: mods\/demo\/build\.gradle: плагин Loom — уже в kraineff\.fabric-mod/);
  has(/^modjson: .*fabric\.mod\.json: id «other»/);
  has(/^modjson: .*depends\.minecraft — "\$\{minecraft_range\}"/);
  has(/^modjson: .*contact\.sources — "https:\/\/github\.com\/kraineff\/minecraft-mods\/tree\/main\/mods\/demo"/);
  has(/^targets: mods\/demo\/README\.md: блок целей отстал/);
});
