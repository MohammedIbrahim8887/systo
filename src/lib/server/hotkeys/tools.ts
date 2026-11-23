import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { run } from "../exec";
import { powershell } from "../win/apps";
import { MODIFIER_ORDER, parseKeyWord, parseModifierWord, type KeyCombo, type Modifier, type SystemBinding } from "../../hotkeys";
import { MAC_KEYCODES, macModifiers } from "./system";

/**
 * Shortcuts that hotkey tools and apps keep in files Systo can read. Each reader returns nothing
 * when its tool isn't set up, so the list only grows with what this computer actually uses.
 */

const HOME = homedir();
const combo = (mods: Iterable<Modifier>, key: string): KeyCombo => {
  const set = new Set(mods);
  return { mods: MODIFIER_ORDER.filter((m) => set.has(m)), key };
};

function read(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function firstFile(...files: string[]): string | null {
  return files.find((f) => existsSync(f)) ?? null;
}

const short = (text: string, max = 72) => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/** "open -na /Applications/Alacritty.app --args …" → "Open Alacritty". */
export function describeCommand(command: string): string {
  const app = /(?:open\s+(?:-[a-zA-Z]+\s+)*(?:-a\s+)?|launchOrFocus\(\s*)["']?(?:\/Applications\/)?([^"'\s/][^"'/]*?)(?:\.app)?["']?(?:\s|\)|$)/.exec(command);
  if (app && !app[1].startsWith("-")) return `Open ${app[1].trim()}`;
  const word = command.trim().split(/\s+/)[0]?.split("/").pop();
  return word ? `Run ${word}` : "Run a command";
}

// ── skhd (macOS) ─────────────────────────────────────────────────────────────────────────────

const SKHD_GROUPS: Record<string, Modifier[]> = {
  hyper: ["ctrl", "alt", "shift", "meta"],
  meh: ["ctrl", "alt", "shift"],
};

/** skhd: "shift + cmd - t : open -na Alacritty". Mode-scoped lines ("mode < …") are skipped. */
export function parseSkhd(text: string): SystemBinding[] {
  const out: SystemBinding[] = [];
  const lines = text.replace(/\\\n/g, " ").split("\n");
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(":") || /^\w+\s*</.test(trimmed)) return;
    const match = /^([^:]+?)\s*(?:\[[^\]]*\]\s*)?[:;]\s*(.*)$/.exec(trimmed);
    if (!match) return;
    const [, keys, command] = match;
    const dash = keys.lastIndexOf(" - ");
    const modsPart = dash === -1 ? "" : keys.slice(0, dash);
    const keyPart = (dash === -1 ? keys : keys.slice(dash + 3)).trim();
    const mods: Modifier[] = [];
    for (const word of modsPart.split("+").map((w) => w.trim()).filter(Boolean)) {
      if (SKHD_GROUPS[word]) mods.push(...SKHD_GROUPS[word]);
      else {
        const mod = parseModifierWord(word);
        if (mod) mods.push(mod);
      }
    }
    let key = parseKeyWord(keyPart);
    if (!key && /^0x[0-9a-f]+$/i.test(keyPart)) key = MAC_KEYCODES[parseInt(keyPart, 16)] ?? "";
    if (!key) return;
    out.push({ id: `skhd-${index}`, name: describeCommand(command), detail: short(command), group: "skhd", owner: "skhd", kind: "tool", combo: combo(mods, key), configured: true });
  });
  return out;
}

// ── AeroSpace (macOS) ────────────────────────────────────────────────────────────────────────

/** AeroSpace: `alt-shift-h = 'move left'` under [mode.main.binding]. */
export function parseAerospace(text: string): SystemBinding[] {
  const out: SystemBinding[] = [];
  let inMain = false;
  text.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    const section = /^\[(.+)\]$/.exec(trimmed);
    if (section) {
      inMain = section[1].replace(/\s/g, "") === "mode.main.binding";
      return;
    }
    if (!inMain) return;
    const match = /^([\w-]+)\s*=\s*(.+)$/.exec(trimmed);
    if (!match) return;
    const parts = match[1].split("-");
    const key = parseKeyWord(parts.pop() ?? "");
    const mods = parts.map(parseModifierWord).filter((m): m is Modifier => m !== null);
    if (!key) return;
    const command = match[2].replace(/^\[|\]$/g, "").replace(/'''|"""|['"]/g, "").trim();
    const name = command.startsWith("exec-and-forget") ? describeCommand(command.replace(/^exec-and-forget\s+/, "")) : command.split(",")[0].trim();
    out.push({ id: `aerospace-${index}`, name: name.charAt(0).toUpperCase() + name.slice(1), detail: short(command), group: "AeroSpace", owner: "AeroSpace", kind: "tool", combo: combo(mods, key), configured: true });
  });
  return out;
}

// ── Hammerspoon (macOS) ──────────────────────────────────────────────────────────────────────

/** Hammerspoon: hs.hotkey.bind({"cmd", "shift"}, "t", …), resolving simple `local hyper = {…}` tables. */
export function parseHammerspoon(text: string): SystemBinding[] {
  const tables = new Map<string, string>();
  for (const m of text.matchAll(/(?:local\s+)?(\w+)\s*=\s*\{([^{}]*)\}/g)) tables.set(m[1], m[2]);
  const out: SystemBinding[] = [];
  for (const m of text.matchAll(/hs\.hotkey\.bind\(\s*(\{[^}]*\}|\w+)\s*,\s*["']([^"']+)["']((?:(?!hs\.hotkey\.bind)[\s\S]){0,240})/g)) {
    const modsText = m[1].startsWith("{") ? m[1] : `{${tables.get(m[1]) ?? ""}}`;
    const mods = [...modsText.matchAll(/["']([^"']+)["']/g)].map((w) => parseModifierWord(w[1])).filter((x): x is Modifier => x !== null);
    const key = parseKeyWord(m[2]);
    if (!key) continue;
    const rest = m[3];
    const app = /launchOrFocus(?:ByBundleID)?\(\s*["']([^"']+)["']/.exec(rest);
    const message = /^\s*,\s*["']([^"']+)["']/.exec(rest);
    const name = app ? `Open ${app[1]}` : message ? message[1] : "Hammerspoon hotkey";
    out.push({ id: `hammerspoon-${m.index}`, name, group: "Hammerspoon", owner: "Hammerspoon", kind: "tool", combo: combo(mods, key), configured: true });
  }
  return out;
}

// ── macOS plists: Rectangle, Services, App Shortcuts ─────────────────────────────────────────

async function readPlistJson(file: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(file)) return null;
  const { stdout, code } = await run("/usr/bin/plutil", ["-convert", "json", "-o", "-", file], 4000);
  if (code !== 0) return null;
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const humanizeCamel = (key: string) => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Rectangle stores changed shortcuts as { keyCode, modifierFlags } per action. */
export function parseRectangle(plist: Record<string, unknown>): SystemBinding[] {
  const out: SystemBinding[] = [];
  for (const [action, value] of Object.entries(plist)) {
    if (!value || typeof value !== "object") continue;
    const { keyCode, modifierFlags } = value as { keyCode?: unknown; modifierFlags?: unknown };
    if (typeof keyCode !== "number" || typeof modifierFlags !== "number") continue;
    const key = MAC_KEYCODES[keyCode];
    if (!key) continue;
    out.push({ id: `rectangle-${action}`, name: humanizeCamel(action), group: "Rectangle", owner: "Rectangle", kind: "tool", combo: combo(macModifiers(modifierFlags), key), configured: true });
  }
  return out;
}

/** Cocoa key equivalents: "@$t" is ⇧⌘T, "~^\\UF702" is ⌃⌥←. */
export function parseKeyEquivalent(text: string): KeyCombo | null {
  const mods: Modifier[] = [];
  let i = 0;
  while (i < text.length - 1 && "@$~^".includes(text[i])) mods.push(parseModifierWord(text[i]) as Modifier), i++;
  const rest = text.slice(i);
  const arrows: Record<string, string> = { "": "Up", "": "Down", "": "Left", "": "Right", "\\UF700": "Up", "\\UF701": "Down", "\\UF702": "Left", "\\UF703": "Right" };
  let key = arrows[rest] ?? "";
  if (!key && rest.length === 1) {
    if (/[A-Z]/.test(rest)) mods.push("shift");
    key = rest === "\r" ? "Return" : rest === "\t" ? "Tab" : rest === " " ? "Space" : parseKeyWord(rest);
  }
  return key ? combo(mods, key) : null;
}

/** pbs.plist NSServicesStatus: Quick Actions and Services with a keyboard shortcut. */
export function parseServices(plist: Record<string, unknown>): SystemBinding[] {
  const status = (plist.NSServicesStatus ?? {}) as Record<string, { key_equivalent?: string; enabled_services_menu?: boolean }>;
  const out: SystemBinding[] = [];
  for (const [id, entry] of Object.entries(status)) {
    if (!entry?.key_equivalent || entry.enabled_services_menu === false) continue;
    const parsed = parseKeyEquivalent(entry.key_equivalent);
    if (!parsed) continue;
    // "(null) - New Alacritty Window - runWorkflowAsService" or "com.app - Title - selector"
    const parts = id.split(" - ");
    const name = parts.length >= 3 ? parts.slice(1, -1).join(" - ") : id;
    out.push({ id: `service-${id}`, name, group: "Services & Quick Actions", owner: "macOS Services", kind: "tool", combo: parsed, configured: true });
  }
  return out;
}

/**
 * `defaults find NSUserKeyEquivalents` prints each domain's App Shortcuts as an old-style plist:
 *   Found 1 keys in domain 'com.apple.Safari': { NSUserKeyEquivalents = { "Show Sidebar" = "@~s"; }; }
 */
export function parseDefaultsFind(text: string, appName: (domain: string) => string): SystemBinding[] {
  const out: SystemBinding[] = [];
  const blocks = text.split(/(?=Found \d+ keys? in domain ')/);
  for (const block of blocks) {
    const domain = /in domain '([^']+)'/.exec(block)?.[1];
    if (!domain) continue;
    const owner = domain === "Apple Global Domain" || domain === "NSGlobalDomain" ? "All apps" : appName(domain);
    for (const m of block.matchAll(/"?([^"=\n{};]+?)"?\s*=\s*"([^"]*)";/g)) {
      const title = m[1].trim();
      if (title === "NSUserKeyEquivalents") continue;
      const parsed = parseKeyEquivalent(m[2].replace(/\\\\/g, "\\"));
      if (!parsed) continue;
      out.push({ id: `appshortcut-${domain}-${title}`, name: title.replace(/\\033/g, " › "), group: "App Shortcuts", owner, kind: "tool", combo: parsed, configured: true, detail: owner === "All apps" ? "Menu item in every app" : `Menu item in ${owner}` });
    }
  }
  return out;
}

async function macTools(): Promise<{ bindings: SystemBinding[]; sources: string[] }> {
  const bindings: SystemBinding[] = [];
  const sources: string[] = [];
  const add = (label: string, found: SystemBinding[]) => {
    if (!found.length) return;
    bindings.push(...found);
    sources.push(label);
  };

  const skhd = firstFile(join(HOME, ".skhdrc"), join(HOME, ".config", "skhd", "skhdrc"));
  if (skhd) add("skhd", parseSkhd(read(skhd) ?? ""));
  const aerospace = firstFile(join(HOME, ".aerospace.toml"), join(HOME, ".config", "aerospace", "aerospace.toml"));
  if (aerospace) add("AeroSpace", parseAerospace(read(aerospace) ?? ""));
  const hammerspoon = firstFile(join(HOME, ".hammerspoon", "init.lua"));
  if (hammerspoon) add("Hammerspoon", parseHammerspoon(read(hammerspoon) ?? ""));

  const prefs = join(HOME, "Library", "Preferences");
  const rectangle = await readPlistJson(join(prefs, "com.knollsoft.Rectangle.plist"));
  if (rectangle) add("Rectangle", parseRectangle(rectangle));
  const pbs = await readPlistJson(join(prefs, "pbs.plist"));
  if (pbs) add("Services", parseServices(pbs));

  const { stdout } = await run("/usr/bin/defaults", ["find", "NSUserKeyEquivalents"], 8000);
  if (stdout.trim()) {
    const names = new Map<string, string>();
    for (const domain of new Set([...stdout.matchAll(/in domain '([^']+)'/g)].map((m) => m[1]))) {
      if (domain.includes(" ")) continue;
      const { stdout: found } = await run("/usr/bin/mdfind", [`kMDItemCFBundleIdentifier == '${domain.replace(/'/g, "")}'`], 3000);
      const path = found.split("\n").find((p) => p.endsWith(".app"));
      if (path) names.set(domain, path.split("/").pop()!.replace(/\.app$/, ""));
    }
    add("App Shortcuts", parseDefaultsFind(stdout, (d) => names.get(d) ?? d.split(".").pop() ?? d));
  }
  return { bindings, sources };
}

// ── Windows: shortcut keys on .lnk files, AutoHotkey ─────────────────────────────────────────

const LNK_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$shell = New-Object -ComObject WScript.Shell
$roots = @("$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs", "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs", [Environment]::GetFolderPath('Desktop'), "$env:PUBLIC\\Desktop")
foreach ($root in $roots) {
  Get-ChildItem -LiteralPath $root -Filter *.lnk -Recurse | ForEach-Object {
    $hotkey = $shell.CreateShortcut($_.FullName).Hotkey
    if ($hotkey -and $hotkey -ne '') { [Console]::Out.WriteLine((@{ name = $_.BaseName; hotkey = $hotkey; path = $_.FullName } | ConvertTo-Json -Compress)) }
  }
}
`;

/** WScript's Hotkey strings: "Ctrl+Alt+T", "Alt+Shift+F5". */
export function parsePlusCombo(text: string): KeyCombo | null {
  const parts = text.split("+").map((p) => p.trim()).filter(Boolean);
  const key = parseKeyWord(parts.pop() ?? "");
  const mods = parts.map(parseModifierWord).filter((m): m is Modifier => m !== null);
  return key ? combo(mods, key) : null;
}

/** AutoHotkey v1/v2 hotkey lines: "^!t::Run alacritty", "#Enter::". ^ Ctrl, ! Alt, + Shift, # Win. */
export function parseAutoHotkey(text: string, file: string): SystemBinding[] {
  const out: SystemBinding[] = [];
  text.split("\n").forEach((line, index) => {
    const m = /^\s*([~*$]*)([#!^+<>]*)([A-Za-z0-9]+|[-=,./;'[\]\\`])::\s*(.*)$/.exec(line);
    if (!m) return;
    const mods: Modifier[] = [];
    for (const ch of m[2]) {
      if (ch === "^") mods.push("ctrl");
      else if (ch === "!") mods.push("alt");
      else if (ch === "+") mods.push("shift");
      else if (ch === "#") mods.push("meta");
    }
    const key = parseKeyWord(m[3]);
    if (!key || !mods.length) return;
    const action = m[4].replace(/;.*$/, "").trim();
    const run = /^Run,?\s*["']?([^"',]+)/i.exec(action);
    const name = run ? describeCommand(run[1]) : action ? short(action, 48) : "AutoHotkey hotkey";
    out.push({ id: `ahk-${file}-${index}`, name, detail: file.split(/[\\/]/).pop(), group: "AutoHotkey", owner: "AutoHotkey", kind: "tool", combo: combo(mods, key), configured: true });
  });
  return out;
}

async function windowsTools(): Promise<{ bindings: SystemBinding[]; sources: string[] }> {
  const bindings: SystemBinding[] = [];
  const sources: string[] = [];
  const { stdout } = await powershell(LNK_SCRIPT, {}, 20000);
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    try {
      const item = JSON.parse(line) as { name: string; hotkey: string; path: string };
      const parsed = parsePlusCombo(item.hotkey);
      if (parsed) bindings.push({ id: `lnk-${item.path}`, name: `Open ${item.name}`, detail: "Shortcut key on a Start menu or desktop shortcut", group: "Shortcut keys", owner: "Windows shortcut", kind: "tool", combo: parsed, configured: true });
    } catch {
      // partial line
    }
  }
  if (bindings.length) sources.push("Shortcut keys on .lnk files");

  const startup = join(process.env.APPDATA || join(HOME, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  const scripts = [startup, join(HOME, "Documents", "AutoHotkey")].flatMap((dir) => {
    try {
      return readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".ahk")).map((f) => join(dir, f));
    } catch {
      return [];
    }
  });
  const ahk = scripts.flatMap((file) => parseAutoHotkey(read(file) ?? "", file));
  if (ahk.length) {
    bindings.push(...ahk);
    sources.push("AutoHotkey scripts");
  }
  return { bindings, sources };
}

// ── Entry point ──────────────────────────────────────────────────────────────────────────────

let cache: { at: number; value: { bindings: SystemBinding[]; sources: string[] } } | null = null;
const TTL = 60_000;

export async function toolBindings(force = false): Promise<{ bindings: SystemBinding[]; sources: string[] }> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.value;
  let value: { bindings: SystemBinding[]; sources: string[] } = { bindings: [], sources: [] };
  try {
    if (process.platform === "darwin") value = await macTools();
    else if (process.platform === "win32") value = await windowsTools();
  } catch (error) {
    console.error("[systo] couldn't read hotkey tools", error);
  }
  cache = { at: Date.now(), value };
  return value;
}
