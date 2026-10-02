---
name: release
description: Релиз мода на Modrinth — как CI публикует сам (ci.yml: мод с modrinth_id, у которого за пуш в main выросла mod_version, после зелёных проверок и сборок того же прогона; на Modrinth уходят JAR из job build через scripts/modrinth.mjs upload), подготовка релиза (раздел CHANGELOG, mod_version по semver, npm run sync), подтверждение пользователя перед пушем с бампом, ссылки, описание и галерея проекта, тег и GitHub Release, повтор и ручной запуск, пробный прогон, первый релиз нового мода. Используется, когда пользователь просит выпустить или опубликовать версию, «зарелизь», «выложи на Modrinth», и при правке ci.yml, scripts/ci.mjs, scripts/modrinth.mjs.
---

# Релиз

**Поднять `mod_version` — значит опубликовать.** Пуш в `main`, после которого у мода с `modrinth_id` выросла версия, CI сам выкладывает на Modrinth. Поэтому версию поднимаю только по просьбе пользователя выпустить релиз; хук перед `git push` всё равно спросит у него подтверждение («этот пуш опубликует …»). `scripts/modrinth.mjs upload` / `sync` и `gh release create` сам не запускаю — хук откажет.

## Подготовка (Claude)

1. **Версия** — semver: исправления — patch (`1.0.1`), новые возможности и новые версии Minecraft — minor (`1.1.0`), несовместимое (настройки, конфиг) — major.
2. `mods/<мод>/docs/CHANGELOG.md`: пункты `[Unreleased]` — в раздел `## [x.y.z] - YYYY-MM-DD`, сверху — пустой `## [Unreleased]`. Текст — для игроков, по-английски; он уходит и на Modrinth, и в GitHub Release.
3. `mod_version=x.y.z` в `mods/<мод>/gradle.properties`, затем `npm run sync` — имена JAR в таблице README.
4. Описание и галерея — то, что увидят на странице проекта: `docs/MODRINTH.md`, `docs/gallery.json` и `docs/screenshots/` (обновить — `./gradlew -p mods/<мод> updateScreenshots`, посмотреть снимки).
5. `npm run verify:changed` и `npm run build -- <мод> --all-targets`; `check-changelog` сверит раздел с `mod_version`.
6. Коммит `chore(<мод>): Выпустить x.y.z` и пуш — хук спросит подтверждение у пользователя.

Пробный прогон без записи: `node scripts/modrinth.mjs upload <мод> <цель> mods/<мод>/build/libs/<мод>-x.y.z+<цель>.jar --dry-run` — что уйдёт на Modrinth (уже выложенную версию скажет и пропустит); `node scripts/modrinth.mjs sync <мод> --dry-run` — что поменяется в проекте.

## Что делает CI (`ci.yml`)

План — `node scripts/ci.mjs plan`: публикуются моды с `modrinth_id`, у которых `mod_version` выросла против прежней вершины `main` (бамп не последним коммитом пуша тоже считается; понижение — нет), и только если проверки и сборки этого прогона зелёные.

1. **build** собирает и проверяет мод под каждую цель и отдаёт его JAR артефактом — публикуется ровно он, второй сборки нет.
2. **publish** — по задаче на цель, без Java и Gradle: `scripts/modrinth.mjs upload` выкладывает `<мод>-x.y.z+<цель>.jar` (версии игры — `modrinth` цели из каталога, changelog — раздел CHANGELOG, зависимость Fabric API — из `fabric.mod.json`); уже выложенная версия пропускается.
3. **release** — один раз на мод: `scripts/modrinth.mjs sync` приводит проект к репозиторию (ссылки на исходники и трекер из `contact` в `fabric.mod.json`, описание из `docs/MODRINTH.md`, галерея — пересобирается, только если подписи разошлись или скриншоты менялись с прошлого тега), затем тег `<мод>/x.y.z` и GitHub Release с JAR всех целей и changelog.

Токен — секрет репозитория `MODRINTH_TOKEN` (PAT Modrinth с правами на версии и правку проекта).

## Повтор и ручной запуск

- Упала цель — исправить и перезапустить прогон (`Re-run failed jobs`): выложенные цели пропускаются, релиз создастся, когда все цели на месте.
- Выложить версию, которая уже в репозитории (новый мод, ручная правка на Modrinth), — Actions → ci → Run workflow, поле `publish` = мод.

## Первый релиз нового мода

1. Пользователь заводит проект на Modrinth (slug), в `gradle.properties` мода — `modrinth_id=<slug>`; `check-modjson` потребует `contact.homepage` = страница проекта.
2. Подготовка по шагам выше и пуш с бампом — или ручной запуск с `publish`, если версия уже стоит.
