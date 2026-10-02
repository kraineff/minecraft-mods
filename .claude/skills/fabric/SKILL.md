---
name: fabric
description: Справочник Fabric и Minecraft 26.x для модов монорепозитория — где что в API (клавиши, тик, рендер надписей в мире, HUD, обводка сущностей, экраны и виджеты, события сущностей, клиентские gametests), приёмы совместимости между целями через compat/ и MethodHandle, журнал различий API между версиями Minecraft (porting.md). Используется при написании кода мода под Fabric API, при переходе на новую версию Minecraft, когда сборка или рантайм упали после смены цели, и когда нужно найти, как в 26.x называется ванильный класс или метод.
---

# Fabric и Minecraft 26.x

Открывай только нужное:

| Файл | Тема |
|---|---|
| `api.md` | где что лежит: клавиши, тик, рендер в мире, HUD, обводка, экраны, сущности, gametests — с образцами из stallium |
| `porting.md` | журнал различий API между версиями Minecraft и Fabric API, на которые мы наткнулись, — читать перед переходом на новую линию, дописывать при каждом новом различии |

## Где искать ответ

- Исходники Minecraft нужной цели: `./gradlew -p mods/<мод> genSources -PtargetMc=<цель>` — Loom кладёт их рядом с JAR игры, IDE открывает по переходу к классу. Без IDE — `javap -cp ~/.gradle/caches/fabric-loom/<версия>/minecraft-client-only.jar:…/minecraft-common.jar <класс>`.
- Fabric API — исходники идут вместе с зависимостью (`fabric-api-<версия>-sources.jar` в кеше Gradle); документация — docs.fabricmc.net, заметки о версиях — fabricmc.net/blog (что удалили и чем заменили).
- Изменения ванили между версиями подробно — портинг-гайды NeoForged (primer) к каждой версии: имена у них те же, официальные Mojang.

## Совместимость между целями

Один исходный код собирается под все цели мода (скилл `targets`). Метод или поле, которого нет в части целей, ищется в рантайме в `compat/` (образец — `ScreenCompat` и `HorseLabels` в stallium):

```java
private static final @Nullable MethodHandle GUI_SET_SCREEN = find(
		Gui.class, "setScreen", MethodType.methodType(void.class, Screen.class));
```

- Поиск — один раз, в `static final`; вызов — `invoke` с понятной ошибкой, если не нашёлся ни один вариант.
- Классы и сигнатуры в `MethodType` — только те, что есть во **всех** целях (иначе не соберётся).
- Компиляция MethodHandle не проверяет: после смены цели — скриншот-тест или `javap` по сигнатуре.
