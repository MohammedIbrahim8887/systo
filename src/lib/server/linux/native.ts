import { existsSync, readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";

/**
 * Everything the sampler needs on Linux comes from /proc and /sys, read synchronously: a few
 * hundred small virtual files per tick, with no helper process.
 */

export interface LinuxProc {
  pid: number;
  ppid: number;
  uid: number;
  /** Kernel's short name (15 characters at most). */
  comm: string;
  /** Executable path, or the first word of the command line when the link isn't readable. */
  path: string;
  /** A kernel thread: no executable, no memory of its own. */
  kthread: boolean;
  cpuNs: number;
  /** Resident memory that isn't shared file or shmem pages, in bytes. */
  memory: number;
  ioRead: number;
  ioWrite: number;
  /** False for other users' processes, whose I/O counters and executable are hidden. */
  readable: boolean;
}

export interface LinuxMemory {
  total: number;
  available: number;
  anon: number;
  shmem: number;
  cached: number;
  kernel: number;
  compressed: number;
  swapUsed: number;
  /** PSI "some" and "full" averages over 10s, or null on kernels without pressure stall info. */
  pressureSome: number | null;
  pressureFull: number | null;
}

export interface LinuxSample {
  procs: LinuxProc[];
  cpu: { idle: number; busy: number };
  memory: LinuxMemory;
  disk: { read: number; write: number };
  net: { in: number; out: number };
  gpu: number | null;
}

/** Linux reports process times in clock ticks; USER_HZ is 100 on every mainstream build. */
const TICK_NS = 1e7;
const PAGE = 4096;
const PF_KTHREAD = 0x00200000;

function read(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

interface Identity {
  uid: number;
  path: string;
  readable: boolean;
}

/**
 * Who a process runs as and what it runs. Read on every sample, not cached by pid: `exec` and
 * `setuid` change both without changing the pid or the start time (a shell running `exec firefox`).
 */
function identity(dir: string, kthread: boolean): Identity {
  let uid = 0;
  try {
    uid = statSync(dir).uid;
  } catch {
    // exited between readdir and stat
  }
  if (kthread) return { uid, path: "", readable: false };
  try {
    return { uid, path: readlinkSync(`${dir}/exe`).replace(/ \(deleted\)$/, ""), readable: true };
  } catch {
    // Another user's process: the command line is world-readable and usually starts with the path.
    const first = (read(`${dir}/cmdline`) ?? "").split("\0")[0] ?? "";
    return { uid, path: first.startsWith("/") ? first.split(" ")[0] : "", readable: false };
  }
}

/** Every process under a proc mount; the argument is for tests, which read a fixture directory. */
export function readProcs(proc = "/proc"): LinuxProc[] {
  const procs: LinuxProc[] = [];
  for (const name of readdirSync(proc)) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const dir = `${proc}/${pid}`;
    const stat = read(`${dir}/stat`);
    if (!stat) continue;
    // "pid (comm) state ppid …": comm may contain spaces and parentheses, so split on the last ")".
    const open = stat.indexOf("(");
    const close = stat.lastIndexOf(")");
    if (open < 0 || close < 0) continue;
    const comm = stat.slice(open + 1, close);
    const f = stat.slice(close + 2).split(" ");
    // f[0] state, f[1] ppid, f[6] flags, f[11] utime, f[12] stime
    const kthread = (Number(f[6]) & PF_KTHREAD) !== 0 || pid === 2;
    const info = identity(dir, kthread);
    let memory = 0;
    if (!kthread) {
      const statm = read(`${dir}/statm`)?.split(" ");
      if (statm) {
        const resident = Number(statm[1]) || 0;
        const shared = Number(statm[2]) || 0;
        memory = Math.max(0, resident - shared) * PAGE || resident * PAGE;
      }
    }
    let ioRead = 0;
    let ioWrite = 0;
    let readable = info.readable;
    if (readable) {
      const io = read(`${dir}/io`);
      if (io) {
        ioRead = Number(/^read_bytes: (\d+)/m.exec(io)?.[1] ?? 0);
        ioWrite = Number(/^write_bytes: (\d+)/m.exec(io)?.[1] ?? 0);
      } else readable = false;
    }
    procs.push({
      pid,
      ppid: Number(f[1]) || 0,
      uid: info.uid,
      comm,
      path: info.path,
      kthread,
      cpuNs: ((Number(f[11]) || 0) + (Number(f[12]) || 0)) * TICK_NS,
      memory,
      ioRead,
      ioWrite,
      readable,
    });
  }
  return procs;
}

function readCpu(): { idle: number; busy: number } {
  const line = (read("/proc/stat") ?? "").split("\n")[0] ?? "";
  // cpu user nice system idle iowait irq softirq steal
  const n = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = (n[3] || 0) + (n[4] || 0);
  const busy = (n[0] || 0) + (n[1] || 0) + (n[2] || 0) + (n[5] || 0) + (n[6] || 0) + (n[7] || 0);
  return { idle, busy };
}

function readMemory(): LinuxMemory {
  const text = read("/proc/meminfo") ?? "";
  const kb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(text)?.[1] ?? 0) * 1024;
  const shmem = kb("Shmem");
  let compressed = kb("Zswap");
  // zram keeps swapped-out pages compressed in RAM, like the macOS compressor.
  try {
    for (const dev of readdirSync("/sys/block")) {
      if (!dev.startsWith("zram")) continue;
      const stat = read(`/sys/block/${dev}/mm_stat`)?.trim().split(/\s+/);
      if (stat) compressed += Number(stat[2]) || 0;
    }
  } catch {
    // no /sys/block
  }
  const psi = read("/proc/pressure/memory");
  const avg = (kind: string) => {
    const m = psi ? new RegExp(`^${kind} avg10=([\\d.]+)`, "m").exec(psi) : null;
    return m ? Number(m[1]) : null;
  };
  return {
    total: kb("MemTotal"),
    available: kb("MemAvailable"),
    anon: kb("AnonPages"),
    shmem,
    cached: Math.max(0, kb("Cached") + kb("Buffers") + kb("SReclaimable") - shmem),
    kernel: kb("SUnreclaim") + kb("KernelStack") + kb("PageTables"),
    compressed,
    swapUsed: Math.max(0, kb("SwapTotal") - kb("SwapFree")),
    pressureSome: avg("some"),
    pressureFull: avg("full"),
  };
}

let devices: { at: number; disks: Set<string>; nics: Set<string>; gpu: string | null } | null = null;

/** Whole physical disks and network cards, so partitions and virtual devices aren't counted twice. */
function hardware() {
  if (devices && Date.now() - devices.at < 30_000) return devices;
  const disks = new Set<string>();
  const nics = new Set<string>();
  let gpu: string | null = null;
  try {
    for (const name of readdirSync("/sys/block")) if (!/^(loop|ram|zram|dm-|md|sr|fd)/.test(name)) disks.add(name);
  } catch {
    // leave empty
  }
  try {
    for (const name of readdirSync("/sys/class/net")) if (name !== "lo" && existsSync(`/sys/class/net/${name}/device`)) nics.add(name);
  } catch {
    // leave empty
  }
  try {
    for (const name of readdirSync("/sys/class/drm")) {
      const file = `/sys/class/drm/${name}/device/gpu_busy_percent`;
      if (/^card\d+$/.test(name) && existsSync(file)) gpu = file;
    }
  } catch {
    // no DRM devices
  }
  devices = { at: Date.now(), disks, nics, gpu };
  return devices;
}

function readDisk(): { read: number; write: number } {
  const { disks } = hardware();
  let readBytes = 0;
  let writeBytes = 0;
  for (const line of (read("/proc/diskstats") ?? "").split("\n")) {
    const cells = line.trim().split(/\s+/);
    if (!disks.has(cells[2])) continue;
    // Fields 6 and 10 are sectors read and written; a sector here is always 512 bytes.
    readBytes += (Number(cells[5]) || 0) * 512;
    writeBytes += (Number(cells[9]) || 0) * 512;
  }
  return { read: readBytes, write: writeBytes };
}

function readNet(): { in: number; out: number } {
  const { nics } = hardware();
  let input = 0;
  let out = 0;
  for (const line of (read("/proc/net/dev") ?? "").split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0 || !nics.has(line.slice(0, colon).trim())) continue;
    const cells = line.slice(colon + 1).trim().split(/\s+/);
    input += Number(cells[0]) || 0;
    out += Number(cells[8]) || 0;
  }
  return { in: input, out };
}

/** GPU load where the driver publishes it (amdgpu). Intel and NVIDIA don't expose it in sysfs. */
function readGpu(): number | null {
  const { gpu } = hardware();
  if (!gpu) return null;
  const value = Number(read(gpu)?.trim());
  return Number.isFinite(value) ? value : null;
}

export function readLinux(): LinuxSample | null {
  if (process.platform !== "linux") return null;
  return { procs: readProcs(), cpu: readCpu(), memory: readMemory(), disk: readDisk(), net: readNet(), gpu: readGpu() };
}

let users: Map<number, string> | null = null;

export function userName(uid: number): string {
  if (!users) {
    users = new Map();
    for (const line of (read("/etc/passwd") ?? "").split("\n")) {
      const [name, , id] = line.split(":");
      if (name && id && !users.has(Number(id))) users.set(Number(id), name);
    }
  }
  return users.get(uid) ?? String(uid);
}

/** When a process started, from its start time in ticks since boot. */
export function processStart(pid: number): Date | null {
  const stat = read(`/proc/${pid}/stat`);
  const uptime = Number((read("/proc/uptime") ?? "").split(" ")[0]);
  if (!stat || !Number.isFinite(uptime)) return null;
  const ticks = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]);
  if (!Number.isFinite(ticks)) return null;
  return new Date(Date.now() - (uptime - ticks / 100) * 1000);
}

export function commandLine(pid: number): string {
  return (read(`/proc/${pid}/cmdline`) ?? "").split("\0").filter(Boolean).join(" ");
}

/** The systemd unit a process runs in, from its cgroup: "waybar.service", "app-foo-123.scope"… */
export function systemdUnit(pid: number): { unit: string; user: boolean } | null {
  const cgroup = read(`/proc/${pid}/cgroup`);
  if (!cgroup) return null;
  const path = cgroup.trim().split("\n").pop()?.split("::")[1] ?? "";
  const parts = path.split("/").filter(Boolean);
  const unit = parts[parts.length - 1];
  if (!unit || !/\.(service|scope)$/.test(unit)) return null;
  return { unit, user: path.includes("/user@") };
}
