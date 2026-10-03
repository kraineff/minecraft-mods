# Монорепозиторий модов Minecraft

Fabric-моды для Minecraft 26.x (Java 25, Loom, Fabric API). Каждый `mods/<id>/` — отдельный мод и отдельная сборка Gradle: собирается под несколько версий Minecraft («цели») и публикуется на Modrinth сам по себе. Специфика мода — в его `mods/<id>/CLAUDE.md`; общие правила — здесь и в `.claude/rules/`, справочники и процедуры — в скиллах `.claude/skills/`. Что куда писать — `.claude/rules/journals.md`.

## Референс

- **`mods/stallium/`** — клиентский мод: раздельные `main` / `client`, миксины, надписи в мире и HUD на Fabric rendering API, экран настроек на ванильных виджетах, ModMenu, клиентский gametest со скриншотами, совместимость целей через `compat/` (MethodHandle).

Новый мод копирует устройство референса через каркас `npm run new-mod` (скилл `mod-new`). Правя референс, реши, должен ли следующий мод повторить этот паттерн; общее — в `build-logic/`, `scripts/` и скиллы, а не копией.

## Устройство

| Где | Что |
|---|---|
| `mods/<id>/` | мод: `build.gradle` в три строки, `gradle.properties` (`mod_version`, `mc_since`), `src/`, `docs/` |
| `build-logic/` | плагин сборки `kraineff.fabric-mod`: Loom, выбор цели, Fabric API, gametests и `updateScreenshots`, Checkstyle |
| `gradle/versions.json` | каталог версий для всех модов: Java, Loader, Loom, Checkstyle и цели Minecraft с Fabric API (скилл `targets`) |
| `config/checkstyle/` | стиль Java для всех модов |
| `scripts/` | Node без зависимостей: версии, сборка по целям, статические проверки, план CI, каркас мода, проект Modrinth |
| `.claude/` | правила, скиллы, хуки |
| `.github/workflows/` | `ci.yml` — проверки, сборка задетых модов по всем целям и публикация модов, у которых за пуш в `main` выросла `mod_version` (план — `scripts/ci.mjs`, скилл `release`) |
| `docs/TODO.md` | общие дела репозитория |

Корневой `settings.gradle` — композит всех модов для IDE (открыть репозиторий целиком) и задач из корня (`./gradlew :stallium:runClient`). Скрипты и CI зовут мод напрямую: `./gradlew -p mods/<id> …`.

## Команды (из корня)

- `./gradlew -p mods/<id> build [-PtargetMc=<цель>]` — сборка мода: компиляция (с gametests) и Checkstyle; цель по умолчанию — последний релиз каталога. JAR — `mods/<id>/build/libs/`.
- `./gradlew -p mods/<id> runClient` — клиент с модом; `runClientGameTest` — скриншот-тест; `updateScreenshots` — он же с переносом снимков в `docs/screenshots/`.
- `npm run build -- [мод…] [--all-targets | --target <цель>]` — сборки по целям подряд.
- `npm run versions [-- --write]` — что вышло у Minecraft, Fabric API и инструментов; `--write` обновляет каталог (скилл `targets`).
- `npm run sync` — блоки целей в README модов из каталога.
- `npm run checks` / `checks:changed` — статические проверки (скилл `checks`); `npm run test:scripts` — тесты скриптов.
- `npm run verify` — проверки, тесты скриптов и сборка всех модов; `npm run verify:changed` — то же для задетого (его гоняет хук завершения хода).
- `npm run new-mod -- <id> "<Название>" [--client]` — каркас мода.

Скрипты — на Node ≥ 22.2 без `npm install`: зависимостей нет.

## Хуки Claude Code

`.claude/hooks/*.mjs` из `.claude/settings.json` — тонкие обёртки над `scripts/`: правка файла — проверки этого файла и его мода; перед `git commit` — правило сообщения и секреты; перед `git push` с выросшей версией мода, ручным запуском публикации (`gh workflow run … publish=<мод>`) и `gh release create` — подтверждение пользователя; запись в Modrinth в обход CI (`scripts/modrinth.mjs upload` / `sync`) — отказ; завершение хода — `verify-changed`; начало сессии — Node и Java, TODO и что нового у Minecraft (скилл `checks`).
