import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { appDataDir, appDataFile } from "../paths";
import { sanitizeAction, sanitizeCombo, type Hotkey, type HotkeyAction, type HotkeyStatus, type SystoCommand, type KeyCombo } from "../../hotkeys";

/**
 * The user's shortcuts live in one JSON file. The API route writes it and the desktop shell reads
 * it at launch; both run in one process, so the shell is told about changes directly (see
 * `HotkeyBridge`) rather than watching the file.
 */
const FILE = "hotkeys.json";

interface StoredFile {
  version: 1;
  hotkeys: Hotkey[];
}

function sanitize(value: unknown): Hotkey | null {
  if (!value || typeof value !== "object") return null;
  const h = value as Record<string, unknown>;
  const combo = sanitizeCombo(h.combo);
  const action = sanitizeAction(h.action);
  if (!combo || !action) return null;
  return {
    id: typeof h.id === "string" && h.id ? h.id : randomUUID(),
    combo,
    action,
    enabled: h.enabled !== false,
    createdAt: typeof h.createdAt === "number" ? h.createdAt : Date.now(),
  };
}

export function loadHotkeys(file = appDataFile(FILE)): Hotkey[] {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredFile>;
    return (parsed.hotkeys ?? []).map(sanitize).filter((h): h is Hotkey => h !== null);
  } catch {
    return [];
  }
}

export function saveHotkeys(hotkeys: Hotkey[], file = appDataFile(FILE)) {
  mkdirSync(appDataDir(), { recursive: true });
  const body: StoredFile = { version: 1, hotkeys };
  // Write then rename, so a crash mid-write never leaves half a file.
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(body, null, 2));
  renameSync(temp, file);
}

export function newHotkey(fields: Pick<Hotkey, "combo" | "action"> & { enabled?: boolean }): Hotkey {
  return { id: randomUUID(), combo: fields.combo, action: fields.action, enabled: fields.enabled ?? true, createdAt: Date.now() };
}

// ── Usage counts ─────────────────────────────────────────────────────────────────────────────

const STATS = "hotkey-stats.json";

export type HotkeyStats = Record<string, { uses: number; lastUsedAt: number }>;

export function loadStats(): HotkeyStats {
  try {
    return JSON.parse(readFileSync(appDataFile(STATS), "utf8")) as HotkeyStats;
  } catch {
    return {};
  }
}

export function saveStats(stats: HotkeyStats) {
  try {
    mkdirSync(appDataDir(), { recursive: true });
    writeFileSync(appDataFile(STATS), JSON.stringify(stats));
  } catch {
    // counts are a nicety
  }
}

// ── Names for keys other apps hold ───────────────────────────────────────────────────────────

const LABELS = "hotkey-labels.json";

/** comboId → what the user says those keys do, for shortcuts Systo found but can't identify. */
export type HotkeyLabels = Record<string, string>;

export function loadLabels(): HotkeyLabels {
  try {
    return JSON.parse(readFileSync(appDataFile(LABELS), "utf8")) as HotkeyLabels;
  } catch {
    return {};
  }
}

export function saveLabels(labels: HotkeyLabels) {
  mkdirSync(appDataDir(), { recursive: true });
  writeFileSync(appDataFile(LABELS), JSON.stringify(labels, null, 2));
}

// ── The shell's side ─────────────────────────────────────────────────────────────────────────

/**
 * What desktop.ts puts on globalThis for the API route: it owns GlobalShortcut, the file picker
 * and Systo's own window and island. Outside the desktop app there is no bridge.
 */
export interface HotkeyBridge {
  sync(hotkeys: Hotkey[]): void;
  status(): { permission: "granted" | "needed" | "not-required"; paused: boolean; statuses: Record<string, HotkeyStatus>; islandSupported: boolean };
  pause(): void;
  resume(): void;
  run(action: HotkeyAction): Promise<{ ok: boolean; message: string }>;
  pick(kind: "app" | "file" | "folder"): Promise<string | null>;
  systo(command: SystoCommand): void;
  /** Keys other programs hold exclusively, or null where that can't be checked. */
  claimed(force?: boolean): KeyCombo[] | null;
}

export function hotkeyBridge(): HotkeyBridge | undefined {
  return (globalThis as { __systoHotkeys?: HotkeyBridge }).__systoHotkeys;
}
