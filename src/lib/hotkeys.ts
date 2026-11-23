/**
 * Global shortcuts: the shapes the page, the server and the desktop shell share, and the pure
 * helpers that turn key presses into combos, combos into labels, and labels into the accelerator
 * strings Electrobun's GlobalShortcut understands. Nothing here touches the DOM or Node.
 */

export type HotkeyOS = "mac" | "windows" | "linux";

/** `meta` is ⌘ on macOS, the Windows key on Windows and Super on Linux. */
export type Modifier = "ctrl" | "alt" | "shift" | "meta";

export interface KeyCombo {
  /** Always in MODIFIER_ORDER, without duplicates. */
  mods: Modifier[];
  /**
   * Canonical key: "A"–"Z", "0"–"9", "F1"–"F20", a named key ("Space", "Return", "Up", …) or one
   * punctuation character ("-", "=", ",", …). Empty while only modifiers are held.
   */
  key: string;
}

export type SystoCommand = "open-main" | "toggle-island";

export type HotkeyAction =
  | { type: "app"; path: string; name: string }
  | { type: "url"; url: string }
  | { type: "path"; path: string }
  | { type: "command"; command: string }
  | { type: "systo"; command: SystoCommand };

export type HotkeyActionType = HotkeyAction["type"];

export interface Hotkey {
  id: string;
  combo: KeyCombo;
  action: HotkeyAction;
  enabled: boolean;
  createdAt: number;
}

export interface HotkeyStatus {
  /** Registered with the OS and listening right now. */
  active: boolean;
  /** Why an enabled shortcut isn't listening. */
  problem?: string;
  uses: number;
  lastUsedAt?: number;
}

export interface HotkeyEntry extends Hotkey {
  status: HotkeyStatus;
}

export interface HotkeysReport {
  /** False outside the desktop app, where nothing can listen system-wide. */
  available: boolean;
  /** macOS needs Accessibility access before key events from other apps reach Systo. */
  permission: "granted" | "needed" | "not-required";
  /** True while the editor is recording, so pressing an existing shortcut doesn't fire it. */
  paused: boolean;
  /** Whether the shell can show a native file picker. */
  canPick: boolean;
  /** Whether "Show or hide the Dynamic Island" makes sense here. */
  islandSupported: boolean;
  hotkeys: HotkeyEntry[];
}

/**
 * Where a shortcut someone else owns comes from, which decides its tab:
 * - `os`: the operating system or desktop (Spotlight, Mission Control, Hyprland binds)
 * - `tool`: an app or tool whose configuration Systo can read (skhd, Rectangle, a Service)
 * - `claimed`: keys another program holds that Systo found by trying them, owner unknown
 * - `app`: keys nearly every app uses (copy, paste, …)
 * - `systo`: Systo's own in-window keys
 */
export type BindingKind = "os" | "tool" | "claimed" | "app" | "systo";

export interface SystemBinding {
  id: string;
  combo: KeyCombo;
  name: string;
  /** "Screenshots", "Mission Control", "Hyprland", … */
  group: string;
  /** Who owns it: "macOS", "Windows", "Hyprland", "skhd", "Another app", … */
  owner: string;
  kind?: BindingKind;
  /** Read from the user's own configuration rather than a built-in list. */
  configured?: boolean;
  /** A second line: the command a binding runs, or the file it came from. */
  detail?: string;
  /** Found by probing: the user can give it a name, since nothing else can. */
  nameable?: boolean;
}

export interface SystemBindingsReport {
  bindings: SystemBinding[];
  /** Where the list came from, shown under the table. */
  sources: string[];
  /** Whether keys held by other apps were probed (desktop app on macOS and Windows). */
  probed: boolean;
}

/** A modifier as apps and config files spell it: "cmd", "option", "^", "⇧", … */
export function parseModifierWord(word: string): Modifier | null {
  const w = word.toLowerCase().replace(/^[lr](?=cmd|alt|ctrl|shift|option|control|command)/, "");
  if (["cmd", "command", "meta", "super", "win", "⌘", "@"].includes(w)) return "meta";
  if (["ctrl", "control", "primary", "^", "⌃"].includes(w)) return "ctrl";
  if (["alt", "opt", "option", "~", "⌥"].includes(w)) return "alt";
  if (["shift", "$", "⇧"].includes(w)) return "shift";
  return null;
}

/** Key words from config files ("return", "leftSquareBracket", "0x24") to canonical keys. */
export function parseKeyWord(word: string): string {
  const raw = word.trim();
  if (/^[a-z0-9]$/i.test(raw)) return raw.toUpperCase();
  const fn = /^f([1-9]|1[0-9]|20)$/i.exec(raw);
  if (fn) return `F${fn[1]}`;
  if (raw.length === 1 && "-=,./;'[]\\`".includes(raw)) return raw;
  const named: Record<string, string> = {
    space: "Space", spacebar: "Space", return: "Return", enter: "Return", tab: "Tab", escape: "Escape", esc: "Escape",
    backspace: "Backspace", delete: "Delete", del: "Delete", forwarddelete: "Delete", up: "Up", down: "Down", left: "Left", right: "Right",
    home: "Home", end: "End", pageup: "PageUp", pgup: "PageUp", pagedown: "PageDown", pgdn: "PageDown",
    minus: "-", equal: "=", equals: "=", comma: ",", period: ".", slash: "/", semicolon: ";", quote: "'", apostrophe: "'",
    leftsquarebracket: "[", rightsquarebracket: "]", bracketleft: "[", bracketright: "]", backslash: "\\", grave: "`", backtick: "`",
  };
  return named[raw.toLowerCase().replace(/[_\s-]/g, "")] ?? "";
}

export interface LaunchableApp {
  /** What launching uses: a .app bundle, a Start menu .lnk or a .desktop file. */
  path: string;
  name: string;
  /** Secondary text, e.g. "Utilities" or the .desktop comment. */
  detail?: string;
}

export const MODIFIER_ORDER: Modifier[] = ["ctrl", "alt", "shift", "meta"];

// ── Reading key presses ──────────────────────────────────────────────────────────────────────

const NAMED_CODES: Record<string, string> = {
  Space: "Space",
  Enter: "Return",
  NumpadEnter: "Return",
  Tab: "Tab",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Minus: "-",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Backquote: "`",
};

const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
  "CapsLock",
  "Fn",
  "FnLock",
]);

export interface KeyLike {
  code: string;
  key?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * The key a press means, by physical position (`code`) so ⌥ on a Mac and other layouts don't turn
 * "K" into "˚". Returns "" for modifier keys and keys a global shortcut can't use.
 */
export function keyFromCode(code: string): string {
  if (MODIFIER_CODES.has(code)) return "";
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (digit) return digit[1];
  const fn = /^F([1-9]|1[0-9]|20)$/.exec(code);
  if (fn) return code;
  return NAMED_CODES[code] ?? "";
}

export function modsFromEvent(event: KeyLike): Modifier[] {
  return MODIFIER_ORDER.filter((mod) =>
    mod === "ctrl" ? event.ctrlKey : mod === "alt" ? event.altKey : mod === "shift" ? event.shiftKey : event.metaKey,
  );
}

export function comboFromEvent(event: KeyLike): KeyCombo {
  return { mods: modsFromEvent(event), key: keyFromCode(event.code) };
}

export function normalizeCombo(combo: KeyCombo): KeyCombo {
  const mods = MODIFIER_ORDER.filter((m) => combo.mods.includes(m));
  return { mods, key: combo.key };
}

/** A stable identity for comparing combos: "alt+meta+T". */
export function comboId(combo: KeyCombo): string {
  return [...normalizeCombo(combo).mods, combo.key.length === 1 ? combo.key.toUpperCase() : combo.key].join("+");
}

export function sameCombo(a: KeyCombo, b: KeyCombo): boolean {
  return comboId(a) === comboId(b);
}

// ── Showing combos ───────────────────────────────────────────────────────────────────────────

export interface KeyCap {
  /** What the cap shows: "⌘", "Ctrl", "K", "↩". */
  label: string;
  /** A small word under macOS symbols ("command"), for people who don't read ⌥ at a glance. */
  caption?: string;
  /** For screen readers. */
  spoken: string;
  modifier: boolean;
}

const MAC_MODS: Record<Modifier, KeyCap> = {
  ctrl: { label: "⌃", caption: "control", spoken: "Control", modifier: true },
  alt: { label: "⌥", caption: "option", spoken: "Option", modifier: true },
  shift: { label: "⇧", caption: "shift", spoken: "Shift", modifier: true },
  meta: { label: "⌘", caption: "command", spoken: "Command", modifier: true },
};

const PC_MODS = (os: HotkeyOS): Record<Modifier, KeyCap> => ({
  ctrl: { label: "Ctrl", spoken: "Control", modifier: true },
  alt: { label: "Alt", spoken: "Alt", modifier: true },
  shift: { label: "Shift", spoken: "Shift", modifier: true },
  meta: os === "windows" ? { label: "Win", spoken: "Windows key", modifier: true } : { label: "Super", spoken: "Super", modifier: true },
});

const MAC_KEYS: Record<string, string> = {
  Space: "Space",
  Return: "↩",
  Tab: "⇥",
  Escape: "esc",
  Backspace: "⌫",
  Delete: "⌦",
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  Home: "↖",
  End: "↘",
  PageUp: "⇞",
  PageDown: "⇟",
};

const PC_KEYS: Record<string, string> = {
  Space: "Space",
  Return: "Enter",
  Tab: "Tab",
  Escape: "Esc",
  Backspace: "Backspace",
  Delete: "Del",
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  Home: "Home",
  End: "End",
  PageUp: "PgUp",
  PageDown: "PgDn",
};

const SPOKEN_KEYS: Record<string, string> = {
  Return: "Return",
  Up: "Up arrow",
  Down: "Down arrow",
  Left: "Left arrow",
  Right: "Right arrow",
  PageUp: "Page Up",
  PageDown: "Page Down",
  "-": "Minus",
  "=": "Equals",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  ";": "Semicolon",
  "'": "Quote",
  "[": "Left bracket",
  "]": "Right bracket",
  "\\": "Backslash",
  "`": "Backtick",
};

export function modifierCap(mod: Modifier, os: HotkeyOS): KeyCap {
  return os === "mac" ? MAC_MODS[mod] : PC_MODS(os)[mod];
}

export function keyCap(key: string, os: HotkeyOS): KeyCap {
  const label = (os === "mac" ? MAC_KEYS : PC_KEYS)[key] ?? key;
  return { label, spoken: SPOKEN_KEYS[key] ?? key, modifier: false };
}

/** Modifiers then the key, in each platform's customary order (⌃⌥⇧⌘ on macOS, Ctrl+Alt+Shift+Win elsewhere). */
export function comboCaps(combo: KeyCombo, os: HotkeyOS): KeyCap[] {
  const order: Modifier[] = os === "mac" ? MODIFIER_ORDER : ["meta", "ctrl", "alt", "shift"];
  const caps = order.filter((m) => combo.mods.includes(m)).map((m) => modifierCap(m, os));
  if (combo.key) caps.push(keyCap(combo.key, os));
  return caps;
}

/** "⌥⌘T" on macOS, "Ctrl+Alt+T" elsewhere. */
export function comboLabel(combo: KeyCombo, os: HotkeyOS): string {
  const caps = comboCaps(combo, os).map((c) => c.label);
  return os === "mac" ? caps.join("") : caps.join("+");
}

export function comboSpoken(combo: KeyCombo, os: HotkeyOS): string {
  return comboCaps(combo, os)
    .map((c) => c.spoken)
    .join(" ");
}

// ── Talking to the OS ────────────────────────────────────────────────────────────────────────

const ACCELERATOR_KEYS: Record<string, string> = {
  Return: "Return",
  Space: "Space",
  Tab: "Tab",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  Up: "Up",
  Down: "Down",
  Left: "Left",
  Right: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  "-": "minus",
  "+": "plus",
};

/** Electrobun's accelerator syntax: "Command+Shift+K", "Control+Alt+Delete", "Super+Return". */
export function toAccelerator(combo: KeyCombo, os: HotkeyOS): string {
  const mods = normalizeCombo(combo).mods.map((m) =>
    m === "ctrl" ? "Control" : m === "alt" ? "Alt" : m === "shift" ? "Shift" : os === "mac" ? "Command" : "Super",
  );
  return [...mods, ACCELERATOR_KEYS[combo.key] ?? combo.key].join("+");
}

const FUNCTION_KEY = /^F([1-9]|1[0-9]|20)$/;

export type ComboCheck = { ok: true } | { ok: false; reason: string };

/** Whether a combo is safe to claim system-wide. Plain typing must keep working everywhere. */
export function checkCombo(combo: KeyCombo, os: HotkeyOS): ComboCheck {
  if (!combo.key) return { ok: false, reason: "Hold modifiers, then press a key." };
  const fn = FUNCTION_KEY.test(combo.key);
  const strong = combo.mods.filter((m) => m !== "shift");
  if (!fn && strong.length === 0) {
    const examples = os === "mac" ? "⌘, ⌥ or ⌃" : os === "windows" ? "Ctrl, Alt or Win" : "Ctrl, Alt or Super";
    return { ok: false, reason: `Add ${examples} so ordinary typing isn't taken over.` };
  }
  if (os === "mac" && strong.length === 1 && strong[0] === "alt" && combo.key.length === 1 && !/[0-9]/.test(combo.key)) {
    // ⌥ plus a character types accented letters and symbols (⌥E → ´), which people rely on.
    return { ok: false, reason: "⌥ with a letter types special characters. Add ⌘ or ⌃ as well." };
  }
  return { ok: true };
}

// ── Actions ──────────────────────────────────────────────────────────────────────────────────

export const SYSTO_COMMANDS: Record<SystoCommand, { title: string; hint: string }> = {
  "open-main": { title: "Show Systo", hint: "Bring the Systo window to the front" },
  "toggle-island": { title: "Show or hide the Dynamic Island", hint: "Turn the island on or off" },
};

/** Adds https:// to "github.com" and rejects anything that isn't a web or mail link. */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) return null;
    if ((url.protocol === "http:" || url.protocol === "https:") && !url.hostname.includes(".") && url.hostname !== "localhost") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** The headline for a shortcut's action: "Safari", "github.com", "Downloads", "brew update". */
export function actionTitle(action: HotkeyAction): string {
  switch (action.type) {
    case "app":
      return action.name || baseName(action.path).replace(/\.(app|lnk|desktop|exe)$/i, "");
    case "url":
      try {
        const url = new URL(action.url);
        return url.protocol === "mailto:" ? url.pathname : url.hostname.replace(/^www\./, "") + (url.pathname !== "/" ? url.pathname : "");
      } catch {
        return action.url;
      }
    case "path":
      return baseName(action.path) || action.path;
    case "command": {
      const line = action.command.trim().split("\n")[0];
      return line.length > 48 ? `${line.slice(0, 47)}…` : line;
    }
    case "systo":
      return SYSTO_COMMANDS[action.command].title;
  }
}

/** The verb shown above the title: "Open app", "Open website", … */
export function actionVerb(action: HotkeyAction): string {
  switch (action.type) {
    case "app":
      return "Open app";
    case "url":
      return "Open website";
    case "path":
      return "Open";
    case "command":
      return "Run command";
    case "systo":
      return "Systo";
  }
}

/** Throws away anything malformed that arrives from the page or a hand-edited file. */
export function sanitizeAction(value: unknown): HotkeyAction | null {
  if (!value || typeof value !== "object") return null;
  const a = value as Record<string, unknown>;
  const str = (v: unknown, max = 4096) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
  switch (a.type) {
    case "app": {
      const path = str(a.path);
      return path ? { type: "app", path, name: str(a.name, 200) ?? "" } : null;
    }
    case "url": {
      const url = typeof a.url === "string" ? normalizeUrl(a.url) : null;
      return url ? { type: "url", url } : null;
    }
    case "path": {
      const path = str(a.path);
      return path ? { type: "path", path } : null;
    }
    case "command": {
      const command = str(a.command, 8192);
      return command ? { type: "command", command } : null;
    }
    case "systo":
      return a.command === "open-main" || a.command === "toggle-island" ? { type: "systo", command: a.command } : null;
    default:
      return null;
  }
}

const VALID_KEY = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|20)|Space|Return|Tab|Escape|Backspace|Delete|Up|Down|Left|Right|Home|End|PageUp|PageDown|[-=,./;'[\]\\`])$/;

export function sanitizeCombo(value: unknown): KeyCombo | null {
  if (!value || typeof value !== "object") return null;
  const c = value as { mods?: unknown; key?: unknown };
  if (!Array.isArray(c.mods) || typeof c.key !== "string" || !VALID_KEY.test(c.key)) return null;
  const mods = c.mods.filter((m): m is Modifier => MODIFIER_ORDER.includes(m as Modifier));
  return normalizeCombo({ mods, key: c.key });
}

// ── Conflicts ────────────────────────────────────────────────────────────────────────────────

export interface Conflicts {
  /** Another of the user's shortcuts already uses these keys. Saving is blocked. */
  own?: Hotkey;
  /** The OS or the desktop uses them. Saving is allowed but the user is warned. */
  system: SystemBinding[];
}

export function findConflicts(combo: KeyCombo, hotkeys: Hotkey[], system: SystemBinding[], ignoreId?: string): Conflicts {
  const id = comboId(combo);
  return {
    own: hotkeys.find((h) => h.id !== ignoreId && comboId(h.combo) === id),
    system: system.filter((b) => comboId(b.combo) === id),
  };
}
