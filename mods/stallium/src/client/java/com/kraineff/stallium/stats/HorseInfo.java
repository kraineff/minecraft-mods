package com.kraineff.stallium.stats;

import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.animal.camel.Camel;
import net.minecraft.world.entity.animal.equine.AbstractHorse;
import net.minecraft.world.entity.animal.equine.Donkey;
import net.minecraft.world.entity.animal.equine.Horse;
import net.minecraft.world.entity.animal.equine.Llama;

/**
 * Характеристики лошади: сырые атрибуты и производные величины — скорость в
 * блоках/сек, высота прыжка в блоках, сводный балл для сравнения особей.
 */
public record HorseInfo(double speedAttr, double jumpAttr, float maxHealth,
                        boolean rideable, boolean breedable, boolean baby) {

	// Скорость по земле: б/с = 10.75 × (0.45 + …) = атрибут × 43 (ru.minecraft.wiki/w/Лошадь).
	public static final double SPEED_TO_BPS = 43.0;

	// Диапазоны генерации при спавне — AbstractHorse.generateSpeed/JumpStrength/MaxHealth.
	public static final double MIN_SPEED = 0.1125, MAX_SPEED = 0.3375;
	public static final double MIN_JUMP = 0.4, MAX_JUMP = 1.0;
	public static final double MIN_HEALTH = 15.0, MAX_HEALTH = 30.0;

	private static final double WEIGHT_SPEED = 0.45, WEIGHT_JUMP = 0.35, WEIGHT_HEALTH = 0.20;

	public static HorseInfo of(AbstractHorse horse) {
		// Ламы не управляются в седле, у верблюда вместо прыжка рывок — из
		// сравнения «лучшей» и показа прыжка они исключены. Потомство со
		// статами дают только лошади и ослы (мулы бесплодны).
		boolean rideable = !(horse instanceof Llama) && !(horse instanceof Camel);
		boolean breedable = horse instanceof Horse || horse instanceof Donkey;

		return new HorseInfo(
				horse.getAttributeValue(Attributes.MOVEMENT_SPEED),
				horse.getAttributeValue(Attributes.JUMP_STRENGTH),
				horse.getMaxHealth(),
				rideable, breedable, horse.isBaby());
	}

	public double speedBps() {
		return speedAttr * SPEED_TO_BPS;
	}

	/**
	 * Высота прыжка симуляцией ванильной физики: y += v; v = (v − 0.08) × 0.98.
	 * Совпадает с таблицей ру-вики (0.4 → 1.153; 1.0 → 5.92 блока).
	 */
	public double jumpBlocks() {
		double velocity = jumpAttr;
		double height = 0.0;
		while (velocity > 0.0) {
			height += velocity;
			velocity = (velocity - 0.08) * 0.98;
		}
		return height;
	}

	public double normSpeed() {
		return normalize(speedAttr, MIN_SPEED, MAX_SPEED);
	}

	public double normJump() {
		return normalize(jumpAttr, MIN_JUMP, MAX_JUMP);
	}

	public double normHealth() {
		return normalize(maxHealth, MIN_HEALTH, MAX_HEALTH);
	}

	public double score() {
		return score(normSpeed(), normJump(), normHealth());
	}

	static double score(double normSpeed, double normJump, double normHealth) {
		return WEIGHT_SPEED * normSpeed + WEIGHT_JUMP * normJump + WEIGHT_HEALTH * normHealth;
	}

	static double normalize(double value, double min, double max) {
		return Math.clamp((value - min) / (max - min), 0.0, 1.0);
	}
}
