package com.kraineff.stallium.gametest;

import com.kraineff.stallium.config.StalliumConfig;
import com.kraineff.stallium.config.StalliumConfigScreen;
import java.util.Locale;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestServerContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;
import net.minecraft.client.gui.screens.worldselection.WorldCreationUiState;
import net.minecraft.world.Difficulty;
import net.minecraft.world.entity.player.ChatVisiblity;
import net.minecraft.world.level.levelgen.presets.WorldPresets;

/**
 * Скриншот-проверка: три лошади с разными статами — надписи и золотая
 * обводка лучшей; затем игрок садится на среднюю — HUD и цветные сравнения.
 */
public class StalliumGameTest implements FabricClientGameTest {
	@Override
	public void runTest(ClientGameTestContext context) {
		try (TestSingleplayerContext singleplayer = context.worldBuilder()
				.adjustSettings(settings -> {
					settings.setGameMode(WorldCreationUiState.SelectedGameMode.CREATIVE);
					settings.setDifficulty(Difficulty.PEACEFUL);
					settings.getNormalPresetList().stream()
							.filter(entry -> entry.preset().is(WorldPresets.FLAT))
							.findFirst()
							.ifPresent(settings::setWorldType);
				})
				.create()) {
			singleplayer.getClientLevel().waitForChunksRender();
			TestServerContext server = singleplayer.getServer();

			context.runOnClient(minecraft -> {
				minecraft.options.chatVisibility().set(ChatVisiblity.HIDDEN);
				StalliumConfig.get().breedingHints = true;
			});
			server.runCommand("time set noon");
			server.runCommand("weather clear");
			server.runCommand("tp @p 0.5 -60 0.5 0 8");

			summonHorse(server, -3.5, 7.5, 0.15, 0.50, 18);
			summonHorse(server, 0.5, 7.5, 0.22, 0.65, 22);
			summonHorse(server, 4.5, 7.5, 0.33, 0.95, 30);
			// жеребёнок на половине роста — таймер должен показать 10:00
			server.runCommand("summon minecraft:horse -2.0 -60.0 11.5 {NoAI:1b, Age:-12000, Rotation:[180f,0f], "
					+ "Health:24.0f, attributes:[{id:\"minecraft:movement_speed\", base:0.2250}, "
					+ "{id:\"minecraft:jump_strength\", base:0.70}, {id:\"minecraft:max_health\", base:24.0}]}");

			context.waitTicks(20);
			context.takeScreenshot("stallium-field");

			context.getInput().holdShift();
			context.waitTicks(3);
			context.takeScreenshot("stallium-field-shift");
			context.getInput().releaseShift();
			context.waitTicks(3);

			// крупный план жеребёнка: полоски и цифры таймера роста
			server.runCommand("tp @p -2.0 -60 8.5 0 15");
			context.waitTicks(5);
			context.takeScreenshot("stallium-baby");
			context.getInput().holdShift();
			context.waitTicks(3);
			context.takeScreenshot("stallium-baby-shift");
			context.getInput().releaseShift();
			server.runCommand("tp @p 0.5 -60 0.5 0 8");
			context.waitTicks(5);

			server.runCommand("ride @p mount @e[type=minecraft:horse,x=0.5,y=-60,z=7.5,distance=..2,limit=1]");
			context.waitTicks(5);
			server.runCommand("rotate @p -90 14");
			context.waitTicks(15);
			context.takeScreenshot("stallium-riding");

			context.setScreen(() -> new StalliumConfigScreen(null));
			context.waitTicks(2);
			context.takeScreenshot("stallium-settings");
		}
	}

	private static void summonHorse(TestServerContext server, double x, double z,
			double speed, double jump, int health) {
		server.runCommand(String.format(Locale.ROOT,
				"summon minecraft:horse %.1f -60.0 %.1f {NoAI:1b, Health:%d.0f, Rotation:[180f,0f], "
						+ "attributes:[{id:\"minecraft:movement_speed\", base:%.4f}, "
						+ "{id:\"minecraft:jump_strength\", base:%.2f}, "
						+ "{id:\"minecraft:max_health\", base:%d.0}]}",
				x, z, health, speed, jump, health));
	}
}
