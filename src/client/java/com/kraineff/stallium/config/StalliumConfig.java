package com.kraineff.stallium.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Настройки мода; хранятся в config/stallium.json. */
public class StalliumConfig {
	private static final Logger log = LoggerFactory.getLogger("com.kraineff.stallium.StalliumConfig");
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static StalliumConfig instance;

	public boolean showLabels = true;
	public int labelRadius = 32;
	public boolean highlightBest = true;
	public boolean showBars = true;
	public boolean hoverNumbers = true;
	public boolean breedingHints = false;

	public static StalliumConfig get() {
		if (instance == null) {
			instance = load();
		}
		return instance;
	}

	private static Path path() {
		return FabricLoader.getInstance().getConfigDir().resolve("stallium.json");
	}

	private static StalliumConfig load() {
		Path path = path();
		if (Files.exists(path)) {
			try {
				StalliumConfig config = GSON.fromJson(Files.readString(path), StalliumConfig.class);
				if (config != null) {
					config.clampValues();
					return config;
				}
			} catch (IOException | RuntimeException e) {
				log.warn("Config unreadable, using defaults: {}", path, e);
			}
		}
		return new StalliumConfig();
	}

	public void save() {
		try {
			clampValues();
			Files.writeString(path(), GSON.toJson(this));
		} catch (IOException e) {
			log.warn("Config not saved: {}", path(), e);
		}
	}

	private void clampValues() {
		labelRadius = Math.clamp(labelRadius, 8, 64);
	}
}
