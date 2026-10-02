---
paths:
  - "mods/*/src/*/resources/**"
---

# Ресурсы

- `fabric.mod.json` — в `src/main/resources`. `version` — `${version}`, `depends.minecraft` — `${minecraft_range}`: их подставляет сборка по цели, версии руками не пишем; `depends.java` — `>=` Java из каталога. Сверяет `check-modjson`.
- Конфиг миксинов — `<id>.client.mixins.json` (клиентские) или `<id>.mixins.json` (общие): `required: true`, `injectors.defaultRequire: 1`, `compatibilityLevel: JAVA_<java>`; каждый класс миксина — в своём списке (`check-mixins`).
- Ресурсы — в `assets/<id>/`; замена ванильных — в `assets/minecraft/`.
- Переводы: `assets/<id>/lang/en_us.json` (обязателен) и `ru_ru.json` — одинаковый набор ключей и подстановок (`%s`). Ключ — `<категория>.<id>.<имя>`: `screen.stallium.title`, `key.stallium.settings`; категория клавиш — `key.category.<id>.<имя>`. Сверяет `check-lang`.
- JSON — с табами, как у Fabric. Комментариев в JSON нет: объяснения — в `CLAUDE.md` мода.
