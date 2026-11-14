import { appDataFile } from "./paths";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { cpus, homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import type { DiskReport, DiskScanState, DiskSuggestion, DiskViewNode } from "../types";
import { createDiskScanner, type DiskNode, type DiskScanRequest, type DiskScanResult } from "./disk-worker";
import { run } from "./exec";
import { bunExecutable } from "./native";
import { powershell } from "./win/apps";
import { storageUsage } from "./system";

/**
 * Coordinates a disk scan across a pool of `bun` workers. The top levels are read one directory at
 * a time ("list"), then each folder below that is scanned whole ("tree") by whichever worker is
 * free, so a big home folder is spread over every worker instead of walked by one.
 */

const IS_WIN = process.platform === "win32";
/** Paths use forward slashes everywhere, which Windows accepts too (C:/Users/…). */
const toSlash = (p: string) => p.replace(/\\/g, "/");
const DATA_VOLUME = IS_WIN ? `${(process.env.SystemDrive || "C:").replace(/[\\/]$/, "")}/` : "/System/Volumes/Data";
const HOME = IS_WIN ? toSlash(homedir()) : homedir();

const trimSlash = (p: string) => (p.endsWith("/") ? p.slice(0, -1) : p);

/** "/" means the whole disk. Trailing slashes go, except on a drive root like "C:/". */
function normalizeRoot(requested: string): string {
  if (requested === "/") return DATA_VOLUME;
  const path = toSlash(requested);
  if (/^[A-Za-z]:\/?$/.test(path)) return `${path.slice(0, 2).toUpperCase()}/`;
  return path.replace(/\/+$/, "") || "/";
}
const CACHE_FILE = appDataFile("disk-scan.json");
const MIN_KEEP = 1024 * 1024;
const MAX_CHILDREN = 200;

const WORKER_SOURCE = `
const ffi = require("bun:ffi");
const { writeSync } = require("node:fs");
const scan = (${createDiskScanner.toString()})(process.platform === "darwin" ? ffi : null, require("node:fs"));
const send = (message) => writeSync(1, JSON.stringify(message) + "\\n");
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  try {
    const result = scan(request, (p) => send({ type: "progress", id: request.id, ...p }));
    send({ type: "result", ...result });
  } catch (error) {
    send({ type: "error", id: request.id, message: String(error && error.message || error) });
  }
});
`;

interface Result {
  root: string;
  label: string;
  tree: DiskNode;
  topFiles: Array<{ p: string; s: number }>;
  categories: Record<string, { size: number; count: number }>;
  stats: NonNullable<DiskScanState["stats"]>;
  finishedAt: number;
  startedAt: number;
}

interface Task {
  id: number;
  path: string;
  depth: number;
  mode: "list" | "tree";
  target: DiskNode;
}

interface Worker {
  child: ChildProcessWithoutNullStreams;
  task: Task | null;
  progress: { files: number; dirs: number; bytes: number };
}

function displayPath(path: string) {
  if (IS_WIN) return path;
  return path.startsWith(DATA_VOLUME + "/") ? path.slice(DATA_VOLUME.length) : path === DATA_VOLUME ? "/" : path;
}

function labelFor(root: string) {
  if (IS_WIN && /^[A-Za-z]:\/$/.test(root)) return `Local Disk (${root.slice(0, 2)})`;
  if (root === DATA_VOLUME || root === "/") return "Macintosh HD";
  if (root === HOME) return "Home";
  return basename(root) || root;
}

/** Sorts, keeps the largest children and folds the rest (including earlier aggregates) into one. */
function prune(children: DiskNode[]): DiskNode[] {
  const real = children.filter((c) => c.k !== 3).sort((a, b) => b.s - a.s);
  let restSize = 0;
  let restFiles = 0;
  for (const c of children) if (c.k === 3) {
    restSize += c.s;
    restFiles += c.f;
  }
  const kept: DiskNode[] = [];
  for (const child of real) {
    if (child.s >= MIN_KEEP && kept.length < MAX_CHILDREN) kept.push(child);
    else {
      restSize += child.s;
      restFiles += child.f;
    }
  }
  if (restSize > 0) kept.push({ n: "", s: restSize, f: restFiles, k: 3 });
  return kept;
}

class DiskAnalyzer {
  state: DiskScanState = { status: "idle", progress: { files: 0, dirs: 0, bytes: 0, current: "" } };
  private result: Result | null = null;
  private loaded = false;
  private workers: Worker[] = [];
  private cancelled = false;

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const saved = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Result;
      if (saved?.tree && saved.root) {
        this.result = saved;
        this.state = {
          status: "done",
          root: saved.root,
          label: saved.label,
          startedAt: saved.startedAt,
          finishedAt: saved.finishedAt,
          progress: { files: saved.stats.files, dirs: saved.stats.dirs, bytes: saved.stats.bytes, current: "" },
          stats: saved.stats,
        };
      }
    } catch {
      // no previous scan
    }
  }

  private save() {
    if (!this.result) return;
    try {
      mkdirSync(join(CACHE_FILE, ".."), { recursive: true });
      writeFileSync(CACHE_FILE, JSON.stringify(this.result));
    } catch (error) {
      console.error("[systo] couldn't cache the disk scan", error);
    }
  }

  start(requested: string): DiskScanState {
    this.load();
    if (this.state.status === "scanning") return this.state;
    const root = normalizeRoot(requested);
    let dev: number;
    try {
      const stat = statSync(root);
      if (!stat.isDirectory()) throw new Error("Not a folder");
      dev = stat.dev;
    } catch (error) {
      this.state = { ...this.state, status: "error", error: `Can't read ${displayPath(root)}: ${(error as Error).message}` };
      return this.state;
    }
    const bun = bunExecutable();
    if (!bun) {
      this.state = { ...this.state, status: "error", error: "The disk scanner needs Bun, which wasn't found." };
      return this.state;
    }
    this.cancelled = false;
    const startedAt = Date.now();
    this.state = { status: "scanning", root, label: labelFor(root), startedAt, progress: { files: 0, dirs: 0, bytes: 0, current: displayPath(root) } };
    void this.scan(bun, root, dev, startedAt).catch((error) => {
      this.state = { ...this.state, status: "error", error: String((error as Error).message ?? error) };
      this.stopWorkers();
    });
    return this.state;
  }

  cancel() {
    if (this.state.status !== "scanning") return;
    this.cancelled = true;
    this.stopWorkers();
    this.state = this.result
      ? { status: "done", root: this.result.root, label: this.result.label, startedAt: this.result.startedAt, finishedAt: this.result.finishedAt, progress: this.state.progress, stats: this.result.stats }
      : { status: "idle", progress: { files: 0, dirs: 0, bytes: 0, current: "" } };
  }

  private stopWorkers() {
    for (const w of this.workers) w.child.kill("SIGKILL");
    this.workers = [];
  }

  private scan(bun: string, root: string, dev: number, startedAt: number): Promise<void> {
    const listDepth = root === DATA_VOLUME ? 3 : 2;
    const count = Math.max(2, Math.min(6, Math.floor((cpus().length || 4) / 2)));
    const queue: Task[] = [];
    const listed = new Map<DiskNode, { s: number; f: number }>();
    const tree: DiskNode = { n: labelFor(root), s: 0, f: 0, k: 1 };
    const topFiles: Array<{ p: string; s: number }> = [];
    const categories: Record<string, { size: number; count: number }> = {};
    const done = { files: 0, dirs: 0, bytes: 0, denied: 0 };
    let nextId = 1;
    let inflight = 0;
    let current = root;

    const enqueue = (path: string, depth: number, target: DiskNode) =>
      queue.push({ id: nextId++, path, depth, mode: depth < listDepth ? "list" : "tree", target });

    return new Promise<void>((resolve, reject) => {
      const publish = () => {
        if (this.cancelled) return;
        const live = this.workers.reduce(
          (sum, w) => ({ files: sum.files + w.progress.files, dirs: sum.dirs + w.progress.dirs, bytes: sum.bytes + w.progress.bytes }),
          { files: 0, dirs: 0, bytes: 0 },
        );
        this.state = {
          ...this.state,
          progress: { files: done.files + live.files, dirs: done.dirs + live.dirs, bytes: done.bytes + live.bytes, current: displayPath(current) },
        };
      };

      const finish = () => {
        this.stopWorkers();
        const settle = (node: DiskNode): void => {
          const own = listed.get(node);
          if (!own) return;
          let s = own.s;
          let f = own.f;
          for (const child of node.c ?? []) {
            settle(child);
            if (child.k === 1 || child.k === 2) {
              if (listed.has(child) || child.c) {
                s += child.s;
                f += child.f;
              }
            }
          }
          node.s = s;
          node.f = f;
          node.c = prune(node.c ?? []);
        };
        settle(tree);
        topFiles.sort((a, b) => b.s - a.s);
        const finishedAt = Date.now();
        const stats = { ...done, ms: finishedAt - startedAt };
        this.result = { root, label: labelFor(root), tree, topFiles: topFiles.slice(0, 150), categories, stats, startedAt, finishedAt };
        this.state = { status: "done", root, label: labelFor(root), startedAt, finishedAt, progress: { files: done.files, dirs: done.dirs, bytes: done.bytes, current: "" }, stats };
        this.save();
        resolve();
      };

      const dispatch = () => {
        if (this.cancelled) return resolve();
        for (const w of this.workers) {
          if (w.task) continue;
          const task = queue.shift();
          if (!task) break;
          w.task = task;
          w.progress = { files: 0, dirs: 0, bytes: 0 };
          inflight++;
          const request: DiskScanRequest = { id: task.id, path: task.path, mode: task.mode, dev, minKeep: MIN_KEEP, maxChildren: MAX_CHILDREN };
          w.child.stdin.write(JSON.stringify(request) + "\n");
        }
        if (inflight === 0 && queue.length === 0) finish();
      };

      const complete = (w: Worker, result: DiskScanResult) => {
        const task = w.task!;
        w.task = null;
        w.progress = { files: 0, dirs: 0, bytes: 0 };
        inflight--;
        done.files += result.files;
        done.dirs += result.dirs;
        done.bytes += result.bytes;
        done.denied += result.denied;
        for (const [id, c] of Object.entries(result.categories)) {
          const bucket = (categories[id] ??= { size: 0, count: 0 });
          bucket.size += c.size;
          bucket.count += c.count;
        }
        topFiles.push(...result.topFiles);
        if (topFiles.length > 600) {
          topFiles.sort((a, b) => b.s - a.s);
          topFiles.length = 150;
        }
        const node = result.node;
        const target = task.target;
        target.s = node.s;
        target.f = node.f;
        target.k = task.depth === 0 ? 1 : node.k;
        target.c = node.c ?? [];
        if (task.mode === "list") {
          listed.set(target, { s: node.s, f: node.f });
          for (const sub of node.pending ?? []) {
            const child: DiskNode = { n: sub.name, s: 0, f: 0, k: sub.kind };
            target.c.push(child);
            enqueue(`${trimSlash(task.path)}/${sub.name}`, task.depth + 1, child);
          }
        }
        dispatch();
      };

      for (let i = 0; i < count; i++) {
        const child = spawn(bun, ["-e", WORKER_SOURCE], { stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
        const worker: Worker = { child, task: null, progress: { files: 0, dirs: 0, bytes: 0 } };
        child.stderr.on("data", () => {});
        child.on("error", (error) => reject(error));
        child.on("exit", (code, signal) => {
          if (this.cancelled || signal === "SIGKILL") return;
          if (worker.task) reject(new Error(`Scanner exited while reading ${displayPath(worker.task.path)} (${code ?? signal})`));
        });
        createInterface({ input: child.stdout }).on("line", (line) => {
          if (this.cancelled) return;
          let message: { type: string; [key: string]: unknown };
          try {
            message = JSON.parse(line);
          } catch {
            return;
          }
          if (message.type === "progress") {
            worker.progress = { files: Number(message.files), dirs: Number(message.dirs), bytes: Number(message.bytes) };
            current = String(message.current);
            publish();
          } else if (message.type === "result") complete(worker, message as unknown as DiskScanResult);
          else if (message.type === "error") {
            // An unreadable folder shouldn't sink the scan; count it and move on.
            complete(worker, { id: Number(message.id), node: { n: "", s: 0, f: 0, k: 1, c: [] }, topFiles: [], categories: {}, files: 0, dirs: 0, bytes: 0, denied: 1 });
          }
        });
        this.workers.push(worker);
      }
      enqueue(root, 0, tree);
      dispatch();
    });
  }

  // ── Queries ─────────────────────────────────────────────────────────────────────────────

  private locate(path: string): { node: DiskNode; trail: DiskNode[] } | null {
    if (!this.result) return null;
    const { root, tree } = this.result;
    let target = path;
    if (!target.startsWith(root) && root === DATA_VOLUME && target.startsWith("/")) target = DATA_VOLUME + target;
    if (target === root) return { node: tree, trail: [tree] };
    const prefix = trimSlash(root) + "/";
    if (!target.startsWith(prefix)) return null;
    const parts = target.slice(prefix.length).split("/").filter(Boolean);
    let node = tree;
    const trail = [tree];
    for (const part of parts) {
      const next = node.c?.find((c) => c.n === part && c.k !== 3);
      if (!next) return null;
      node = next;
      trail.push(node);
    }
    return { node, trail };
  }

  private view(node: DiskNode, path: string, depth: number, limits = [160, 40, 18, 10]): DiskViewNode {
    const kind = node.k === 0 ? "file" : node.k === 2 ? "package" : node.k === 3 ? "rest" : "folder";
    const out: DiskViewNode = {
      name: node.k === 3 ? "Smaller items" : node.n,
      size: node.s,
      files: node.f,
      kind,
      path: node.k === 3 ? undefined : path,
      bundlePath: kind === "package" && path.endsWith(".app") ? path : undefined,
      hasChildren: Boolean(node.c?.some((c) => c.k !== 3)),
    };
    if (depth > 0 && node.c?.length) {
      const limit = limits[0];
      const kids = node.c.slice(0, limit);
      const rest = node.c.slice(limit);
      out.children = kids.map((c) => this.view(c, `${trimSlash(path)}/${c.n}`, depth - 1, limits.slice(1)));
      if (rest.length) {
        const s = rest.reduce((sum, c) => sum + c.s, 0);
        const f = rest.reduce((sum, c) => sum + c.f, 0);
        const existing = out.children.find((c) => c.kind === "rest");
        if (existing) {
          existing.size += s;
          existing.files += f;
        } else out.children.push({ name: "Smaller items", size: s, files: f, kind: "rest", hasChildren: false });
      }
    }
    return out;
  }

  private suggestions(): DiskSuggestion[] {
    const size = (path: string) => this.locate(path)?.node.s ?? 0;
    const LOCAL = toSlash(process.env.LOCALAPPDATA || join(HOME, "AppData", "Local"));
    const windowsKnown: Array<Omit<DiskSuggestion, "size"> & { path: string }> = [
      { id: "temp", title: "Temporary files", description: "Leftovers from installers and apps. Anything still in use is skipped when you delete.", path: `${LOCAL}/Temp`, safe: true },
      { id: "chrome-cache", title: "Chrome cache", description: "Chrome rebuilds its cache as you browse.", path: `${LOCAL}/Google/Chrome/User Data/Default/Cache`, safe: true },
      { id: "edge-cache", title: "Edge cache", description: "Edge rebuilds its cache as you browse.", path: `${LOCAL}/Microsoft/Edge/User Data/Default/Cache`, safe: true },
      { id: "crash-dumps", title: "Crash dumps", description: "Memory dumps from apps that crashed. Only useful for debugging.", path: `${LOCAL}/CrashDumps`, safe: true },
      { id: "docker", title: "Docker disk image", description: "Containers, images and volumes. Reclaim space with `docker system prune` rather than deleting the file.", path: `${LOCAL}/Docker/wsl`, safe: false },
      { id: "updates", title: "Windows Update downloads", description: "Update files Windows already installed. Clear them with Disk Cleanup > Windows Update Cleanup.", path: `${DATA_VOLUME}Windows/SoftwareDistribution/Download`, safe: false },
      { id: "downloads", title: "Downloads", description: "Installers and files you downloaded. Often full of things you no longer need.", path: `${HOME}/Downloads`, safe: false },
      { id: "npm", title: "Package manager caches", description: "npm, pnpm, Yarn and Bun download caches. They refill on the next install.", path: `${LOCAL}/npm-cache`, safe: true },
    ];
    const macKnown: Array<Omit<DiskSuggestion, "size"> & { path: string }> = [
      { id: "trash", title: "Trash", description: "Files you've already deleted. Empty the Trash in Finder to get the space back.", path: join(HOME, ".Trash"), safe: true },
      { id: "caches", title: "App caches", description: "Apps rebuild these as needed. Safe to clear, though apps may start a little slower once.", path: join(HOME, "Library", "Caches"), safe: true },
      { id: "derived", title: "Xcode build data", description: "DerivedData is rebuilt the next time you build a project.", path: join(HOME, "Library", "Developer", "Xcode", "DerivedData"), safe: true },
      { id: "simulators", title: "iOS Simulators", description: "Simulator devices and their data. Remove unused ones with `xcrun simctl delete unavailable`.", path: join(HOME, "Library", "Developer", "CoreSimulator"), safe: false },
      { id: "device-support", title: "Device support files", description: "Debug symbols Xcode copies from each iOS version you've connected. Old versions are safe to delete.", path: join(HOME, "Library", "Developer", "Xcode", "iOS DeviceSupport"), safe: true },
      { id: "archives", title: "Xcode archives", description: "Builds you archived for distribution. Keep the ones you may need to symbolicate crashes.", path: join(HOME, "Library", "Developer", "Xcode", "Archives"), safe: false },
      { id: "docker", title: "Docker disk image", description: "Containers, images and volumes. Reclaim space with `docker system prune` rather than deleting the file.", path: join(HOME, "Library", "Containers", "com.docker.docker"), safe: false },
      { id: "backups", title: "iPhone and iPad backups", description: "Local device backups. Manage them in Finder under your device, or keep the latest one.", path: join(HOME, "Library", "Application Support", "MobileSync", "Backup"), safe: false },
      { id: "downloads", title: "Downloads", description: "Installers and files you downloaded. Often full of things you no longer need.", path: join(HOME, "Downloads"), safe: false },
      { id: "npm", title: "Package manager caches", description: "npm, pnpm, Yarn and Bun download caches. They refill on the next install.", path: join(HOME, ".npm"), safe: true },
    ];
    const known = IS_WIN ? windowsKnown : macKnown;
    const extraCaches = IS_WIN
      ? [`${LOCAL}/pnpm/store`, `${LOCAL}/Yarn/Cache`, `${HOME}/.bun/install/cache`, `${HOME}/.cache`]
      : [join(HOME, "Library", "pnpm"), join(HOME, ".pnpm-store"), join(HOME, ".bun", "install", "cache"), join(HOME, ".cache")];
    const results: DiskSuggestion[] = known.map((k) => ({ ...k, size: size(k.path) }));
    const npm = results.find((r) => r.id === "npm")!;
    npm.items = [{ path: npm.path!, size: npm.size }, ...extraCaches.map((path) => ({ path, size: size(path) }))].filter((i) => i.size > 0);
    npm.size = npm.items.reduce((s, i) => s + i.size, 0);
    if (npm.items.length) npm.path = npm.items.sort((a, b) => b.size - a.size)[0].path;

    // Dependency and build folders anywhere in the scan; the outermost one counts, not nested copies.
    const DEV = new Set(["node_modules", ".venv", "venv", ".next", "Pods", ".build", ".gradle", ".turbo", "DerivedData", ".nuxt", ".parcel-cache"]);
    const found: Array<{ path: string; size: number }> = [];
    const walk = (node: DiskNode, path: string) => {
      for (const c of node.c ?? []) {
        if (c.k === 0 || c.k === 3) continue;
        const p = `${trimSlash(path)}/${c.n}`;
        if (DEV.has(c.n)) found.push({ path: displayPath(p), size: c.s });
        else walk(c, p);
      }
    };
    if (this.result) walk(this.result.tree, this.result.root);
    found.sort((a, b) => b.size - a.size);
    results.push({
      id: "dev-folders",
      title: "Dependency and build folders",
      description: "node_modules, virtualenvs and build output inside your projects. Reinstall or rebuild to get them back.",
      size: found.reduce((s, f) => s + f.size, 0),
      count: found.length,
      safe: true,
      items: found.slice(0, 40),
    });
    return results
      .filter((r) => r.size >= 32 * 1024 * 1024)
      .map((r) => ({ ...r, path: r.path ? displayPath(r.path) : undefined }))
      .sort((a, b) => b.size - a.size);
  }

  async report(path?: string, depth = 3): Promise<DiskReport> {
    this.load();
    const volume = await storageUsage();
    const base: DiskReport = { state: this.state, volume, home: HOME };
    if (!this.result || this.state.status === "scanning") return base;
    const { root } = this.result;
    const located = (path && this.locate(path)) || this.locate(root)!;
    const trail = located.trail;
    const segments: string[] = [];
    const crumbs = trail.map((n, i) => {
      if (i > 0) segments.push(n.n);
      const abs = i === 0 ? root : `${trimSlash(root)}/${segments.join("/")}`;
      return { name: i === 0 ? labelFor(root) : n.n, path: displayPath(abs) };
    });
    const absolute = crumbs.length > 1 ? `${trimSlash(root)}/${segments.join("/")}` : root;
    const prefix = absolute === root ? "" : absolute + "/";
    return {
      ...base,
      view: {
        path: displayPath(absolute),
        display: displayPath(absolute),
        crumbs,
        node: this.view(located.node, displayPath(absolute), Math.min(4, Math.max(1, depth))),
      },
      topFiles: this.result.topFiles
        .filter((f) => !prefix || f.p.startsWith(prefix))
        .slice(0, 60)
        .map((f) => ({ path: displayPath(f.p), size: f.s })),
      categories: Object.entries(this.result.categories)
        .map(([id, c]) => ({ id, size: c.size, count: c.count }))
        .sort((a, b) => b.size - a.size),
      suggestions: this.suggestions(),
    };
  }

  // ── Actions ─────────────────────────────────────────────────────────────────────────────

  async trash(path: string): Promise<{ ok: boolean; message: string }> {
    this.load();
    if (!this.result) return { ok: false, message: "Scan a folder first." };
    if (this.state.status === "scanning") return { ok: false, message: "Wait for the scan to finish." };
    const located = this.locate(path);
    if (!located || located.trail.length < 2) return { ok: false, message: "That item isn't part of the scan." };
    const real = path;
    if (IS_WIN) return this.recycle(real, located.trail);
    const protectedPaths = new Set(
      [HOME, join(HOME, "Library"), join(HOME, "Documents"), join(HOME, "Desktop"), join(HOME, "Downloads"), join(HOME, "Applications"), "/Applications", "/Library", "/System", "/Users", "/usr", "/bin", "/sbin", "/private", "/opt", "/Volumes", "/cores"].flatMap(
        (p) => [p, DATA_VOLUME + p],
      ),
    );
    if (protectedPaths.has(real.replace(/\/+$/, ""))) return { ok: false, message: "Systo won't move a top-level system or home folder to the Trash." };
    if (!existsSync(real)) {
      this.forget(located.trail);
      return { ok: true, message: "It was already gone." };
    }
    const script = `on run argv
  tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)
end run`;
    const finder = await run("/usr/bin/osascript", ["-e", script, real], 30000);
    if (finder.code !== 0) {
      // Without Automation access to Finder, move it into the Trash directly (no "Put Back").
      try {
        const name = basename(real);
        let dest = join(HOME, ".Trash", name);
        for (let i = 2; existsSync(dest); i++) dest = join(HOME, ".Trash", `${name} ${i}`);
        renameSync(real, dest);
      } catch (error) {
        return { ok: false, message: `Couldn't move it to the Trash: ${(error as Error).message}` };
      }
    }
    this.forget(located.trail);
    return { ok: true, message: `Moved ${basename(real)} to the Trash.` };
  }

  private async recycle(real: string, trail: DiskNode[]): Promise<{ ok: boolean; message: string }> {
    const drive = DATA_VOLUME;
    const protectedPaths = new Set(
      [HOME, `${HOME}/Documents`, `${HOME}/Desktop`, `${HOME}/Downloads`, `${HOME}/AppData`, `${HOME}/AppData/Local`, `${HOME}/AppData/Roaming`, drive, `${drive}Windows`, `${drive}Program Files`, `${drive}Program Files (x86)`, `${drive}ProgramData`, `${drive}Users`].map((p) => trimSlash(p).toLowerCase()),
    );
    if (protectedPaths.has(trimSlash(real).toLowerCase()) || /^[a-z]:\/?$/i.test(real)) {
      return { ok: false, message: "Systo won't move a top-level system or user folder to the Recycle Bin." };
    }
    if (!existsSync(real)) {
      this.forget(trail);
      return { ok: true, message: "It was already gone." };
    }
    const { code, stderr } = await powershell(
      `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
$p = $env:SYSTO_PATH
try {
  if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }
  else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`,
      { SYSTO_PATH: real.replace(/\//g, "\\") },
      120000,
    );
    if (code !== 0) return { ok: false, message: `Couldn't move it to the Recycle Bin: ${stderr.trim() || "Windows refused."}` };
    this.forget(trail);
    return { ok: true, message: `Moved ${basename(real)} to the Recycle Bin.` };
  }

  private forget(trail: DiskNode[]) {
    const node = trail[trail.length - 1];
    const parent = trail[trail.length - 2];
    parent.c = parent.c?.filter((c) => c !== node);
    for (const ancestor of trail.slice(0, -1)) {
      ancestor.s = Math.max(0, ancestor.s - node.s);
      ancestor.f = Math.max(0, ancestor.f - node.f);
    }
    if (this.result) {
      const segments = trail.slice(1).map((n) => n.n);
      const abs = `${trimSlash(this.result.root)}/${segments.join("/")}`;
      this.result.topFiles = this.result.topFiles.filter((f) => f.p !== abs && !f.p.startsWith(abs + "/"));
      this.result.stats.bytes = Math.max(0, this.result.stats.bytes - node.s);
      this.save();
    }
  }

  async choose(): Promise<string | null> {
    if (IS_WIN) {
      const { stdout } = await powershell(
        `Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Choose a folder for Systo to analyze'
if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }
$owner.Dispose()`,
        {},
        10 * 60_000,
      );
      return stdout.trim() ? toSlash(stdout.trim()) : null;
    }
    const { code, stdout } = await run(
      "/usr/bin/osascript",
      ["-e", 'POSIX path of (choose folder with prompt "Choose a folder for Systo to analyze")'],
      10 * 60_000,
    );
    return code === 0 && stdout.trim() ? stdout.trim() : null;
  }
}

const KEY = "__systoDisk";
const store = globalThis as unknown as Record<string, DiskAnalyzer | undefined>;

export function disk(): DiskAnalyzer {
  return (store[KEY] ??= new DiskAnalyzer());
}

export const DISK_ROOTS = { home: HOME, volume: DATA_VOLUME };
