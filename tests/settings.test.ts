import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootScript } from "../src/lib/server/appearance";
import { loadSettings, patchSettings } from "../src/lib/server/settings";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { DEFAULT_APPEARANCE } from "../src/lib/theme";

const temp = () => join(mkdtempSync(join(tmpdir(), "systo-settings-")), "settings.json");

test("settings survive, and each window's changes are merged", () => {
  const file = temp();
  expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS);
  patchSettings({ interval: 0, heatmap: false }, file);
  patchSettings({ islandMetric: "network" }, file);
  expect(loadSettings(file)).toEqual({ ...DEFAULT_SETTINGS, interval: 0, heatmap: false, islandMetric: "network" });
});

test("bad values and broken files fall back to defaults", () => {
  const file = temp();
  expect(patchSettings({ interval: 1, cpuMode: "x", colorIcons: "yes", dismissedLogins: ["a", 3, "a"], extra: 1 }, file)).toEqual({ ...DEFAULT_SETTINGS, dismissedLogins: ["a"] });
  writeFileSync(file, "{broken");
  expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS);
});

test("the boot script hands the saved settings to the page", () => {
  expect(bootScript(DEFAULT_APPEARANCE, { ...DEFAULT_SETTINGS, interval: 5000 })).toContain('"interval":5000');
});
