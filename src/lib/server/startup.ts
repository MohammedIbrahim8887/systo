import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import type { ProcessGroup, StartupItem, StartupKind, StartupReport, StartupToggleResult } from "../types";
import { getBundleSync, loadBundle, outermostBundle } from "./bundle";
import { output, run } from "./exec";
import { sampler } from "./sampler";

/**
 * Startup items come from three places that System Settings > Login Items merges:
 * - "Open at Login" apps (System Events login items),
 * - launchd plists in ~/Library/LaunchAgents, /Library/LaunchAgents and /Library/LaunchDaemons,
 * - helpers apps register with ServiceManagement, which only the BTM database (sfltool) lists.
 *
 * Disabling never edits or deletes another app's files: launchd jobs get a launchctl override
 * (exactly what `launchctl enable` reverses), and login items are removed from the list and
 * remembered so they can be put back.
 */

const UID = userInfo().uid;
const STATE_FILE = join(homedir(), "Library", "Application Support", "Systo", "startup.json");
const BTM_TTL = 120_000;

interface SavedLoginItem {
  name: string;
  path: string;
  hidden: boolean;
  at: number;
}

interface State {
  disabledLoginItems: SavedLoginItem[];
}

function loadState(): State {
  try {
    return { disabledLoginItems: [], ...(JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<State>) };
  } catch {
    return { disabledLoginItems: [] };
  }
}

function saveState(state: State) {
  mkdirSync(join(STATE_FILE, ".."), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── BTM ────────────────────────────────────────────────────────────────────────────────────

interface BtmRecord {
  uid: number;
  name?: string;
  developer?: string;
  type: string;
  enabled: boolean;
  allowed: boolean;
  identifier: string;
  url?: string;
  executable?: string;
  bundleId?: string;
  parent?: string;
}

function parseBtm(text: string): BtmRecord[] {
  const records: BtmRecord[] = [];
  let uid = -2;
  let current: BtmRecord | null = null;
  const value = (v: string) => (v === "(null)" ? undefined : v);
  for (const line of text.split("\n")) {
    const section = /Records for UID (-?\d+)/.exec(line);
    if (section) {
      uid = Number(section[1]);
      continue;
    }
    if (/^\s*#\d+:\s*$/.test(line)) {
      if (current) records.push(current);
      current = { uid, type: "", enabled: false, allowed: false, identifier: "" };
      continue;
    }
    if (!current) continue;
    const m = /^\s+([A-Za-z ]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, raw] = m;
    switch (key.trim()) {
      case "Name":
        current.name = value(raw.trim());
        break;
      case "Developer Name":
        current.developer = value(raw.trim());
        break;
      case "Type":
        current.type = raw.replace(/\s*\(0x[0-9a-f]+\)/i, "").trim();
        break;
      case "Disposition":
        current.enabled = /\benabled\b/.test(raw);
        current.allowed = /\ballowed\b/.test(raw) && !/\bdisallowed\b/.test(raw);
        break;
      case "Identifier":
        current.identifier = raw.trim();
        break;
      case "URL":
        current.url = value(raw.trim());
        break;
      case "Executable Path":
        current.executable = value(raw.trim());
        break;
      case "Bundle Identifier":
        current.bundleId = value(raw.trim());
        break;
      case "Parent Identifier":
        current.parent = value(raw.trim());
        break;
    }
  }
  if (current) records.push(current);
  return records;
}

function fileUrlToPath(url: string) {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/\/$/, "");
  } catch {
    return url;
  }
}

let btmCache: { at: number; records: Promise<BtmRecord[]> } | null = null;

function btm(force = false): Promise<BtmRecord[]> {
  if (!btmCache || force || Date.now() - btmCache.at > BTM_TTL) {
    // sfltool never finishes writing to a pipe, so it dumps into a file instead.
    const file = join(tmpdir(), `systo-btm-${process.pid}.txt`);
    const records = run("/bin/sh", ["-c", '/usr/bin/sfltool dumpbtm > "$1" 2>/dev/null </dev/null', "sh", file], 30000)
      .then(() => parseBtm(readFileSync(file, "utf8")))
      .catch(() => []);
    btmCache = { at: Date.now(), records };
  }
  return btmCache.records;
}

// ── launchd ────────────────────────────────────────────────────────────────────────────────

interface Plist {
  Label?: string;
  Program?: string;
  ProgramArguments?: string[];
  RunAtLoad?: boolean;
  KeepAlive?: unknown;
  Disabled?: boolean;
  StartInterval?: number;
  StartCalendarInterval?: unknown;
  WatchPaths?: unknown;
}

const PLIST_DIRS: Array<{ dir: string; kind: StartupKind; domain: "gui" | "system" }> = [
  { dir: join(homedir(), "Library", "LaunchAgents"), kind: "agent", domain: "gui" },
  { dir: "/Library/LaunchAgents", kind: "agent", domain: "gui" },
  { dir: "/Library/LaunchDaemons", kind: "daemon", domain: "system" },
];

async function readPlistJson(file: string): Promise<Plist | null> {
  const text = await output("/usr/bin/plutil", ["-convert", "json", "-o", "-", file], 3000);
  try {
    return JSON.parse(text) as Plist;
  } catch {
    return null;
  }
}

async function overrides(domain: string): Promise<Map<string, boolean>> {
  const text = await output("/bin/launchctl", ["print-disabled", domain]);
  const map = new Map<string, boolean>();
  for (const m of text.matchAll(/"([^"]+)" => (enabled|disabled|true|false)/g)) map.set(m[1], m[2] === "disabled" || m[2] === "true");
  return map;
}

async function launchdPids(domain: string): Promise<Map<string, number>> {
  const text = await output("/bin/launchctl", ["print", domain], 6000);
  const map = new Map<string, number>();
  const start = text.indexOf("services = {");
  if (start === -1) return map;
  for (const line of text.slice(start).split("\n").slice(1)) {
    if (/^\t\}/.test(line)) break;
    const m = /^\s+(\d+)\s+\S+\s+(\S+)\s*$/.exec(line);
    if (m && Number(m[1]) > 0) map.set(m[2], Number(m[1]));
  }
  return map;
}

function scheduleOf(plist: Plist | null, kind: StartupKind): string {
  if (!plist) return kind === "login-helper" ? "At login" : "On demand";
  if (plist.KeepAlive === true || (plist.KeepAlive && typeof plist.KeepAlive === "object")) return "Always running";
  if (plist.StartInterval) {
    const minutes = Math.round(plist.StartInterval / 60);
    return minutes >= 60 ? `Every ${Math.round(minutes / 60)} h` : `Every ${Math.max(1, minutes)} min`;
  }
  if (plist.StartCalendarInterval) return "Scheduled";
  if (plist.RunAtLoad) return "At login";
  if (plist.WatchPaths) return "When files change";
  return "On demand";
}

// ── Login items ────────────────────────────────────────────────────────────────────────────

async function readLoginItems(): Promise<Array<{ name: string; path: string | null; hidden: boolean }> | null> {
  const script = `JSON.stringify(Application("System Events").loginItems().map(i => ({ name: i.name(), path: i.path(), hidden: i.hidden() })))`;
  const { stdout, code } = await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], 8000);
  if (code !== 0) return null;
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
}

// ── Assembly ───────────────────────────────────────────────────────────────────────────────

/** "com.google.keystone.agent" → "Google keystone agent", for jobs nothing better describes. */
function prettyLabel(label: string) {
  const parts = label.split(".").filter(Boolean);
  if (parts.length > 2 && /^(com|io|org|net|dev|sh|app|co|me|local|ch|de|uk|us)$/.test(parts[0])) parts.shift();
  const [company = label, ...rest] = parts;
  const words = rest.join(" ").replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return `${company[0].toUpperCase()}${company.slice(1)}${words ? ` ${words}` : ""}`;
}

function impactOf(running: boolean, memory: number, cpu: number, schedule: string): StartupItem["impact"] {
  if (!running) return "none";
  if (memory > 600 * 1024 * 1024 || cpu > 15) return "high";
  if (memory > 150 * 1024 * 1024 || cpu > 3 || schedule === "Always running") return "medium";
  return "low";
}

function usageFor(groups: ProcessGroup[], pids: number[], bundlePath?: string) {
  const matched = new Map<string, ProcessGroup>();
  for (const pid of pids) {
    const group = groups.find((g) => g.processes.some((p) => p.pid === pid));
    if (group) matched.set(group.id, group);
  }
  if (bundlePath) for (const g of groups) if (g.bundlePath === bundlePath) matched.set(g.id, g);
  let memory = 0;
  let cpu = 0;
  const all: number[] = [];
  for (const g of matched.values()) {
    memory += g.memory;
    cpu += g.cpu;
    all.push(...g.processes.map((p) => p.pid));
  }
  return { memory, cpu: cpu / (sampler().snapshot?.totals.cores ?? 1), pids: all };
}

async function bundleMeta(path?: string) {
  if (!path) return undefined;
  const bundle = getBundleSync(path) ?? (await loadBundle(path).catch(() => undefined));
  return bundle;
}

export async function startupReport(force = false): Promise<StartupReport> {
  const [records, loginItems, guiOverrides, systemOverrides, guiPids, systemPids, snapshot] = await Promise.all([
    btm(force),
    readLoginItems(),
    overrides(`gui/${UID}`),
    overrides("system"),
    launchdPids(`gui/${UID}`),
    launchdPids("system"),
    sampler().current(),
  ]);
  const groups = snapshot.groups;
  const state = loadState();
  const items: StartupItem[] = [];
  const mine = records.filter((r) => r.uid === UID || r.uid === 0 || r.uid === -2);
  const byIdentifier = new Map(mine.map((r) => [r.identifier, r]));
  const byPlist = new Map<string, BtmRecord>();
  for (const r of mine) if (r.url?.startsWith("file://") && r.url.endsWith(".plist")) byPlist.set(fileUrlToPath(r.url), r);
  const developerFor = (r?: BtmRecord) => r?.developer ?? (r?.parent ? byIdentifier.get(r.parent)?.developer : undefined);

  // Open at Login.
  const seenLogin = new Set<string>();
  const loginSource =
    loginItems ??
    records
      .filter((r) => r.uid === UID && r.type === "app" && r.enabled && r.url)
      .map((r) => ({ name: r.name ?? "App", path: fileUrlToPath(r.url!), hidden: false }));
  for (const item of loginSource) {
    const path = item.path ?? undefined;
    const bundlePath = path?.endsWith(".app") ? path : undefined;
    const bundle = await bundleMeta(bundlePath);
    const record = mine.find((r) => r.type === "app" && r.url && fileUrlToPath(r.url) === path);
    const use = usageFor(groups, [], bundlePath);
    const running = use.pids.length > 0;
    seenLogin.add(path ?? item.name);
    items.push({
      id: `login:${path ?? item.name}`,
      kind: "login-item",
      name: bundle?.name ?? item.name,
      developer: developerFor(record),
      appName: bundle?.name ?? item.name,
      bundlePath,
      hasIcon: Boolean(bundle?.iconFile || bundle?.hasAssetCatalog),
      program: path,
      schedule: item.hidden ? "At login, hidden" : "At login",
      enabled: true,
      blockedBySettings: false,
      needsAdmin: false,
      running,
      pids: use.pids,
      memory: use.memory,
      cpu: use.cpu,
      impact: impactOf(running, use.memory, use.cpu, "At login"),
    });
  }
  for (const saved of state.disabledLoginItems) {
    if (seenLogin.has(saved.path)) continue;
    const bundle = await bundleMeta(saved.path.endsWith(".app") ? saved.path : undefined);
    const use = usageFor(groups, [], saved.path);
    items.push({
      id: `login:${saved.path}`,
      kind: "login-item",
      name: bundle?.name ?? saved.name,
      appName: bundle?.name ?? saved.name,
      bundlePath: saved.path.endsWith(".app") ? saved.path : undefined,
      hasIcon: Boolean(bundle?.iconFile || bundle?.hasAssetCatalog),
      program: saved.path,
      schedule: "At login",
      enabled: false,
      blockedBySettings: false,
      needsAdmin: false,
      running: use.pids.length > 0,
      pids: use.pids,
      memory: use.memory,
      cpu: use.cpu,
      impact: "none",
    });
  }

  // launchd plists.
  const seenLabels = new Set<string>();
  for (const { dir, kind, domain } of PLIST_DIRS) {
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".plist"));
    } catch {
      continue;
    }
    const plists = await Promise.all(files.map(async (f) => ({ file: join(dir, f), plist: await readPlistJson(join(dir, f)) })));
    for (const { file, plist } of plists) {
      const label = plist?.Label ?? file.split("/").pop()!.replace(/\.plist$/, "");
      if (label.startsWith("com.apple.")) continue;
      seenLabels.add(label);
      const program = plist?.Program ?? plist?.ProgramArguments?.[0];
      const record = byPlist.get(file);
      const bundlePath = program ? outermostBundle(program) : undefined;
      const bundle = await bundleMeta(bundlePath);
      const override = (domain === "gui" ? guiOverrides : systemOverrides).get(label);
      const blocked = record ? !record.allowed : false;
      const enabled = !blocked && (override !== undefined ? !override : !plist?.Disabled);
      const pid = (domain === "gui" ? guiPids : systemPids).get(label);
      const schedule = scheduleOf(plist, kind);
      const use = usageFor(groups, pid ? [pid] : []);
      const running = Boolean(pid);
      items.push({
        id: `launchd:${domain}:${label}`,
        kind,
        name: bundle?.name ?? (record?.name && !/^(true|run\.sh|kextload)$/.test(record.name) ? record.name : prettyLabel(label)),
        label,
        developer: developerFor(record),
        appName: bundle?.name,
        bundlePath,
        hasIcon: Boolean(bundle?.iconFile || bundle?.hasAssetCatalog),
        program,
        plistPath: file,
        schedule,
        enabled,
        blockedBySettings: blocked,
        needsAdmin: domain === "system",
        running,
        pids: use.pids.length ? use.pids : pid ? [pid] : [],
        memory: use.memory,
        cpu: use.cpu,
        impact: impactOf(running, use.memory, use.cpu, schedule),
      });
    }
  }

  // Helpers registered through ServiceManagement, which live inside their app.
  for (const r of mine) {
    if (r.uid !== UID && r.type !== "daemon") continue;
    if (r.type !== "login item" && r.type !== "agent" && r.type !== "daemon") continue;
    const label = r.identifier.replace(/^\d+\./, "");
    if (!label || label.startsWith("com.apple.") || seenLabels.has(label)) continue;
    seenLabels.add(label);
    const parent = r.parent ? byIdentifier.get(r.parent) : undefined;
    const parentPath = parent?.url?.startsWith("file://") ? fileUrlToPath(parent.url) : undefined;
    if (parentPath && !existsSync(parentPath)) continue;
    const bundle = await bundleMeta(parentPath);
    const kind: StartupKind = r.type === "daemon" ? "daemon" : r.type === "agent" ? "agent" : "login-helper";
    const domain = kind === "daemon" ? "system" : "gui";
    const override = (domain === "gui" ? guiOverrides : systemOverrides).get(label);
    const blocked = !r.allowed;
    const enabled = r.enabled && !blocked && override !== true;
    const pid = (domain === "gui" ? guiPids : systemPids).get(label);
    const program = r.executable ?? (parentPath && r.url && !r.url.startsWith("file://") ? `${parentPath}/${r.url}` : undefined);
    const schedule = kind === "login-helper" ? "At login" : "On demand";
    const use = usageFor(groups, pid ? [pid] : []);
    const running = Boolean(pid);
    items.push({
      id: `launchd:${domain}:${label}`,
      kind,
      name: r.name && !/^(true|run\.sh)$/.test(r.name) ? r.name.replace(/\.app$/, "") : (bundle?.name ?? prettyLabel(label)),
      label,
      developer: developerFor(r),
      appName: bundle?.name ?? parent?.name,
      bundlePath: parentPath,
      hasIcon: Boolean(bundle?.iconFile || bundle?.hasAssetCatalog),
      program,
      schedule,
      enabled,
      blockedBySettings: blocked,
      needsAdmin: domain === "system",
      running,
      pids: use.pids.length ? use.pids : pid ? [pid] : [],
      memory: use.memory,
      cpu: use.cpu,
      impact: impactOf(running, use.memory, use.cpu, schedule),
    });
  }

  for (const item of items) if (/^[a-z][\w-]*(\.[\w-]+){2,}$/i.test(item.name)) item.name = prettyLabel(item.name);
  const order: Record<StartupKind, number> = { "login-item": 0, "login-helper": 1, agent: 2, daemon: 3 };
  items.sort((a, b) => order[a.kind] - order[b.kind] || (a.appName ?? a.name).localeCompare(b.appName ?? b.name));
  return { items, loginItemsReadable: loginItems !== null, at: Date.now() };
}

// ── Toggling ───────────────────────────────────────────────────────────────────────────────

const LABEL = /^[\w.@-]+$/;

async function admin(command: string): Promise<{ ok: boolean; cancelled: boolean; error: string }> {
  const { code, stderr } = await run("/usr/bin/osascript", ["-e", `do shell script "${command}" with administrator privileges`], 60000);
  return { ok: code === 0, cancelled: stderr.includes("-128"), error: stderr.trim() };
}

export async function setStartupItem(id: string, enabled: boolean, useAdmin: boolean): Promise<StartupToggleResult> {
  if (id.startsWith("login:")) return setLoginItem(id.slice(6), enabled);
  const m = /^launchd:(gui|system):(.+)$/.exec(id);
  if (!m || !LABEL.test(m[2])) return { ok: false, needsAdmin: false, message: "Unknown startup item." };
  const [, domain, label] = m;
  const verb = enabled ? "enable" : "disable";
  if (domain === "system") {
    if (!useAdmin) return { ok: false, needsAdmin: true, message: "System daemons need administrator permission." };
    const result = await admin(`/bin/launchctl ${verb} system/${label}`);
    if (result.ok) return { ok: true, needsAdmin: false, message: enabled ? "Enabled. It starts the next time the Mac restarts." : "Disabled. It won't start with the Mac." };
    return { ok: false, needsAdmin: false, message: result.cancelled ? "Administrator authorization was cancelled." : result.error || "Couldn't change it." };
  }
  const { code, stderr } = await run("/bin/launchctl", [verb, `gui/${UID}/${label}`]);
  if (code !== 0) return { ok: false, needsAdmin: false, message: stderr.trim() || "launchctl refused the change." };
  return { ok: true, needsAdmin: false, message: enabled ? "Enabled. It starts the next time you log in." : "Disabled. It won't start when you log in." };
}

async function setLoginItem(path: string, enabled: boolean): Promise<StartupToggleResult> {
  const state = loadState();
  if (!enabled) {
    const items = await readLoginItems();
    if (!items) return { ok: false, needsAdmin: false, message: "Systo needs permission to control System Events. Allow it in System Settings > Privacy & Security > Automation." };
    const item = items.find((i) => (i.path ?? i.name) === path);
    if (!item) return { ok: true, needsAdmin: false, message: "It's already off." };
    const script = `on run argv
  tell application "System Events" to delete (first login item whose name is (item 1 of argv))
end run`;
    const { code, stderr } = await run("/usr/bin/osascript", ["-e", script, item.name], 8000);
    if (code !== 0) return { ok: false, needsAdmin: false, message: stderr.trim() || "System Events refused the change." };
    if (item.path) {
      state.disabledLoginItems = state.disabledLoginItems.filter((s) => s.path !== item.path);
      state.disabledLoginItems.push({ name: item.name, path: item.path, hidden: item.hidden, at: Date.now() });
      saveState(state);
    }
    btmCache = null;
    return { ok: true, needsAdmin: false, message: `${item.name} won't open at login.` };
  }
  const saved = state.disabledLoginItems.find((s) => s.path === path);
  if (!existsSync(path)) return { ok: false, needsAdmin: false, message: "That app is no longer installed." };
  const script = `on run argv
  tell application "System Events" to make login item at end with properties {path:(item 1 of argv), hidden:((item 2 of argv) is "true")}
end run`;
  const { code, stderr } = await run("/usr/bin/osascript", ["-e", script, path, String(saved?.hidden ?? false)], 8000);
  if (code !== 0) return { ok: false, needsAdmin: false, message: stderr.trim() || "System Events refused the change." };
  state.disabledLoginItems = state.disabledLoginItems.filter((s) => s.path !== path);
  saveState(state);
  btmCache = null;
  return { ok: true, needsAdmin: false, message: `${saved?.name ?? "The app"} will open at login.` };
}

/** The BTM dump takes a few seconds, so read it ahead of the first visit to Startup. */
export function warmStartup() {
  void btm();
}

export async function openLoginItemsSettings() {
  await run("/usr/bin/open", ["x-apple.systempreferences:com.apple.LoginItems-Settings.extension"]);
}
