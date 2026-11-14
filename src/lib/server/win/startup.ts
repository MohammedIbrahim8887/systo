import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { ProcessGroup, StartupItem, StartupReport, StartupToggleResult } from "../../types";
import { run } from "../exec";
import { sampler } from "../sampler";
import { exeDisplayName, exeInfoAsync, powershell } from "./apps";

/**
 * Windows startup apps are what Task Manager's Startup apps page lists: the Run keys (per user and
 * per machine) and the two Startup folders. Turning one off never deletes it: like Task Manager,
 * Systo flips its byte under Explorer\StartupApproved, which Windows checks at sign-in.
 */

type Root = "HKEY_CURRENT_USER" | "HKEY_LOCAL_MACHINE";
type ApprovedKey = "Run" | "Run32" | "StartupFolder";

interface RawItem {
  source: "registry" | "folder";
  scope: "user" | "machine";
  root: Root;
  approvedKey: ApprovedKey;
  name: string;
  command: string;
  target: string;
  enabled: boolean;
}

const APPROVED = "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved";

const READ_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$out = New-Object System.Collections.ArrayList
function Approved($root, $sub, $name) {
  $key = Get-Item -LiteralPath "Registry::$root\\${APPROVED}\\$sub"
  if (-not $key) { return $true }
  $v = $key.GetValue($name)
  if ($v -is [byte[]] -and $v.Length -gt 0) { return (($v[0] -band 1) -eq 0) }
  return $true
}
$runs = @(
  @{ root = 'HKEY_CURRENT_USER'; key = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run'; approved = 'Run'; scope = 'user' },
  @{ root = 'HKEY_LOCAL_MACHINE'; key = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run'; approved = 'Run'; scope = 'machine' },
  @{ root = 'HKEY_LOCAL_MACHINE'; key = 'Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'; approved = 'Run32'; scope = 'machine' }
)
foreach ($r in $runs) {
  $item = Get-Item -LiteralPath ("Registry::" + $r.root + "\\" + $r.key)
  if (-not $item) { continue }
  foreach ($n in $item.GetValueNames()) {
    if (-not $n) { continue }
    [void]$out.Add([ordered]@{ source = 'registry'; scope = $r.scope; root = $r.root; approvedKey = $r.approved; name = $n; command = [string]$item.GetValue($n); target = ''; enabled = (Approved $r.root $r.approved $n) })
  }
}
$shell = New-Object -ComObject WScript.Shell
$folders = @(
  @{ path = [Environment]::GetFolderPath('Startup'); root = 'HKEY_CURRENT_USER'; scope = 'user' },
  @{ path = [Environment]::GetFolderPath('CommonStartup'); root = 'HKEY_LOCAL_MACHINE'; scope = 'machine' }
)
foreach ($f in $folders) {
  if (-not $f.path -or -not (Test-Path -LiteralPath $f.path)) { continue }
  foreach ($file in Get-ChildItem -LiteralPath $f.path -File -Force) {
    if ($file.Name -eq 'desktop.ini') { continue }
    $t = ''
    if ($file.Extension -eq '.lnk') { try { $t = $shell.CreateShortcut($file.FullName).TargetPath } catch {} }
    [void]$out.Add([ordered]@{ source = 'folder'; scope = $f.scope; root = $f.root; approvedKey = 'StartupFolder'; name = $file.Name; command = $file.FullName; target = $t; enabled = (Approved $f.root 'StartupFolder' $file.Name) })
  }
}
ConvertTo-Json -InputObject @($out.ToArray()) -Compress -Depth 3
`;

function expandEnv(value: string) {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? process.env[name.toUpperCase()] ?? whole);
}

/** The executable a Run command starts: quoted, an unquoted path with spaces, or the first word. */
export function programOf(command: string): string {
  const text = expandEnv(command.trim());
  if (text.startsWith('"')) return text.slice(1, text.indexOf('"', 1) > 0 ? text.indexOf('"', 1) : undefined);
  const exe = /^(.+?\.exe)(\s|$)/i.exec(text);
  if (exe) return exe[1];
  return text.split(/\s+/)[0] ?? "";
}

function encodeId(item: Pick<RawItem, "root" | "approvedKey" | "name">) {
  return `win:${Buffer.from(JSON.stringify([item.root, item.approvedKey, item.name])).toString("base64url")}`;
}

function decodeId(id: string): Pick<RawItem, "root" | "approvedKey" | "name"> | null {
  if (!id.startsWith("win:")) return null;
  try {
    const [root, approvedKey, name] = JSON.parse(Buffer.from(id.slice(4), "base64url").toString("utf8")) as string[];
    if (root !== "HKEY_CURRENT_USER" && root !== "HKEY_LOCAL_MACHINE") return null;
    if (approvedKey !== "Run" && approvedKey !== "Run32" && approvedKey !== "StartupFolder") return null;
    if (typeof name !== "string" || !name || /["\r\n\0]/.test(name)) return null;
    return { root, approvedKey, name };
  } catch {
    return null;
  }
}

function impactOf(running: boolean, memory: number, cpu: number): StartupItem["impact"] {
  if (!running) return "none";
  if (memory > 600 * 1024 * 1024 || cpu > 15) return "high";
  if (memory > 150 * 1024 * 1024 || cpu > 3) return "medium";
  return "low";
}

function usageFor(groups: ProcessGroup[], program: string) {
  const target = program.toLowerCase();
  let memory = 0;
  let cpu = 0;
  const pids: number[] = [];
  for (const g of groups) {
    if (!g.processes.some((p) => p.path.toLowerCase() === target)) continue;
    memory += g.memory;
    cpu += g.cpu;
    pids.push(...g.processes.map((p) => p.pid));
  }
  return { memory, cpu: cpu / (sampler().snapshot?.totals.cores ?? 1), pids };
}

let cached: { at: number; raw: RawItem[] } | null = null;

async function readRaw(force: boolean): Promise<RawItem[]> {
  if (!force && cached && Date.now() - cached.at < 15_000) return cached.raw;
  const { stdout } = await powershell(READ_SCRIPT, {}, 20000);
  let raw: RawItem[] = [];
  try {
    const parsed = JSON.parse(stdout.trim() || "[]") as RawItem[] | RawItem;
    raw = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    raw = cached?.raw ?? [];
  }
  cached = { at: Date.now(), raw };
  return raw;
}

export async function startupReportWindows(force = false): Promise<StartupReport> {
  const [raw, snapshot] = await Promise.all([readRaw(force), sampler().current()]);
  const items: StartupItem[] = [];
  for (const r of raw) {
    const program = r.source === "folder" ? (r.target || r.command) : programOf(r.command);
    const exe = /\.exe$/i.test(program) && existsSync(program) ? program : undefined;
    const info = exe ? await exeInfoAsync(exe) : undefined;
    const fallback = r.source === "folder" ? basename(r.name).replace(/\.(lnk|url|bat|cmd)$/i, "") : r.name;
    const use = exe ? usageFor(snapshot.groups, exe) : { memory: 0, cpu: 0, pids: [] };
    const running = use.pids.length > 0;
    items.push({
      id: encodeId(r),
      kind: r.scope === "user" ? "login-item" : "agent",
      name: exe ? exeDisplayName(exe, fallback) : fallback,
      developer: info?.company || undefined,
      appName: info?.product || undefined,
      bundlePath: exe,
      hasIcon: Boolean(exe) && (info ? Boolean(info.icon) : true),
      program: r.command,
      plistPath: r.source === "folder" ? r.command : undefined,
      schedule: "At sign-in",
      enabled: r.enabled,
      blockedBySettings: false,
      needsAdmin: r.root === "HKEY_LOCAL_MACHINE",
      running,
      pids: use.pids,
      memory: use.memory,
      cpu: use.cpu,
      impact: impactOf(running, use.memory, use.cpu),
    });
  }
  items.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "login-item" ? -1 : 1));
  return { items, loginItemsReadable: true, at: Date.now() };
}

export async function setStartupItemWindows(id: string, enabled: boolean, useAdmin: boolean): Promise<StartupToggleResult> {
  const item = decodeId(id);
  if (!item) return { ok: false, needsAdmin: false, message: "Unknown startup item." };
  const key = `${item.root}\\${APPROVED}\\${item.approvedKey}`;
  // Byte 0: 2 = on, 3 = off. Windows ignores the rest (a timestamp) when deciding.
  const data = `${enabled ? "02" : "03"}0000000000000000000000`;
  const args = ["add", key, "/v", item.name, "/t", "REG_BINARY", "/d", data, "/f"];
  const done = enabled ? "Turned on. It starts the next time you sign in." : "Turned off. It won't start when you sign in.";

  if (item.root === "HKEY_LOCAL_MACHINE") {
    if (!useAdmin) return { ok: false, needsAdmin: true, message: "Apps that start for every user need administrator permission." };
    const argLine = args.map((a) => (/[\s\\]/.test(a) ? `"${a}"` : a)).join(" ");
    const { code, stderr } = await powershell(
      `try { $p = Start-Process -FilePath reg.exe -ArgumentList $env:SYSTO_ARGS -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ErrorAction Stop; exit $p.ExitCode } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1223 }`,
      { SYSTO_ARGS: argLine },
      120000,
    );
    cached = null;
    if (code === 0) return { ok: true, needsAdmin: false, message: done };
    return { ok: false, needsAdmin: false, message: /cancel/i.test(stderr) ? "The administrator prompt was cancelled." : "Windows refused the change." };
  }

  const { code, stderr } = await run("reg.exe", args, 8000);
  cached = null;
  if (code !== 0) return { ok: false, needsAdmin: false, message: stderr.trim() || "Windows refused the change." };
  return { ok: true, needsAdmin: false, message: done };
}

export async function openStartupSettingsWindows() {
  await run("explorer.exe", ["ms-settings:startupapps"], 4000);
}
