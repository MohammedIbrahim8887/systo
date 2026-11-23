import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { LaunchableApp } from "../../hotkeys";
import { launcherEntries } from "../linux/apps";

/** Apps a shortcut can open, as the platform's launcher would list them. */

let cache: { at: number; apps: LaunchableApp[] } | null = null;
const TTL = 60_000;

function list(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function macApps(): LaunchableApp[] {
  const home = homedir();
  const roots: Array<{ dir: string; detail?: string }> = [
    { dir: "/Applications" },
    { dir: "/Applications/Utilities", detail: "Utilities" },
    { dir: "/System/Applications" },
    { dir: "/System/Applications/Utilities", detail: "Utilities" },
    { dir: join(home, "Applications") },
    { dir: join(home, "Applications", "Chrome Apps.localized"), detail: "Web app" },
  ];
  const apps: LaunchableApp[] = [{ path: "/System/Library/CoreServices/Finder.app", name: "Finder" }];
  for (const { dir, detail } of roots) {
    for (const name of list(dir)) {
      const path = join(dir, name);
      if (name.endsWith(".app")) {
        apps.push({ path, name: name.slice(0, -4), detail });
        continue;
      }
      // Suites install into folders: /Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app.
      if (name.startsWith(".") || name === "Utilities" || name.endsWith(".localized")) continue;
      try {
        if (!statSync(path).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const inner of list(path)) {
        if (inner.endsWith(".app")) apps.push({ path: join(path, inner), name: inner.slice(0, -4), detail: name });
      }
    }
  }
  return apps;
}

const NOT_AN_APP = /\b(uninstall|readme|read me|help|documentation|license|release notes|website|support|manual)\b/i;

function windowsApps(): LaunchableApp[] {
  const roots = [
    join(process.env.ProgramData || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
    join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs"),
  ];
  const apps: LaunchableApp[] = [];
  for (const root of roots) {
    let names: string[];
    try {
      names = readdirSync(root, { recursive: true }) as string[];
    } catch {
      continue;
    }
    for (const relative of names) {
      if (!relative.toLowerCase().endsWith(".lnk")) continue;
      const name = basename(relative).slice(0, -4);
      if (NOT_AN_APP.test(name)) continue;
      const folder = relative.split(/[\\/]/).slice(0, -1).join(" › ");
      apps.push({ path: join(root, relative), name, detail: folder || undefined });
    }
  }
  return apps;
}

function linuxApps(): LaunchableApp[] {
  return launcherEntries().map((entry) => ({ path: entry.file, name: entry.name, detail: entry.comment || undefined }));
}

export function launchableApps(): LaunchableApp[] {
  if (cache && Date.now() - cache.at < TTL) return cache.apps;
  const found = process.platform === "win32" ? windowsApps() : process.platform === "linux" ? linuxApps() : macApps();
  // The same app can appear twice (all users and just you); keep the first.
  const seen = new Set<string>();
  const apps = found
    .filter((app) => {
      const key = app.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  cache = { at: Date.now(), apps };
  return apps;
}
