import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { output, run } from "./exec";

export interface BundleInfo {
  path: string;
  id?: string;
  name: string;
  version?: string;
  executable?: string;
  copyright?: string;
  category?: string;
  /** LSUIElement or LSBackgroundOnly: no Dock icon. */
  agent: boolean;
  iconFile?: string;
  /** Has a compiled asset catalog, so the icon may live only there. */
  hasAssetCatalog: boolean;
}

const cache = new Map<string, BundleInfo>();
const pending = new Map<string, Promise<BundleInfo>>();

/** The outermost `.app` in a path: helpers nested inside an app belong to that app. */
export function outermostBundle(path: string): string | undefined {
  const index = path.indexOf(".app/");
  if (index === -1) return path.endsWith(".app") ? path : undefined;
  return path.slice(0, index + 4);
}

/** The innermost bundle (app, appex or xpc) that directly contains an executable. */
export function innermostBundle(path: string): string | undefined {
  const match = path.match(/^(.*\.(?:app|appex|xpc))\/Contents\/MacOS\/[^/]+$/);
  return match?.[1];
}

function readPlist(file: string): Promise<Record<string, unknown> | null> {
  return output("/usr/bin/plutil", ["-convert", "json", "-o", "-", file], 3000).then((text) => {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  });
}

export function getBundleSync(path: string): BundleInfo | undefined {
  return cache.get(path);
}

export function loadBundle(path: string): Promise<BundleInfo> {
  const hit = cache.get(path);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(path);
  if (inflight) return inflight;
  const promise = (async () => {
    const plist = (await readPlist(join(path, "Contents", "Info.plist"))) ?? {};
    const str = (key: string) => (typeof plist[key] === "string" ? (plist[key] as string) : undefined);
    const truthy = (key: string) => plist[key] === true || plist[key] === "1" || plist[key] === "YES";
    let iconFile = str("CFBundleIconFile");
    if (iconFile && !iconFile.endsWith(".icns")) iconFile += ".icns";
    const resources = join(path, "Contents", "Resources");
    const info: BundleInfo = {
      path,
      id: str("CFBundleIdentifier"),
      name: (str("CFBundleDisplayName") || str("CFBundleName") || basename(path, ".app")).replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ""),
      version: str("CFBundleShortVersionString") || str("CFBundleVersion"),
      executable: str("CFBundleExecutable"),
      copyright: str("NSHumanReadableCopyright"),
      category: str("LSApplicationCategoryType"),
      agent: truthy("LSUIElement") || truthy("LSBackgroundOnly"),
      iconFile: iconFile && existsSync(join(resources, iconFile)) ? join(resources, iconFile) : undefined,
      hasAssetCatalog: existsSync(join(resources, "Assets.car")),
    };
    if (!info.iconFile && existsSync(resources)) {
      try {
        const icns = readdirSync(resources).find((f) => f.endsWith(".icns"));
        if (icns) info.iconFile = join(resources, icns);
      } catch {
        // unreadable resources
      }
    }
    cache.set(path, info);
    pending.delete(path);
    return info;
  })();
  pending.set(path, promise);
  return promise;
}

const ICON_DIR = join(tmpdir(), "systo-icons");
const iconJobs = new Map<string, Promise<Buffer | null>>();

/** Renders an app's icon to a 64px PNG with sips, falling back to a Quick Look thumbnail. */
export function bundleIcon(path: string): Promise<Buffer | null> {
  const existing = iconJobs.get(path);
  if (existing) return existing;
  const job = (async () => {
    if (!path.endsWith(".app") || !existsSync(path)) return null;
    mkdirSync(ICON_DIR, { recursive: true });
    const key = createHash("sha1").update(path + statSync(path).mtimeMs).digest("hex");
    const target = join(ICON_DIR, `${key}.png`);
    if (existsSync(target)) return readFileSync(target);
    const info = await loadBundle(path);
    if (info.iconFile) {
      await run("/usr/bin/sips", ["-s", "format", "png", "-Z", "64", info.iconFile, "--out", target], 5000);
      if (existsSync(target)) return readFileSync(target);
    }
    const qlDir = join(ICON_DIR, key);
    mkdirSync(qlDir, { recursive: true });
    await run("/usr/bin/qlmanage", ["-t", "-s", "64", "-o", qlDir, path], 6000);
    const thumb = join(qlDir, `${basename(path)}.png`);
    if (existsSync(thumb)) {
      const data = readFileSync(thumb);
      return data;
    }
    return null;
  })().catch(() => null);
  iconJobs.set(path, job);
  return job;
}
