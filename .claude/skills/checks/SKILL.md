---
name: checks
description: Статические проверки монорепозитория модов — scripts/checks (check-json, check-secrets, check-journals, check-logs, check-targets, check-project, check-modjson, check-mixins, check-lang, check-changelog) и Checkstyle в Gradle; что ловит каждая, как запускать (check-all, --changed, verify-changed), хуки Claude Code в .claude/hooks, подавление находки комментарием с причиной, как добавить новую проверку. Используется, когда проверка упала в хуке или CI, при правке scripts/checks, config/checkstyle или .claude/hooks и когда найден класс ошибок, который стоит ловить автоматически.
---

# Статические проверки

Два слоя. **Checkstyle** (`config/checkstyle/checkstyle.xml`) — стиль Java: табы, импорты, пробелы, скобки, имена; идёт в `./gradlew build` каждого мода. **Проверки `scripts/checks/check-*.mjs`** — то, чего не видят компилятор и Checkstyle: связи между кодом, ресурсами, сборкой и документами. Они на встроенных модулях Node, без зависимостей; каждая появилась из класса ошибок, который уже случался.

## Запуск

- Из корня: `npm run checks` (весь репозиторий), `npm run checks:changed` (задетое), `npm run test:scripts` (тесты проверок и скриптов), `npm run verify` (проверки, тесты, сборка всех модов), `npm run verify:changed` (то же для задетого).
- Одна проверка: `node scripts/checks/check-<имя>.mjs [путь…]` — путь сужает до мода или файла. Флаги: `--tests` — смотреть и gametests; `--info` — показать находки уровня info.
- Вывод: `файл:строка  что не так`. Код выхода: 0 — чисто, 1 — находки, 2 — ошибка запуска.
- Автоматически: хук после правки — проверки этого файла и его мода; хук завершения хода — `verify-changed`; CI (`ci.yml`) — `npm run checks`, тесты скриптов и сборка задетых модов по всем целям.

## Что ловит каждая

| Проверка | Ловит | Откуда взялась |
|---|---|---|
| `check-json` | JSON из git не читается | битый ресурс мода падает только в игре |
| `check-secrets` | токены Modrinth, GitHub, CurseForge, вебхуки Discord, ключи AWS/Google, приватные ключи, JWT; `--pending` — во всём, что уйдёт в коммит | токен Modrinth рядом с кодом публикации |
| `check-journals` | `TODO.md` не по разделам-статусам, пункт без даты, отмеченный `[x]` | журналы, которые читают хуки (`.claude/rules/journals.md`) |
| `check-logs` | лог не `[Контекст]: Факт`, склейка вместо `{}`, число `{}` ≠ аргументам, throwable в `{}`, `error` без throwable, логгер не `log` с полным именем класса, `System.out`, `printStackTrace` | логи stallium без контекста и с чужим именем логгера |
| `check-targets` | каталог `gradle/versions.json`: порядок, одна цель на линию, Fabric API своей линии, `range`, `modrinth`; `mod_version` и `mc_since` мода; блок целей в README отстал (`npm run sync`) | README и workflow со snapshot-7, когда сборка была уже на snapshot-9 |
| `check-project` | мод не по устройству: settings.gradle без build-logic, build.gradle дублирует плагин, свои gradlew/.gitignore, нет CLAUDE.md/README/CHANGELOG/MODRINTH, код вне `com.kraineff.<id>`, ресурсы вне `assets/<id>/`, галерея без файлов | общие правила, которые не держатся без проверки |
| `check-modjson` | `fabric.mod.json`: id ≠ папке, версии не через `${…}`, `depends.java`, ссылки `contact` (исходники и трекер — в этот репозиторий, у публикуемого мода `homepage` — его проект Modrinth), нет Fabric API при импорте, точки входа без классов или клиентские в `main`, иконка, миксины, access widener | точка входа на сервере из клиентского набора |
| `check-mixins` | конфиг без `required`/`defaultRequire`/своей Java; класс из конфига не найден или не в том наборе; `@Mixin` без конфига (молча не применится); обработчик без `<id>$`; поле без `@Unique`/`@Shadow`; `@Overwrite`; импорт миксина из обычного кода | поле `GOLD` в миксине без `@Unique` |
| `check-lang` | ключ из кода нет в `en_us.json`; у языка другой набор ключей или подстановок `%s`; кириллица в `en_us`; info — ключ без литерала в коде | подпись, которая показывается ключом |
| `check-changelog` | CHANGELOG не по Keep a Changelog, последний раздел ≠ `mod_version`, кириллица в CHANGELOG и `MODRINTH.md` | CI берёт текст для Modrinth из раздела `mod_version` |

## Хуки Claude Code

`.claude/hooks/*.mjs` подключены в `.claude/settings.json` и только вызывают `scripts/`: логика и её тесты (`scripts/tests/`, `scripts/checks/tests/`) живут там.

| Хук | Когда | Что делает |
|---|---|---|
| `after-edit.mjs` | после Edit/Write | проверки, которые задевает файл (план — `changedPlan` из check-all): Java — логи и миксины мода, lang — переводы, каталог — цели. Находки — модели (код 2) |
| `before-bash.mjs` | перед Bash | `git commit` — сообщение по правилу коммитов (`scripts/commit-message.mjs`) и `check-secrets --pending`; `git push` ветки main, который опубликует моды с выросшей `mod_version` (`scripts/ci.mjs`), — вопрос пользователю в окне подтверждения; публикация (`modrinth`, `scripts/modrinth.mjs sync`, `gh release create`) — отказ, пробные прогоны — можно |
| `on-stop.mjs` | завершение хода | `verify-changed` и предложение в ответе без записи в TODO (`scripts/journals.mjs`); рабочая копия с прошлого хода та же — проверки не повторяются, если прошлый прогон был зелёным |
| `on-session-start.mjs` | начало сессии | Node и Java, сводка TODO, что нового у Minecraft и инструментов (раз в 12 часов) |

## Подавление

Находку, которая не ошибка, подавляют комментарием на той же строке или строкой выше:

```java
// check-<имя>: <почему правило здесь не про то>
<строка с находкой>
```

- Причина обязательна: пустое подавление — само находка.
- Подавлять можно, только когда проверка ошиблась или правило здесь не имеет смысла. Если можно исправить — исправляют.
- Checkstyle: `// CHECKSTYLE.OFF: <Проверка>` … `// CHECKSTYLE.ON: <Проверка>` — тоже с причиной рядом.
- JSON подавлений не знает: расхождение в нём исправляется.

## Новая проверка

1. Баг нашли руками, и он из класса, который повторится, — значит, проверка окупится.
2. Скрипт `scripts/checks/check-<имя>.mjs` с шапкой: что ловит и известные ограничения. Разбор Java — `lib/java.mjs` (маска комментариев и строк, вызовы с аргументами, члены класса), файлы, моды, подавления, вывод и коды выхода — `lib/cli.mjs`, устройство репозитория — `scripts/lib/repo.mjs`; своих копий не заводить. Чистая функция экспортируется для тестов, а `export const checker = { name, run(options) }` возвращает `{ title, ok, problems }` и подключается строкой `runCli(import.meta.url, checker)`.
3. Тесты на образцах — `scripts/checks/tests/check-<имя>.test.mjs`.
4. Прогнать по всему репозиторию: ложных срабатываний быть не должно, настоящие — исправить в том же коммите.
5. Подключить в `CHECKS` в `check-all.mjs` с видом (`file` — файл Java, `repo` — любой файл своего вида, `mod` — мод целиком), добавить строку в таблицу выше.
