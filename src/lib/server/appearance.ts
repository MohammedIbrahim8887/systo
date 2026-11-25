import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { appearanceCss, islandTint, sanitizeAppearance, type Appearance } from "../theme";
import { appDataFile } from "./paths";
import { loadSettings } from "./settings";

/**
 * The theme lives in a file rather than localStorage: the packaged app's server takes a new port
 * on every launch, so the page's origin, and with it localStorage, starts out empty each time.
 */
const FILE = "appearance.json";
/** On globalThis: the API routes and the desktop shell can be separate bundles in one process. */
const cache = globalThis as { __systoIslandTint?: string | null };

export function loadAppearance(file = appDataFile(FILE)): Appearance {
  let stored: unknown;
  try {
    stored = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // Never saved, or unreadable: Systo's own theme.
  }
  return sanitizeAppearance(stored);
}

export function saveAppearance(value: unknown, file = appDataFile(FILE)): Appearance {
  const appearance = sanitizeAppearance(value);
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(appearance, null, 2));
  renameSync(temp, file);
  cache.__systoIslandTint = islandTint(appearance);
  return appearance;
}

/** Polled by the island, so it's read from disk once. */
export function currentIslandTint(): string | null {
  if (cache.__systoIslandTint === undefined) cache.__systoIslandTint = islandTint(loadAppearance());
  return cache.__systoIslandTint;
}

/**
 * A blocking head script, so the first paint already has the theme and settings. Farm's own theme script runs
 * right after and reads its cookie, so the saved mode is handed over there.
 */
export function bootScript(appearance = loadAppearance(), settings = loadSettings()): string {
  return `(function(){var a=${JSON.stringify(appearance)};window.__systoAppearance=a;window.__systoSettings=${JSON.stringify(settings)};var d=document,s=d.createElement("style");s.id="systo-theme";s.textContent=${JSON.stringify(appearanceCss(appearance))};(d.head||d.documentElement).appendChild(s);document.cookie="systo-theme="+a.mode+"; path=/; max-age=31536000; samesite=lax";})();`;
}
