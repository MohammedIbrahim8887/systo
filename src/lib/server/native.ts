import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

/** Per-process data only libproc can give: footprint, disk I/O and responsibility. */
export interface NativeProcInfo {
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
  path: string;
}

export type NativeTable = Record<number, NativeProcInfo>;

/**
 * Self-contained so it can run in-process under Bun or be serialized with Function#toString and
 * evaluated by a `bun -e` worker when the dev server runs on Node. It must not close over imports.
 */
function createNativeReader(ffi: {
  dlopen: (path: string, symbols: Record<string, unknown>) => { symbols: Record<string, (...args: any[]) => any> };
  ptr: (view: ArrayBufferView) => number;
}) {
  const lib = ffi.dlopen("/usr/lib/libSystem.B.dylib", {
    proc_pid_rusage: { args: ["i32", "i32", "ptr"], returns: "i32" },
    proc_pidpath: { args: ["i32", "ptr", "u32"], returns: "i32" },
    mach_timebase_info: { args: ["ptr"], returns: "i32" },
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
  const usage = new BigUint64Array(48);
  const usagePtr = ffi.ptr(usage);
  const pathBuf = new Uint8Array(4096);
  const pathPtr = ffi.ptr(pathBuf);
  const decoder = new TextDecoder();

  return function read(pids: number[]) {
    const out: Record<number, unknown> = {};
    for (const pid of pids) {
      usage.fill(0n);
      // RUSAGE_INFO_V4
      if (lib.proc_pid_rusage(pid, 4, usagePtr) !== 0) continue;
      const len = lib.proc_pidpath(pid, pathPtr, 4096);
      out[pid] = {
        cpuNs: Number(usage[2] + usage[3]) * tick,
        footprint: Number(usage[9]),
        diskRead: Number(usage[18]),
        diskWrite: Number(usage[19]),
        energyNj: Number(usage[33]),
        responsible: responsibleFor ? Math.max(0, responsibleFor(pid)) : 0,
        path: len > 0 ? decoder.decode(pathBuf.subarray(0, len)) : "",
      };
    }
    return out;
  };
}

type Reader = (pids: number[]) => Promise<NativeTable>;

const WORKER_SOURCE = `
const ffi = require("bun:ffi");
const read = (${createNativeReader.toString()})(ffi);
const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let pids = [];
  try { pids = JSON.parse(line); } catch {}
  process.stdout.write(JSON.stringify(read(pids)) + "\\n");
});
`;

class WorkerReader {
  private child: ChildProcessWithoutNullStreams | null = null;
  private queue: Array<(table: NativeTable) => void> = [];
  private dead = false;

  constructor(private bunPath: string) {}

  private ensure() {
    if (this.child || this.dead) return this.child;
    const child = spawn(this.bunPath, ["-e", WORKER_SOURCE], { stdio: ["pipe", "pipe", "pipe"] });
    child.on("exit", () => {
      this.child = null;
      for (const resolve of this.queue.splice(0)) resolve({});
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
        resolve(JSON.parse(line) as NativeTable);
      } catch {
        resolve({});
      }
    });
    child.unref();
    this.child = child;
    return child;
  }

  read: Reader = (pids) =>
    new Promise((resolve) => {
      const child = this.ensure();
      if (!child) return resolve({});
      this.queue.push(resolve);
      child.stdin.write(JSON.stringify(pids) + "\n");
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
      const read = createNativeReader(ffi);
      return async (pids) => read(pids) as NativeTable;
    } catch {
      return null;
    }
  }
  const binary = bunExecutable();
  return binary ? new WorkerReader(binary).read : null;
}

export async function readNative(pids: number[]): Promise<NativeTable | null> {
  if (reader === undefined) reader = await createReader();
  if (!reader) return null;
  return reader(pids);
}
