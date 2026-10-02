import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { pascal, scaffold, solidPng } from '../new-mod.mjs';

const base = { java: 25, since: '26.3', gradleProps: { 'org.gradle.jvmargs': '-Xmx2G', mod_version: '9.9.9' } };

test('pascal: название → имя класса', () => {
  assert.equal(pascal('Horse Tweaks'), 'HorseTweaks');
  assert.equal(pascal('stallium'), 'Stallium');
  assert.equal(pascal('x-ray helper 2'), 'XRayHelper2');
});

test('solidPng: настоящий PNG нужного размера и цвета', () => {
  const png = solidPng(4, [10, 20, 30]);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 4);
  assert.equal(png.readUInt32BE(20), 4);
  const idatLength = png.readUInt32BE(33);
  const raw = inflateSync(png.subarray(41, 41 + idatLength));
  assert.equal(raw.length, (4 * 3 + 1) * 4);
  assert.deepEqual([...raw.subarray(1, 4)], [10, 20, 30]);
});

test('scaffold: мод для обеих сторон', () => {
  const files = scaffold({ ...base, id: 'horse-tweaks', name: 'Horse Tweaks', client: false });
  const modJson = JSON.parse(files['src/main/resources/fabric.mod.json']);
  assert.equal(modJson.id, 'horse-tweaks');
  assert.equal(modJson.environment, '*');
  assert.deepEqual(modJson.entrypoints, {
    main: ['com.kraineff.horsetweaks.HorseTweaks'],
    client: ['com.kraineff.horsetweaks.HorseTweaksClient'],
  });
  assert.equal(modJson.depends.java, '>=25');
  assert.ok(files['src/main/java/com/kraineff/horsetweaks/HorseTweaks.java'].includes('implements ModInitializer'));
  assert.match(files['gradle.properties'], /org\.gradle\.jvmargs=-Xmx2G/);
  assert.doesNotMatch(files['gradle.properties'], /9\.9\.9/, 'берутся только настройки демона');
  assert.match(files['gradle.properties'], /mc_since=26\.3/);
  assert.equal(JSON.parse(files['src/client/resources/horse-tweaks.client.mixins.json']).compatibilityLevel, 'JAVA_25');
});

test('scaffold: клиентский мод — одна точка входа с логгером', () => {
  const files = scaffold({ ...base, id: 'demo', name: 'Demo', client: true });
  const modJson = JSON.parse(files['src/main/resources/fabric.mod.json']);
  assert.equal(modJson.environment, 'client');
  assert.deepEqual(Object.keys(modJson.entrypoints), ['client']);
  assert.equal(files['src/main/java/com/kraineff/demo/Demo.java'], undefined);
  assert.match(files['src/client/java/com/kraineff/demo/DemoClient.java'], /log\.info\("\[Demo\]: Initialized"\)/);
});
