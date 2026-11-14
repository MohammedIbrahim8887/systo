import { basename, dirname } from "node:path";
import { cpus, totalmem, uptime as osUptime, userInfo } from "node:os";
import type {
  HistoryPoint,
  IslandData,
  Metric,
  ProcessGroup,
  ProcessRow,
  Snapshot,
  SystemTotals,
} from "../types";
import { getBundleSync, loadBundle, outermostBundle } from "./bundle";
import { classifyProcess, bundleKind, safetyFor, sectionFor, worstSafety } from "./classify";
import { output } from "./exec";
import { readNative, type NativeTable } from "./native";
import { usage } from "./usage";
import { exeDisplayName, exeInfo } from "./win/apps";
import { classifyWin, safetyWin } from "./win/classify";
import { readWindows } from "./win/native";

const IS_WIN = process.platform === "win32";

interface PsRow {
  pid: number;
  ppid: number;
  uid: number;
  user: string;
  cpuNs: number;
  rss: number;
  comm: string;
}

const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(.*)$/;

/** ps TIME: [[dd-]hh:]mm:ss.cc */
function parseCpuTime(value: string): number {
  let days = 0;
  let rest = value;
  const dash = rest.indexOf("-");
  if (dash !== -1) {
    days = Number(rest.slice(0, dash));
    rest = rest.slice(dash + 1);
  }
  const parts = rest.split(":").map(Number);
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + (Number.isFinite(part) ? part : 0);
  return (days * 86400 + seconds) * 1e9;
}

async function readPs(): Promise<PsRow[]> {
  const text = await output("/bin/ps", ["-axo", "pid=,ppid=,uid=,user=,time=,rss=,comm="]);
  const rows: PsRow[] = [];
  for (const line of text.split("\n")) {
    const m = PS_LINE.exec(line);
    if (!m) continue;
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      uid: Number(m[3]),
      user: m[4],
      cpuNs: parseCpuTime(m[5]),
      rss: Number(m[6]) * 1024,
      comm: m[7].trim(),
    });
  }
  return rows;
}

async function readNettop(): Promise<Map<number, { in: number; out: number }>> {
  const text = await output("/usr/bin/nettop", ["-P", "-L", "1", "-J", "bytes_in,bytes_out", "-x", "-n"], 4000);
  const map = new Map<number, { in: number; out: number }>();
  for (const line of text.split("\n")) {
    const cells = line.split(",");
    if (cells.length < 3) continue;
    const m = /\.(\d+)$/.exec(cells[0]);
    if (!m) continue;
    map.set(Number(m[1]), { in: Number(cells[1]) || 0, out: Number(cells[2]) || 0 });
  }
  return map;
}

interface MemoryStats {
  used: number;
  app: number;
  wired: number;
  compressed: number;
  cached: number;
  swapUsed: number;
  pressure: SystemTotals["pressure"];
}

async function readMemory(): Promise<MemoryStats> {
  const [vm, sys] = await Promise.all([
    output("/usr/bin/vm_stat", []),
    output("/usr/sbin/sysctl", ["-n", "vm.swapusage", "kern.memorystatus_vm_pressure_level"]),
  ]);
  const pageSize = Number(/page size of (\d+)/.exec(vm)?.[1] ?? 16384);
  const pages = (label: string) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(vm)?.[1] ?? 0) * pageSize;
  const anonymous = pages("Anonymous pages");
  const purgeable = pages("Pages purgeable");
  const wired = pages("Pages wired down");
  const compressed = pages("Pages occupied by compressor");
  const fileBacked = pages("File-backed pages");
  const app = Math.max(0, anonymous - purgeable);
  const [swapLine = "", pressureLine = "1"] = sys.trim().split("\n");
  const swapMatch = /used = ([\d.]+)M/.exec(swapLine);
  const level = Number(pressureLine.trim());
  return {
    used: app + wired + compressed,
    app,
    wired,
    compressed,
    cached: fileBacked + purgeable,
    swapUsed: swapMatch ? Number(swapMatch[1]) * 1024 * 1024 : 0,
    pressure: level >= 4 ? "critical" : level >= 2 ? "warning" : "normal",
  };
}

async function readInterfaces(): Promise<{ in: number; out: number }> {
  const text = await output("/usr/sbin/netstat", ["-ib", "-n"]);
  let input = 0;
  let out = 0;
  for (const line of text.split("\n")) {
    const cells = line.trim().split(/\s+/);
    if (cells.length < 10 || !cells[2]?.startsWith("<Link#")) continue;
    if (!/^(en|pdp_ip)\d+/.test(cells[0])) continue;
    const n = cells.length;
    // Name Mtu Network [Address] Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
    input += Number(cells[n - 5]) || 0;
    out += Number(cells[n - 2]) || 0;
  }
  return { in: input, out };
}

async function readDiskIo(): Promise<{ read: number; write: number }> {
  const text = await output("/usr/sbin/ioreg", ["-c", "IOBlockStorageDriver", "-r", "-w", "0", "-k", "Statistics"]);
  let read = 0;
  let write = 0;
  for (const m of text.matchAll(/"Bytes \(Read\)"=(\d+)/g)) read += Number(m[1]);
  for (const m of text.matchAll(/"Bytes \(Write\)"=(\d+)/g)) write += Number(m[1]);
  return { read, write };
}

async function readGpu(): Promise<number | null> {
  const text = await output("/usr/sbin/ioreg", ["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"]);
  const m = /"Device Utilization %"=(\d+)/.exec(text);
  return m ? Number(m[1]) : null;
}

interface Counters {
  at: number;
  cpu: Map<number, number>;
  diskRead: Map<number, number>;
  diskWrite: Map<number, number>;
  energy: Map<number, number>;
  net: Map<number, { in: number; out: number }>;
  sysDisk: { read: number; write: number };
  sysNet: { in: number; out: number };
  /** Windows: system-wide idle and busy CPU time (100ns units). */
  sysCpu?: { idle: number; busy: number };
}

export const SELF_BUNDLE_ID = "dev.systo.monitor";
const HISTORY = 120;
const IDLE_STOP_MS = 15000;
/** Cadence while nothing is polling but usage history is being recorded. */
const BACKGROUND_MS = 10000;
/** 100 Mbit/s: below this, a quiet link would read as fully busy. */
const NET_FLOOR = 12.5 * 1024 * 1024;

function delta(now: number, before: number | undefined): number {
  if (before === undefined) return 0;
  return Math.max(0, now - before);
}

export class Sampler {
  interval = 1500;
  snapshot: Snapshot | null = null;
  /** Windows: processes that own an app window, so Quit can leave a "save changes?" prompt alone. */
  windowPids = new Set<number>();
  private history: HistoryPoint[] = [];
  private prev: Counters | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private lastDemand = 0;
  private native = false;
  private cores = cpus().length || 1;
  private background = false;
  private netPeak = NET_FLOOR;

  /** Keeps sampling with no UI attached so usage history covers the whole session. */
  runInBackground() {
    this.background = true;
    if (!this.timer && !this.running) this.loop();
  }

  setInterval(ms: number) {
    this.interval = Math.min(10000, Math.max(500, Math.round(ms)));
  }

  /** Returns the latest snapshot, sampling on demand and keeping the loop alive while polled. */
  async current(): Promise<Snapshot> {
    this.lastDemand = Date.now();
    if (!this.timer && !this.running) this.loop();
    if (!this.snapshot) {
      await this.running;
      const first = this.snapshot as Snapshot | null;
      // The first sample has no previous counters, so rates need a second one.
      if (!first || !this.prev || first.history.length === 0) {
        await new Promise((r) => setTimeout(r, 400));
        await this.tick();
      }
    }
    return this.snapshot!;
  }

  /** Forces a fresh sample, e.g. right after ending a process. */
  async refresh(): Promise<Snapshot> {
    await this.running;
    await this.tick();
    return this.snapshot!;
  }

  private loop() {
    this.running = this.tick().finally(() => {
      this.running = null;
      const idle = Date.now() - this.lastDemand > IDLE_STOP_MS;
      if (idle && !this.background) {
        this.timer = null;
        this.prev = null;
        return;
      }
      this.timer = setTimeout(() => {
        this.timer = null;
        this.loop();
      }, idle ? Math.max(this.interval, BACKGROUND_MS) : this.interval);
    });
  }

  private async tick() {
    try {
      await this.sample();
    } catch (error) {
      console.error("[systo] sample failed", error);
    }
  }

  private async sample() {
    if (IS_WIN) return this.sampleWindows();
    const [ps, nettop, memory, sysNet, sysDisk, gpu] = await Promise.all([
      readPs(),
      readNettop().catch(() => new Map<number, { in: number; out: number }>()),
      readMemory(),
      readInterfaces().catch(() => ({ in: 0, out: 0 })),
      readDiskIo().catch(() => ({ read: 0, write: 0 })),
      readGpu().catch(() => null),
    ]);
    const native: NativeTable = (await readNative(ps.map((p) => p.pid))) ?? {};
    this.native = Object.keys(native).length > 0;
    const at = Date.now();
    const prev = this.prev;
    const dt = prev ? Math.max(0.2, (at - prev.at) / 1000) : 0;

    const counters: Counters = {
      at,
      cpu: new Map(),
      diskRead: new Map(),
      diskWrite: new Map(),
      energy: new Map(),
      net: nettop,
      sysDisk,
      sysNet,
    };

    const byPid = new Map<number, PsRow>();
    for (const p of ps) byPid.set(p.pid, p);

    // Resolve bundles for every executable that lives in an app. Info.plist reads are cached.
    const bundlePaths = new Set<string>();
    const paths = new Map<number, string>();
    for (const p of ps) {
      const path = native[p.pid]?.path || p.comm;
      paths.set(p.pid, path);
      const bundle = outermostBundle(path);
      if (bundle) bundlePaths.add(bundle);
    }
    await Promise.all([...bundlePaths].filter((b) => !getBundleSync(b)).map((b) => loadBundle(b).catch(() => null)));

    const rows: ProcessRow[] = [];
    const rowByPid = new Map<number, ProcessRow>();
    for (const p of ps) {
      const n = native[p.pid];
      const path = paths.get(p.pid)!;
      const cpuNs = n ? n.cpuNs : p.cpuNs;
      counters.cpu.set(p.pid, cpuNs);
      let diskRead = 0;
      let diskWrite = 0;
      let power = 0;
      if (n) {
        counters.diskRead.set(p.pid, n.diskRead);
        counters.diskWrite.set(p.pid, n.diskWrite);
        counters.energy.set(p.pid, n.energyNj);
        if (prev && dt) {
          diskRead = delta(n.diskRead, prev.diskRead.get(p.pid)) / dt;
          diskWrite = delta(n.diskWrite, prev.diskWrite.get(p.pid)) / dt;
          power = delta(n.energyNj, prev.energy.get(p.pid)) / 1e9 / dt;
        }
      }
      const cpu = prev && dt ? (delta(cpuNs, prev.cpu.get(p.pid)) / (dt * 1e9)) * 100 : 0;
      const net = nettop.get(p.pid);
      const prevNet = prev?.net.get(p.pid);
      const name = basename(path) || p.comm;
      const bundlePath = outermostBundle(path);
      const bundle = bundlePath ? getBundleSync(bundlePath) : undefined;
      const kind = classifyProcess({ pid: p.pid, uid: p.uid, name, path, bundlePath, bundle });
      const row: ProcessRow = {
        pid: p.pid,
        ppid: p.ppid,
        uid: p.uid,
        user: p.user,
        name: p.pid === 0 ? "kernel_task" : name,
        path,
        cpu: Math.min(cpu, this.cores * 100),
        memory: n?.footprint || p.rss,
        diskRead,
        diskWrite,
        netIn: net && prevNet && dt ? delta(net.in, prevNet.in) / dt : 0,
        netOut: net && prevNet && dt ? delta(net.out, prevNet.out) / dt : 0,
        power,
        kind,
        safety: safetyFor(p.pid === 0 ? "kernel_task" : name, kind, p.uid),
        inspectable: Boolean(n),
        self: p.pid === process.pid,
      };
      rows.push(row);
      rowByPid.set(p.pid, row);
    }

    const groups = this.group(rows, rowByPid, native, byPid);
    const totalCpu = rows.reduce((sum, r) => sum + r.cpu, 0) / this.cores;
    this.publish({ at, prev, dt, counters, groups, rows, totalCpu, memory, gpu });
  }

  private publish({
    at,
    prev,
    dt,
    counters,
    groups,
    rows,
    totalCpu,
    memory,
    gpu,
  }: {
    at: number;
    prev: Counters | null;
    dt: number;
    counters: Counters;
    groups: ProcessGroup[];
    rows: ProcessRow[];
    totalCpu: number;
    memory: MemoryStats;
    gpu: number | null;
  }) {
    const { sysDisk, sysNet } = counters;
    const diskRead = prev && dt ? delta(sysDisk.read, prev.sysDisk.read) / dt : 0;
    const diskWrite = prev && dt ? delta(sysDisk.write, prev.sysDisk.write) / dt : 0;
    const netIn = prev && dt ? delta(sysNet.in, prev.sysNet.in) / dt : 0;
    const netOut = prev && dt ? delta(sysNet.out, prev.sysNet.out) / dt : 0;

    const totals: SystemTotals = {
      cpu: Math.min(100, totalCpu),
      cores: this.cores,
      memoryUsed: memory.used,
      memoryTotal: totalmem(),
      memoryApp: memory.app,
      memoryWired: memory.wired,
      memoryCompressed: memory.compressed,
      memoryCached: memory.cached,
      swapUsed: memory.swapUsed,
      pressure: memory.pressure,
      diskRead,
      diskWrite,
      netIn,
      netOut,
      gpu,
      processCount: rows.length,
      uptime: osUptime(),
    };

    if (prev) {
      usage().record(groups, totals, dt, at);
      // Network has no fixed ceiling, so the island's percentage is against a slowly decaying peak.
      this.netPeak = Math.max(netIn + netOut, this.netPeak * 0.999, NET_FLOOR);
      this.history.push({ t: at, cpu: totals.cpu, memory: memory.used, diskRead, diskWrite, netIn, netOut, gpu });
      if (this.history.length > HISTORY) this.history.splice(0, this.history.length - HISTORY);
    }
    this.prev = counters;
    this.snapshot = {
      at,
      interval: this.interval,
      totals,
      groups,
      history: this.history.slice(),
      native: this.native,
      netPeak: this.netPeak,
    };
  }

  // ── Windows ──────────────────────────────────────────────────────────────────────────────

  private async sampleWindows() {
    const win = await readWindows();
    if (!win) throw new Error("Win32 counters are unavailable");
    const at = Date.now();
    const prev = this.prev;
    const dt = prev ? Math.max(0.2, (at - prev.at) / 1000) : 0;
    const counters: Counters = {
      at,
      cpu: new Map(),
      diskRead: new Map(),
      diskWrite: new Map(),
      energy: new Map(),
      net: new Map(),
      sysDisk: { read: 0, write: 0 },
      sysNet: { in: win.net.in, out: win.net.out },
      sysCpu: win.cpu,
    };
    this.native = true;
    this.windowPids = new Set(win.windows.keys());
    let username = "You";
    try {
      username = userInfo().username;
    } catch {
      // keep the placeholder
    }
    const selfRoot = dirname(dirname(process.execPath)).toLowerCase();

    const rows: ProcessRow[] = [];
    for (const p of win.procs) {
      counters.cpu.set(p.pid, p.cpuNs);
      counters.diskRead.set(p.pid, p.ioRead);
      counters.diskWrite.set(p.pid, p.ioWrite);
      counters.sysDisk.read += p.ioRead;
      counters.sysDisk.write += p.ioWrite;
      const cpu = prev && dt ? (delta(p.cpuNs, prev.cpu.get(p.pid)) / (dt * 1e9)) * 100 : 0;
      const kind = classifyWin({ pid: p.pid, exe: p.exe, path: p.path, session: p.session, hasWindow: win.windows.has(p.pid) });
      rows.push({
        pid: p.pid,
        ppid: p.ppid,
        uid: p.session === 0 ? 0 : 1000,
        user: p.session === 0 ? "SYSTEM" : username,
        name: p.exe,
        path: p.path,
        cpu: Math.min(cpu, this.cores * 100),
        memory: p.memory,
        diskRead: prev && dt ? delta(p.ioRead, prev.diskRead.get(p.pid)) / dt : 0,
        diskWrite: prev && dt ? delta(p.ioWrite, prev.diskWrite.get(p.pid)) / dt : 0,
        netIn: 0,
        netOut: 0,
        power: 0,
        kind,
        safety: safetyWin(p.exe, kind, p.session),
        inspectable: p.readable,
        self: p.pid === process.pid || (Boolean(p.path) && p.path.toLowerCase().startsWith(selfRoot + "\\")),
      });
    }

    const groups = this.groupWindows(rows, win.windows);
    let totalCpu = rows.reduce((sum, r) => sum + r.cpu, 0) / this.cores;
    if (prev?.sysCpu) {
      const busy = delta(win.cpu.busy, prev.sysCpu.busy);
      const idle = delta(win.cpu.idle, prev.sysCpu.idle);
      if (busy + idle > 0) totalCpu = (busy / (busy + idle)) * 100;
    }
    const m = win.memory;
    const used = Math.max(0, m.total - m.available);
    const memory: MemoryStats = {
      used,
      app: Math.max(0, used - m.kernelNonpaged - m.kernelPaged),
      wired: m.kernelNonpaged + m.kernelPaged,
      compressed: 0,
      cached: m.cache,
      swapUsed: Math.max(0, m.commit - used),
      pressure: m.load >= 90 ? "critical" : m.load >= 80 ? "warning" : "normal",
    };
    this.publish({ at, prev, dt, counters, groups, rows, totalCpu, memory, gpu: null });
  }

  /**
   * Task Manager groups by program: every process of one executable is one entry. Helpers an app
   * starts from its own folder (or WebView2, conhost and crash reporters) join the app they came from.
   */
  private groupWindows(rows: ProcessRow[], windows: Map<number, string>): ProcessGroup[] {
    const byPid = new Map(rows.map((r) => [r.pid, r]));
    const baseKey = (r: ProcessRow) => {
      if (r.self) return "app:systo";
      if (r.kind === "kernel" || !r.path) return `exe:${r.uid === 0 ? "sys" : "usr"}:${r.name.toLowerCase()}`;
      return `app:${r.path.toLowerCase()}`;
    };
    const HELPERS = new Set(["msedgewebview2.exe", "conhost.exe", "crashpad_handler.exe", "cefsharp.browsersubprocess.exe"]);
    const keys = new Map<number, string>();
    for (const r of rows) keys.set(r.pid, baseKey(r));
    const appKeys = new Set<string>();
    for (const r of rows) if (windows.has(r.pid)) appKeys.add(keys.get(r.pid)!);
    for (const r of rows) {
      if (windows.has(r.pid) || r.kind === "kernel" || r.self) continue;
      const lower = r.path.toLowerCase();
      let parent = byPid.get(r.ppid);
      for (let depth = 0; parent && depth < 6; depth++) {
        const parentKey = keys.get(parent.pid)!;
        if (parentKey === keys.get(r.pid)) break;
        if (appKeys.has(parentKey) || parentKey === "app:systo") {
          const appDir = parent.path.toLowerCase().replace(/\\[^\\]+$/, "");
          const ownDir = appDir.includes("\\windows\\") ? null : appDir;
          if (HELPERS.has(r.name.toLowerCase()) || (ownDir && lower.startsWith(ownDir + "\\"))) {
            keys.set(r.pid, parentKey);
            r.kind = "helper";
          }
          break;
        }
        parent = byPid.get(parent.ppid);
      }
    }

    const buckets = new Map<string, ProcessRow[]>();
    for (const r of rows) {
      const key = keys.get(r.pid)!;
      let list = buckets.get(key);
      if (!list) buckets.set(key, (list = []));
      list.push(r);
    }

    const groups: ProcessGroup[] = [];
    for (const [id, processes] of buckets) {
      processes.sort((a, b) => a.pid - b.pid);
      const pids = new Set(processes.map((p) => p.pid));
      const head =
        processes.find((p) => windows.has(p.pid) && p.kind !== "helper") ??
        processes.find((p) => p.kind !== "helper" && !pids.has(p.ppid)) ??
        processes.find((p) => p.kind !== "helper") ??
        processes[0];
      const self = id === "app:systo";
      // Systo runs on bun.exe, which would otherwise read as a dev tool.
      const kind = self ? "app" : head.kind === "helper" ? "menu-bar" : head.kind;
      const info = head.path ? exeInfo(head.path) : undefined;
      groups.push({
        id,
        name: self ? "Systo" : kind === "kernel" ? head.name.replace(/\.exe$/i, "") : exeDisplayName(head.path, head.name),
        section: sectionFor(kind),
        kind,
        safety: kind === "app" || kind === "menu-bar" ? (processes.some((p) => p.safety === "critical") ? "critical" : head.safety) : worstSafety(processes.map((p) => p.safety)),
        bundlePath: head.path || undefined,
        hasIcon: Boolean(head.path) && (info ? Boolean(info.icon) : true),
        user: head.user,
        headPid: head.pid,
        processes,
        cpu: processes.reduce((s, p) => s + p.cpu, 0),
        memory: processes.reduce((s, p) => s + p.memory, 0),
        disk: processes.reduce((s, p) => s + p.diskRead + p.diskWrite, 0),
        network: 0,
        self,
      });
    }
    return groups;
  }

  private group(
    rows: ProcessRow[],
    rowByPid: Map<number, ProcessRow>,
    native: NativeTable,
    byPid: Map<number, PsRow>,
  ): ProcessGroup[] {
    const groupKey = new Map<number, string>();

    const keyFor = (pid: number, depth = 0): string => {
      const cached = groupKey.get(pid);
      if (cached) return cached;
      const row = rowByPid.get(pid);
      if (!row) return `pid:${pid}`;
      let key: string | undefined;
      const bundle = outermostBundle(row.path);
      if (bundle) {
        key = `app:${bundle}`;
      } else {
        // Processes an app is responsible for (terminal shells, language servers, XPC services)
        // belong to that app, like Activity Monitor's grouping.
        const responsible = native[pid]?.responsible;
        if (responsible && responsible !== pid && rowByPid.has(responsible) && depth < 8) {
          const parentKey = keyFor(responsible, depth + 1);
          if (parentKey.startsWith("app:")) key = parentKey;
        }
        if (!key && !native[pid]) {
          // Without libproc, fall back to the parent chain: anything under an app joins it.
          let parent = byPid.get(pid)?.ppid ?? 0;
          for (let i = 0; i < 12 && parent > 1; i++) {
            const parentRow = rowByPid.get(parent);
            if (!parentRow) break;
            const parentBundle = outermostBundle(parentRow.path);
            if (parentBundle && classifyProcess({ ...parentRow, bundlePath: parentBundle, bundle: getBundleSync(parentBundle) }) !== "helper") {
              key = `app:${parentBundle}`;
              break;
            }
            parent = byPid.get(parent)?.ppid ?? 0;
          }
        }
        if (!key) key = `exe:${row.uid < 500 ? "sys" : "usr"}:${row.path || row.name}`;
      }
      groupKey.set(pid, key);
      return key;
    };

    const buckets = new Map<string, ProcessRow[]>();
    for (const row of rows) {
      const key = keyFor(row.pid);
      let list = buckets.get(key);
      if (!list) buckets.set(key, (list = []));
      list.push(row);
    }

    const groups: ProcessGroup[] = [];
    for (const [id, processes] of buckets) {
      processes.sort((a, b) => a.pid - b.pid);
      let group: ProcessGroup;
      if (id.startsWith("app:")) {
        const bundlePath = id.slice(4);
        const bundle = getBundleSync(bundlePath);
        const mainPath = bundle?.executable ? `${bundlePath}/Contents/MacOS/${bundle.executable}` : undefined;
        const head = processes.find((p) => p.path === mainPath) ?? processes.find((p) => p.path.startsWith(bundlePath)) ?? processes[0];
        const bundleKindValue = bundleKind(bundle, bundlePath, head.uid);
        // Only helpers running (a login item, an updater): the app itself isn't open.
        const appRunning = !mainPath || processes.some((p) => p.path === mainPath);
        const effectiveKind =
          appRunning || bundleKindValue === "user-service" || bundleKindValue === "system-service" ? bundleKindValue : "helper";
        // Ending an app ends its helpers too, so the app's own safety is what matters.
        const appSafety = processes.some((p) => p.safety === "critical") ? "critical" : head.safety;
        group = {
          id,
          name: bundle?.name ?? basename(bundlePath, ".app"),
          section: sectionFor(effectiveKind),
          kind: effectiveKind,
          safety: effectiveKind === "app" || effectiveKind === "menu-bar" || effectiveKind === "helper" ? appSafety : worstSafety(processes.map((p) => p.safety)),
          bundleId: bundle?.id,
          bundlePath,
          hasIcon: Boolean(bundle?.iconFile || bundle?.hasAssetCatalog),
          user: head.user,
          headPid: head.pid,
          processes,
          cpu: 0,
          memory: 0,
          disk: 0,
          network: 0,
          self: Boolean(bundle?.id?.startsWith(SELF_BUNDLE_ID)),
        };
      } else {
        const head = processes[0];
        group = {
          id,
          name: head.name,
          section: sectionFor(head.kind),
          kind: head.kind,
          safety: worstSafety(processes.map((p) => p.safety)),
          hasIcon: false,
          user: head.user,
          headPid: head.pid,
          processes,
          cpu: 0,
          memory: 0,
          disk: 0,
          network: 0,
          self: false,
        };
      }
      for (const p of processes) {
        group.cpu += p.cpu;
        group.memory += p.memory;
        group.disk += p.diskRead + p.diskWrite;
        group.network += p.netIn + p.netOut;
      }
      groups.push(group);
    }
    return groups;
  }
}

const KEY = "__systoSampler";
const globalStore = globalThis as unknown as Record<string, Sampler | undefined>;

export function sampler(): Sampler {
  return (globalStore[KEY] ??= new Sampler());
}

export function metricValue(group: ProcessGroup, metric: Metric): number {
  switch (metric) {
    case "cpu":
      return group.cpu;
    case "memory":
      return group.memory;
    case "disk":
      return group.disk;
    case "network":
      return group.network;
  }
}

export function islandData(snapshot: Snapshot, metric: Metric, storage: { used: number; total: number }, count = 3): IslandData {
  const { totals } = snapshot;
  const sorted = snapshot.groups
    .filter((g) => !(metric === "cpu" && g.kind === "kernel"))
    .map((g) => ({ g, value: metricValue(g, metric) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, count);
  const total =
    metric === "cpu"
      ? totals.cpu
      : metric === "memory"
        ? totals.memoryUsed
        : metric === "disk"
          ? totals.diskRead + totals.diskWrite
          : totals.netIn + totals.netOut;
  // Memory bars show share of installed RAM; the rest show share of what the whole Mac is doing now.
  const busy = metric === "cpu" ? total * totals.cores : total;
  const denominator = metric === "memory" ? totals.memoryTotal : Math.max(busy, sorted[0]?.value ?? 0, 1);
  return {
    metric,
    total,
    entries: sorted.map(({ g, value }) => ({
      id: g.id,
      name: g.name,
      bundlePath: g.bundlePath,
      hasIcon: g.hasIcon,
      kind: g.kind,
      value,
      share: Math.min(1, value / denominator),
    })),
    totals: {
      cpu: totals.cpu,
      cores: totals.cores,
      memoryUsed: totals.memoryUsed,
      memoryTotal: totals.memoryTotal,
      diskRead: totals.diskRead,
      diskWrite: totals.diskWrite,
      netIn: totals.netIn,
      netOut: totals.netOut,
    },
    overview: {
      cpu: totals.cpu,
      memory: totals.memoryTotal ? (totals.memoryUsed / totals.memoryTotal) * 100 : 0,
      disk: storage.total ? (storage.used / storage.total) * 100 : 0,
      network: Math.min(100, ((totals.netIn + totals.netOut) / Math.max(1, snapshot.netPeak)) * 100),
    },
    storage,
    netPeak: snapshot.netPeak,
  };
}
