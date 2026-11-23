import { dlopen, ptr } from "bun:ffi";
import { MODIFIER_ORDER, type KeyCombo, type Modifier } from "../lib/hotkeys";
import { MAC_KEYCODES } from "../lib/server/hotkeys/system";

/**
 * Finds keys other programs hold system-wide by trying to take each one ourselves.
 *
 * No OS lets one app list another's hotkeys. But a hotkey registered exclusively (Carbon's
 * kEventHotKeyExclusive on macOS; every RegisterHotKey on Windows) refuses a second claimant,
 * so trying each combo and letting go at once reveals which are taken. Each try takes ~40µs,
 * so a sweep of ~1,100 combos stays well under 100ms. It can't name the owner, and on macOS
 * it can't see apps that register without the exclusive flag.
 */

const FUNCTION_KEYS = Array.from({ length: 20 }, (_, i) => `F${i + 1}`);
const KEYS = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  ...FUNCTION_KEYS,
  "Space", "Return", "Tab", "Escape", "Backspace", "Delete", "Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown",
  "-", "=", ",", ".", "/", ";", "'", "[", "]", "\\", "`",
];

/** Every modifier set with at least one of ⌘ ⌥ ⌃ (shift alone never makes a hotkey). */
const MOD_SETS: Modifier[][] = [];
for (let mask = 1; mask < 16; mask++) {
  const mods = MODIFIER_ORDER.filter((_, i) => mask & (1 << i));
  if (mods.some((m) => m !== "shift")) MOD_SETS.push(mods);
}

function candidates(): KeyCombo[] {
  const out: KeyCombo[] = [];
  for (const mods of MOD_SETS) for (const key of KEYS) out.push({ mods, key });
  // Bare and shifted function keys are fair game for hotkey tools.
  for (const key of FUNCTION_KEYS) out.push({ mods: [], key }, { mods: ["shift"], key });
  return out;
}

// ── macOS: Carbon ────────────────────────────────────────────────────────────────────────────

const MAC_CODE = new Map(Object.entries(MAC_KEYCODES).map(([code, key]) => [key, Number(code)]));
const CARBON_MODS: Record<Modifier, number> = { meta: 0x100, shift: 0x200, alt: 0x800, ctrl: 0x1000 };
const EVENT_HOTKEY_EXISTS = -9878;

function macProbe(): (combo: KeyCombo) => boolean | null {
  const carbon = dlopen("/System/Library/Frameworks/Carbon.framework/Carbon", {
    GetApplicationEventTarget: { args: [], returns: "ptr" },
    RegisterEventHotKey: { args: ["u32", "u32", "u64", "ptr", "u32", "ptr"], returns: "i32" },
    UnregisterEventHotKey: { args: ["ptr"], returns: "i32" },
  }).symbols;
  const target = carbon.GetApplicationEventTarget();
  const out = new BigUint64Array(1);
  // EventHotKeyID { signature: 'SYTO', id: 1 } passed by value as one 64-bit word.
  const hotkeyId = 0x5359544fn | (1n << 32n);
  return (combo) => {
    const code = MAC_CODE.get(combo.key);
    if (code === undefined) return null;
    const mods = combo.mods.reduce((sum, m) => sum | CARBON_MODS[m], 0);
    const status = carbon.RegisterEventHotKey(code, mods, hotkeyId, target, 1 /* kEventHotKeyExclusive */, ptr(out));
    if (status === 0) {
      carbon.UnregisterEventHotKey(Number(out[0]));
      return false;
    }
    return status === EVENT_HOTKEY_EXISTS;
  };
}

// ── Windows: user32 ──────────────────────────────────────────────────────────────────────────

const WIN_MODS: Record<Modifier, number> = { alt: 0x1, ctrl: 0x2, shift: 0x4, meta: 0x8 };
const MOD_NOREPEAT = 0x4000;
const WIN_VK: Record<string, number> = {
  Space: 0x20, Return: 0x0d, Tab: 0x09, Escape: 0x1b, Backspace: 0x08, Delete: 0x2e, Up: 0x26, Down: 0x28, Left: 0x25, Right: 0x27,
  Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22, "-": 0xbd, "=": 0xbb, ",": 0xbc, ".": 0xbe, "/": 0xbf, ";": 0xba, "'": 0xde,
  "[": 0xdb, "]": 0xdd, "\\": 0xdc, "`": 0xc0,
};

function windowsVk(key: string): number | undefined {
  if (/^[A-Z0-9]$/.test(key)) return key.charCodeAt(0);
  const fn = /^F(\d+)$/.exec(key);
  if (fn) return 0x6f + Number(fn[1]);
  return WIN_VK[key];
}

function windowsProbe(): (combo: KeyCombo) => boolean | null {
  const user32 = dlopen("user32.dll", {
    RegisterHotKey: { args: ["ptr", "i32", "u32", "u32"], returns: "i32" },
    UnregisterHotKey: { args: ["ptr", "i32"], returns: "i32" },
  }).symbols;
  const id = 0x5359;
  return (combo) => {
    const vk = windowsVk(combo.key);
    if (vk === undefined) return null;
    const mods = combo.mods.reduce((sum, m) => sum | WIN_MODS[m], MOD_NOREPEAT);
    if (user32.RegisterHotKey(null, id, mods, vk)) {
      user32.UnregisterHotKey(null, id);
      return false;
    }
    return true;
  };
}

// ── Sweep ────────────────────────────────────────────────────────────────────────────────────

let probe: ((combo: KeyCombo) => boolean | null) | null | undefined;

export function probeSupported(): boolean {
  if (probe === undefined) {
    try {
      probe = process.platform === "darwin" ? macProbe() : process.platform === "win32" ? windowsProbe() : null;
    } catch (error) {
      console.error("[systo] hotkey probe unavailable", error);
      probe = null;
    }
  }
  return probe !== null;
}

/** Every candidate combo some other program currently holds. */
export function sweepClaimed(): KeyCombo[] {
  if (!probeSupported() || !probe) return [];
  const taken: KeyCombo[] = [];
  for (const combo of candidates()) {
    try {
      if (probe(combo)) taken.push(combo);
    } catch {
      // a key this keyboard can't express
    }
  }
  return taken;
}
