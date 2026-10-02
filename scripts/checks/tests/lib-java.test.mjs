import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findCalls, importsOf, literalValue, maskJava, members, packageOf, topType } from '../lib/java.mjs';

test('maskJava: комментарии и текст строк — пробелы, позиции и переводы строк те же', () => {
  const source = 'int a = 1; // log.info("x")\nString s = "log.warn(\\"y\\")"; /* a\nb */ char c = \'"\';';
  const masked = maskJava(source);
  assert.equal(masked.length, source.length);
  assert.equal(masked.split('\n').length, source.split('\n').length);
  assert.doesNotMatch(masked, /log\./);
  assert.match(masked, /String s = "\s+";/);
});

test('literalValue: один литерал с экранированием, склейка — нет', () => {
  assert.equal(literalValue(' "[Ctx]: a \\"b\\"\\n" '), '[Ctx]: a "b"\n');
  assert.equal(literalValue('"a" + b'), undefined);
  assert.equal(literalValue('KEY'), undefined);
});

test('findCalls: аргументы верхнего уровня, вызовы в строках и комментариях не находятся', () => {
  const source = 'log.warn("[A]: {} ({})", f(x, y), e.toString()); // log.info("no")\nString s = "log.error(1)";';
  const calls = findCalls(source, /\blog\s*\.\s*(warn|info|error)\s*\(/g);
  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls[0].args.map((arg) => arg.text.trim()),
    ['"[A]: {} ({})"', 'f(x, y)', 'e.toString()'],
  );
});

test('topType и members: аннотации, поля, методы, конструктор, вложенные блоки', () => {
  const source = `package com.kraineff.demo.mixin;

import org.spongepowered.asm.mixin.Mixin;
import java.util.Map;

/** Док. */
@Mixin(Entity.class)
public class EntityMixin {
	@Unique
	private static final int GOLD = 0xFFAA00;
	private static final Map<String, Integer> M = Map.of("a", 1);
	@Shadow private int x;

	EntityMixin() {}

	@Inject(method = "getTeamColor", at = @At("HEAD"), cancellable = true)
	private void demo$color(CallbackInfoReturnable<Integer> cir) {
		Runnable r = () -> { if (x > 0) { return; } };
	}

	private int helper(int a) { return a; }
}
`;
  assert.equal(packageOf(source), 'com.kraineff.demo.mixin');
  assert.deepEqual(importsOf(source), ['org.spongepowered.asm.mixin.Mixin', 'java.util.Map']);
  const type = topType(source);
  assert.equal(type.name, 'EntityMixin');
  assert.deepEqual(type.annotations.map((a) => a.name), ['Mixin']);
  const list = members(source).map((m) => [m.kind, m.name, m.annotations.map((a) => a.name).join(',')]);
  assert.deepEqual(list, [
    ['field', 'GOLD', 'Unique'],
    ['field', 'M', ''],
    ['field', 'x', 'Shadow'],
    ['method', 'EntityMixin', ''],
    ['method', 'demo$color', 'Inject'],
    ['method', 'helper', ''],
  ]);
});

test('topType: record с заголовком в скобках', () => {
  const source = 'package p;\n\npublic record Info(double a,\n\t\tboolean b) {\n\tpublic static final double K = 43.0;\n}\n';
  assert.equal(topType(source).kind, 'record');
  assert.deepEqual(members(source).map((m) => m.name), ['K']);
});
