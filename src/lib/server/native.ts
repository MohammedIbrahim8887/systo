import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

/** Per-process data from libproc. Rusage fields are absent for processes we can't inspect (root's). */
export interface NativeProcInfo {
  ppid: number;
  uid: number;
  /** Short name from the kernel (16 chars), used when the path is unreadable. */
  comm: string;
  path: string;
  /** False when proc_pid_rusage was refused, so the counters below are 0. */
  inspectable: boolean;
  /** Cumulative CPU time in nanoseconds. */
  cpuNs: number;
  /** Physical memory footprint in bytes (what Activity Monitor calls "Memory"). */
  footprint: number;
  diskRead: number;
  diskWrite: number;
  /** Cumulative billed energy in nanojoules (0 when the kernel does not report it). */
  energyNj: number;
  /** The process macOS holds responsible for this one (an app for its helpers), or 0. */
  responsible: number;
}

export type NativeTable = Record<number, NativeProcInfo>;

export interface NativeMemory {
  pageSize: number;
  wired: number;
  purgeable: number;
  compressor: number;
  external: number;
  internal: number;
  swapUsed: number;
  pressure: number;
}

export interface NativeSample {
  procs: NativeTable;
  memory: NativeMemory;
}

/**
 * Self-contained so it can run in-process under Bun or be serialized with Function#toString and
 * evaluated by a `bun -e` worker when the dev server runs on Node. It must not close over imports.
 * One call lists every process with its parent, owner, name and path (no `ps` needed for those),
 * plus rusage where the kernel allows it, and the VM statistics `vm_stat` and `sysctl` report.
 */
function createNativeReader(ffi: {
  dlopen: (path: string, symbols: Record<string, unknown>) => { symbols: Record<string, (...args: any[]) => any> };
  ptr: (view: ArrayBufferView) => number;
}) {
  const lib = ffi.dlopen("/usr/lib/libSystem.B.dylib", {
    proc_listallpids: { args: ["ptr", "i32"], returns: "i32" },
    proc_pidinfo: { args: ["i32", "i32", "u64", "ptr", "i32"], returns: "i32" },
    proc_pid_rusage: { args: ["i32", "i32", "ptr"], returns: "i32" },
    proc_pidpath: { args: ["i32", "ptr", "u32"], returns: "i32" },
    mach_timebase_info: { args: ["ptr"], returns: "i32" },
    mach_host_self: { args: [], returns: "u32" },
    host_statistics64: { args: ["u32", "i32", "ptr", "ptr"], returns: "i32" },
    sysctlbyname: { args: ["ptr", "ptr", "ptr", "ptr", "u64"], returns: "i32" },
  }).symbols;
  let responsibleFor: ((pid: number) => number) | null = null;
  try {
    responsibleFor = ffi.dlopen("/usr/lib/system/libquarantine.dylib", {
      responsibility_get_pid_responsible_for_pid: { args: ["i32"], returns: "i32" },
    }).symbols.responsibility_get_pid_responsible_for_pid as (pid: number) => number;
  } catch {
    responsibleFor = null;
  }
  const timebase = new Uint32Array(2);
  lib.mach_timebase_info(ffi.ptr(timebase));
  const tick = timebase[1] ? timebase[0] / timebase[1] : 1;
  const pids = new Int32Array(16384);
  const pidsPtr = ffi.ptr(pids);
  const usage = new BigUint64Array(48);
  const usagePtr = ffi.ptr(usage);
  const short = new Uint8Array(64);
  const shortView = new DataView(short.buffer);
  const shortPtr = ffi.ptr(short);
  const pathBuf = new Uint8Array(4096);
  const pathPtr = ffi.ptr(pathBuf);
  const decoder = new TextDecoder();
  const host = lib.mach_host_self();
  const vm = new DataView(new ArrayBuffer(160));
  const vmPtr = ffi.ptr(vm);
  const vmCount = new Uint32Array(1);
  const vmCountPtr = ffi.ptr(vmCount);
  const encoder = new TextEncoder();
  const name = (s: string) => encoder.encode(s + "\0");
  const swapName = name("vm.swapusage");
  const pressureName = name("kern.memorystatus_vm_pressure_level");
  const pageName = name("hw.pagesize");
  const swap = new DataView(new ArrayBuffer(32));
  const int = new Int32Array(1);
  const len = new BigUint64Array(1);

  function sysctlInt(key: Uint8Array) {
    int[0] = 0;
    len[0] = 4n;
    return lib.sysctlbyname(ffi.ptr(key), ffi.ptr(int), ffi.ptr(len), null, 0n) === 0 ? int[0] : 0;
  }
  const pageSize = sysctlInt(pageName) || 16384;

  function memory() {
    vmCount[0] = 38; // HOST_VM_INFO64_COUNT
    lib.host_statistics64(host, 4, vmPtr, vmCountPtr);
    const pages = (offset: number) => vm.getUint32(offset, true) * pageSize;
    len[0] = 32n;
    const swapOk = lib.sysctlbyname(ffi.ptr(swapName), ffi.ptr(swap), ffi.ptr(len), null, 0n) === 0;
    return {
      pageSize,
      wired: pages(12),
      purgeable: pages(88),
      compressor: pages(128),
      external: pages(136),
      internal: pages(140),
      swapUsed: swapOk ? Number(swap.getBigUint64(16, true)) : 0,
      pressure: sysctlInt(pressureName) || 1,
    };
  }

  return function sample() {
    const out: Record<number, unknown> = {};
    const count = Math.min(pids.length, lib.proc_listallpids(pidsPtr, pids.byteLength));
    for (let i = 0; i < count; i++) {
      const pid = pids[i];
      if (pid < 0) continue;
      // PROC_PIDT_SHORTBSDINFO: pid, ppid, pgid, status, comm[16], flags, uid, …
      if (lib.proc_pidinfo(pid, 13, 0n, shortPtr, 64) !== 64) continue;
      const comm = decoder.decode(short.subarray(16, 32)).replace(/\0.*$/s, "");
      const pathLen = lib.proc_pidpath(pid, pathPtr, 4096);
      usage.fill(0n);
      // RUSAGE_INFO_V4
      const inspectable = lib.proc_pid_rusage(pid, 4, usagePtr) === 0;
      out[pid] = {
        ppid: shortView.getUint32(4, true),
        uid: shortView.getUint32(36, true),
        comm,
        path: pathLen > 0 ? decoder.decode(pathBuf.subarray(0, pathLen)) : "",
        inspectable,
        cpuNs: inspectable ? Number(usage[2] + usage[3]) * tick : 0,
        footprint: inspectable ? Number(usage[9]) : 0,
        diskRead: inspectable ? Number(usage[18]) : 0,
        diskWrite: inspectable ? Number(usage[19]) : 0,
        energyNj: inspectable ? Number(usage[33]) : 0,
        responsible: responsibleFor ? Math.max(0, responsibleFor(pid)) : 0,
      };
    }
    return { procs: out, memory: memory() };
  };
}

type Reader = () => Promise<NativeSample | null>;

const WORKER_SOURCE = `
const ffi = require("bun:ffi");
const sample = (${createNativeReader.toString()})(ffi);
const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", () => {
  process.stdout.write(JSON.stringify(sample()) + "\\n");
});
`;

class WorkerReader {
  private child: ChildProcessWithoutNullStreams | null = null;
  private queue: Array<(sample: NativeSample | null) => void> = [];
  private dead = false;

  constructor(private bunPath: string) {}

  private ensure() {
    if (this.child || this.dead) return this.child;
    const child = spawn(this.bunPath, ["--smol", "-e", WORKER_SOURCE], { stdio: ["pipe", "pipe", "pipe"] });
    child.on("exit", () => {
      this.child = null;
      for (const resolve of this.queue.splice(0)) resolve(null);
    });
    child.on("error", () => {
      this.dead = true;
      this.child = null;
    });
    child.stderr.on("data", () => {});
    createInterface({ input: child.stdout }).on("line", (line) => {
      const resolve = this.queue.shift();
      if (!resolve) return;
      try {
        resolve(JSON.parse(line) as NativeSample);
      } catch {
        resolve(null);
      }
    });
    child.unref();
    this.child = child;
    return child;
  }

  read: Reader = () =>
    new Promise((resolve) => {
      const child = this.ensure();
      if (!child) return resolve(null);
      this.queue.push(resolve);
      child.stdin.write("sample\n");
    });
}

let reader: Reader | null | undefined;

function findBun(): string | null {
  const result = spawnSync("/bin/sh", ["-lc", "command -v bun"], { encoding: "utf8" });
  const found = result.stdout?.trim();
  return found ? found : null;
}

let bunPath: string | null | undefined;

/** A bun binary for FFI workers: our own runtime under Bun, otherwise one on the PATH. */
export function bunExecutable(): string | null {
  if (bunPath === undefined) bunPath = (globalThis as { Bun?: unknown }).Bun ? process.execPath : findBun();
  return bunPath;
}

async function createReader(): Promise<Reader | null> {
  if (process.platform !== "darwin") return null;
  const bun = (globalThis as { Bun?: unknown }).Bun;
  if (bun) {
    try {
      const specifier = ["bun", "ffi"].join(":");
      const ffi = await import(/* @vite-ignore */ specifier);
      const sample = createNativeReader(ffi);
      return async () => sample() as NativeSample;
    } catch {
      return null;
    }
  }
  const binary = bunExecutable();
  return binary ? new WorkerReader(binary).read : null;
}

/** Every process plus VM statistics, or null without Bun (limited mode falls back to ps). */
export async function readNative(): Promise<NativeSample | null> {
  if (reader === undefined) reader = await createReader();
  if (!reader) return null;
  return reader();
}
