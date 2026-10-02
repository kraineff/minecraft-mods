---
paths:
  - "mods/**/*.java"
---

# Код

- Имена — официальные Mojang: с 26.1 игра выходит без обфускации, маппингов нет. Исходники Minecraft для чтения — `./gradlew -p mods/<id> genSources -PtargetMc=<цель>`.
- Пакет — `com.kraineff.<id>`. Клиентский код (рендер, экраны, клавиши, `Minecraft`) — только в `src/client`: на сервере его классы не загрузятся. Общий — в `src/main`.
- Миксины: обработчик — `<id>$имя`, своё поле или метод — `@Unique`, поле цели — `@Shadow`; `@Overwrite` нельзя. Инъекция — в самую узкую точку (`@Inject` в `HEAD`/`RETURN`, `@ModifyReturnValue`, `@WrapOperation`). Класс миксина из обычного кода не трогаем. Сверяет `check-mixins`.
- Различие целей — только в `compat/`: MethodHandle ищется один раз в `static final`, ни один вариант не нашёлся — `IllegalStateException` с понятным текстом. В остальном коде ветвлений по версиям нет.
- Null — jspecify (`org.jspecify.annotations.Nullable`), как в Minecraft; `org.jetbrains.annotations` ловит Checkstyle.
- Логи — SLF4J: `private static final Logger log = LoggerFactory.getLogger("<пакет>.<Класс>")`, фраза-факт по-английски `[Контекст]: Факт, детали (причина)`, только `{}`; `error` — с throwable последним аргументом, восстановимое — `warn` с причиной, штатное и частое — `debug`. Правило логов и скилл `logging` — целиком; сверяет `check-logs`.
- Текст для игрока — только переводом: `Component.translatable("<категория>.<id>.<ключ>")`, ключ сразу в `en_us.json` и `ru_ru.json` (`check-lang`). Строк по-русски в коде нет.
- Комментарии и Javadoc — по-русски и только о «почему»: формула, ограничение API, версия, где поменялось поведение. Что делает строка — не пишем.
- Стиль — табы, импорты одним блоком по алфавиту, скобки всегда, утилитарный класс — `final` с закрытым конструктором: Checkstyle (`config/checkstyle/checkstyle.xml`) в `./gradlew build`.

Приёмы и подробности стиля — скилл `code-style`; API Fabric и Minecraft, различия версий — скилл `fabric`.
