import { contrast, ensureContrast, luminance, mix, normalizeHex, readableOn, withAlpha } from "./color";
import { DEFAULT_PRESET, findPreset, presetPalette, type Variant } from "./theme-presets";

export type { Variant } from "./theme-presets";
export type ThemeMode = "system" | "light" | "dark";

/** One slot: the theme used whenever the app is dark, or whenever it is light. */
export interface SlotTheme {
  preset: string;
  accent: string;
  background: string;
  foreground: string;
  /** CSS font families; empty uses Geist. */
  uiFont: string;
  codeFont: string;
  window: "solid" | "translucent";
  sidebarOnly: boolean;
  /** 30–100. How much of the background color covers what's behind the window. */
  opacity: number;
  /** 0–64, or null to follow opacity. */
  blur: number | null;
  /** 0–100. Extra separation between surfaces, borders and secondary text. */
  contrast: number;
}

export interface Appearance {
  mode: ThemeMode;
  dark: SlotTheme;
  light: SlotTheme;
}

export const OPACITY_MIN = 30;
export const BLUR_MAX = 64;

export function presetSlot(preset: string, variant: Variant): SlotTheme {
  const id = findPreset(preset)?.[variant] ? preset : DEFAULT_PRESET;
  const { accent, background, foreground } = presetPalette(id, variant);
  return { preset: id, accent, background, foreground, uiFont: "", codeFont: "", window: "solid", sidebarOnly: false, opacity: 90, blur: null, contrast: 0 };
}

export const DEFAULT_APPEARANCE: Appearance = { mode: "dark", dark: presetSlot(DEFAULT_PRESET, "dark"), light: presetSlot(DEFAULT_PRESET, "light") };

/** Picking a preset swaps the colors and keeps the fonts, window and contrast you set. */
export function applyPreset(slot: SlotTheme, preset: string, variant: Variant): SlotTheme {
  const { preset: id, accent, background, foreground } = presetSlot(preset, variant);
  return { ...slot, preset: id, accent, background, foreground };
}

export function isCustomized(slot: SlotTheme, variant: Variant): boolean {
  const base = presetSlot(slot.preset, variant);
  return (Object.keys(base) as Array<keyof SlotTheme>).some((key) => base[key] !== slot[key]);
}

/** Systo's own colors, untouched: the stylesheet already has them. */
function usesStylesheetColors(slot: SlotTheme, variant: Variant): boolean {
  const base = presetPalette(DEFAULT_PRESET, variant);
  return slot.contrast === 0 && slot.accent === base.accent && slot.background === base.background && slot.foreground === base.foreground;
}

export function autoBlur(opacity: number): number {
  return Math.min(BLUR_MAX, Math.round(16 + (100 - opacity) * 0.8));
}

export function slotBlur(slot: SlotTheme): number {
  return slot.blur ?? autoBlur(slot.opacity);
}

// ── Validation ───────────────────────────────────────────────────────────────────────────────

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value))) : fallback;

/** A font-family list only: names, quotes, commas. Nothing that could end the CSS declaration. */
export function sanitizeFont(value: unknown): string {
  if (typeof value !== "string") return "";
  const families = value
    .slice(0, 200)
    .split(",")
    .map((name) => name.replace(/[^\p{L}\p{N} ._-]/gu, "").trim())
    .filter(Boolean);
  return families.map((name) => (GENERIC_FONTS.has(name.toLowerCase()) ? name.toLowerCase() : `"${name}"`)).join(", ");
}

export const GENERIC_FONTS = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "-apple-system"]);

export function sanitizeSlot(value: unknown, variant: Variant): SlotTheme {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const base = presetSlot(typeof v.preset === "string" ? v.preset : DEFAULT_PRESET, variant);
  return {
    preset: base.preset,
    accent: normalizeHex(v.accent) ?? base.accent,
    background: normalizeHex(v.background) ?? base.background,
    foreground: normalizeHex(v.foreground) ?? base.foreground,
    uiFont: sanitizeFont(v.uiFont),
    codeFont: sanitizeFont(v.codeFont),
    window: v.window === "translucent" ? "translucent" : "solid",
    sidebarOnly: v.sidebarOnly === true,
    opacity: clamp(v.opacity, OPACITY_MIN, 100, base.opacity),
    blur: v.blur === null || v.blur === undefined ? null : clamp(v.blur, 0, BLUR_MAX, 0),
    contrast: clamp(v.contrast, 0, 100, base.contrast),
  };
}

export function sanitizeAppearance(value: unknown): Appearance {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    mode: v.mode === "light" || v.mode === "system" ? v.mode : "dark",
    dark: sanitizeSlot(v.dark, "dark"),
    light: sanitizeSlot(v.light, "light"),
  };
}

// ── Deriving the interface colors ────────────────────────────────────────────────────────────

const DANGER: Record<Variant, string> = { dark: "#ff6b6b", light: "#d1242f" };

/** Every color token in globals.css, worked out from accent, background, foreground and contrast. */
export function deriveTokens(slot: SlotTheme, variant: Variant): Record<string, string> {
  const { accent, background: bg, foreground: fg } = slot;
  const dark = variant === "dark";
  const c = slot.contrast / 100;
  /** A step from the background toward the text, wider as contrast goes up. */
  const step = (amount: number) => mix(bg, fg, amount * (1 + c * 1.2));
  const tint = (color: string, amount: number) => mix(color, accent, amount);

  const card = dark ? step(0.035) : luminance(bg) > 0.97 ? bg : mix(bg, "#ffffff", 0.55);
  const popover = dark ? step(0.055) : luminance(bg) > 0.97 ? bg : mix(bg, "#ffffff", 0.7);
  const muted = step(dark ? 0.07 : 0.04);
  const hover = tint(step(dark ? 0.085 : 0.055), 0.07);
  const surfaces = [bg, card, muted];
  // Secondary text reaches 4.5:1 unless the theme's own text is softer than that.
  const ceiling = Math.min(...surfaces.map((s) => contrast(fg, s)));
  const mutedTarget = Math.min(4.5 + c * 2.5, Math.max(3, ceiling * 0.88));
  const mutedForeground = ensureContrast(mix(bg, fg, 0.56 + c * 0.2), surfaces, mutedTarget, fg);
  const primary = ensureContrast(accent, [bg], 1.6, fg);
  const danger = findPreset(slot.preset)?.[variant]?.danger ?? DANGER[variant];

  return {
    background: bg,
    foreground: fg,
    card,
    "card-foreground": fg,
    popover,
    "popover-foreground": fg,
    primary,
    "primary-foreground": readableOn(primary),
    secondary: muted,
    "secondary-foreground": fg,
    muted,
    "muted-foreground": mutedForeground,
    accent: hover,
    "accent-foreground": fg,
    destructive: danger,
    "destructive-foreground": readableOn(danger),
    border: withAlpha(fg, (dark ? 0.1 : 0.12) + c * 0.22),
    input: withAlpha(fg, (dark ? 0.15 : 0.18) + c * 0.25),
    ring: primary,
    sidebar: dark ? mix(bg, "#000000", luminance(bg) < 0.004 ? 0 : 0.22) : step(0.022),
    heat: ensureContrast(accent, [bg], 2, fg),
    data: ensureContrast(accent, [bg, card], 3, fg),
  };
}

function fontTokens(slot: SlotTheme): Record<string, string> {
  return {
    ...(slot.uiFont ? { "ui-font": slot.uiFont } : {}),
    ...(slot.codeFont ? { "code-font": slot.codeFont } : {}),
  };
}

/** Tokens a slot changes from the stylesheet. */
export function slotTokens(slot: SlotTheme, variant: Variant): Record<string, string> {
  return { ...(usesStylesheetColors(slot, variant) ? {} : deriveTokens(slot, variant)), ...fontTokens(slot) };
}

const declare = (tokens: Record<string, string>) =>
  Object.entries(tokens)
    .map(([name, value]) => `--${name}:${value};`)
    .join("");

/**
 * Both slots as CSS, so light and dark switch on `data-theme` alone. Values are sanitized hex
 * colors and font names, never raw user text.
 */
export function appearanceCss(appearance: Appearance): string {
  const rule = (selector: string, slot: SlotTheme, variant: Variant) => {
    const body = declare(slotTokens(slot, variant));
    return body ? `${selector}{${body}}` : "";
  };
  return rule(`html:not([data-theme="dark"])`, appearance.light, "light") + rule(`html[data-theme="dark"]`, appearance.dark, "dark");
}

/** The island is always black, so it borrows only the dark slot's accent. Null keeps it white. */
export function islandTint(appearance: Appearance): string | null {
  const slot = appearance.dark;
  if (slot.accent === presetPalette(DEFAULT_PRESET, "dark").accent) return null;
  return ensureContrast(slot.accent, ["#000000"], 4.5, "#ffffff");
}

// ── Sharing ──────────────────────────────────────────────────────────────────────────────────

const SHARE_PREFIX = "systo-theme-v1:";

export function exportTheme(slot: SlotTheme, variant: Variant): string {
  return SHARE_PREFIX + JSON.stringify({ variant, theme: slot });
}

export interface ImportedTheme {
  slot: SlotTheme;
  /** The kind of theme it was copied from, if it says. */
  variant: Variant | null;
}

/** Reads a theme copied from Systo, or bare JSON with at least one of the three colors. */
export function importTheme(text: string, variant: Variant): ImportedTheme | { error: string } {
  const raw = text.trim();
  if (!raw) return { error: "Paste a theme first." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.startsWith(SHARE_PREFIX) ? raw.slice(SHARE_PREFIX.length) : raw);
  } catch {
    return { error: "That isn't a theme. Copy one from Systo and paste all of it." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: "That isn't a theme. Copy one from Systo and paste all of it." };
  const outer = parsed as Record<string, unknown>;
  const theme = (outer.theme && typeof outer.theme === "object" ? outer.theme : outer) as Record<string, unknown>;
  const colors = (["accent", "background", "foreground"] as const).filter((key) => theme[key] !== undefined);
  if (!colors.length) return { error: "This theme has no accent, background or foreground color." };
  const bad = colors.find((key) => !normalizeHex(theme[key]));
  if (bad) return { error: `The ${bad} color isn't a hex value like #E6B450.` };
  return {
    slot: sanitizeSlot(theme, variant),
    variant: outer.variant === "dark" || outer.variant === "light" ? outer.variant : null,
  };
}
