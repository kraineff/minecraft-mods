# Различия API между версиями

Журнал того, что поменялось при переходе на новую версию Minecraft или Fabric API и как мы это обошли. Пункт — «было → стало → где у нас». Новая версия — раздел сверху.

## 26.4 (снапшоты)

- 26.4-snapshot-2, Fabric API 0.161.2+26.4: stallium собрался и прошёл скриншот-тест без правок; сигнатуры, которые ищет `compat/`, — как в 26.3.
- На macOS клиент 26.4 рендерит через Vulkan (MoltenVK): строки `[mvk-warn] … primitive restart` в логе — норма, на моды не влияют.

## 26.3

- Fabric API 0.161 (client-gametest v6): `TestSingleplayerContext.getClientLevel()` → `getConnection()` — `TestServerConnection` с `waitForChunksRender()`, `getClientLevel()`, `getServerLevel()`, `getClientPlayer()`. Gametest, который собирается и под 26.1–26.2, ищет метод рефлексией (`StalliumGameTest.waitForChunksRender`).
- GLFW заменён на SDL: коды клавиш — только `InputConstants` (часть констант, в том числе кнопки мыши, поменялась); своё поле ввода текста сообщает о фокусе — `Minecraft.getInstance().onTextInputFocusChange(…)`, иначе ввод символов ломается.
- Fabric API удалил `FuelRegistry`, `CompostingChanceRegistry`, `FabricPotionBrewingBuilder`, `StrippableBlockRegistry`, `TillableBlockRegistry`, `FlattenableBlockRegistry`: топливо и компост — компоненты предметов (`DataComponents.COOKING_FUEL`, `COMPOSTABLE`) через `DefaultItemComponentEvents`, варка — рецепты в данных, превращения блоков — `BlockTransformerHelper` и `BlockTransformerEvents`.
- Рекомендация Fabric к релизу: Loom 1.17 и Gradle 9.6+, Loader 0.19.5.

## 26.2

- `Minecraft.setScreen(Screen)` и поле `Minecraft.screen` → `Gui.setScreen(Screen)` и `Gui.screen()` через `minecraft.gui` — `ScreenCompat`.
- `OrderedSubmitNodeCollector.submitNameTag(…)` потерял параметр `double distanceToCameraSq` — `HorseLabels` ищет обе сигнатуры.
- У `ChatFormatting` нет метода цвета — цвет константой (`EntityMixin`).

## 26.1

- Первая версия без обфускации: имена Mojang, маппинги не нужны, плагин Loom — `net.fabricmc.fabric-loom` (без remap). Java 25.
