package com.kraineff.stallium.stats;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientEntityEvents;
import net.fabricmc.fabric.api.event.player.UseEntityCallback;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.AgeableMob;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.animal.equine.AbstractHorse;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.EntityHitResult;

/**
 * Остаток роста жеребёнка. В одиночной игре — точно, из поля age на
 * встроенном сервере. На серверах возраст клиенту не приходит — оценка:
 * отсчёт с увиденного рождения (жеребёнок появился рядом в уже прогруженном
 * мире) минус собственные кормления; пока сущность выгружена, время стоит.
 */
public final class GrowthTracker {
	/** Полный рост жеребёнка: 24000 тиков = 20 минут. */
	public static final int FULL_GROWTH_TICKS = 24000;

	// Секунды роста за еду — AbstractHorse.handleEating.
	private static final Map<Item, Integer> FOOD_SECONDS = Map.of(
			Items.WHEAT, 20,
			Items.SUGAR, 30,
			Items.HAY_BLOCK, 180,
			Items.APPLE, 60,
			Items.CARROT, 60,
			Items.GOLDEN_CARROT, 60,
			Items.GOLDEN_APPLE, 240,
			Items.ENCHANTED_GOLDEN_APPLE, 240);

	/** Появление ближе этого радиуса считаем рождением, а не прогрузкой чанка. */
	private static final double BIRTH_RADIUS = 32.0;
	/** Первые тики после входа в мир — массовая прогрузка, рождения не засчитываем. */
	private static final long JOIN_GRACE_TICKS = 100;

	private static final class Estimate {
		long refGameTime;
		int remainingAtRef;
		boolean frozen;
	}

	private static final Map<UUID, Estimate> estimates = new HashMap<>();
	private static ClientLevel knownLevel;
	private static long levelJoinGameTime;

	private GrowthTracker() {}

	public static void register() {
		ClientEntityEvents.ENTITY_LOAD.register(GrowthTracker::onEntityLoad);
		ClientEntityEvents.ENTITY_UNLOAD.register(GrowthTracker::onEntityUnload);
		UseEntityCallback.EVENT.register(GrowthTracker::onUseEntity);
	}

	/** Следит за сменой мира; вызывается раз в клиентский тик. */
	static void tick(Minecraft minecraft) {
		if (minecraft.level != knownLevel) {
			knownLevel = minecraft.level;
			levelJoinGameTime = knownLevel != null ? knownLevel.getGameTime() : 0;
			estimates.clear();
		}
	}

	/** Остаток тиков роста; null — жеребёнок не отслеживается (нет данных). */
	static Integer remainingTicks(AbstractHorse horse, Minecraft minecraft) {
		if (!horse.isBaby()) {
			return null;
		}

		IntegratedServer server = minecraft.getSingleplayerServer();
		if (server != null) {
			Entity entity = server.overworld().getEntityInAnyDimension(horse.getUUID());
			return entity instanceof AgeableMob mob ? Math.max(0, -mob.getAge()) : null;
		}

		Estimate estimate = estimates.get(horse.getUUID());
		if (estimate == null || minecraft.level == null) {
			return null;
		}
		return Math.max(0, currentRemaining(estimate, minecraft.level.getGameTime()));
	}

	private static int currentRemaining(Estimate estimate, long now) {
		return estimate.frozen ? estimate.remainingAtRef
				: estimate.remainingAtRef - (int) (now - estimate.refGameTime);
	}

	private static void onEntityLoad(Entity entity, ClientLevel level) {
		if (!(entity instanceof AbstractHorse horse)) {
			return;
		}
		Minecraft minecraft = Minecraft.getInstance();
		if (minecraft.getSingleplayerServer() != null) {
			return;
		}

		if (!horse.isBaby()) {
			estimates.remove(horse.getUUID());
			return;
		}

		Estimate estimate = estimates.get(horse.getUUID());
		long now = level.getGameTime();
		if (estimate != null) {
			estimate.refGameTime = now;
			estimate.frozen = false;
			return;
		}

		// Новорождённый: появился рядом уже после прогрузки мира.
		if (minecraft.player != null
				&& horse.distanceToSqr(minecraft.player) <= BIRTH_RADIUS * BIRTH_RADIUS
				&& now - levelJoinGameTime > JOIN_GRACE_TICKS) {
			Estimate born = new Estimate();
			born.refGameTime = now;
			born.remainingAtRef = FULL_GROWTH_TICKS;
			estimates.put(horse.getUUID(), born);
		}
	}

	private static void onEntityUnload(Entity entity, ClientLevel level) {
		Estimate estimate = estimates.get(entity.getUUID());
		if (estimate != null && !estimate.frozen) {
			estimate.remainingAtRef = currentRemaining(estimate, level.getGameTime());
			estimate.frozen = true;
		}
	}

	private static InteractionResult onUseEntity(Player player, Level level, InteractionHand hand,
			Entity entity, EntityHitResult hitResult) {
		if (level.isClientSide() && entity instanceof AbstractHorse horse && horse.isBaby()) {
			Estimate estimate = estimates.get(horse.getUUID());
			Integer seconds = FOOD_SECONDS.get(player.getItemInHand(hand).getItem());
			if (estimate != null && seconds != null) {
				estimate.remainingAtRef = currentRemaining(estimate, level.getGameTime()) - seconds * 20;
				estimate.refGameTime = level.getGameTime();
			}
		}
		return InteractionResult.PASS;
	}
}
