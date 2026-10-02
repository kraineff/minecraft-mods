package com.kraineff.stallium.mixin;

import com.kraineff.stallium.config.StalliumConfig;
import com.kraineff.stallium.stats.HorseTracker;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(Entity.class)
public class EntityMixin {
	// Цвет ChatFormatting.GOLD; в 26.2 у ChatFormatting больше нет метода цвета.
	@Unique
	private static final int GOLD = 0xFFAA00;

	/** Обводка лучшей лошади — золотая, как у команды GOLD. */
	@Inject(method = "getTeamColor", at = @At("HEAD"), cancellable = true)
	private void stallium$goldBestHorseOutline(CallbackInfoReturnable<Integer> cir) {
		Entity self = (Entity) (Object) this;
		if (StalliumConfig.get().highlightBest && HorseTracker.isBestHorse(self) && self.getTeam() == null) {
			cir.setReturnValue(GOLD);
		}
	}
}
