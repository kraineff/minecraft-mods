# Моды Minecraft

Fabric-моды для Minecraft 26.x. Каждый мод — в `mods/<id>/` со своим README; общие сборка, версии, проверки и CI — в корне.

| Мод | Что делает | Modrinth |
|---|---|---|
| [Stallium](mods/stallium) | статы лошадей прямо в мире, обводка лучшей, пара для разведения, таймер роста жеребят | [stallium](https://modrinth.com/mod/stallium) |

## Сборка

Нужны Java 25 и Node 22.2+ (скрипты без зависимостей — `npm install` не нужен). Команды — из корня:

```bash
./gradlew -p mods/stallium build                    # мод под последний релиз Minecraft
./gradlew -p mods/stallium build -PtargetMc=26.1    # под конкретную цель
./gradlew -p mods/stallium runClient                # клиент с модом
npm run build -- --all-targets                      # все моды под все свои цели
```

JAR — в `mods/<id>/build/libs/`. Открыть в IDE можно корень целиком: корневой `settings.gradle` — композит всех модов.

## Версии Minecraft

Цели сборки (версии Minecraft и Fabric API под каждую), Loader, Loom и Java — общий каталог `gradle/versions.json`; мод собирается с цели `mc_since` из своего `gradle.properties`. Что вышло нового и обновление каталога:

```bash
npm run versions             # отчёт: Minecraft, Fabric API, Loader, Loom, Minotaur, Checkstyle, Gradle
npm run versions -- --write  # применить к каталогу: свежий Fabric API, снапшот → релиз, новая линия
```

Маппингов нет: с 26.1 Minecraft выходит без обфускации.

## Проверки

- `npm run checks` — статические проверки: миксины, `fabric.mod.json`, переводы, логи, цели, CHANGELOG, устройство модов, JSON, секреты.
- Checkstyle — в `./gradlew build` каждого мода (`config/checkstyle/checkstyle.xml`).
- `npm run verify` — проверки, тесты скриптов и сборка всех модов; `npm run verify:changed` — только задетое.
- CI (`.github/workflows/ci.yml`) — проверки на каждый пуш и сборка задетых модов под все их цели.

## Новый мод

```bash
npm run new-mod -- horse-tweaks "Horse Tweaks" [--client]
```

Каркас сразу собирается и проходит проверки; дальше — описание, страница Modrinth, код.

## Релиз

1. В `mods/<id>/docs/CHANGELOG.md` — раздел `[x.y.z] - YYYY-MM-DD` из `[Unreleased]`; `mod_version` в `gradle.properties`; `npm run sync`.
2. Коммит и пуш.
3. GitHub Release с тегом `<id>/x.y.z` — `publish.yml` соберёт JAR под каждую цель мода и опубликует на Modrinth: changelog из раздела CHANGELOG, описание из `docs/MODRINTH.md`, галерею из `docs/gallery.json`. Токен — секрет `MODRINTH_TOKEN`.

## Как устроено

```
├── mods/<id>/             — моды: build.gradle, gradle.properties, src/, docs/
├── build-logic/           — плагин сборки kraineff.fabric-mod (Loom, цели, Fabric API, gametests, Checkstyle, Modrinth)
├── gradle/versions.json   — каталог версий для всех модов
├── config/checkstyle/     — стиль Java
├── scripts/               — версии, сборка по целям, проверки, CI, каркас мода, галерея Modrinth
├── .claude/               — правила, скиллы и хуки Claude Code
└── .github/workflows/     — ci.yml и publish.yml
```
