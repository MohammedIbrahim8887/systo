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
import { canListWindows, entryForClass, entryForProgram, windowOwners, type DesktopEntry } from "./linux/apps";
import { classifyLinux, safetyLinux } from "./linux/classify";
import { readLinux, userName } from "./linux/native";
import { socketTraffic } from "./linux/network";
import { readNative, type NativeMemory, type NativeTable } from "./native";
import { usage } from "./usage";
import { exeDisplayName, exeInfo } from "./win/apps";
import { classifyWin, safetyWin } from "./win/classify";
import { readWindows } from "./win/native";

const IS_WIN = process.platform === "win32";
const IS_LINUX = process.platform === "linux";

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

/** CPU time and RSS for processes libproc can't inspect (other users'), from setuid ps. */
async function readPsCounters(): Promise<Map<number, { cpuNs: number; rss: number }>> {
  const text = await output("/bin/ps", ["-axo", "pid=,time=,rss="]);
  const map = new Map<number, { cpuNs: number; rss: number }>();
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\S+)\s+(\d+)/.exec(line);
    if (m) map.set(Number(m[1]), { cpuNs: parseCpuTime(m[2]), rss: Number(m[3]) * 1024 });
  }
  return map;
}

const userNames = new Map<number, string>();
let userNamesLoaded: Promise<void> | null = null;

/** uid → short name from the local directory, read once. */
function loadUserNames() {
  return (userNamesLoaded ??= output("/usr/bin/dscl", [".", "-list", "/Users", "UniqueID"], 5000).then((text) => {
    for (const line of text.split("\n")) {
      const m = /^(\S+)\s+(-?\d+)\s*$/.exec(line);
      if (m && !userNames.has(Number(m[2]))) userNames.set(Number(m[2]), m[1]);
    }
  }));
}

function memoryFromNative(m: NativeMemory): MemoryStats {
  const app = Math.max(0, m.internal - m.purgeable);
  return {
    used: app + m.wired + m.compressor,
    app,
    wired: m.wired,
    compressed: m.compressor,
    cached: m.external + m.purgeable,
    swapUsed: m.swapUsed,
    pressure: m.pressure >= 4 ? "critical" : m.pressure >= 2 ? "warning" : "normal",
  };
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
  /** Windows and Linux: system-wide idle and busy CPU time (100ns units or clock ticks). */
  sysCpu?: { idle: number; busy: number };
}

export const SELF_BUNDLE_ID = "dev.systo.monitor";
const HISTORY = 120;
const IDLE_STOP_MS = 15000;
/** Cadence while nothing is polling but usage history is being recorded. */
const BACKGROUND_MS = 10000;
/** A poll within this window counts as someone looking. */
const DEMAND_MS = 5000;
/** Cadence while only the island is open: it shows one number collapsed, so 1.5s is wasted work. */
const LIGHT_MS = 2500;
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
  /** Last poll from the main window, which shows every column (GPU, per-app network). */
  private lastFullDemand = 0;
  /** Last island poll for the network metric, which needs per-app network. */
  private lastNetworkDemand = 0;
  /** Per-app network comes from nettop, run only when needed; rates hold between runs. */
  private netAt = 0;
  private netLast = new Map<number, { in: number; out: number }>();
  private netRates = new Map<number, { in: number; out: number }>();
  private lastGpu: number | null = null;
  private gpuTick = 0;
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

  /**
   * Returns the latest snapshot, sampling on demand and keeping the loop alive while polled.
   * "full" is the main window; "light" is the island and one-off reads, which sample slower and
   * skip GPU and per-app network unless `network` asks for it.
   */
  async current(demand: "full" | "light" = "light", options: { network?: boolean } = {}): Promise<Snapshot> {
    const now = Date.now();
    this.lastDemand = now;
    if (demand === "full") this.lastFullDemand = now;
    if (options.network) this.lastNetworkDemand = now;
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
      }, idle ? Math.max(this.interval, BACKGROUND_MS) : this.full() ? this.interval : Math.max(this.interval, LIGHT_MS));
    });
  }

  private full() {
    return Date.now() - this.lastFullDemand < DEMAND_MS;
  }

  /**
   * Per-app network rates when someone needs them, and at least every background tick for History.
   * macOS reads running totals from nettop; Linux gets the bytes moved since the last reading.
   */
  private async networkRates(): Promise<Map<number, { in: number; out: number }>> {
    const now = Date.now();
    const wanted = this.full() || now - this.lastNetworkDemand < DEMAND_MS || now - this.netAt >= BACKGROUND_MS - 500;
    if (!wanted) return this.netRates;
    if (IS_LINUX) {
      const moved = await socketTraffic().catch(() => null);
      if (!moved) return this.netRates;
      const elapsed = this.netAt ? Math.max(0.2, (now - this.netAt) / 1000) : 0;
      const rates = new Map<number, { in: number; out: number }>();
      if (elapsed) for (const [pid, bytes] of moved) rates.set(pid, { in: bytes.in / elapsed, out: bytes.out / elapsed });
      this.netAt = now;
      this.netRates = rates;
      return rates;
    }
    const counters = await readNettop().catch(() => null);
    if (!counters) return this.netRates;
    const seconds = this.netAt ? Math.max(0.2, (now - this.netAt) / 1000) : 0;
    const rates = new Map<number, { in: number; out: number }>();
    if (seconds) {
      for (const [pid, c] of counters) {
        const before = this.netLast.get(pid);
        if (before) rates.set(pid, { in: delta(c.in, before.in) / seconds, out: delta(c.out, before.out) / seconds });
      }
    }
    this.netAt = now;
    this.netLast = counters;
    this.netRates = rates;
    return rates;
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
    if (IS_LINUX) return this.sampleLinux();
    const full = this.full();
    const [sample, netRates, sysNet, sysDisk, gpu] = await Promise.all([
      readNative(),
      this.networkRates(),
      readInterfaces().catch(() => ({ in: 0, out: 0 })),
      readDiskIo().catch(() => ({ read: 0, write: 0 })),
      // GPU load only shows in the Performance view; every other tick is smooth enough for its chart.
      full && this.gpuTick++ % 2 === 0 ? readGpu().catch(() => null) : Promise.resolve(this.lastGpu),
    ]);
    this.lastGpu = gpu;
    let ps: PsRow[];
    let memory: MemoryStats;
    let native: NativeTable = {};
    if (sample) {
      // libproc lists everything; ps only fills CPU and memory for processes it can't inspect.
      const needPs = Object.values(sample.procs).some((p) => !p.inspectable);
      const [counters] = await Promise.all([needPs ? readPsCounters() : Promise.resolve(new Map()), loadUserNames()]);
      ps = [];
      for (const [key, info] of Object.entries(sample.procs)) {
        const pid = Number(key);
        const fallback = counters.get(pid);
        if (info.inspectable) native[pid] = info;
        ps.push({
          pid,
          ppid: info.ppid,
          uid: info.uid,
          user: userNames.get(info.uid) ?? String(info.uid),
          cpuNs: info.inspectable ? info.cpuNs : (fallback?.cpuNs ?? 0),
          rss: fallback?.rss ?? 0,
          comm: info.path || info.comm,
        });
      }
      memory = memoryFromNative(sample.memory);
    } else {
      [ps, memory] = await Promise.all([readPs(), readMemory()]);
    }
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
      net: new Map(),
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
      const net = netRates.get(p.pid);
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
        netIn: net?.in ?? 0,
        netOut: net?.out ?? 0,
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

  // ── Linux ────────────────────────────────────────────────────────────────────────────────

  private async sampleLinux() {
    const [windows, netRates] = await Promise.all([windowOwners().catch(() => new Map<number, string>()), this.networkRates()]);
    const linux = readLinux();
    if (!linux) throw new Error("/proc is unavailable");
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
      sysDisk: linux.disk,
      sysNet: linux.net,
      sysCpu: linux.cpu,
    };
    this.native = true;
    this.windowPids = new Set(windows.keys());

    // Systo is this server, whatever it started (the shell and its web views) and the launcher above it.
    const parents = new Map(linux.procs.map((p) => [p.pid, p.ppid]));
    const selfPids = new Set<number>([process.pid]);
    const execDir = dirname(process.execPath);
    for (const p of linux.procs) {
      let cursor = p.pid;
      for (let depth = 0; depth < 12 && cursor > 1; depth++) {
        if (selfPids.has(cursor)) {
          selfPids.add(p.pid);
          break;
        }
        cursor = parents.get(cursor) ?? 0;
      }
      if (p.pid === process.ppid && p.path && dirname(p.path) === execDir) selfPids.add(p.pid);
    }

    const entries = new Map<number, DesktopEntry | undefined>();
    const rows: ProcessRow[] = [];
    for (const p of linux.procs) {
      counters.cpu.set(p.pid, p.cpuNs);
      counters.diskRead.set(p.pid, p.ioRead);
      counters.diskWrite.set(p.pid, p.ioWrite);
      // The path of another user's process is a guess from its command line ("/sbin/init" for
      // systemd), so the kernel's name wins unless it was cut off at 15 characters.
      const file = p.path ? basename(p.path) : "";
      const name = file && (p.readable || file.startsWith(p.comm)) ? file : p.comm;
      const windowClass = windows.get(p.pid);
      const hasWindow = windowClass !== undefined;
      const entry = p.kthread ? undefined : hasWindow ? entryForClass(windowClass) ?? entryForProgram(p.path, name) : entryForProgram(p.path, name);
      entries.set(p.pid, entry);
      const kind = classifyLinux({
        pid: p.pid,
        uid: p.uid,
        name,
        path: p.path,
        kthread: p.kthread,
        // Without a compositor to ask, a launcher entry is the best sign that this is an app.
        hasWindow: hasWindow || (!canListWindows() && Boolean(entry) && p.uid >= 1000),
        hasEntry: Boolean(entry),
      });
      rows.push({
        pid: p.pid,
        ppid: p.ppid,
        uid: p.uid,
        user: userName(p.uid),
        name,
        path: p.path,
        cpu: Math.min(prev && dt ? (delta(p.cpuNs, prev.cpu.get(p.pid)) / (dt * 1e9)) * 100 : 0, this.cores * 100),
        memory: p.memory,
        diskRead: prev && dt ? delta(p.ioRead, prev.diskRead.get(p.pid)) / dt : 0,
        diskWrite: prev && dt ? delta(p.ioWrite, prev.diskWrite.get(p.pid)) / dt : 0,
        netIn: netRates.get(p.pid)?.in ?? 0,
        netOut: netRates.get(p.pid)?.out ?? 0,
        power: 0,
        kind,
        safety: safetyLinux(name, kind, p.pid),
        inspectable: p.readable || p.kthread,
        self: selfPids.has(p.pid),
      });
    }

    const groups = this.groupLinux(rows, windows, entries);
    let totalCpu = rows.reduce((sum, r) => sum + r.cpu, 0) / this.cores;
    if (prev?.sysCpu) {
      const busy = delta(linux.cpu.busy, prev.sysCpu.busy);
      const idle = delta(linux.cpu.idle, prev.sysCpu.idle);
      if (busy + idle > 0) totalCpu = (busy / (busy + idle)) * 100;
    }
    const m = linux.memory;
    const free = m.total ? m.available / m.total : 1;
    const memory: MemoryStats = {
      used: Math.max(0, m.total - m.available),
      app: m.anon + m.shmem,
      wired: m.kernel,
      compressed: m.compressed,
      cached: m.cached,
      swapUsed: m.swapUsed,
      pressure:
        (m.pressureFull ?? 0) >= 10 || free < 0.04 ? "critical" : (m.pressureSome ?? 0) >= 10 || free < 0.1 ? "warning" : "normal",
    };
    this.publish({ at, prev, dt, counters, groups, rows, totalCpu, memory, gpu: linux.gpu });
  }

  /**
   * An app is a process that owns a window; whatever it started joins it (a terminal's shells, a
   * browser's renderers), the way Activity Monitor groups by responsible app. Everything else
   * groups by executable, and kernel threads collapse into one entry.
   */
  private groupLinux(rows: ProcessRow[], windows: Map<number, string>, entries: Map<number, DesktopEntry | undefined>): ProcessGroup[] {
    const byPid = new Map(rows.map((r) => [r.pid, r]));
    const isApp = (r: ProcessRow) => r.kind === "app" && !r.self;
    const baseKey = (r: ProcessRow) => {
      if (r.self) return "app:systo";
      if (r.kind === "kernel") return "kernel";
      if (isApp(r)) {
        const entry = entries.get(r.pid);
        return `app:${entry?.id ?? windows.get(r.pid) ?? r.path ?? r.name}`;
      }
      return `exe:${r.uid < 1000 ? "sys" : "usr"}:${r.path || r.name}`;
    };
    const keys = new Map<number, string>();
    for (const r of rows) keys.set(r.pid, baseKey(r));
    for (const r of rows) {
      if (r.self || r.kind === "kernel" || isApp(r)) continue;
      let parent = byPid.get(r.ppid);
      for (let depth = 0; parent && parent.pid > 1 && depth < 12; depth++) {
        if (parent.self) break;
        if (isApp(parent)) {
          keys.set(r.pid, keys.get(parent.pid)!);
          // Tools run inside a terminal keep their own kind; an app's own children are its helpers.
          if (r.kind !== "developer") r.kind = "helper";
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
      const self = id === "app:systo";
      const kernel = id === "kernel";
      const pids = new Set(processes.map((p) => p.pid));
      const head =
        (self ? processes.find((p) => p.pid === process.pid) : undefined) ??
        processes.find((p) => windows.has(p.pid) && isApp(p)) ??
        processes.find((p) => !pids.has(p.ppid)) ??
        processes[0];
      const entry = self || kernel ? undefined : entries.get(head.pid);
      const kind = self ? "app" : head.kind;
      const appLike = kind === "app" || kind === "menu-bar";
      groups.push({
        id,
        name: self ? "Systo" : kernel ? "Linux kernel" : entry && appLike ? entry.name : head.name,
        section: sectionFor(kind),
        kind,
        safety: appLike ? (processes.some((p) => p.safety === "critical") ? "critical" : head.safety) : worstSafety(processes.map((p) => p.safety)),
        bundleId: entry && appLike ? entry.id : undefined,
        bundlePath: entry && appLike ? entry.file : undefined,
        hasIcon: Boolean(entry && appLike && entry.icon),
        user: head.user,
        headPid: head.pid,
        processes,
        cpu: processes.reduce((s, p) => s + p.cpu, 0),
        memory: processes.reduce((s, p) => s + p.memory, 0),
        disk: processes.reduce((s, p) => s + p.diskRead + p.diskWrite, 0),
        network: processes.reduce((s, p) => s + p.netIn + p.netOut, 0),
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
