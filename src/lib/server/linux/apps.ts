import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { run } from "../exec";
import { clients, hyprlandAvailable } from "./hyprland";

/** What a launcher shows for an app: a freedesktop .desktop entry. */
export interface DesktopEntry {
  /** Absolute path of the .desktop file; the icon route resolves the icon from it. */
  file: string;
  /** File name without .desktop, e.g. "google-chrome". */
  id: string;
  name: string;
  comment: string;
  exec: string;
  /** Basename of the program Exec starts. */
  program: string;
  icon: string;
  wmClass: string;
  terminal: boolean;
  noDisplay: boolean;
  hidden: boolean;
  /** Raw lists, for autostart entries limited to some desktops. */
  onlyShowIn: string[];
  notShowIn: string[];
}

const HOME = homedir();

function dataDirs(): string[] {
  const dirs = [
    process.env.XDG_DATA_HOME || join(HOME, ".local", "share"),
    ...(process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":"),
    "/var/lib/flatpak/exports/share",
    join(HOME, ".local", "share", "flatpak", "exports", "share"),
  ];
  return [...new Set(dirs.filter(Boolean).map((d) => d.replace(/\/+$/, "")))];
}

/** The program an Exec line starts, skipping `env VAR=x` prefixes and field codes. */
export function programOf(exec: string): string {
  const words = exec.match(/"[^"]*"|\S+/g) ?? [];
  for (const raw of words) {
    const word = raw.replace(/^"|"$/g, "");
    if (word === "env" || /^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || word.startsWith("-") || word.startsWith("%")) continue;
    return word;
  }
  return "";
}

export function parseDesktopEntry(file: string, text?: string): DesktopEntry | null {
  let body = text;
  if (body === undefined) {
    try {
      body = readFileSync(file, "utf8");
    } catch {
      return null;
    }
  }
  const values: Record<string, string> = {};
  let inMain = false;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inMain = trimmed === "[Desktop Entry]";
      continue;
    }
    if (!inMain || !trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) values[trimmed.slice(0, eq).trim()] ??= trimmed.slice(eq + 1).trim();
  }
  if (values.Type && values.Type !== "Application") return null;
  const exec = values.Exec ?? "";
  const list = (value: string | undefined) => (value ?? "").split(";").filter(Boolean);
  return {
    file,
    id: basename(file).replace(/\.desktop$/, ""),
    name: values.Name || basename(file).replace(/\.desktop$/, ""),
    comment: values.Comment ?? values.GenericName ?? "",
    exec,
    program: basename(programOf(exec)),
    icon: values.Icon ?? "",
    wmClass: values.StartupWMClass ?? "",
    terminal: values.Terminal === "true",
    noDisplay: values.NoDisplay === "true",
    hidden: values.Hidden === "true",
    onlyShowIn: list(values.OnlyShowIn),
    notShowIn: list(values.NotShowIn),
  };
}

function programScore(entry: DesktopEntry): number {
  const id = entry.id.toLowerCase();
  const program = entry.program.toLowerCase();
  return (id === program || id.endsWith(`.${program}`) ? 2 : 0) + (entry.noDisplay ? 0 : 1);
}

interface Index {
  at: number;
  byFile: Map<string, DesktopEntry>;
  byId: Map<string, DesktopEntry>;
  byClass: Map<string, DesktopEntry>;
  byProgram: Map<string, DesktopEntry>;
}

let index: Index | null = null;
const INDEX_TTL = 60_000;

function buildIndex(): Index {
  const built: Index = { at: Date.now(), byFile: new Map(), byId: new Map(), byClass: new Map(), byProgram: new Map() };
  // Earlier directories win, so a user's own entry overrides the system one.
  for (const dir of dataDirs()) {
    const apps = join(dir, "applications");
    let names: string[];
    try {
      names = readdirSync(apps, { recursive: true }) as string[];
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".desktop")) continue;
      const entry = parseDesktopEntry(join(apps, name));
      if (!entry || entry.hidden) continue;
      built.byFile.set(entry.file, entry);
      const id = entry.id.toLowerCase();
      if (!built.byId.has(id)) built.byId.set(id, entry);
      if (entry.wmClass && !built.byClass.has(entry.wmClass.toLowerCase())) built.byClass.set(entry.wmClass.toLowerCase(), entry);
      // Several entries can start one program (URL handlers, a terminal app wrapped in `foot …`).
      // The one named after the program wins, then one the launcher shows.
      const existing = built.byProgram.get(entry.program);
      if (entry.program && (!existing || programScore(entry) > programScore(existing))) built.byProgram.set(entry.program, entry);
    }
  }
  return built;
}

function entries(): Index {
  if (!index || Date.now() - index.at > INDEX_TTL) index = buildIndex();
  return index;
}

/** The entry for a window class, which on Wayland is normally the desktop file's id. */
export function entryForClass(windowClass: string): DesktopEntry | undefined {
  const key = windowClass.toLowerCase();
  const { byId, byClass, byProgram } = entries();
  return byClass.get(key) ?? byId.get(key) ?? byId.get(key.split(".").pop() ?? key) ?? byProgram.get(key);
}

/** The entry that starts this executable, for apps running without a window. */
export function entryForProgram(path: string, name: string): DesktopEntry | undefined {
  const { byProgram, byId } = entries();
  const program = basename(path) || name;
  const entry = byProgram.get(program) ?? byId.get(program.toLowerCase());
  // Hidden entries are URL handlers and the like, not the app itself.
  return entry && !entry.terminal && !entry.noDisplay ? entry : undefined;
}

export function entryForFile(file: string): DesktopEntry | undefined {
  return entries().byFile.get(file);
}

/** What an app launcher lists: visible entries, one per id, the user's own overriding the system's. */
export function launcherEntries(): DesktopEntry[] {
  return [...entries().byId.values()].filter((entry) => !entry.noDisplay && !entry.hidden && entry.exec);
}

// ── Windows ────────────────────────────────────────────────────────────────────────────────

let windowsCache: { at: number; value: Map<number, string> } | null = null;
let windowsPending: Promise<Map<number, string>> | null = null;
const WINDOWS_TTL = 2500;

/** True when the compositor can tell us which processes own windows (Hyprland). */
export function canListWindows(): boolean {
  return hyprlandAvailable();
}

async function readWindows(): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  for (const client of await clients()) {
    if (!client.pid || client.pid <= 0 || client.mapped === false) continue;
    if (!map.has(client.pid)) map.set(client.pid, client.class || client.initialClass || "");
  }
  return map;
}

/** pid → window class for every process that owns a window. Empty when the compositor can't say. */
export function windowOwners(): Promise<Map<number, string>> {
  if (!canListWindows()) return Promise.resolve(new Map());
  if (windowsCache && Date.now() - windowsCache.at < WINDOWS_TTL) return Promise.resolve(windowsCache.value);
  return (windowsPending ??= readWindows()
    .then((value) => {
      windowsCache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      windowsPending = null;
    }));
}

// ── Icons ──────────────────────────────────────────────────────────────────────────────────

let themeChain: { at: number; themes: string[] } | null = null;

function iconBases(): string[] {
  return [join(HOME, ".icons"), ...dataDirs().map((d) => join(d, "icons"))];
}

function configuredTheme(): string | undefined {
  for (const file of [join(HOME, ".config", "gtk-4.0", "settings.ini"), join(HOME, ".config", "gtk-3.0", "settings.ini")]) {
    try {
      const m = /^\s*gtk-icon-theme-name\s*=\s*(.+)$/m.exec(readFileSync(file, "utf8"));
      if (m) return m[1].trim();
    } catch {
      // try the next one
    }
  }
  return undefined;
}

async function themes(): Promise<string[]> {
  if (themeChain && Date.now() - themeChain.at < 5 * 60_000) return themeChain.themes;
  let current = configuredTheme();
  if (!current) {
    const { stdout, code } = await run("gsettings", ["get", "org.gnome.desktop.interface", "icon-theme"], 2000);
    if (code === 0) current = stdout.trim().replace(/^'|'$/g, "") || undefined;
  }
  const chain: string[] = [];
  const add = (theme: string, depth: number) => {
    if (!theme || chain.includes(theme) || depth > 5) return;
    chain.push(theme);
    for (const base of iconBases()) {
      try {
        const inherits = /^Inherits\s*=\s*(.+)$/m.exec(readFileSync(join(base, theme, "index.theme"), "utf8"))?.[1];
        for (const parent of (inherits ?? "").split(",")) add(parent.trim(), depth + 1);
        break;
      } catch {
        // theme isn't in this base
      }
    }
  };
  if (current) add(current, 0);
  for (const fallback of ["hicolor", "Adwaita"]) add(fallback, 0);
  themeChain = { at: Date.now(), themes: chain };
  return chain;
}

const SIZES = ["scalable", "64x64", "48x48", "96x96", "128x128", "256x256", "512x512", "32x32", "24x24", "22x22", "16x16"];
const iconCache = new Map<string, string | null>();

/** Absolute path of an icon file (svg or png) for a .desktop Icon value, searching the icon themes. */
export async function iconFile(icon: string): Promise<string | null> {
  if (!icon) return null;
  const cached = iconCache.get(icon);
  if (cached !== undefined) return cached;
  let found: string | null = null;
  if (icon.startsWith("/")) {
    found = /\.(png|svg)$/i.test(icon) && existsSync(icon) ? icon : null;
  } else {
    const name = icon.replace(/\.(png|svg|xpm)$/i, "");
    search: for (const theme of await themes()) {
      for (const base of iconBases()) {
        if (!existsSync(join(base, theme))) continue;
        for (const size of SIZES) {
          for (const dir of [join(base, theme, size, "apps"), join(base, theme, "apps", size.split("x")[0])]) {
            for (const ext of ["svg", "png"]) {
              const candidate = join(dir, `${name}.${ext}`);
              if (existsSync(candidate)) {
                found = candidate;
                break search;
              }
            }
          }
        }
      }
    }
    if (!found) {
      for (const dir of ["/usr/share/pixmaps", "/usr/local/share/pixmaps"]) {
        for (const ext of ["svg", "png"]) {
          const candidate = join(dir, `${name}.${ext}`);
          if (!found && existsSync(candidate)) found = candidate;
        }
      }
    }
  }
  iconCache.set(icon, found);
  return found;
}

/** Icon bytes for a .desktop file the index knows about, for /api/icon. */
export async function desktopIcon(file: string): Promise<{ data: Buffer; type: string } | null> {
  const entry = entryForFile(file) ?? (isAutostartFile(file) ? parseDesktopEntry(file) : null);
  if (!entry) return null;
  const path = await iconFile(entry.icon);
  if (!path) return null;
  try {
    return { data: readFileSync(path), type: path.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "image/png" };
  } catch {
    return null;
  }
}

export const AUTOSTART_USER_DIR = join(process.env.XDG_CONFIG_HOME || join(HOME, ".config"), "autostart");
export const AUTOSTART_SYSTEM_DIRS = (process.env.XDG_CONFIG_DIRS || "/etc/xdg").split(":").filter(Boolean).map((d) => join(d, "autostart"));

function isAutostartFile(file: string): boolean {
  return file.endsWith(".desktop") && [AUTOSTART_USER_DIR, ...AUTOSTART_SYSTEM_DIRS].some((dir) => file.startsWith(dir + "/") && !file.slice(dir.length + 1).includes("/"));
}
