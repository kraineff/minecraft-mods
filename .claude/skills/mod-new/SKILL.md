---
name: mod-new
description: Создать новый Fabric-мод в монорепозитории — каркас mods/<id>/ скриптом npm run new-mod (сборка через kraineff.fabric-mod, mc_since, fabric.mod.json, точки входа, миксины, переводы, иконка, CLAUDE.md, README с блоком целей, CHANGELOG, MODRINTH.md), что заполнить руками, как добавить клиентский gametest со скриншотами, проект на Modrinth. Используется, когда пользователь просит сделать новый мод, «заведи мод для …», «новый проект в моды».
---

# Новый мод

## 1. Уточни у пользователя

- **Название** и **id** (латиница в нижнем регистре, цифры, дефис: `horse-tweaks`). Id — имя папки, `fabric.mod.json`, пространство ресурсов и пакет `com.kraineff.<id без дефисов>`.
- **Стороны**: только клиент (HUD, надписи, экраны — как stallium; на сервер не ставится) или обе (блоки, предметы, логика мира).
- **С какой версии Minecraft**: по умолчанию — последний релиз каталога; раньше — значит, код должен собираться и под старые цели (скилл `targets`).

## 2. Каркас

```bash
npm run new-mod -- <id> "<Название>" [--client]
```

Скрипт (`scripts/new-mod.mjs`) создаёт `mods/<id>/` по правилам `check-project` и сразу собирается:
`settings.gradle` и `build.gradle` (плагин `kraineff.fabric-mod`), `gradle.properties` (`mod_version=0.1.0`, `mc_since` — последний релиз), `fabric.mod.json`, точку входа (`<Класс>` в `src/main` и `<Класс>Client` в `src/client`; с `--client` — только клиентская), пустой `<id>.client.mixins.json`, `en_us.json` / `ru_ru.json`, иконку-заглушку 128×128, `CLAUDE.md`, `README.md` с блоком целей, `docs/CHANGELOG.md`, `docs/MODRINTH.md`.

`mc_since` не последний релиз — поправь в `gradle.properties` и `npm run sync`.

## 3. Заполни руками

- `fabric.mod.json` — `description` (одно предложение для игроков, по-английски).
- `CLAUDE.md` — суть мода и как он устроен (дерево пакетов, нетривиальные решения); правила — `.claude/rules/journals.md`.
- `README.md` — возможности для людей, по-русски; таблицу версий не трогать — её пишет `npm run sync`.
- `docs/MODRINTH.md` — страница проекта для игроков, по-английски (образец — `mods/stallium/docs/MODRINTH.md`).
- Иконка `src/main/resources/assets/<id>/icon.png` — настоящая, когда будет.

## 4. Скриншот-тест (если у мода есть что показать)

Клиентский gametest — то, чем проверяются рендер и экраны под каждой целью (скилл `targets`). Образец — `mods/stallium/src/gametest/`:
- `src/gametest/resources/fabric.mod.json` — мод `<id>-gametest`, зависит от `<id>`, точка входа `fabric-client-gametest`;
- `src/gametest/java/com/kraineff/<pkg>/gametest/<Класс>GameTest.java` — `FabricClientGameTest`: мир (`context.worldBuilder()`), команды сервера, `context.takeScreenshot("<id>-<имя>")`.
Плагин сборки сам заведёт набор исходников, `runClientGameTest` и `updateScreenshots` (снимки → `docs/screenshots/`). Галерея Modrinth — `docs/gallery.json` (образец — stallium).

## 5. Проверка и коммит

1. `npm run verify:changed` — проверки и сборка мода; `npm run build -- <id> --all-targets` — все цели.
2. `./gradlew -p mods/<id> runClient` — запуск клиента с модом (смотрит пользователь).
3. Коммит `feat(<id>): Добавить мод <Название>`.

## 6. Публикация

Пока у мода нет `modrinth_id`, CI его только собирает. Когда пользователь завёл проект на Modrinth — `modrinth_id=<slug>` в `gradle.properties` (каркас оставил строку закомментированной), `contact.homepage` в `fabric.mod.json` — страница проекта; секрет `MODRINTH_TOKEN` в репозитории общий. Первый релиз — скилл `release`.
