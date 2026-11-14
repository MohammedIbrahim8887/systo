import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { run } from "../exec";
import { appDataDir } from "../paths";

/** What Explorer shows for an executable: its description, publisher and icon. */
export interface ExeInfo {
  path: string;
  /** FileDescription, e.g. "Google Chrome" for chrome.exe. */
  description: string;
  product: string;
  company: string;
  version: string;
  /** 32px PNG, base64. */
  icon: string;
}

const cache = new Map<string, ExeInfo>();
const queued = new Set<string>();
let loaded = false;
let running: Promise<void> | null = null;
let dirty = false;

function cacheFile() {
  return join(appDataDir(), "exe-info.json");
}

function loadCache() {
  if (loaded) return;
  loaded = true;
  try {
    for (const info of JSON.parse(readFileSync(cacheFile(), "utf8")) as ExeInfo[]) cache.set(info.path.toLowerCase(), info);
  } catch {
    // first run
  }
}

function saveCache() {
  if (!dirty) return;
  dirty = false;
  try {
    mkdirSync(appDataDir(), { recursive: true });
    writeFileSync(cacheFile(), JSON.stringify([...cache.values()]));
  } catch (error) {
    console.error("[systo] couldn't cache app info", error);
  }
}

const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
$paths = $env:SYSTO_PATHS | ConvertFrom-Json
foreach ($p in $paths) {
  $o = [ordered]@{ path = $p; description = ''; product = ''; company = ''; version = ''; icon = '' }
  try {
    $v = [Diagnostics.FileVersionInfo]::GetVersionInfo($p)
    if ($v.FileDescription) { $o.description = $v.FileDescription.Trim() }
    if ($v.ProductName) { $o.product = $v.ProductName.Trim() }
    if ($v.CompanyName) { $o.company = $v.CompanyName.Trim() }
    if ($v.ProductVersion) { $o.version = $v.ProductVersion.Trim() }
  } catch {}
  try {
    $i = [Drawing.Icon]::ExtractAssociatedIcon($p)
    if ($i) {
      $b = $i.ToBitmap(); $m = New-Object IO.MemoryStream
      $b.Save($m, [Drawing.Imaging.ImageFormat]::Png)
      $o.icon = [Convert]::ToBase64String($m.ToArray())
      $b.Dispose(); $i.Dispose(); $m.Dispose()
    }
  } catch {}
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress))
}
`;

/** Runs a PowerShell script without a console window. Values reach it through environment variables. */
export function powershell(script: string, env: Record<string, string> = {}, timeout = 20000) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    timeout,
    env,
  );
}

async function drain() {
  while (queued.size) {
    const batch = [...queued].slice(0, 40);
    for (const p of batch) queued.delete(p);
    const { stdout } = await powershell(SCRIPT, { SYSTO_PATHS: JSON.stringify(batch) }, 30000);
    const seen = new Set<string>();
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.startsWith("{")) continue;
      try {
        const info = JSON.parse(line) as ExeInfo;
        cache.set(info.path.toLowerCase(), info);
        seen.add(info.path.toLowerCase());
      } catch {
        // partial line
      }
    }
    // Remember failures too, so a locked file isn't retried every tick.
    for (const p of batch) {
      if (!seen.has(p.toLowerCase())) cache.set(p.toLowerCase(), { path: p, description: "", product: "", company: "", version: "", icon: "" });
    }
    dirty = true;
  }
  saveCache();
}

/** Cached info, or undefined while it's being read. Unknown paths are queued for the next batch. */
export function exeInfo(path: string): ExeInfo | undefined {
  if (!path) return undefined;
  loadCache();
  const hit = cache.get(path.toLowerCase());
  if (hit) return hit;
  queued.add(path);
  if (!running) running = drain().finally(() => (running = null));
  return undefined;
}

/** Waits for queued lookups, used where a complete answer matters more than speed. */
export async function exeInfoAsync(path: string): Promise<ExeInfo | undefined> {
  const hit = exeInfo(path);
  if (hit) return hit;
  await running;
  return cache.get(path.toLowerCase());
}

/** A friendly name: the file description unless it's empty or just the file name again. */
export function exeDisplayName(path: string, fallback: string): string {
  const info = path ? exeInfo(path) : undefined;
  const stem = basename(path || fallback).replace(/\.exe$/i, "");
  const description = info?.description || info?.product;
  if (description && description.toLowerCase() !== stem.toLowerCase() && description.length <= 48) return description;
  return stem || fallback;
}

export async function exeIcon(path: string): Promise<Buffer | null> {
  const info = await exeInfoAsync(path);
  return info?.icon ? Buffer.from(info.icon, "base64") : null;
}
