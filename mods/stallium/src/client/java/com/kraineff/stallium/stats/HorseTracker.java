package com.kraineff.stallium.stats;

import com.kraineff.stallium.config.StalliumConfig;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.FontDescription;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.animal.equine.AbstractHorse;
import net.minecraft.world.phys.Vec3;

/**
 * Раз в клиентский тик собирает лошадей вокруг игрока, определяет лучшую,
 * подбирает пару для разведения и готовит строки для надписей в мире и HUD.
 * Рендер только читает результат.
 */
public final class HorseTracker {
	/** Минимальный радиус, в котором лошади участвуют в сравнении и подсветке. */
	public static final double TRACK_RADIUS = 48.0;

	/** Порог «заметно лучше» по сводному баллу (доля полной шкалы). */
	private static final double SCORE_EPSILON = 0.01;

	private static final int BAR_SEGMENTS = 10;

	// Свои песочные часы: ванильные ⌛⌚⏳ шириной 8px, а ♥⚡↑ — 6px; чтобы
	// колонки сходились попиксельно, глиф U+E000 нарисован с advance 6.
	private static final FontDescription ICON_FONT = new FontDescription.Resource(
			Identifier.fromNamespaceAndPath("stallium", "icons"));
	private static final String TIMER_GLYPH = "\uE000";

	public record Label(AbstractHorse horse, List<Component> linesBottomUp) {}

	private static List<Label> labels = List.of();
	private static Component hudStats;
	private static int bestId = -1;
	private static int breedingPairFirstId = -1;
	private static int breedingPairSecondId = -1;

	private HorseTracker() {}

	public static List<Label> labels() {
		return labels;
	}

	public static Component hudStats() {
		return hudStats;
	}

	/** Лучшая ли это лошадь поблизости — управляет ванильной обводкой. */
	public static boolean isBestHorse(Entity entity) {
		return bestId != -1 && entity.getId() == bestId;
	}

	public static void tick(Minecraft minecraft) {
		GrowthTracker.tick(minecraft);
		LocalPlayer player = minecraft.player;
		if (player == null || minecraft.level == null) {
			clear();
			return;
		}

		StalliumConfig config = StalliumConfig.get();
		double trackRadius = Math.max(TRACK_RADIUS, config.labelRadius);

		AbstractHorse ridden = player.getVehicle() instanceof AbstractHorse vehicle ? vehicle : null;
		HorseInfo riddenInfo = ridden != null ? HorseInfo.of(ridden) : null;

		Map<AbstractHorse, HorseInfo> nearby = new LinkedHashMap<>();
		for (Entity entity : minecraft.level.entitiesForRendering()) {
			if (entity instanceof AbstractHorse horse && !horse.isRemoved()
					&& horse.distanceToSqr(player) <= trackRadius * trackRadius) {
				nearby.put(horse, HorseInfo.of(horse));
			}
		}

		AbstractHorse best = null;
		HorseInfo bestInfo = null;
		int contenders = 0;
		for (Map.Entry<AbstractHorse, HorseInfo> entry : nearby.entrySet()) {
			HorseInfo info = entry.getValue();
			if (!info.rideable() || info.baby()) {
				continue;
			}
			contenders++;
			if (bestInfo == null || info.score() > bestInfo.score()) {
				best = entry.getKey();
				bestInfo = info;
			}
		}

		// Обводка: не верхом — у лучшей, когда есть из чего выбирать; верхом —
		// только у той, что заметно лучше нашей.
		if (best == null) {
			bestId = -1;
		} else if (ridden == null) {
			bestId = contenders >= 2 ? best.getId() : -1;
		} else {
			bestId = best != ridden && bestInfo.score() > riddenInfo.score() + SCORE_EPSILON
					? best.getId() : -1;
		}

		updateBreedingPair(nearby, config);

		// Цифры после полосок: по Shift — у всех (пешком; верхом Shift спешивает),
		// у лошади под прицелом — всегда; при выключенных полосках — у всех.
		boolean allNumbers = !config.showBars || (ridden == null && player.isShiftKeyDown());
		AbstractHorse aimed = config.hoverNumbers
				? pickAimedHorse(player, nearby.keySet(), ridden, config.labelRadius) : null;

		List<Label> newLabels = new ArrayList<>();
		if (config.showLabels) {
			double labelRadiusSq = (double) config.labelRadius * config.labelRadius;
			for (Map.Entry<AbstractHorse, HorseInfo> entry : nearby.entrySet()) {
				AbstractHorse horse = entry.getKey();
				if (horse == ridden || horse.distanceToSqr(player) > labelRadiusSq) {
					continue;
				}
				boolean numbers = allNumbers || horse == aimed;
				newLabels.add(new Label(horse, buildLines(horse, entry.getValue(), numbers, config, minecraft)));
			}
		}
		labels = newLabels;

		if (ridden != null) {
			boolean riddenIsBest = contenders >= 2 && best == ridden;
			hudStats = buildHudStats(riddenInfo, riddenIsBest, isBreedingPair(ridden), config);
		} else {
			hudStats = null;
		}
	}

	/** Пара взрослых лошадей (или ослов) с лучшим ожидаемым жеребёнком. */
	private static void updateBreedingPair(Map<AbstractHorse, HorseInfo> nearby, StalliumConfig config) {
		breedingPairFirstId = -1;
		breedingPairSecondId = -1;
		if (!config.breedingHints) {
			return;
		}

		List<Map.Entry<AbstractHorse, HorseInfo>> candidates = nearby.entrySet().stream()
				.filter(entry -> entry.getValue().breedable() && !entry.getValue().baby())
				.toList();

		double bestScore = -1.0;
		for (int i = 0; i < candidates.size(); i++) {
			for (int j = i + 1; j < candidates.size(); j++) {
				AbstractHorse first = candidates.get(i).getKey();
				AbstractHorse second = candidates.get(j).getKey();
				// потомство со статами — только внутри вида (лошадь×осёл даёт бесплодного мула)
				if (first.getClass() != second.getClass()) {
					continue;
				}
				double score = Breeding.expectedFoalScore(candidates.get(i).getValue(), candidates.get(j).getValue());
				if (score > bestScore) {
					bestScore = score;
					breedingPairFirstId = first.getId();
					breedingPairSecondId = second.getId();
				}
			}
		}
	}

	private static boolean isBreedingPair(AbstractHorse horse) {
		int id = horse.getId();
		return id == breedingPairFirstId || id == breedingPairSecondId;
	}

	/** Лошадь на линии взгляда (до радиуса надписей), ближайшая по лучу. */
	private static AbstractHorse pickAimedHorse(LocalPlayer player, Iterable<AbstractHorse> horses,
			AbstractHorse exclude, double maxDistance) {
		Vec3 eye = player.getEyePosition();
		Vec3 end = eye.add(player.getViewVector(1.0F).scale(maxDistance));
		AbstractHorse aimed = null;
		double closest = Double.MAX_VALUE;
		for (AbstractHorse horse : horses) {
			if (horse == exclude) {
				continue;
			}
			var hit = horse.getBoundingBox().inflate(0.25).clip(eye, end);
			if (hit.isPresent()) {
				double distance = eye.distanceToSqr(hit.get());
				if (distance < closest) {
					closest = distance;
					aimed = horse;
				}
			}
		}
		return aimed;
	}

	private static void clear() {
		labels = List.of();
		hudStats = null;
		bestId = -1;
		breedingPairFirstId = -1;
		breedingPairSecondId = -1;
	}

	/**
	 * Строки снизу вверх: скорость и прыжок; над ними здоровье (шириной с блок
	 * скорости) и — у жеребят — таймер роста ⌛ ровно над блоком прыжка; у
	 * взрослых полоска здоровья тянется на всю ширину. У лучшей — ★ короной:
	 * <pre>
	 *            ★
	 * ♥ ||||‖··  ⌛ ||||‖···
	 * ⚡ ||||||‖··  ↑ ||||‖···
	 * </pre>
	 * Иконка здоровья — ♥; у пары для разведения она фиолетовая. По Shift
	 * после полосок дописываются точные числа.
	 */
	private static List<Component> buildLines(AbstractHorse horse, HorseInfo info, boolean numbers,
			StalliumConfig config, Minecraft minecraft) {
		boolean bars = config.showBars;

		MutableComponent speedPart = statPart(icon("⚡", ChatFormatting.YELLOW), ChatFormatting.YELLOW,
				bars, numbers, format(info.speedBps()), info.normSpeed(), BAR_SEGMENTS);
		MutableComponent jumpPart = info.rideable()
				? statPart(icon("↑", ChatFormatting.GREEN), ChatFormatting.GREEN, bars, numbers,
						format(info.jumpBlocks()), info.normJump(), BAR_SEGMENTS)
				: null;
		MutableComponent lower = Component.empty().append(speedPart);
		if (jumpPart != null) {
			lower.append("  ").append(jumpPart);
		}

		ChatFormatting healthColor = config.breedingHints && isBreedingPair(horse)
				? ChatFormatting.LIGHT_PURPLE : ChatFormatting.RED;
		String healthValue = formatWhole(info.maxHealth());
		Integer growthLeft = GrowthTracker.remainingTicks(horse, minecraft);

		MutableComponent upper;
		if (growthLeft != null && jumpPart != null) {
			// жеребёнок: здоровье — шириной с блок скорости, таймер — с блок прыжка
			upper = statPartMatched(minecraft, minecraft.font.width(speedPart), icon("♥", healthColor),
					healthColor, bars, numbers, healthValue, info.normHealth());
			double growthNorm = 1.0 - Math.min(1.0, growthLeft / (double) GrowthTracker.FULL_GROWTH_TICKS);
			upper.append("  ").append(statPartMatched(minecraft, minecraft.font.width(jumpPart), timerIcon(),
					ChatFormatting.AQUA, bars, numbers, formatTime(growthLeft), growthNorm));
		} else {
			// взрослая: полоска здоровья тянется до ширины нижнего ряда
			upper = statPartMatched(minecraft, minecraft.font.width(lower), icon("♥", healthColor),
					healthColor, bars, numbers, healthValue, info.normHealth());
		}

		if (horse.getId() == bestId) {
			return List.of(lower, upper, Component.literal("★").withStyle(ChatFormatting.GOLD));
		}
		return List.of(lower, upper);
	}

	private static Component icon(String glyph, ChatFormatting color) {
		return Component.literal(glyph + " ").withStyle(color);
	}

	private static Component timerIcon() {
		return Component.empty()
				.append(Component.literal(TIMER_GLYPH)
						.withStyle(style -> style.withColor(ChatFormatting.AQUA).withFont(ICON_FONT)))
				.append(" ");
	}

	private static MutableComponent statPart(Component icon, ChatFormatting barColor, boolean bars,
			boolean numbers, String value, double norm, int segments) {
		MutableComponent part = Component.empty();
		appendStat(part, icon, barColor, bars, numbers, value, norm, segments);
		return part;
	}

	/** Блок стата, полоска которого добирает сегменты до заданной ширины в пикселях. */
	private static MutableComponent statPartMatched(Minecraft minecraft, int targetWidth, Component icon,
			ChatFormatting barColor, boolean bars, boolean numbers, String value, double norm) {
		if (!bars) {
			return statPart(icon, barColor, false, numbers, value, norm, 0);
		}
		int reserved = minecraft.font.width(icon) + (numbers ? minecraft.font.width(" " + value) : 0);
		int segments = Math.max(1, Math.round((targetWidth - reserved) / (float) minecraft.font.width("|")));
		return statPart(icon, barColor, true, numbers, value, norm, segments);
	}

	private static String formatTime(int ticks) {
		int seconds = (ticks + 19) / 20;
		return String.format(Locale.ROOT, "%d:%02d", seconds / 60, seconds % 60);
	}

	private static void appendStat(MutableComponent line, Component icon, ChatFormatting barColor,
			boolean bars, boolean numbers, String value, double norm, int segments) {
		line.append(icon);
		if (bars) {
			appendBar(line, norm, barColor, segments);
		}
		if (numbers) {
			if (bars) {
				line.append(" ");
			}
			line.append(Component.literal(value).withStyle(ChatFormatting.WHITE));
		}
	}

	/** HUD своей лошади: ★ (золотая — ваша лучшая рядом), затем здоровье, скорость, прыжок. */
	private static Component buildHudStats(HorseInfo info, boolean best, boolean breedingPair,
			StalliumConfig config) {
		MutableComponent line = Component.empty();
		line.append(Component.literal("★ ")
				.withStyle(best ? ChatFormatting.GOLD : ChatFormatting.DARK_GRAY));
		ChatFormatting healthColor = config.breedingHints && breedingPair
				? ChatFormatting.LIGHT_PURPLE : ChatFormatting.RED;
		appendStat(line, icon("♥", healthColor), healthColor, config.showBars, true,
				formatWhole(info.maxHealth()), info.normHealth(), BAR_SEGMENTS);
		line.append("  ");
		appendStat(line, icon("⚡", ChatFormatting.YELLOW), ChatFormatting.YELLOW, config.showBars, true,
				format(info.speedBps()), info.normSpeed(), BAR_SEGMENTS);
		line.append("  ");
		appendStat(line, icon("↑", ChatFormatting.GREEN), ChatFormatting.GREEN, config.showBars, true,
				format(info.jumpBlocks()), info.normJump(), BAR_SEGMENTS);
		return line;
	}

	/** Полоска доли от максимума спавна, заполнение — цветом стата. */
	private static void appendBar(MutableComponent line, double norm, ChatFormatting color, int segments) {
		int filled = (int) Math.round(Math.clamp(norm, 0.0, 1.0) * segments);
		if (filled > 0) {
			line.append(Component.literal("|".repeat(filled)).withStyle(color));
		}
		if (filled < segments) {
			line.append(Component.literal("|".repeat(segments - filled)).withStyle(ChatFormatting.DARK_GRAY));
		}
	}

	private static String format(double value) {
		return String.format(Locale.ROOT, "%.1f", value);
	}

	private static String formatWhole(float value) {
		return String.format(Locale.ROOT, "%.0f", value);
	}
}
