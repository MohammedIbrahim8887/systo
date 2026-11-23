import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { run } from "../exec";
import { hyprlandAvailable } from "../linux/hyprland";
import { MODIFIER_ORDER, comboId, type KeyCombo, type Modifier, type SystemBinding, type SystemBindingsReport } from "../../hotkeys";

/**
 * Shortcuts the OS or desktop already uses, so the page can list them and warn before a new
 * shortcut steals one. macOS keeps its configurable ones in com.apple.symbolichotkeys; Hyprland,
 * GNOME and KDE each have their own store. Fixed, built-in shortcuts come from the lists below.
 */

const combo = (mods: Modifier[], key: string): KeyCombo => ({ mods: MODIFIER_ORDER.filter((m) => mods.includes(m)), key });

// ── macOS ────────────────────────────────────────────────────────────────────────────────────

/** Virtual key codes (Carbon's kVK_*) to the canonical keys in lib/hotkeys.ts. */
export const MAC_KEYCODES: Record<number, string> = {
  0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X", 8: "C", 9: "V", 11: "B", 12: "Q", 13: "W", 14: "E", 15: "R",
  16: "Y", 17: "T", 18: "1", 19: "2", 20: "3", 21: "4", 22: "6", 23: "5", 24: "=", 25: "9", 26: "7", 27: "-", 28: "8", 29: "0",
  30: "]", 31: "O", 32: "U", 33: "[", 34: "I", 35: "P", 36: "Return", 37: "L", 38: "J", 39: "'", 40: "K", 41: ";", 42: "\\",
  43: ",", 44: "/", 45: "N", 46: "M", 47: ".", 48: "Tab", 49: "Space", 50: "`", 51: "Backspace", 53: "Escape",
  64: "F17", 79: "F18", 80: "F19", 90: "F20", 96: "F5", 97: "F6", 98: "F7", 99: "F3", 100: "F8", 101: "F9", 103: "F11",
  105: "F13", 106: "F16", 107: "F14", 109: "F10", 111: "F12", 113: "F15", 115: "Home", 116: "PageUp", 117: "Delete",
  118: "F4", 119: "End", 120: "F2", 121: "PageDown", 122: "F1", 123: "Left", 124: "Right", 125: "Down", 126: "Up",
};

/** NSEventModifierFlags as stored in the plist. Fn (0x800000) only marks arrow and F keys, so it's ignored. */
export function macModifiers(flags: number): Modifier[] {
  const mods: Modifier[] = [];
  if (flags & 0x40000) mods.push("ctrl");
  if (flags & 0x80000) mods.push("alt");
  if (flags & 0x20000) mods.push("shift");
  if (flags & 0x100000) mods.push("meta");
  return mods;
}

interface MacSymbolic {
  name: string;
  group: string;
  /** [character, keycode, modifier flags] as macOS stores them. */
  keys: [number, number, number];
  on: boolean;
}

const SHIFT = 0x20000;
const CTRL = 0x40000;
const ALT = 0x80000;
const CMD = 0x100000;
const FN = 0x800000;

/** The symbolic hotkeys System Settings › Keyboard › Keyboard Shortcuts shows, with their defaults. */
const MAC_SYMBOLIC: Record<number, MacSymbolic> = {
  64: { name: "Show Spotlight search", group: "Spotlight", keys: [32, 49, CMD], on: true },
  65: { name: "Show Finder search window", group: "Spotlight", keys: [32, 49, CMD | ALT], on: true },
  28: { name: "Save picture of screen as a file", group: "Screenshots", keys: [51, 20, CMD | SHIFT], on: true },
  29: { name: "Copy picture of screen to the clipboard", group: "Screenshots", keys: [51, 20, CMD | SHIFT | CTRL], on: true },
  30: { name: "Save picture of selected area as a file", group: "Screenshots", keys: [52, 21, CMD | SHIFT], on: true },
  31: { name: "Copy picture of selected area to the clipboard", group: "Screenshots", keys: [52, 21, CMD | SHIFT | CTRL], on: true },
  184: { name: "Screenshot and recording options", group: "Screenshots", keys: [53, 23, CMD | SHIFT], on: true },
  32: { name: "Mission Control", group: "Mission Control", keys: [65535, 126, CTRL | FN], on: true },
  33: { name: "Application windows", group: "Mission Control", keys: [65535, 125, CTRL | FN], on: true },
  36: { name: "Show Desktop", group: "Mission Control", keys: [65535, 103, FN], on: true },
  79: { name: "Move left a space", group: "Mission Control", keys: [65535, 123, CTRL | FN], on: true },
  81: { name: "Move right a space", group: "Mission Control", keys: [65535, 124, CTRL | FN], on: true },
  118: { name: "Switch to Desktop 1", group: "Mission Control", keys: [65535, 18, CTRL], on: false },
  119: { name: "Switch to Desktop 2", group: "Mission Control", keys: [65535, 19, CTRL], on: false },
  120: { name: "Switch to Desktop 3", group: "Mission Control", keys: [65535, 20, CTRL], on: false },
  121: { name: "Switch to Desktop 4", group: "Mission Control", keys: [65535, 21, CTRL], on: false },
  60: { name: "Select the previous input source", group: "Input Sources", keys: [32, 49, CTRL], on: true },
  61: { name: "Select next source in Input menu", group: "Input Sources", keys: [32, 49, CTRL | ALT], on: true },
  12: { name: "Turn keyboard access on or off", group: "Keyboard", keys: [65535, 122, CTRL | FN], on: true },
  7: { name: "Move focus to the menu bar", group: "Keyboard", keys: [65535, 120, CTRL | FN], on: true },
  8: { name: "Move focus to the Dock", group: "Keyboard", keys: [65535, 99, CTRL | FN], on: true },
  9: { name: "Move focus to active or next window", group: "Keyboard", keys: [65535, 118, CTRL | FN], on: true },
  10: { name: "Move focus to window toolbar", group: "Keyboard", keys: [65535, 96, CTRL | FN], on: true },
  11: { name: "Move focus to floating window", group: "Keyboard", keys: [65535, 97, CTRL | FN], on: true },
  13: { name: "Change the way Tab moves focus", group: "Keyboard", keys: [65535, 98, CTRL | FN], on: true },
  57: { name: "Move focus to status menus", group: "Keyboard", keys: [65535, 100, CTRL | FN], on: true },
  27: { name: "Move focus to next window", group: "Keyboard", keys: [96, 50, CMD], on: true },
  98: { name: "Show Help menu", group: "Keyboard", keys: [47, 44, CMD | SHIFT], on: true },
  52: { name: "Turn Dock hiding on or off", group: "Launchpad & Dock", keys: [100, 2, CMD | ALT], on: true },
  15: { name: "Turn zoom on or off", group: "Accessibility", keys: [56, 28, CMD | ALT], on: false },
  17: { name: "Zoom in", group: "Accessibility", keys: [61, 24, CMD | ALT], on: false },
  19: { name: "Zoom out", group: "Accessibility", keys: [45, 27, CMD | ALT], on: false },
  21: { name: "Invert colors", group: "Accessibility", keys: [56, 28, CMD | ALT | CTRL], on: false },
  59: { name: "Turn VoiceOver on or off", group: "Accessibility", keys: [65535, 96, CMD | FN], on: true },
  162: { name: "Show Accessibility controls", group: "Accessibility", keys: [65535, 96, CMD | ALT | FN], on: true },
};

/** Fixed shortcuts every Mac has, which an app-wide grab would take from the frontmost app. */
const MAC_FIXED: Array<Omit<SystemBinding, "id" | "owner">> = [
  { name: "Switch between apps", group: "System", combo: combo(["meta"], "Tab") },
  { name: "Switch between apps, backwards", group: "System", combo: combo(["meta", "shift"], "Tab") },
  { name: "Force Quit Applications", group: "System", combo: combo(["meta", "alt"], "Escape") },
  { name: "Lock screen", group: "System", combo: combo(["ctrl", "meta"], "Q") },
  { name: "Log out", group: "System", combo: combo(["shift", "meta"], "Q") },
  { name: "Emoji & Symbols", group: "System", combo: combo(["ctrl", "meta"], "Space") },
  { name: "Quit app", group: "Every app", combo: combo(["meta"], "Q") },
  { name: "Close window", group: "Every app", combo: combo(["meta"], "W") },
  { name: "Hide app", group: "Every app", combo: combo(["meta"], "H") },
  { name: "Hide other apps", group: "Every app", combo: combo(["alt", "meta"], "H") },
  { name: "Minimize window", group: "Every app", combo: combo(["meta"], "M") },
  { name: "Full screen", group: "Every app", combo: combo(["ctrl", "meta"], "F") },
  { name: "Settings", group: "Every app", combo: combo(["meta"], ",") },
  { name: "New window or document", group: "Every app", combo: combo(["meta"], "N") },
  { name: "Copy", group: "Every app", combo: combo(["meta"], "C") },
  { name: "Paste", group: "Every app", combo: combo(["meta"], "V") },
  { name: "Cut", group: "Every app", combo: combo(["meta"], "X") },
  { name: "Undo", group: "Every app", combo: combo(["meta"], "Z") },
  { name: "Select all", group: "Every app", combo: combo(["meta"], "A") },
  { name: "Find", group: "Every app", combo: combo(["meta"], "F") },
  { name: "Save", group: "Every app", combo: combo(["meta"], "S") },
  { name: "Print", group: "Every app", combo: combo(["meta"], "P") },
  { name: "Open", group: "Every app", combo: combo(["meta"], "O") },
  { name: "New tab", group: "Every app", combo: combo(["meta"], "T") },
];

interface SymbolicEntry {
  enabled?: boolean;
  value?: { parameters?: number[] };
}

/** Merges the plist over the defaults: a missing entry, or one without parameters, keeps the default keys. */
export function decodeMacSymbolic(plist: Record<string, SymbolicEntry>): SystemBinding[] {
  const bindings: SystemBinding[] = [];
  for (const [rawId, meta] of Object.entries(MAC_SYMBOLIC)) {
    const entry = plist[rawId];
    const enabled = entry?.enabled ?? meta.on;
    if (!enabled) continue;
    const params = entry?.value?.parameters;
    const [, keycode, flags] = params && params.length === 3 ? params : meta.keys;
    const key = MAC_KEYCODES[keycode];
    if (!key || keycode === 65535) continue;
    bindings.push({ id: `mac-${rawId}`, name: meta.name, group: meta.group, owner: "macOS", combo: combo(macModifiers(flags), key), configured: Boolean(entry) });
  }
  return bindings;
}

async function macBindings(): Promise<{ bindings: SystemBinding[]; sources: string[] }> {
  const file = join(homedir(), "Library", "Preferences", "com.apple.symbolichotkeys.plist");
  let plist: Record<string, SymbolicEntry> = {};
  if (existsSync(file)) {
    const { stdout } = await run("/usr/bin/plutil", ["-convert", "json", "-o", "-", file], 4000);
    try {
      plist = (JSON.parse(stdout) as { AppleSymbolicHotKeys?: Record<string, SymbolicEntry> }).AppleSymbolicHotKeys ?? {};
    } catch {
      // keep the defaults
    }
  }
  const fixed = MAC_FIXED.map((b, i) => ({ ...b, id: `mac-fixed-${i}`, owner: b.group === "Every app" ? "Apps" : "macOS" }));
  return { bindings: [...decodeMacSymbolic(plist), ...fixed], sources: ["System Settings › Keyboard › Keyboard Shortcuts", "Built-in macOS shortcuts"] };
}

// ── Windows ──────────────────────────────────────────────────────────────────────────────────

const W = (name: string, group: string, mods: Modifier[], key: string) => ({ name, group, combo: combo(mods, key) });

/** Windows reserves these itself; RegisterHotKey fails for most Win+ combos. */
const WINDOWS_FIXED = [
  W("Switch between apps", "System", ["alt"], "Tab"),
  W("Close app", "System", ["alt"], "F4"),
  W("Task Manager", "System", ["ctrl", "shift"], "Escape"),
  W("Security options", "System", ["ctrl", "alt"], "Delete"),
  W("Lock PC", "System", ["meta"], "L"),
  W("Run", "System", ["meta"], "R"),
  W("Settings", "System", ["meta"], "I"),
  W("Quick Link menu", "System", ["meta"], "X"),
  W("Search", "System", ["meta"], "S"),
  W("Emoji panel", "System", ["meta"], "."),
  W("Clipboard history", "System", ["meta"], "V"),
  W("Voice typing", "System", ["meta"], "H"),
  W("Switch input language", "System", ["meta"], "Space"),
  W("File Explorer", "Apps & files", ["meta"], "E"),
  W("Show desktop", "Windows & desktops", ["meta"], "D"),
  W("Minimize all windows", "Windows & desktops", ["meta"], "M"),
  W("Restore minimized windows", "Windows & desktops", ["meta", "shift"], "M"),
  W("Task view", "Windows & desktops", ["meta"], "Tab"),
  W("Maximize window", "Windows & desktops", ["meta"], "Up"),
  W("Minimize window", "Windows & desktops", ["meta"], "Down"),
  W("Snap window left", "Windows & desktops", ["meta"], "Left"),
  W("Snap window right", "Windows & desktops", ["meta"], "Right"),
  W("Snap layouts", "Windows & desktops", ["meta"], "Z"),
  W("Minimize all but the active window", "Windows & desktops", ["meta"], "Home"),
  W("Peek at desktop", "Windows & desktops", ["meta"], ","),
  W("New virtual desktop", "Windows & desktops", ["meta", "ctrl"], "D"),
  W("Close virtual desktop", "Windows & desktops", ["meta", "ctrl"], "F4"),
  W("Previous virtual desktop", "Windows & desktops", ["meta", "ctrl"], "Left"),
  W("Next virtual desktop", "Windows & desktops", ["meta", "ctrl"], "Right"),
  W("Snip a screenshot", "Screenshots", ["meta", "shift"], "S"),
  W("Record the screen", "Screenshots", ["meta", "shift"], "R"),
  W("Game Bar", "Screenshots", ["meta"], "G"),
  W("Record that", "Screenshots", ["meta", "alt"], "G"),
  W("Notifications", "Taskbar", ["meta"], "N"),
  W("Quick Settings", "Taskbar", ["meta"], "A"),
  W("Widgets", "Taskbar", ["meta"], "W"),
  W("Focus the taskbar", "Taskbar", ["meta"], "T"),
  W("Focus the notification area", "Taskbar", ["meta"], "B"),
  W("Project to a second screen", "Taskbar", ["meta"], "P"),
  W("Cast", "Taskbar", ["meta"], "K"),
  W("Magnifier", "Accessibility", ["meta"], "="),
  W("Narrator", "Accessibility", ["meta", "ctrl"], "Return"),
  W("Copy", "Every app", ["ctrl"], "C"),
  W("Paste", "Every app", ["ctrl"], "V"),
  W("Cut", "Every app", ["ctrl"], "X"),
  W("Undo", "Every app", ["ctrl"], "Z"),
  W("Select all", "Every app", ["ctrl"], "A"),
  W("Save", "Every app", ["ctrl"], "S"),
  W("Find", "Every app", ["ctrl"], "F"),
  W("Close tab or document", "Every app", ["ctrl"], "W"),
];

function windowsBindings(): { bindings: SystemBinding[]; sources: string[] } {
  const bindings: SystemBinding[] = WINDOWS_FIXED.map((b, i) => ({ ...b, id: `win-${i}`, owner: b.group === "Every app" ? "Apps" : "Windows" }));
  // Win+1…9 open pinned taskbar apps.
  for (let n = 1; n <= 9; n++) bindings.push({ id: `win-taskbar-${n}`, name: `Open taskbar app ${n}`, group: "Taskbar", owner: "Windows", combo: combo(["meta"], String(n)) });
  return { bindings, sources: ["Built-in Windows shortcuts"] };
}

// ── Linux ────────────────────────────────────────────────────────────────────────────────────

/** X keysym names (as Hyprland, GNOME and KDE spell them) to canonical keys. */
export function keyFromKeysym(name: string): string {
  const raw = name.trim();
  if (/^[a-z0-9]$/i.test(raw)) return raw.toUpperCase();
  const fn = /^F([1-9]|1[0-9]|20)$/i.exec(raw);
  if (fn) return `F${fn[1]}`;
  const lower = raw.toLowerCase().replace(/[_\s]/g, "");
  const named: Record<string, string> = {
    space: "Space", return: "Return", enter: "Return", kpenter: "Return", tab: "Tab", escape: "Escape", esc: "Escape",
    backspace: "Backspace", delete: "Delete", del: "Delete", up: "Up", down: "Down", left: "Left", right: "Right",
    home: "Home", end: "End", pageup: "PageUp", prior: "PageUp", pgup: "PageUp", pagedown: "PageDown", next: "PageDown", pgdown: "PageDown",
    minus: "-", equal: "=", comma: ",", period: ".", slash: "/", semicolon: ";", apostrophe: "'", bracketleft: "[",
    bracketright: "]", backslash: "\\", grave: "`", "-": "-", "=": "=", ",": ",", ".": ".", "/": "/", ";": ";", "'": "'", "`": "`",
  };
  return named[lower] ?? "";
}

/** Hyprland's modmask bits: SHIFT 1, CTRL 4, ALT 8, SUPER 64. */
export function hyprModifiers(mask: number): Modifier[] {
  const mods: Modifier[] = [];
  if (mask & 4) mods.push("ctrl");
  if (mask & 8) mods.push("alt");
  if (mask & 1) mods.push("shift");
  if (mask & 64) mods.push("meta");
  return mods;
}

interface HyprBind {
  modmask: number;
  key: string;
  dispatcher: string;
  arg: string;
  description?: string;
  has_description?: boolean;
  submap?: string;
  mouse?: boolean;
  release?: boolean;
}

function titleCase(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function describeHyprBind(bind: HyprBind): string {
  if (bind.has_description && bind.description) return bind.description;
  const arg = bind.arg.trim();
  switch (bind.dispatcher) {
    case "exec":
    case "execr":
      return `Run ${arg.split(/\s+/)[0]?.split("/").pop() ?? arg}`;
    case "workspace":
      return `Go to workspace ${arg}`;
    case "movetoworkspace":
    case "movetoworkspacesilent":
      return `Move window to workspace ${arg}`;
    case "killactive":
      return "Close window";
    case "togglefloating":
      return "Toggle floating";
    case "fullscreen":
      return "Toggle full screen";
    case "movefocus":
      return `Focus ${{ l: "left", r: "right", u: "up", d: "down" }[arg] ?? arg}`;
    case "movewindow":
      return `Move window ${{ l: "left", r: "right", u: "up", d: "down" }[arg] ?? arg}`;
    case "exit":
      return "Exit Hyprland";
    default:
      return titleCase(`${bind.dispatcher}${arg ? ` ${arg}` : ""}`);
  }
}

export function decodeHyprBinds(binds: HyprBind[]): SystemBinding[] {
  const out: SystemBinding[] = [];
  binds.forEach((bind, index) => {
    if (bind.mouse || bind.release || (bind.submap && bind.submap !== "")) return;
    const key = keyFromKeysym(bind.key);
    if (!key) return;
    out.push({ id: `hypr-${index}`, name: describeHyprBind(bind), group: "Hyprland", owner: "Hyprland", combo: combo(hyprModifiers(bind.modmask), key), configured: true });
  });
  return out;
}

/** GTK accelerators: "<Super>d", "<Primary><Shift>Page_Up", "<Control><Alt>t". */
export function parseGtkAccelerator(text: string): KeyCombo | null {
  const mods: Modifier[] = [];
  const rest = text.replace(/<([^>]+)>/g, (_, name: string) => {
    const n = name.toLowerCase();
    if (n === "primary" || n === "control" || n === "ctrl") mods.push("ctrl");
    else if (n === "alt" || n === "mod1") mods.push("alt");
    else if (n === "shift") mods.push("shift");
    else if (n === "super" || n === "meta" || n === "mod4") mods.push("meta");
    return "";
  });
  const key = keyFromKeysym(rest);
  return key ? combo(mods, key) : null;
}

/** Turns gsettings key names into sentences: "switch-to-workspace-1" → "Switch to workspace 1". */
function humanize(key: string) {
  return titleCase(key.replace(/-/g, " ").replace(/\bws\b/g, "workspace"));
}

const GNOME_SCHEMAS: Array<{ schema: string; group: string }> = [
  { schema: "org.gnome.desktop.wm.keybindings", group: "Windows" },
  { schema: "org.gnome.shell.keybindings", group: "GNOME Shell" },
  { schema: "org.gnome.mutter.keybindings", group: "Windows" },
  { schema: "org.gnome.settings-daemon.plugins.media-keys", group: "Launchers" },
];

export function decodeGsettings(text: string, group: string): SystemBinding[] {
  const out: SystemBinding[] = [];
  for (const line of text.split("\n")) {
    const match = /^(\S+)\s+(\S+)\s+(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, schema, key, value] = match;
    // Values are GVariant string lists (['<Super>d']) or a plain string ('<Super>d').
    const accels = [...value.matchAll(/'([^']*)'/g)].map((m) => m[1]).filter(Boolean);
    accels.forEach((accel, i) => {
      const parsed = parseGtkAccelerator(accel);
      if (parsed) out.push({ id: `gnome-${schema}-${key}-${i}`, name: humanize(key), group, owner: "GNOME", combo: parsed, configured: true });
    });
  }
  return out;
}

/** KDE shortcuts: "Meta+Shift+S", "Ctrl+Alt+T". */
export function parseKdeShortcut(text: string): KeyCombo | null {
  const parts = text.split("+").map((p) => p.trim());
  // A trailing "+" key appears as "Ctrl++".
  if (text.endsWith("++")) parts.splice(parts.length - 2, 2, "+");
  const mods: Modifier[] = [];
  let key = "";
  for (const part of parts) {
    const p = part.toLowerCase();
    if (p === "ctrl" || p === "control") mods.push("ctrl");
    else if (p === "alt") mods.push("alt");
    else if (p === "shift") mods.push("shift");
    else if (p === "meta" || p === "super" || p === "win") mods.push("meta");
    else key = keyFromKeysym(part);
  }
  return key ? combo(mods, key) : null;
}

export function decodeKdeShortcuts(text: string): SystemBinding[] {
  const out: SystemBinding[] = [];
  let section = "";
  for (const line of text.split("\n")) {
    const header = /^\[(.+)\]$/.exec(line.trim());
    if (header) {
      section = header[1];
      continue;
    }
    const eq = line.indexOf("=");
    if (!section || eq <= 0 || line.startsWith("_k_friendly_name")) continue;
    const action = line.slice(0, eq);
    // "_launch" is an app's own launch shortcut (Ctrl+Alt+T → Konsole); other "_" keys are metadata.
    if (action.startsWith("_") && action !== "_launch") continue;
    // value: "current shortcuts\tmore,default,Friendly description"
    const fields = line.slice(eq + 1).split(",");
    const current = fields[0] ?? "";
    const description = fields.slice(2).join(",").trim() || humanize(action);
    if (!current || current === "none") continue;
    current.split("\t").forEach((shortcut, i) => {
      const parsed = parseKdeShortcut(shortcut);
      if (parsed) out.push({ id: `kde-${section}-${action}-${i}`, name: description, group: section === "kwin" ? "Windows" : section.endsWith(".desktop") ? "App launchers" : section, owner: "KDE", combo: parsed, configured: true });
    });
  }
  return out;
}

async function linuxBindings(): Promise<{ bindings: SystemBinding[]; sources: string[] }> {
  const bindings: SystemBinding[] = [];
  const sources: string[] = [];
  const desktop = (process.env.XDG_CURRENT_DESKTOP ?? "").toLowerCase();

  if (hyprlandAvailable()) {
    const { stdout, code } = await run("hyprctl", ["binds", "-j"], 4000);
    if (code === 0) {
      try {
        bindings.push(...decodeHyprBinds(JSON.parse(stdout) as HyprBind[]));
        sources.push("hyprctl binds");
      } catch {
        // older Hyprland without JSON output
      }
    }
  }
  if (desktop.includes("gnome") || desktop.includes("unity") || desktop.includes("cinnamon") || desktop.includes("budgie")) {
    for (const { schema, group } of GNOME_SCHEMAS) {
      const { stdout, code } = await run("gsettings", ["list-recursively", schema], 4000);
      if (code === 0) bindings.push(...decodeGsettings(stdout, group));
    }
    sources.push("GNOME keyboard settings");
  }
  if (desktop.includes("kde")) {
    const file = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "kglobalshortcutsrc");
    try {
      bindings.push(...decodeKdeShortcuts(readFileSync(file, "utf8")));
      sources.push("KDE global shortcuts");
    } catch {
      // not configured yet
    }
  }
  const common = [
    W("Copy", "Every app", ["ctrl"], "C"),
    W("Paste", "Every app", ["ctrl"], "V"),
    W("Cut", "Every app", ["ctrl"], "X"),
    W("Undo", "Every app", ["ctrl"], "Z"),
    W("Select all", "Every app", ["ctrl"], "A"),
    W("Save", "Every app", ["ctrl"], "S"),
    W("Find", "Every app", ["ctrl"], "F"),
    W("Close tab or document", "Every app", ["ctrl"], "W"),
    W("Quit app", "Every app", ["ctrl"], "Q"),
  ];
  bindings.push(...common.map((b, i) => ({ ...b, id: `linux-app-${i}`, owner: "Apps" })));
  sources.push("Common app shortcuts");
  return { bindings, sources };
}

// ── Entry point ──────────────────────────────────────────────────────────────────────────────

const GROUP_ORDER = [
  "System", "Spotlight", "Screenshots", "Mission Control", "Windows & desktops", "Apps & files", "Taskbar", "Input Sources",
  "Launchpad & Dock", "Keyboard", "Accessibility", "Hyprland", "Windows", "GNOME Shell", "Launchers", "App launchers",
  "Every app",
];

let cache: { at: number; report: SystemBindingsReport } | null = null;
const TTL = 30_000;

export async function systemBindings(): Promise<SystemBindingsReport> {
  if (cache && Date.now() - cache.at < TTL) return cache.report;
  const { bindings, sources } =
    process.platform === "win32" ? windowsBindings() : process.platform === "linux" ? await linuxBindings() : await macBindings();
  // One row per name and combo: GNOME lists some keys under two schemas.
  const seen = new Set<string>();
  const unique = bindings.filter((b) => {
    const key = `${b.name}|${comboId(b.combo)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Most-reached-for first; anything unlisted (Hyprland, KDE sections) keeps its own order after.
  const rank = (group: string) => {
    const index = GROUP_ORDER.indexOf(group);
    return index === -1 ? GROUP_ORDER.length - 1.5 : index;
  };
  unique.sort((a, b) => rank(a.group) - rank(b.group));
  for (const b of unique) b.kind ??= b.owner === "Apps" ? "app" : "os";
  const report: SystemBindingsReport = { bindings: unique, sources, probed: false };
  cache = { at: Date.now(), report };
  return report;
}
