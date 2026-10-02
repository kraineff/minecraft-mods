# Где что в API (Minecraft 26.x, Fabric API)

Образцы — из `mods/stallium/`; имена официальные Mojang. Различия между версиями — `porting.md`.

## Клавиши и тик

```java
KeyMapping.Category category = KeyMapping.Category.register(Identifier.fromNamespaceAndPath(MOD_ID, "main"));
KeyMapping key = KeyMappingHelper.registerKeyMapping(new KeyMapping("key.<id>.<имя>", InputConstants.KEY_H, category));
ClientTickEvents.END_CLIENT_TICK.register(minecraft -> {
	while (key.consumeClick()) { … }
});
```

- Подпись категории — ключ `key.category.<id>.<имя>` в lang (`check-lang` выводит его из `register`).
- Коды клавиш — только `InputConstants`: с 26.3 ввод идёт через SDL, константы GLFW не подходят.

## Надписи в мире (как ники)

`LevelRenderEvents.COLLECT_SUBMITS.register(context -> …)` — `HorseLabels`:
- камера — `context.levelState().cameraRenderState` (`.pos`), стек — `context.poseStack()`, сборщик — `context.submitNodeCollector()`;
- строка ника — `submitNameTag(poseStack, attachment, 0, component, true, light, camera)` (в 26.1 ещё `double distanceToCameraSq` перед `camera` — обе сигнатуры ищутся MethodHandle);
- позиция между тиками — `Mth.lerp(partialTick, entity.xOld, entity.getX())`, `partialTick` — `minecraft.getDeltaTracker().getGameTimeDeltaPartialTick(!level.tickRateManager().isEntityFrozen(entity))`;
- точка над головой — `entity.getAttachments().getNullable(EntityAttachment.NAME_TAG, 0, entity.getYRot(partialTick))`, свет — `minecraft.getEntityRenderDispatcher().getPackedLightCoords(entity, partialTick)`;
- шаг строки ника — `9 × 1.15 × 0.025` блока.

Считать в рендере нечего: данные готовит тик (`HorseTracker.tick`), рендер только читает.

## HUD

```java
HudElementRegistry.attachElementAfter(VanillaHudElements.MOUNT_HEALTH, id, (GuiGraphicsExtractor graphics, DeltaTracker delta) -> …);
```

- Текст с подложкой, как имя предмета над хотбаром, — `graphics.textWithBackdrop(font, text, x, y, width, ARGB.white(255))`; размеры — `graphics.guiWidth()` / `guiHeight()`.
- Ванильные строки над хотбаром: имя предмета — `guiHeight − 59`, actionbar — `guiHeight − 72`.

## Обводка сущности

- Светится — миксин `Minecraft.shouldEntityAppearGlowing(Entity)`: `cir.setReturnValue(true)`.
- Цвет — миксин `Entity.getTeamColor()`; команду игрока уважать (`getTeam() != null` — не трогать). У `ChatFormatting` с 26.2 нет метода цвета — цвет константой.

## Экраны и настройки

- `Screen` на ванильных виджетах — `StalliumConfigScreen`: `CycleButton.onOffBuilder(value).create(x, y, w, h, label, (button, v) -> …)`, `AbstractSliderButton` (`updateMessage`, `applyValue`), `StringWidget`, `Button.builder(CommonComponents.GUI_DONE, b -> onClose()).bounds(…)`.
- Открыть экран — `ScreenCompat.open(minecraft, screen)`: 26.1 — `Minecraft.setScreen`, 26.2+ — `Gui.setScreen` (`minecraft.gui`).
- Конфиг — JSON через Gson в `FabricLoader.getInstance().getConfigDir().resolve("<id>.json")`; значения ограничивать при чтении и записи; нечитаемый файл — `warn` и значения по умолчанию.
- ModMenu — точка входа `modmenu` → `ModMenuApi.getModConfigScreenFactory()`; зависимость `compileOnly 'com.terraformersmc:modmenu:<версия>'` и репозиторий `https://maven.terraformersmc.com/releases/`.

## Сущности

- Появление и выгрузка на клиенте — `ClientEntityEvents.ENTITY_LOAD` / `ENTITY_UNLOAD` (`(entity, level)`); взаимодействие — `UseEntityCallback.EVENT` (на клиенте — `level.isClientSide()`, вернуть `InteractionResult.PASS`).
- Перебор вокруг — `minecraft.level.entitiesForRendering()`.
- Лошади — `net.minecraft.world.entity.animal.equine` (`AbstractHorse`, `Horse`, `Donkey`, `Llama`), верблюд — `animal.camel.Camel`; атрибуты — `getAttributeValue(Attributes.MOVEMENT_SPEED)`, `JUMP_STRENGTH`.
- В одиночной игре точные серверные данные — `minecraft.getSingleplayerServer().overworld().getEntityInAnyDimension(uuid)`; на сервере клиент видит только то, что синхронизировано.

## Свои глифы

Bitmap-шрифт `assets/<id>/font/<имя>.json` (`providers: [{ "type": "bitmap", "file": "<id>:font/<имя>.png", "ascent", "chars" }]`), в тексте — `style.withFont(new FontDescription.Resource(Identifier.fromNamespaceAndPath(<id>, "<имя>")))`. Ширину глифа подгонять под соседние символы — иначе колонки разъедутся.

## Клиентские gametests

`FabricClientGameTest.runTest(ClientGameTestContext context)` — `StalliumGameTest`:
- мир — `context.worldBuilder().adjustSettings(…).create()` в try-with-resources (`TestSingleplayerContext`), сервер — `singleplayer.getServer().runCommand("…")`;
- ожидание — `context.waitTicks(n)`; чанки — `getClientLevel().waitForChunksRender()` в 26.1–26.2, `getConnection().waitForChunksRender()` с 26.3;
- ввод — `context.getInput().holdShift()` / `releaseShift()`; экран — `context.setScreen(() -> …)`; код на клиенте — `context.runOnClient(minecraft -> …)`;
- снимок — `context.takeScreenshot("<id>-<имя>")` → `build/run/clientGameTest/screenshots/0000_<id>-<имя>.png`.

Запуск — `./gradlew -p mods/<id> runClientGameTest [-PtargetMc=<цель>]`: на macOS открывается окно игры на минуту.
