export type Variant = "dark" | "light";

export interface Palette {
  accent: string;
  background: string;
  foreground: string;
  /** For destructive actions; a standard red when left out. */
  danger?: string;
}

export interface ThemePreset {
  id: string;
  name: string;
  /** A theme with only one of these is offered only in that slot. */
  dark?: Palette;
  light?: Palette;
}

const p = (accent: string, background: string, foreground: string, danger?: string): Palette => ({ accent, background, foreground, danger });

/** Systo's own monochrome look. Untouched, it uses the stylesheet's values exactly. */
export const DEFAULT_PRESET = "systo";

export const THEME_PRESETS: ThemePreset[] = [
  { id: "systo", name: "Systo", dark: p("#ebebeb", "#0c0c0c", "#f1f1f1"), light: p("#171717", "#ffffff", "#0a0a0a") },
  { id: "absolutely", name: "Absolutely", dark: p("#cc7d5e", "#2d2d2b", "#f9f9f7", "#ff5f38"), light: p("#cc7d5e", "#f9f9f7", "#2d2d2b", "#c9371a") },
  { id: "ayu", name: "Ayu", dark: p("#e6b450", "#0b0e14", "#bfbdb6", "#d95757"), light: p("#f29718", "#f8f9fa", "#5c6166", "#e65050") },
  { id: "catppuccin", name: "Catppuccin", dark: p("#cba6f7", "#1e1e2e", "#cdd6f4", "#f38ba8"), light: p("#8839ef", "#eff1f5", "#4c4f69", "#d20f39") },
  { id: "codex", name: "Codex", dark: p("#339cff", "#181818", "#ffffff", "#fa423e"), light: p("#339cff", "#ffffff", "#1a1c1f", "#ba2623") },
  { id: "sona", name: "Sona", dark: p("#f05a28", "#0d0d0d", "#f2f2f0"), light: p("#c74614", "#ffffff", "#0d0d0d") },
  { id: "dracula", name: "Dracula", dark: p("#ff79c6", "#282a36", "#f8f8f2", "#ff5555"), light: p("#a3144d", "#fffbeb", "#1f1f1f", "#cb3a2a") },
  { id: "everforest", name: "Everforest", dark: p("#a7c080", "#2d353b", "#d3c6aa", "#e67e80"), light: p("#8da101", "#fdf6e3", "#5c6a72", "#f85552") },
  { id: "github", name: "GitHub", dark: p("#1f6feb", "#0d1117", "#e6edf3", "#f85149"), light: p("#0969da", "#ffffff", "#1f2328", "#cf222e") },
  { id: "gruvbox", name: "Gruvbox", dark: p("#458588", "#282828", "#ebdbb2", "#fb4934"), light: p("#458588", "#fbf1c7", "#3c3836", "#cc241d") },
  { id: "linear", name: "Linear", dark: p("#5e6ad2", "#0f0f11", "#e3e4e6", "#eb5757"), light: p("#5e6ad2", "#fcfcfd", "#1b1b1b", "#eb5757") },
  { id: "lobster", name: "Lobster", dark: p("#ff5c5c", "#111827", "#e4e4e7", "#ff5c5c") },
  { id: "material", name: "Material", dark: p("#80cbc4", "#212121", "#eeffff", "#f07178"), light: p("#39adb5", "#fafafa", "#546e7a", "#e53935") },
  { id: "matrix", name: "Matrix", dark: p("#1eff5a", "#040805", "#b8ffca", "#fa423e") },
  { id: "monokai", name: "Monokai", dark: p("#99947c", "#272822", "#f8f8f2", "#f92672"), light: p("#e14775", "#faf4f2", "#29242a", "#e14775") },
  { id: "night-owl", name: "Night Owl", dark: p("#44596b", "#011627", "#d6deeb", "#ef5350"), light: p("#2aa298", "#fbfbfb", "#403f53", "#de3d3b") },
  { id: "nord", name: "Nord", dark: p("#88c0d0", "#2e3440", "#d8dee9", "#bf616a"), light: p("#5e81ac", "#eceff4", "#2e3440", "#bf616a") },
  { id: "notion", name: "Notion", dark: p("#3183d8", "#191919", "#d9d9d8", "#fa423e"), light: p("#3183d8", "#ffffff", "#37352f", "#ba2623") },
  { id: "one", name: "One", dark: p("#4d78cc", "#282c34", "#abb2bf", "#e06c75"), light: p("#526fff", "#fafafa", "#383a42", "#e45649") },
  { id: "oscurange", name: "Oscurange", dark: p("#f9b98c", "#0b0b0f", "#e6e6e6", "#fa423e") },
  { id: "raycast", name: "Raycast", dark: p("#ff6363", "#101010", "#fefefe", "#ff6363"), light: p("#ff6363", "#ffffff", "#030303", "#b12424") },
  { id: "rose-pine", name: "Rose Pine", dark: p("#ea9a97", "#232136", "#e0def4", "#eb6f92"), light: p("#d7827e", "#faf4ed", "#575279", "#b4637a") },
  { id: "sentry", name: "Sentry", dark: p("#7055f6", "#2d2935", "#e6dff9", "#fa423e") },
  { id: "solarized", name: "Solarized", dark: p("#d30102", "#002b36", "#839496", "#dc322f"), light: p("#b58900", "#fdf6e3", "#657b83", "#dc322f") },
  { id: "temple", name: "Temple", dark: p("#e4f222", "#02120c", "#c7e6da", "#ff6f61") },
  { id: "tokyo-night", name: "Tokyo Night", dark: p("#3d59a1", "#1a1b26", "#a9b1d6", "#f7768e"), light: p("#2e7de9", "#e1e2e7", "#3760bf", "#f52a65") },
  { id: "vercel", name: "Vercel", dark: p("#006efe", "#000000", "#ededed", "#f13342"), light: p("#006aff", "#ffffff", "#171717", "#fc0035") },
  { id: "vscode-plus", name: "VS Code Plus", dark: p("#007acc", "#1e1e1e", "#d4d4d4", "#f44747"), light: p("#007acc", "#ffffff", "#000000", "#e51400") },
];

const BY_ID = new Map(THEME_PRESETS.map((t) => [t.id, t]));

export function presetsFor(variant: Variant): ThemePreset[] {
  return THEME_PRESETS.filter((t) => t[variant]);
}

export function findPreset(id: string): ThemePreset | undefined {
  return BY_ID.get(id);
}

export function presetPalette(id: string, variant: Variant): Palette {
  return BY_ID.get(id)?.[variant] ?? BY_ID.get(DEFAULT_PRESET)![variant]!;
}
