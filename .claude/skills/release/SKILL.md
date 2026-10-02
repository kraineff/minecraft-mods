---
name: release
description: Релиз мода на Modrinth — подготовка (раздел CHANGELOG, mod_version, npm run sync, коммит и пуш), что делает пользователь (GitHub Release с тегом <мод>/<x.y.z>), что делает CI (.github/workflows/publish.yml — сборка всех целей, changelog, описание, галерея), версии мода по semver, первый релиз нового мода. Используется, когда пользователь просит выпустить или опубликовать версию, «зарелизь», «выложи на Modrinth», и при правке publish.yml, scripts/ci.mjs, scripts/gallery.mjs.
---

# Релиз

Публикует пользователь: GitHub Release запускает CI, а CI пишет на Modrinth от его имени. Хук перед командой не даст модели запустить `modrinth`, `scripts/gallery.mjs` или `gh release create`.

## Готовит Claude

1. **Версия** — semver: исправления — patch (`1.0.1`), новые возможности и новые версии Minecraft — minor (`1.1.0`), несовместимые изменения (настройки, конфиг) — major.
2. `mods/<мод>/docs/CHANGELOG.md`: пункты из `[Unreleased]` — в новый раздел `## [x.y.z] - YYYY-MM-DD`, сверху — пустой `## [Unreleased]`. Текст — для игроков, по-английски.
3. `mod_version=x.y.z` в `mods/<мод>/gradle.properties`, затем `npm run sync` — имена JAR в таблице версий README.
4. `npm run verify:changed` и `npm run build -- <мод> --all-targets` — все цели собираются; `check-changelog` сверит раздел с `mod_version`.
5. Коммит `chore(<мод>): Выпустить x.y.z`, пуш.
6. Сказать пользователю, что создать: GitHub Release с тегом **`<мод>/x.y.z`** (например `stallium/1.1.0`) на ветке `main`; текст релиза можно взять из раздела CHANGELOG.

## Делает CI (`publish.yml`)

1. `node scripts/ci.mjs release <тег>` — разбирает тег, сверяет версию с `mod_version` (не совпало — падает до сборки), даёт цели мода из каталога.
2. По цели на задачу: `./gradlew -p mods/<мод> modrinth -PtargetMc=<цель> -Pchangelog=<раздел>` — Minotaur загружает `<мод>-x.y.z+<цель>.jar` с версиями игры `modrinth` цели, зависимостью Fabric API и синхронизирует описание проекта из `docs/MODRINTH.md`.
3. `node scripts/gallery.mjs <мод>` — галерея проекта пересобирается из `docs/gallery.json` и `docs/screenshots/` (первая картинка — featured).

Токен — секрет репозитория `MODRINTH_TOKEN` (Modrinth PAT с правами на создание версий и правку проекта). Проект на Modrinth — slug = id мода, иначе `modrinth_id` в `gradle.properties` мода.

## Если что-то пошло не так

- План упал на версии — `mod_version` не поднят или тег не тот: поправить и пересоздать релиз (пользователь).
- Упала одна цель — остальные могли опубликоваться: версию для упавшей цели пользователь перевыпускает из Actions (`Re-run failed jobs`) после исправления в той же версии, без нового тега, если код не менялся; если менялся — новая patch-версия.
- Скриншоты для галереи обновляются заранее: `./gradlew -p mods/<мод> updateScreenshots`, глазами посмотреть `docs/screenshots/`, закоммитить.
