---
name: targets
description: Версии Minecraft и цели сборки модов — каталог gradle/versions.json (цели с Fabric API, Loader, Loom, Minotaur, Checkstyle, Java), mc_since мода, npm run versions (что вышло у Mojang, Fabric API, инструментов) и --write, смена снапшота на следующий или на релиз, новая линия, патчи, обновление Loom/Gradle, проверка всех целей сборкой и скриншот-тестом, записи в CHANGELOG. Используется, когда вышла новая версия Minecraft, снапшот, pre/rc или Fabric API, когда пользователь просит «обнови до 26.x», «добавь поддержку снапшотов», «что нового в версиях», при правке gradle/versions.json и сборки под цели.
---

# Цели Minecraft

## Как устроено

- **Каталог** `gradle/versions.json` — общий для всех модов: `java`, `loader`, `loom`, `minotaur`, `checkstyle` и `targets` — цели по возрастанию, по одной на линию (`26.1`, `26.2`, `26.3`, `26.4-snapshot-2`). У цели: `minecraft` (с какой версией компилируем), `fabricApi` (сборка Fabric API для неё), `range` (диапазон в `fabric.mod.json`), `modrinth` (версии игры, куда публикуется JAR).
- **Мод** берёт цели каталога начиная со своего `mc_since` (`mods/<id>/gradle.properties`). Цель по умолчанию — последний релиз: её открывает IDE и запускает `runClient`. Другая — `-PtargetMc=<цель>`.
- **Линия** — одна цель: пока релиза нет, это последний пререлиз (`snapshot` → `pre` → `rc`); вышел релиз — пререлиз заменяется им. Диапазон пререлиза `>=26.4- <26.5-` покрывает все снапшоты линии и её релиз, релиза — `>=26.3 <26.4-` (патчи `26.3.x` входят).
- Маппингов нет: с 26.1 игра выходит без обфускации, Loom берёт её как есть (плагин `net.fabricmc.fabric-loom`).
- Изменения API между версиями, на которые мы уже наткнулись, — `porting.md` скилла `fabric`: читать перед переходом на новую линию.

## Что нового: `npm run versions`

Отчёт против каталога: последние релиз и снапшот Minecraft (манифест Mojang), Fabric API под каждую цель (Modrinth), что заменить или добавить, Loader, Loom (в ветке и следующая), Minotaur, Checkstyle, Gradle. Хук начала сессии показывает то же раз в 12 часов (кеш `.cache/versions.json`).

`npm run versions -- --write` применяет к каталогу:
- свежий Fabric API цели;
- пререлиз линии → более новый пререлиз или релиз, как только под него вышел Fabric API; моды с `mc_since` на старой цели переходят на новую;
- патч релиза (`26.3.1`) → в `modrinth` цели, если его покрывает та же сборка Fabric API;
- новая линия → новая цель в конце;
- Loader — до последнего стабильного;
- блоки целей в README модов (`npm run sync`).

Loom, Minotaur, Checkstyle и Gradle `--write` не трогает: их обновление может потребовать правок `build-logic/` — руками, отдельным коммитом (Loom и Minotaur — `gradle/versions.json`, Gradle — `./gradlew wrapper --gradle-version <версия>` и проверка, что Loom его поддерживает; заметки о выпуске Loom — релизы FabricMC/fabric-loom на GitHub, блог fabricmc.net).

## Обновить версии — по шагам

1. `npm run versions` — посмотреть, что вышло; перед новой линией прочитать заметку Fabric о версии (fabricmc.net/blog) и `porting.md`.
2. `npm run versions -- --write` (или правка `gradle/versions.json` руками по тем же правилам — `check-targets` сверит).
3. Собрать все цели задетых модов: `npm run build -- --all-targets`. Упало — чинить так, чтобы код собирался под **все** цели: различие — в `compat/` (MethodHandle), не ветвлением; gametests тоже собираются в `build`.
4. Рантайм: MethodHandle и миксины компиляция не проверяет — скриншот-тест под новой целью и под самой старой: `./gradlew -p mods/<мод> runClientGameTest -PtargetMc=<цель>`, снимки в `mods/<мод>/build/run/clientGameTest/screenshots/` — посмотреть. Без gametest — `runClient` и проверка руками пользователем.
5. Для быстрой сверки сигнатур без запуска — `javap` по JAR игры из кеша Loom: `~/.gradle/caches/fabric-loom/<версия>/minecraft-client-only.jar` (клиент) и `minecraft-common.jar`.
6. В `[Unreleased]` CHANGELOG каждого мода — `Support for Minecraft <версия>` (для снапшотов — `Support for Minecraft 26.4 snapshots (26.4-snapshot-2)`; при смене снапшота пункт правится, а не дублируется).
7. Нашлось изменение API — строка в `porting.md` скилла `fabric`.
8. Коммит `build(targets): …` — сообщение со списком Добавлено / Изменено / Удалено и чем проверено.

## Правила каталога

- Цель — только когда под неё вышел Fabric API (`versions --write` ждёт его сам).
- Публикуем только последний снапшот линии: билды снапшотов одинаковые, а игроки на снапшотах обновляются до последнего.
- Старые линии из каталога не удаляем без согласования с пользователем: на них остаются игроки.
- `check-targets` сверяет порядок, одну цель на линию, суффикс Fabric API, `range`, `modrinth`, `mc_since` модов и блоки целей в README.
