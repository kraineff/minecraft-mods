package com.kraineff.stallium.compat;

import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.screens.Screen;
import org.jspecify.annotations.Nullable;

/**
 * Открытие экранов: в 26.1 — {@code Minecraft.setScreen} и поле
 * {@code Minecraft.screen}, с 26.2 — {@code Gui.setScreen}/{@code Gui.screen()}.
 * Сигнатура определяется в рантайме, чтобы один JAR работал везде.
 */
public final class ScreenCompat {
	private static final @Nullable MethodHandle MINECRAFT_SET_SCREEN = find(
			Minecraft.class, "setScreen", MethodType.methodType(void.class, Screen.class));
	private static final @Nullable MethodHandle MINECRAFT_GET_SCREEN = findGetter();
	private static final @Nullable MethodHandle GUI_SET_SCREEN = find(
			Gui.class, "setScreen", MethodType.methodType(void.class, Screen.class));
	private static final @Nullable MethodHandle GUI_GET_SCREEN = find(
			Gui.class, "screen", MethodType.methodType(Screen.class));

	private ScreenCompat() {}

	public static void open(Minecraft minecraft, @Nullable Screen screen) {
		try {
			if (MINECRAFT_SET_SCREEN != null) {
				MINECRAFT_SET_SCREEN.invoke(minecraft, screen);
			} else if (GUI_SET_SCREEN != null) {
				GUI_SET_SCREEN.invoke(minecraft.gui, screen);
			} else {
				throw new IllegalStateException("No setScreen method found");
			}
		} catch (Throwable t) {
			throw new IllegalStateException("setScreen failed", t);
		}
	}

	public static @Nullable Screen current(Minecraft minecraft) {
		try {
			if (MINECRAFT_GET_SCREEN != null) {
				return (Screen) MINECRAFT_GET_SCREEN.invoke(minecraft);
			}
			if (GUI_GET_SCREEN != null) {
				return (Screen) GUI_GET_SCREEN.invoke(minecraft.gui);
			}
			return null;
		} catch (Throwable t) {
			throw new IllegalStateException("screen lookup failed", t);
		}
	}

	private static @Nullable MethodHandle find(Class<?> owner, String name, MethodType type) {
		try {
			return MethodHandles.publicLookup().findVirtual(owner, name, type);
		} catch (ReflectiveOperationException e) {
			return null;
		}
	}

	private static @Nullable MethodHandle findGetter() {
		try {
			return MethodHandles.publicLookup().findGetter(Minecraft.class, "screen", Screen.class);
		} catch (ReflectiveOperationException e) {
			return null;
		}
	}
}
