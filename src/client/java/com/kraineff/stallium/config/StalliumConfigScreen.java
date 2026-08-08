package com.kraineff.stallium.config;

import com.kraineff.stallium.compat.ScreenCompat;
import net.minecraft.client.gui.components.AbstractSliderButton;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.CycleButton;
import net.minecraft.client.gui.components.StringWidget;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;
import org.jspecify.annotations.Nullable;

/** Простой экран настроек на ванильных виджетах. */
public class StalliumConfigScreen extends Screen {
	private static final int WIDGET_WIDTH = 210;
	private static final int WIDGET_HEIGHT = 20;
	private static final int ROW_STEP = 24;

	private final @Nullable Screen parent;
	private final StalliumConfig config = StalliumConfig.get();

	public StalliumConfigScreen(@Nullable Screen parent) {
		super(Component.translatable("screen.stallium.title"));
		this.parent = parent;
	}

	@Override
	protected void init() {
		int x = (this.width - WIDGET_WIDTH) / 2;
		int y = this.height / 6;

		this.addRenderableWidget(new StringWidget((this.width - this.font.width(this.title)) / 2, y - 14,
				this.font.width(this.title), 9, this.title, this.font));

		this.addRenderableWidget(CycleButton.onOffBuilder(config.showLabels)
				.create(x, y += ROW_STEP, WIDGET_WIDTH, WIDGET_HEIGHT,
						Component.translatable("screen.stallium.show_labels"),
						(button, value) -> config.showLabels = value));

		this.addRenderableWidget(new RadiusSlider(x, y += ROW_STEP));

		this.addRenderableWidget(CycleButton.onOffBuilder(config.highlightBest)
				.create(x, y += ROW_STEP, WIDGET_WIDTH, WIDGET_HEIGHT,
						Component.translatable("screen.stallium.highlight_best"),
						(button, value) -> config.highlightBest = value));

		this.addRenderableWidget(CycleButton.onOffBuilder(config.showBars)
				.create(x, y += ROW_STEP, WIDGET_WIDTH, WIDGET_HEIGHT,
						Component.translatable("screen.stallium.show_bars"),
						(button, value) -> config.showBars = value));

		this.addRenderableWidget(CycleButton.onOffBuilder(config.hoverNumbers)
				.create(x, y += ROW_STEP, WIDGET_WIDTH, WIDGET_HEIGHT,
						Component.translatable("screen.stallium.hover_numbers"),
						(button, value) -> config.hoverNumbers = value));

		this.addRenderableWidget(CycleButton.onOffBuilder(config.breedingHints)
				.create(x, y += ROW_STEP, WIDGET_WIDTH, WIDGET_HEIGHT,
						Component.translatable("screen.stallium.breeding_hints"),
						(button, value) -> config.breedingHints = value));

		this.addRenderableWidget(Button.builder(CommonComponents.GUI_DONE, button -> this.onClose())
				.bounds(x, y + ROW_STEP + 6, WIDGET_WIDTH, WIDGET_HEIGHT)
				.build());
	}

	@Override
	public void onClose() {
		config.save();
		assert this.minecraft != null;
		ScreenCompat.open(this.minecraft, this.parent);
	}

	private class RadiusSlider extends AbstractSliderButton {
		private static final int MIN = 8, MAX = 64;

		RadiusSlider(int x, int y) {
			super(x, y, WIDGET_WIDTH, WIDGET_HEIGHT, Component.empty(),
					(StalliumConfigScreen.this.config.labelRadius - MIN) / (double) (MAX - MIN));
			updateMessage();
		}

		@Override
		protected void updateMessage() {
			setMessage(Component.translatable("screen.stallium.label_radius", config.labelRadius));
		}

		@Override
		protected void applyValue() {
			config.labelRadius = MIN + (int) Math.round(this.value * (MAX - MIN));
		}
	}
}
