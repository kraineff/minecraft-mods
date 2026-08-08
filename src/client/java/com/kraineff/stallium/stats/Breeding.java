package com.kraineff.stallium.stats;

/**
 * Ожидаемые статы жеребёнка по ванильной формуле
 * {@code AbstractHorse.createOffspringAttribute}: потомок = среднее родителей
 * ± (|разница родителей| + 30 % диапазона) × качество, где качество —
 * (r+r+r)/3 − 0.5, а перелёт за границы диапазона отражается внутрь. Отсюда
 * следствие: выгодны два сильных И сбалансированных родителя — «экстремальные»
 * пары дают большой разброс, а упор в максимум срезается отражением.
 */
final class Breeding {
	private static final int QUADRATURE_STEPS = 96;

	private Breeding() {}

	/** Ожидаемый сводный балл жеребёнка пары. */
	static double expectedFoalScore(HorseInfo a, HorseInfo b) {
		double speed = expectedAttribute(a.speedAttr(), b.speedAttr(), HorseInfo.MIN_SPEED, HorseInfo.MAX_SPEED);
		double jump = expectedAttribute(a.jumpAttr(), b.jumpAttr(), HorseInfo.MIN_JUMP, HorseInfo.MAX_JUMP);
		double health = expectedAttribute(a.maxHealth(), b.maxHealth(), HorseInfo.MIN_HEALTH, HorseInfo.MAX_HEALTH);
		return HorseInfo.score(
				HorseInfo.normalize(speed, HorseInfo.MIN_SPEED, HorseInfo.MAX_SPEED),
				HorseInfo.normalize(jump, HorseInfo.MIN_JUMP, HorseInfo.MAX_JUMP),
				HorseInfo.normalize(health, HorseInfo.MIN_HEALTH, HorseInfo.MAX_HEALTH));
	}

	/** Матожидание одного атрибута потомка (квадратура по плотности качества). */
	static double expectedAttribute(double parentA, double parentB, double min, double max) {
		parentA = Math.clamp(parentA, min, max);
		parentB = Math.clamp(parentB, min, max);
		double margin = 0.15 * (max - min);
		double range = Math.abs(parentA - parentB) + margin * 2.0;
		double average = (parentA + parentB) / 2.0;

		double weightedSum = 0.0;
		double weightTotal = 0.0;
		for (int i = 0; i < QUADRATURE_STEPS; i++) {
			double quality = -0.5 + (i + 0.5) / QUADRATURE_STEPS;
			double weight = qualityDensity(quality + 0.5);
			double value = average + range * quality;
			if (value > max) {
				value = max - (value - max);
			} else if (value < min) {
				value = min + (min - value);
			}
			weightedSum += weight * value;
			weightTotal += weight;
		}
		return weightedSum / weightTotal;
	}

	/** Плотность Ирвина — Холла (n=3) для (r+r+r)/3 на [0;1], без нормировки. */
	private static double qualityDensity(double x) {
		double s = 3.0 * x;
		if (s <= 1.0) {
			return s * s;
		}
		if (s <= 2.0) {
			return -2.0 * s * s + 6.0 * s - 3.0;
		}
		return (3.0 - s) * (3.0 - s);
	}
}
