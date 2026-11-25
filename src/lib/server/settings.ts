import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { sanitizeSettings, type Settings } from "../settings";
import { appDataFile } from "./paths";

/** A file for the same reason as the theme's: localStorage is empty on every launch (see appearance.ts). */
const FILE = "settings.json";

export function loadSettings(file = appDataFile(FILE)): Settings {
  let stored: unknown;
  try {
    stored = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // Never saved, or unreadable: defaults.
  }
  return sanitizeSettings(stored);
}

/** Merges, because the main window and the island each save only what they change. */
export function patchSettings(patch: object, file = appDataFile(FILE)): Settings {
  const settings = sanitizeSettings({ ...loadSettings(file), ...patch });
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(settings, null, 2));
  renameSync(temp, file);
  return settings;
}
