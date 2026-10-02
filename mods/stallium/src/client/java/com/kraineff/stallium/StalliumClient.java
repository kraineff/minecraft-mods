package com.kraineff.stallium;

import com.kraineff.stallium.compat.ScreenCompat;
import com.kraineff.stallium.config.StalliumConfigScreen;
import com.kraineff.stallium.render.HorseHud;
import com.kraineff.stallium.render.HorseLabels;
import com.kraineff.stallium.stats.GrowthTracker;
import com.kraineff.stallium.stats.HorseTracker;
import com.mojang.blaze3d.platform.InputConstants;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.minecraft.client.KeyMapping;
import net.minecraft.resources.Identifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class StalliumClient implements ClientModInitializer {
	public static final String MOD_ID = "stallium";

	private static final Logger log = LoggerFactory.getLogger("com.kraineff.stallium.StalliumClient");

	private static KeyMapping settingsKey;

	@Override
	public void onInitializeClient() {
		KeyMapping.Category category = KeyMapping.Category.register(
				Identifier.fromNamespaceAndPath(MOD_ID, "main"));
		settingsKey = KeyMappingHelper.registerKeyMapping(new KeyMapping(
				"key.stallium.settings", InputConstants.KEY_H, category));

		ClientTickEvents.END_CLIENT_TICK.register(minecraft -> {
			while (settingsKey.consumeClick()) {
				if (ScreenCompat.current(minecraft) == null) {
					ScreenCompat.open(minecraft, new StalliumConfigScreen(null));
				}
			}
			HorseTracker.tick(minecraft);
		});
		GrowthTracker.register();
		HorseLabels.register();
		HorseHud.register();
		log.info("[Stallium] Initialized");
	}
}
