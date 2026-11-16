import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ProcessGroup, StartupItem, StartupReport, StartupToggleResult } from "../../types";
import { run } from "../exec";
import { appDataFile } from "../paths";
import { sampler } from "../sampler";
import { AUTOSTART_SYSTEM_DIRS, AUTOSTART_USER_DIR, iconFile, parseDesktopEntry, programOf, type DesktopEntry } from "./apps";

/**
 * What starts on its own on a Linux desktop:
 * - XDG autostart entries (~/.config/autostart and /etc/xdg/autostart), which systemd or the
 *   desktop runs at login. Turning one off writes `Hidden=true` into the user's copy, the
 *   standard per-user override, so system files are never touched.
 * - Enabled systemd user services, and enabled system services (which need an administrator).
 * Units Systo turned off are remembered, so they stay in the list to be turned back on.
 */

type Scope = "user" | "system";

const UNIT_NAME = /^[\w@.:\\-]+\.service$/;
/** systemd's own plumbing, which nobody should be toggling from a process manager. */
const HIDDEN_UNITS = /^(systemd-|getty@|autovt@|dbus-|user@|user-runtime-dir@|initrd-|emergency|rescue|kmod-|modprobe@)/;
const STATE_FILE = appDataFile("startup-linux.json");

interface State {
  /** Units Systo disabled: "user:foo.service", "system:bar.service". */
  disabled: string[];
}

function loadState(): State {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<State>;
    return { disabled: Array.isArray(parsed.disabled) ? parsed.disabled.filter((v) => typeof v === "string") : [] };
  } catch {
    return { disabled: [] };
  }
}

function saveState(state: State) {
  try {
    mkdirSync(join(STATE_FILE, ".."), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (error) {
    console.error("[systo] couldn't save startup state", error);
  }
}

function impactOf(running: boolean, memory: number, cpu: number): StartupItem["impact"] {
  if (!running) return "none";
  if (memory > 600 * 1024 * 1024 || cpu > 15) return "high";
  if (memory > 150 * 1024 * 1024 || cpu > 3) return "medium";
  return "low";
}

// ── XDG autostart ──────────────────────────────────────────────────────────────────────────

interface AutostartEntry extends DesktopEntry {
  /** The file name shared by a system entry and the user's override of it. */
  fileName: string;
  enabled: boolean;
}

function appliesHere(entry: DesktopEntry): boolean {
  const desktops = (process.env.XDG_CURRENT_DESKTOP ?? "").split(":").filter(Boolean);
  if (entry.onlyShowIn.length && !entry.onlyShowIn.some((d) => desktops.includes(d))) return false;
  if (entry.notShowIn.some((d) => desktops.includes(d))) return false;
  return true;
}

/**
 * Autostart entries by file name, the highest-priority copy deciding: the user's directory first,
 * then the system ones. A copy that isn't shown (wrong desktop, nothing to run) still replaces
 * the ones below it, and a bare `Hidden=true` override takes its name and command from the
 * entry it turns off.
 */
export function autostartEntries(dirs = [AUTOSTART_USER_DIR, ...AUTOSTART_SYSTEM_DIRS]): AutostartEntry[] {
  const found = new Map<string, AutostartEntry | null>();
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const fileName of names) {
      if (!fileName.endsWith(".desktop")) continue;
      const above = found.get(fileName);
      // Settled by a copy above, unless that one only said "off" and left the rest to this one.
      if (found.has(fileName) && (!above || above.exec)) continue;
      const file = join(dir, fileName);
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const entry = parseDesktopEntry(file, text);
      if (!entry || !appliesHere(entry)) {
        found.set(fileName, null);
        continue;
      }
      const off = entry.hidden || /^X-GNOME-Autostart-enabled\s*=\s*false\s*$/m.test(text);
      if (above) found.set(fileName, entry.exec ? { ...entry, fileName, enabled: false } : null);
      else found.set(fileName, entry.exec || off ? { ...entry, fileName, enabled: !off } : null);
    }
  }
  return [...found.values()].filter((entry): entry is AutostartEntry => Boolean(entry?.exec));
}

/** Memory, CPU and pids of the processes a command line starts, matched by program name. */
function usageByProgram(groups: ProcessGroup[], program: string) {
  let memory = 0;
  let cpu = 0;
  const pids: number[] = [];
  if (program) {
    for (const g of groups) {
      const match = g.processes.filter((p) => (program.startsWith("/") ? p.path === program : p.name === program));
      if (!match.length) continue;
      // The whole app when the program is its main process, otherwise just the matching processes.
      const whole = match.some((p) => p.pid === g.headPid);
      const counted = whole ? g.processes : match;
      memory += counted.reduce((s, p) => s + p.memory, 0);
      cpu += counted.reduce((s, p) => s + p.cpu, 0);
      pids.push(...counted.map((p) => p.pid));
    }
  }
  return { memory, cpu: cpu / (sampler().snapshot?.totals.cores ?? 1), pids };
}

function setHidden(text: string, hidden: boolean): string {
  const lines = text.split("\n").filter((line) => !/^(Hidden|X-GNOME-Autostart-enabled)\s*=/.test(line.trim()));
  if (!hidden) return lines.join("\n");
  const at = lines.findIndex((line) => line.trim() === "[Desktop Entry]");
  lines.splice(at + 1, 0, "Hidden=true");
  return lines.join("\n");
}

export function toggleAutostart(fileName: string, enabled: boolean, userDir = AUTOSTART_USER_DIR, systemDirs = AUTOSTART_SYSTEM_DIRS): StartupToggleResult {
  if (!/^[^/\0]+\.desktop$/.test(fileName)) return { ok: false, needsAdmin: false, message: "Unknown startup item." };
  const userFile = join(userDir, fileName);
  const system = systemDirs.map((dir) => join(dir, fileName)).find((file) => existsSync(file));
  const source = existsSync(userFile) ? userFile : system;
  if (!source) return { ok: false, needsAdmin: false, message: "That startup item is gone." };
  try {
    const text = setHidden(readFileSync(source, "utf8"), !enabled);
    // Back on, and either identical to the system entry or with no command of its own: the
    // override has nothing left to say, and kept around it would hide the entry it sits on.
    const spent = text === (system ? readFileSync(system, "utf8") : null) || !parseDesktopEntry(userFile, text)?.exec;
    if (enabled && system && existsSync(userFile) && spent) rmSync(userFile);
    else {
      mkdirSync(userDir, { recursive: true });
      writeFileSync(userFile, text);
    }
  } catch (error) {
    return { ok: false, needsAdmin: false, message: `Couldn't change it: ${(error as Error).message}` };
  }
  return { ok: true, needsAdmin: false, message: enabled ? "Turned on. It starts the next time you log in." : "Turned off. It won't start when you log in." };
}

// ── systemd ────────────────────────────────────────────────────────────────────────────────

interface Unit {
  scope: Scope;
  name: string;
  enabled: boolean;
  description: string;
  program: string;
  fragment: string;
  active: boolean;
  mainPid: number;
  memory: number;
}

const systemctl = (scope: Scope, args: string[], timeout = 6000) => run("systemctl", [...(scope === "user" ? ["--user"] : []), "--no-pager", ...args], timeout);

async function units(scope: Scope, remembered: string[]): Promise<Unit[]> {
  const listed = await systemctl(scope, ["list-unit-files", "--type=service", "--state=enabled", "--no-legend", "--plain"]);
  const names = new Map<string, boolean>();
  for (const line of listed.stdout.split("\n")) {
    const name = line.trim().split(/\s+/)[0];
    if (name && UNIT_NAME.test(name) && !name.includes("@.") && !HIDDEN_UNITS.test(name)) names.set(name, true);
  }
  for (const name of remembered) if (UNIT_NAME.test(name) && !names.has(name)) names.set(name, false);
  if (!names.size) return [];

  const shown = await systemctl(scope, ["show", ...names.keys(), "-p", "Id,Description,ExecStart,FragmentPath,ActiveState,MainPID,MemoryCurrent,UnitFileState,LoadState"]);
  const result: Unit[] = [];
  for (const block of shown.stdout.split(/\n\s*\n/)) {
    const props: Record<string, string> = {};
    for (const line of block.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) props[line.slice(0, eq)] = line.slice(eq + 1);
    }
    const name = props.Id;
    if (!name || !names.has(name) || props.LoadState === "not-found") continue;
    const memory = Number(props.MemoryCurrent);
    result.push({
      scope,
      name,
      enabled: props.UnitFileState ? props.UnitFileState === "enabled" || props.UnitFileState === "enabled-runtime" : names.get(name)!,
      description: props.Description ?? "",
      // ExecStart={ path=/usr/bin/foo ; argv[]=/usr/bin/foo --bar ; … }
      program: /argv\[\]=(.*?) ; /.exec(props.ExecStart ?? "")?.[1] ?? /path=(\S+)/.exec(props.ExecStart ?? "")?.[1] ?? "",
      fragment: props.FragmentPath ?? "",
      active: props.ActiveState === "active" || props.ActiveState === "activating",
      mainPid: Number(props.MainPID) || 0,
      memory: Number.isFinite(memory) && memory < 2 ** 53 ? memory : 0,
    });
  }
  return result;
}

async function toggleUnit(scope: Scope, name: string, enabled: boolean, useAdmin: boolean): Promise<StartupToggleResult> {
  if (!UNIT_NAME.test(name)) return { ok: false, needsAdmin: false, message: "Unknown startup item." };
  const verb = enabled ? "enable" : "disable";
  let result;
  if (scope === "system") {
    if (!useAdmin) return { ok: false, needsAdmin: true, message: "System services need an administrator password." };
    result = await run("pkexec", ["systemctl", verb, name], 120000);
    if (result.code === 126) return { ok: false, needsAdmin: false, message: "The administrator prompt was cancelled." };
    if (result.code === 127) return { ok: false, needsAdmin: false, message: "No polkit agent is running to ask for the password." };
  } else {
    result = await systemctl("user", [verb, name], 15000);
  }
  if (result.code !== 0) return { ok: false, needsAdmin: false, message: result.stderr.trim().split("\n")[0] || "systemd refused the change." };
  const state = loadState();
  const key = `${scope}:${name}`;
  state.disabled = enabled ? state.disabled.filter((k) => k !== key) : [...new Set([...state.disabled, key])];
  saveState(state);
  const when = scope === "system" ? "the PC boots" : "you log in";
  return { ok: true, needsAdmin: false, message: enabled ? `Turned on. It starts the next time ${when}.` : `Turned off. It won't start when ${when}.` };
}

// ── Report ─────────────────────────────────────────────────────────────────────────────────

const encodeId = (parts: string[]) => `linux:${Buffer.from(JSON.stringify(parts)).toString("base64url")}`;

function decodeId(id: string): string[] | null {
  if (!id.startsWith("linux:")) return null;
  try {
    const parts = JSON.parse(Buffer.from(id.slice(6), "base64url").toString("utf8")) as unknown;
    return Array.isArray(parts) && parts.every((p) => typeof p === "string") ? (parts as string[]) : null;
  } catch {
    return null;
  }
}

let cached: { at: number; autostart: AutostartEntry[]; units: Unit[] } | null = null;

export async function startupReportLinux(force = false): Promise<StartupReport> {
  const snapshotPromise = sampler().current();
  if (force || !cached || Date.now() - cached.at > 10_000) {
    const remembered = loadState().disabled;
    const pick = (scope: Scope) => remembered.filter((k) => k.startsWith(`${scope}:`)).map((k) => k.slice(scope.length + 1));
    const [user, system] = await Promise.all([units("user", pick("user")).catch(() => []), units("system", pick("system")).catch(() => [])]);
    cached = { at: Date.now(), autostart: autostartEntries(), units: [...user, ...system] };
  }
  const snapshot = await snapshotPromise;
  const cores = sampler().snapshot?.totals.cores ?? 1;
  const rows = new Map(snapshot.groups.flatMap((g) => g.processes).map((p) => [p.pid, p]));
  const items: StartupItem[] = [];

  for (const entry of cached.autostart) {
    const program = programOf(entry.exec);
    const use = usageByProgram(snapshot.groups, program.startsWith("/") ? program : basename(program));
    const running = use.pids.length > 0;
    items.push({
      id: encodeId(["autostart", entry.fileName]),
      kind: "login-item",
      name: entry.name,
      appName: entry.comment || undefined,
      bundlePath: entry.file,
      hasIcon: Boolean(await iconFile(entry.icon)),
      program: entry.exec,
      plistPath: entry.file,
      schedule: "At login",
      enabled: entry.enabled,
      blockedBySettings: false,
      needsAdmin: false,
      running,
      pids: use.pids,
      memory: use.memory,
      cpu: use.cpu,
      impact: impactOf(running, use.memory, use.cpu),
    });
  }

  for (const unit of cached.units) {
    const main = unit.mainPid ? rows.get(unit.mainPid) : undefined;
    const memory = unit.memory || main?.memory || 0;
    const cpu = (main?.cpu ?? 0) / cores;
    items.push({
      id: encodeId(["unit", unit.scope, unit.name]),
      kind: unit.scope === "user" ? "agent" : "daemon",
      name: unit.description || unit.name.replace(/\.service$/, ""),
      label: unit.name,
      hasIcon: false,
      program: unit.program || undefined,
      plistPath: unit.fragment || undefined,
      schedule: unit.scope === "user" ? "With your session" : "At boot",
      enabled: unit.enabled,
      blockedBySettings: false,
      needsAdmin: unit.scope === "system",
      running: unit.active,
      pids: unit.mainPid ? [unit.mainPid] : [],
      memory: unit.active ? memory : 0,
      cpu: unit.active ? cpu : 0,
      impact: impactOf(unit.active, memory, cpu),
    });
  }

  const order = { "login-item": 0, "login-helper": 1, agent: 2, daemon: 3 } as const;
  items.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
  return { items, loginItemsReadable: true, at: Date.now() };
}

export async function setStartupItemLinux(id: string, enabled: boolean, useAdmin: boolean): Promise<StartupToggleResult> {
  const parts = decodeId(id);
  let result: StartupToggleResult = { ok: false, needsAdmin: false, message: "Unknown startup item." };
  if (parts?.[0] === "autostart" && parts.length === 2) result = toggleAutostart(parts[1], enabled);
  else if (parts?.[0] === "unit" && parts.length === 3 && (parts[1] === "user" || parts[1] === "system")) {
    result = await toggleUnit(parts[1], parts[2], enabled, useAdmin);
  }
  if (result.ok) cached = null;
  return result;
}

/** There's no single settings page for this on Linux; the autostart folder is the closest thing. */
export async function openStartupSettingsLinux() {
  mkdirSync(AUTOSTART_USER_DIR, { recursive: true });
  await run("xdg-open", [AUTOSTART_USER_DIR], 4000);
}
