package com.kraineff.stallium.render;

import com.kraineff.stallium.stats.HorseTracker;
import com.mojang.blaze3d.vertex.PoseStack;
import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;
import java.util.List;
import net.fabricmc.fabric.api.client.rendering.v1.level.LevelRenderContext;
import net.fabricmc.fabric.api.client.rendering.v1.level.LevelRenderEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.OrderedSubmitNodeCollector;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.state.level.CameraRenderState;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.EntityAttachment;
import net.minecraft.world.entity.animal.equine.AbstractHorse;
import net.minecraft.world.phys.Vec3;

/**
 * Рисует блок статов над лошадьми тем же способом, каким ваниль рисует ники:
 * {@link SubmitNodeCollector#submitNameTag} строка за строкой снизу вверх.
 */
public final class HorseLabels {
	// Шаг строки ника из EntityRenderer.submitNameDisplay: 9px × 1.15 × 0.025.
	private static final float LINE_STEP = 9.0F * 1.15F * 0.025F;

	// В 26.1 submitNameTag принимает distanceToCameraSq, с 26.2 — нет;
	// сигнатура определяется в рантайме, чтобы один JAR работал везде.
	private static final MethodHandle SUBMIT_NAME_TAG;
	private static final boolean NAME_TAG_TAKES_DISTANCE;

	static {
		MethodHandles.Lookup lookup = MethodHandles.publicLookup();
		MethodHandle handle;
		boolean takesDistance;
		try {
			handle = lookup.findVirtual(OrderedSubmitNodeCollector.class, "submitNameTag",
					MethodType.methodType(void.class, PoseStack.class, Vec3.class, int.class,
							Component.class, boolean.class, int.class, double.class, CameraRenderState.class));
			takesDistance = true;
		} catch (ReflectiveOperationException e) {
			try {
				handle = lookup.findVirtual(OrderedSubmitNodeCollector.class, "submitNameTag",
						MethodType.methodType(void.class, PoseStack.class, Vec3.class, int.class,
								Component.class, boolean.class, int.class, CameraRenderState.class));
				takesDistance = false;
			} catch (ReflectiveOperationException e2) {
				throw new IllegalStateException("Unsupported submitNameTag signature", e2);
			}
		}
		SUBMIT_NAME_TAG = handle;
		NAME_TAG_TAKES_DISTANCE = takesDistance;
	}

	private HorseLabels() {}

	private static void submitLine(SubmitNodeCollector collector, PoseStack poseStack, Vec3 attachment,
			Component line, int light, double distanceSq, CameraRenderState camera) {
		try {
			if (NAME_TAG_TAKES_DISTANCE) {
				SUBMIT_NAME_TAG.invoke(collector, poseStack, attachment, 0, line, true, light, distanceSq, camera);
			} else {
				SUBMIT_NAME_TAG.invoke(collector, poseStack, attachment, 0, line, true, light, camera);
			}
		} catch (Throwable t) {
			throw new IllegalStateException("submitNameTag failed", t);
		}
	}

	public static void register() {
		LevelRenderEvents.COLLECT_SUBMITS.register(HorseLabels::collectSubmits);
	}

	private static void collectSubmits(LevelRenderContext context) {
		List<HorseTracker.Label> labels = HorseTracker.labels();
		if (labels.isEmpty()) {
			return;
		}

		Minecraft minecraft = Minecraft.getInstance();
		if (minecraft.level == null) {
			return;
		}

		CameraRenderState camera = context.levelState().cameraRenderState;
		Vec3 cameraPos = camera.pos;
		PoseStack poseStack = context.poseStack();
		SubmitNodeCollector collector = context.submitNodeCollector();

		for (HorseTracker.Label label : labels) {
			AbstractHorse horse = label.horse();
			if (horse.isRemoved()) {
				continue;
			}

			float partialTick = minecraft.getDeltaTracker()
					.getGameTimeDeltaPartialTick(!minecraft.level.tickRateManager().isEntityFrozen(horse));
			double x = Mth.lerp(partialTick, horse.xOld, horse.getX()) - cameraPos.x;
			double y = Mth.lerp(partialTick, horse.yOld, horse.getY()) - cameraPos.y;
			double z = Mth.lerp(partialTick, horse.zOld, horse.getZ()) - cameraPos.z;

			Vec3 attachment = horse.getAttachments()
					.getNullable(EntityAttachment.NAME_TAG, 0, horse.getYRot(partialTick));
			if (attachment == null) {
				attachment = new Vec3(0.0, horse.getBbHeight() + 0.5, 0.0);
			}

			int light = minecraft.getEntityRenderDispatcher().getPackedLightCoords(horse, partialTick);
			double distanceSq = cameraPos.distanceToSqr(horse.position());

			poseStack.pushPose();
			poseStack.translate(x, y, z);
			// Ванильный ник (кастомное имя) занимает нижнюю строку — уступаем её.
			if (horse.hasCustomName()) {
				poseStack.translate(0.0F, LINE_STEP, 0.0F);
			}

			for (Component line : label.linesBottomUp()) {
				submitLine(collector, poseStack, attachment, line, light, distanceSq, camera);
				poseStack.translate(0.0F, LINE_STEP, 0.0F);
			}
			poseStack.popPose();
		}
	}
}
