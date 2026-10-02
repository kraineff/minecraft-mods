import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkLogs } from '../check-logs.mjs';

const FILE = 'mods/demo/src/client/java/com/kraineff/demo/Demo.java';
const wrap = (body) => `package com.kraineff.demo;

public class Demo {
	private static final Logger log = LoggerFactory.getLogger("com.kraineff.demo.Demo");

	void run(Exception e) {
${body}
	}
}
`;
const texts = (body) => checkLogs(wrap(body), FILE).map((problem) => problem.text);

test('по правилу — чисто', () => {
  assert.deepEqual(
    texts(`		log.info("[Demo]: Initialized");
		log.warn("[Config]: File \\"{}\\" not read, defaults used ({})", path, e.toString());
		log.error("[Render]: Label not drawn", e);
		log.debug("[Owner1] [Tick >> Horse]: Scored {} ({})", 3, "best");`),
    [],
  );
});

test('формат, заглавная, склейка', () => {
  const found = texts(`		log.info("Initialized");
		log.info("[Demo] Initialized");
		log.info("[Demo]: initialized");
		log.info("[Demo]: Value " + x);`);
  assert.equal(found.length, 4);
  assert.match(found[0], /формат «\[Контекст\]: Факт»/);
  assert.match(found[1], /формат/);
  assert.match(found[2], /с заглавной/);
  assert.match(found[3], /склейка строк/);
});

test('плейсхолдеры и throwable', () => {
  const found = texts(`		log.warn("[Demo]: A {} {}", one);
		log.warn("[Demo]: B {}", e);
		log.error("[Demo]: C {}", value);`);
  assert.match(found[0], /плейсхолдеров \{\} — 2, аргументов — 1/);
  assert.match(found[1], /throwable попал в \{\}/);
  assert.match(found[2], /log\.error без throwable/);
});

test('логгер: имя класса литералом и поле log; System.out и printStackTrace', () => {
  const source = `package com.kraineff.demo;

public class Demo {
	static Logger LOGGER = LoggerFactory.getLogger("com.kraineff.Demo");

	void run(Exception e) {
		System.out.println("x");
		e.printStackTrace();
		String s = "System.out.println";
	}
}
`;
  const found = checkLogs(source, FILE).map((p) => p.text);
  assert.equal(found.length, 4);
  assert.match(found[0], /getLogger\("com\.kraineff\.demo\.Demo"\)/);
  assert.match(found[1], /private static final Logger log/);
  assert.match(found[2], /System\.out/);
  assert.match(found[3], /printStackTrace/);
});
