package com.kraineff.stallium.render;

import com.kraineff.stallium.StalliumClient;
import com.kraineff.stallium.stats.HorseTracker;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.util.ARGB;

/**
 * Строка статов своей лошади над хотбаром — в том же стиле, каким ваниль
 * подписывает предмет в руке (textWithBackdrop по центру экрана).
 */
public final class HorseHud {
	private static final Identifier ID = Identifier.fromNamespaceAndPath(StalliumClient.MOD_ID, "mount_stats");

	// Ванильные строки занимают guiHeight − 59 (имя предмета) и − 72 (actionbar);
	// строка статов встаёт выше них.
	private static final int STATS_OFFSET = 84;

	private HorseHud() {}

	public static void register() {
		HudElementRegistry.attachElementAfter(VanillaHudElements.MOUNT_HEALTH, ID, HorseHud::extract);
	}

	private static void extract(GuiGraphicsExtractor graphics, DeltaTracker deltaTracker) {
		Component stats = HorseTracker.hudStats();
		if (stats == null) {
			return;
		}

		Font font = Minecraft.getInstance().font;
		drawCentered(graphics, font, stats, graphics.guiHeight() - STATS_OFFSET);
	}

	private static void drawCentered(GuiGraphicsExtractor graphics, Font font, Component text, int y) {
		int width = font.width(text);
		graphics.textWithBackdrop(font, text, (graphics.guiWidth() - width) / 2, y, width, ARGB.white(255));
	}
}
