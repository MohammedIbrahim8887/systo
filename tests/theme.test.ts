import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contrast, hexToHsv, hsvToHex, mix, normalizeHex } from "../src/lib/color";
import { bootScript, loadAppearance, saveAppearance } from "../src/lib/server/appearance";
import { appearanceCss, applyPreset, DEFAULT_APPEARANCE, deriveTokens, exportTheme, importTheme, isCustomized, islandTint, presetSlot, sanitizeFont, slotTokens } from "../src/lib/theme";
import { presetsFor, THEME_PRESETS, type Variant } from "../src/lib/theme-presets";

const all = (["dark", "light"] as Variant[]).flatMap((variant) => presetsFor(variant).map((preset) => ({ preset, variant, slot: presetSlot(preset.id, variant) })));

test("every requested theme is offered in the dark slot", () => {
  const requested = "Absolutely Ayu Catppuccin Codex Sona Dracula Everforest GitHub Gruvbox Linear Lobster Material Matrix Monokai Night_Owl Nord Notion One Oscurange Raycast Rose_Pine Sentry Solarized Temple Tokyo_Night Vercel VS_Code_Plus";
  expect(presetsFor("dark").map((t) => t.name)).toEqual(["Systo", ...requested.split(" ").map((n) => n.replace(/_/g, " "))]);
  expect(new Set(THEME_PRESETS.map((t) => t.id)).size).toBe(THEME_PRESETS.length);
});

test("Systo's own theme adds no CSS at all", () => {
  expect(appearanceCss(DEFAULT_APPEARANCE)).toBe("");
});

for (const { preset, variant, slot } of all) {
  test(`${preset.name} ${variant} stays readable at every contrast`, () => {
    for (const level of [0, 50, 100]) {
      const t = deriveTokens({ ...slot, contrast: level }, variant);
      for (const value of Object.values(t)) expect(value).toMatch(/^(#[0-9a-f]{6}|rgb\(\d+ \d+ \d+ \/ [\d.]+%\))$/);
      // Softer themes can't give secondary text more than their own text has.
      const floor = Math.min(4.5, contrast(slot.foreground, t.muted) * 0.87);
      for (const surface of [t.background, t.card, t.muted]) expect(contrast(t["muted-foreground"], surface)).toBeGreaterThanOrEqual(Math.max(2.9, floor) - 0.1);
      expect(contrast(t["primary-foreground"], t.primary)).toBeGreaterThanOrEqual(4);
      expect(contrast(t["destructive-foreground"], t.destructive)).toBeGreaterThanOrEqual(4);
      expect(contrast(t.data, t.background)).toBeGreaterThanOrEqual(3);
    }
  });
}

test("colors round-trip and reject junk", () => {
  expect(normalizeHex("E6B")).toBe("#ee66bb");
  expect(normalizeHex("red;}")).toBeNull();
  for (const hex of ["#e6b450", "#000000", "#ffffff", "#1eff5a"]) {
    expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    expect(mix(hex, "#808080", 0)).toBe(hex);
  }
});

test("a preset keeps the fonts and window you set, and counts as customized", () => {
  const slot = applyPreset({ ...presetSlot("systo", "dark"), codeFont: '"Menlo"', contrast: 20 }, "ayu", "dark");
  expect(slot).toMatchObject({ preset: "ayu", accent: "#e6b450", codeFont: '"Menlo"', contrast: 20 });
  expect(isCustomized(slot, "dark")).toBe(true);
  expect(isCustomized(presetSlot("ayu", "dark"), "dark")).toBe(false);
});

test("a dark-only theme can't land in the light slot", () => {
  expect(presetSlot("matrix", "light").preset).toBe("systo");
});

test("themes survive copy and import, and bad ones say why", () => {
  const slot = { ...presetSlot("nord", "dark"), accent: "#123456", blur: 12, opacity: 70 };
  expect(importTheme(exportTheme(slot, "dark"), "dark")).toEqual({ slot, variant: "dark" });
  expect(importTheme('{"accent":"#E6B450"}', "dark")).toMatchObject({ slot: { accent: "#e6b450", preset: "systo" }, variant: null });
  for (const text of ["", "nope", "[]", "{}", '{"accent":"blue"}']) expect(importTheme(text, "dark")).toHaveProperty("error");
});

test("font names can't break out of the stylesheet", () => {
  expect(sanitizeFont("SF Mono, monospace")).toBe('"SF Mono", monospace');
  expect(sanitizeFont('"JetBrains Mono"')).toBe('"JetBrains Mono"');
  const evil = sanitizeFont('x"; } body { display:none } /*');
  expect(evil).not.toMatch(/[;{}*/]/);
  expect(slotTokens({ ...presetSlot("systo", "dark"), uiFont: evil }, "dark")).toEqual({ "ui-font": evil });
});

test("the saved file is sanitized on the way in and out", () => {
  const file = join(mkdtempSync(join(tmpdir(), "systo-theme-")), "appearance.json");
  expect(loadAppearance(file)).toEqual(DEFAULT_APPEARANCE);
  const saved = saveAppearance({ mode: "system", dark: { preset: "ayu", opacity: 4, blur: 900, accent: "</script>" } }, file);
  expect(saved).toMatchObject({ mode: "system", dark: { preset: "ayu", accent: "#e6b450", opacity: 30, blur: 64 } });
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(saved);
  expect(loadAppearance(file)).toEqual(saved);
  new Function(bootScript(saved)); // parses
  writeFileSync(file, "{broken");
  expect(loadAppearance(file)).toEqual(DEFAULT_APPEARANCE);
});

test("the island is tinted only by a colored dark theme, and stays visible on black", () => {
  expect(islandTint(DEFAULT_APPEARANCE)).toBeNull();
  for (const preset of presetsFor("dark").slice(1)) {
    expect(contrast(islandTint({ ...DEFAULT_APPEARANCE, dark: presetSlot(preset.id, "dark") })!, "#000000")).toBeGreaterThanOrEqual(4.5);
  }
});
