package com.kraineff.stallium.mixin;

import com.kraineff.stallium.config.StalliumConfig;
import com.kraineff.stallium.stats.HorseTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(Minecraft.class)
public class MinecraftMixin {
	/** Лучшая лошадь поблизости светится как от спектральной стрелы. */
	@Inject(method = "shouldEntityAppearGlowing", at = @At("HEAD"), cancellable = true)
	private void stallium$glowBestHorse(Entity entity, CallbackInfoReturnable<Boolean> cir) {
		if (StalliumConfig.get().highlightBest && HorseTracker.isBestHorse(entity)) {
			cir.setReturnValue(true);
		}
	}
}
