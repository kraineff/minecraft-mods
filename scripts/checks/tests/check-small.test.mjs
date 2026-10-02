// Тесты проверок, которые разбирают один текст: миксин, переводы, CHANGELOG, каталог целей,
// журналы, секреты, план check-all.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedPlan, parseStatus } from '../check-all.mjs';
import { checkChangelog, checkModrinthPage } from '../check-changelog.mjs';
import { checkTodo } from '../check-journals.mjs';
import { placeholders, usedKeys } from '../check-lang.mjs';
import { checkMixinClass } from '../check-mixins.mjs';
import { diffAdditions, findSecrets } from '../check-secrets.mjs';
import { checkCatalog } from '../check-targets.mjs';

test('check-mixins: префикс обработчика, @Unique у своих полей и методов, @Overwrite', () => {
  const source = `package com.kraineff.demo.mixin;

@Mixin(Entity.class)
public class EntityMixin {
	private static final int GOLD = 1;
	@Unique
	private int demo$count;

	@Inject(method = "tick", at = @At("HEAD"))
	private void onTick(CallbackInfo ci) {}

	@Inject(method = "tick", at = @At("TAIL"))
	private void demo$afterTick(CallbackInfo ci) {}

	private void helper() {}

	@Overwrite
	public void getX() {}
}
`;
  const found = checkMixinClass(source, 'demo$').map((p) => `${p.line}: ${p.text}`);
  assert.deepEqual(found, [
    '5: поле GOLD: @Shadow (поле цели) или @Unique (своё)',
    '9: обработчик onTick: имя с префиксом demo$',
    '15: метод helper: @Shadow, @Unique или аннотация инъекции',
    '17: @Overwrite getX: ломает чужие миксины — @Inject / @WrapOperation',
  ]);
});

test('check-lang: ключи из кода и подстановки', () => {
  const source = `class A {
	void a() {
		Component.translatable("screen.demo.title");
		Component.translatable("screen.demo.radius", value);
		new KeyMapping("key.demo.open", InputConstants.KEY_H, category);
		KeyMapping.Category.register(Identifier.fromNamespaceAndPath(MOD_ID, "main"));
		Component.translatable(dynamicKey);
	}
}`;
  assert.deepEqual(
    usedKeys(source, 'demo').map((k) => k.key),
    ['screen.demo.title', 'screen.demo.radius', 'key.demo.open', 'key.category.demo.main'],
  );
  assert.deepEqual(placeholders('Радиус: %s, %1$d из %d (100%%)'), ['%1$d', '%d', '%s']);
});

test('check-changelog: порядок, разделы, версия мода, язык', () => {
  const good = '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- New thing\n\n## [1.1.0] - 2026-10-02\n\n### Fixed\n\n- Bug\n\n## [1.0.0] - 2026-07-24\n\n### Added\n\n- First\n';
  assert.deepEqual(checkChangelog(good, '1.1.0'), []);
  assert.match(checkChangelog(good, '1.2.0')[0].text, /нет раздела для неё/);
  const bad = '# Changelog\n\n## [1.0.0] - 2026-07-24\n\n### Новое\n\n- Первое\n\n## [Unreleased]\n';
  const texts = checkChangelog(bad, '1.0.0').map((p) => p.text);
  assert.ok(texts.some((t) => /первым разделом/.test(t)));
  assert.ok(texts.some((t) => /подраздел «Новое»/.test(t)));
  assert.ok(texts.some((t) => /по-русски/.test(t)));
  assert.ok(texts.some((t) => /один и первым/.test(t)));
  assert.deepEqual(checkModrinthPage('Stallium shows stats.\n\nСтаты.\n').map((p) => p.line), [3]);
});

test('check-targets: каталог по правилам и типичные ошибки', () => {
  const ok = {
    java: 25,
    loader: '0.19.5',
    loom: '1.17.17',
    minotaur: '2.9.0',
    checkstyle: '14.3.0',
    targets: [
      { minecraft: '26.1', fabricApi: '0.155.3+26.1.2', range: '>=26.1 <26.2-', modrinth: ['26.1', '26.1.2'] },
      { minecraft: '26.4-snapshot-2', fabricApi: '0.161.2+26.4', range: '>=26.4- <26.5-', modrinth: ['26.4-snapshot-2'] },
    ],
  };
  assert.deepEqual(checkCatalog(ok), []);
  const bad = structuredClone(ok);
  bad.targets.push(
    { minecraft: '26.4', fabricApi: '0.161.0+26.3', range: '>=26.4 <26.5', modrinth: ['26.5'] },
    { minecraft: '26.2', fabricApi: '0.161.0+26.2', range: '>=26.2 <26.3-', modrinth: ['26.2'] },
  );
  const texts = checkCatalog(bad).map((p) => p.text);
  assert.ok(texts.some((t) => /вторая цель линии 26\.4/.test(t)));
  assert.ok(texts.some((t) => /для линии 26\.3, а не 26\.4/.test(t)));
  assert.ok(texts.some((t) => /range — ">=26\.4 <26\.5-"/.test(t)));
  assert.ok(texts.some((t) => /среди них сама 26\.4/.test(t)));
  assert.ok(texts.some((t) => /по возрастанию/.test(t)));
});

test('check-journals: разделы-статусы, дата, сделанное удаляется', () => {
  const texts = checkTodo('# TODO\n\n- [ ] 2026-10-02 · вне раздела\n\n## Идеи\n\n- [ ] без даты\n- [x] 2026-10-02 · сделано\n').map((p) => p.text);
  assert.deepEqual(texts, [
    'пункт вне раздела-статуса',
    'раздел «Идеи» — не статус (Предложено, Согласовано, Проверить вживую, Ждёт)',
    'пункт — «- [ ] YYYY-MM-DD · что и зачем»',
    'сделанный пункт — удалить, а не отмечать',
  ]);
});

test('check-secrets: токен Modrinth, подавление с причиной, добавленные строки диффа', () => {
  const token = `mrp_${'a1B2'.repeat(10)}`;
  assert.match(findSecrets(`token = "${token}"`)[0].text, /токен Modrinth/);
  assert.deepEqual(findSecrets(`// check-secrets: заведомо фальшивый для теста\ntoken = "${token}"`), []);
  const diff = 'diff --git a/x b/x\n+++ b/x\n@@ -1,0 +5,2 @@\n+one\n+two\n';
  assert.deepEqual(diffAdditions(diff), [
    { file: 'x', line: 5, text: 'one' },
    { file: 'x', line: 6, text: 'two' },
  ]);
});

test('check-all: план по изменённым файлам', () => {
  const mods = ['mods/a', 'mods/b'];
  const exists = () => true;
  const plan = (files) => Object.fromEntries(changedPlan(files, { mods, exists }).map((s) => [s.name, s.paths]));
  assert.deepEqual(plan(['mods/a/src/client/java/A.java']), {
    secrets: ['mods/a/src/client/java/A.java'],
    logs: ['mods/a/src/client/java/A.java'],
    targets: ['mods/a'],
    project: ['mods/a'],
    modjson: ['mods/a'],
    mixins: ['mods/a'],
    lang: ['mods/a'],
    changelog: ['mods/a'],
  });
  const catalog = plan(['gradle/versions.json']);
  assert.deepEqual([catalog.targets, catalog.modjson, catalog.mixins], [[], [], []]);
  assert.deepEqual(catalog.json, ['gradle/versions.json']);
  assert.deepEqual(plan(['docs/TODO.md']), { secrets: ['docs/TODO.md'], journals: ['docs/TODO.md'] });
  assert.deepEqual(parseStatus(' M a.txt\0R  new.txt\0old.txt\0?? mods/a/build/x\0'), ['a.txt', 'new.txt', 'old.txt']);
});
