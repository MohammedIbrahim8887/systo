/**
 * Windows process and system counters straight from Win32 through bun:ffi, the same numbers
 * Task Manager reads. One sample costs a few syscalls per process, so it runs every tick without
 * spawning anything.
 */

export interface WinProc {
  pid: number;
  ppid: number;
  /** Executable name from the process snapshot (e.g. "chrome.exe"). */
  exe: string;
  /** Full image path, or "" for protected processes. */
  path: string;
  threads: number;
  /** Terminal Services session: 0 is services and the system. */
  session: number;
  /** Cumulative kernel + user CPU time in nanoseconds. */
  cpuNs: number;
  /** Private working set, which is Task Manager's "Memory" column. */
  memory: number;
  ioRead: number;
  ioWrite: number;
  /** False when the process couldn't be opened, so only the snapshot fields are real. */
  readable: boolean;
}

export interface WinSample {
  procs: WinProc[];
  /** Processes that own a visible, uncloaked top-level window, with that window's title. */
  windows: Map<number, string>;
  cpu: { idle: number; busy: number };
  memory: {
    total: number;
    available: number;
    load: number;
    commit: number;
    commitLimit: number;
    cache: number;
    kernelNonpaged: number;
    kernelPaged: number;
  };
  net: { in: number; out: number; interfaces: string[] };
}

type Ffi = typeof import("bun:ffi");

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TH32CS_SNAPPROCESS = 0x2;
const ENTRY_SIZE = 568; // PROCESSENTRY32W on x64
const IF_ROW_SIZE = 1352; // MIB_IF_ROW2
const GW_OWNER = 4;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const DWMWA_CLOAKED = 14;

export function createWinReader(ffi: Ffi) {
  const { dlopen, ptr, read, toArrayBuffer } = ffi;
  const k32 = dlopen("kernel32.dll", {
    CreateToolhelp32Snapshot: { args: ["u32", "u32"], returns: "ptr" },
    Process32FirstW: { args: ["ptr", "ptr"], returns: "i32" },
    Process32NextW: { args: ["ptr", "ptr"], returns: "i32" },
    CloseHandle: { args: ["ptr"], returns: "i32" },
    OpenProcess: { args: ["u32", "i32", "u32"], returns: "ptr" },
    GetProcessTimes: { args: ["ptr", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
    K32GetProcessMemoryInfo: { args: ["ptr", "ptr", "u32"], returns: "i32" },
    GetProcessIoCounters: { args: ["ptr", "ptr"], returns: "i32" },
    QueryFullProcessImageNameW: { args: ["ptr", "u32", "ptr", "ptr"], returns: "i32" },
    ProcessIdToSessionId: { args: ["u32", "ptr"], returns: "i32" },
    GetSystemTimes: { args: ["ptr", "ptr", "ptr"], returns: "i32" },
    GlobalMemoryStatusEx: { args: ["ptr"], returns: "i32" },
    K32GetPerformanceInfo: { args: ["ptr", "u32"], returns: "i32" },
  }).symbols;
  const user32 = dlopen("user32.dll", {
    FindWindowExW: { args: ["ptr", "ptr", "ptr", "ptr"], returns: "ptr" },
    IsWindowVisible: { args: ["ptr"], returns: "i32" },
    GetWindow: { args: ["ptr", "u32"], returns: "ptr" },
    GetWindowTextLengthW: { args: ["ptr"], returns: "i32" },
    GetWindowTextW: { args: ["ptr", "ptr", "i32"], returns: "i32" },
    GetWindowThreadProcessId: { args: ["ptr", "ptr"], returns: "u32" },
    GetWindowLongPtrW: { args: ["ptr", "i32"], returns: "i64" },
  }).symbols;
  let dwm: { DwmGetWindowAttribute: (...args: any[]) => any } | null = null;
  try {
    dwm = dlopen("dwmapi.dll", { DwmGetWindowAttribute: { args: ["ptr", "u32", "ptr", "u32"], returns: "i32" } }).symbols;
  } catch {
    dwm = null;
  }
  let iphlp: { GetIfTable2: (...args: any[]) => any; FreeMibTable: (...args: any[]) => any } | null = null;
  try {
    iphlp = dlopen("iphlpapi.dll", {
      GetIfTable2: { args: ["ptr"], returns: "u32" },
      FreeMibTable: { args: ["ptr"], returns: "void" },
    }).symbols;
  } catch {
    iphlp = null;
  }

  const utf16 = new TextDecoder("utf-16le");
  const wide = (bytes: Uint8Array) => {
    const units = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    let end = units.indexOf(0);
    if (end === -1) end = units.length;
    return utf16.decode(units.subarray(0, end));
  };
  const valid = (handle: unknown): handle is number =>
    typeof handle === "number" && handle > 0 && handle < Number.MAX_SAFE_INTEGER;

  const entry = new Uint8Array(ENTRY_SIZE);
  const entryView = new DataView(entry.buffer);
  const created = new BigUint64Array(1);
  const exited = new BigUint64Array(1);
  const kernel = new BigUint64Array(1);
  const user = new BigUint64Array(1);
  const mem = new BigUint64Array(12);
  const memView = new DataView(mem.buffer);
  const io = new BigUint64Array(6);
  const pathBuf = new Uint8Array(2048);
  const pathLen = new Uint32Array(1);
  const session = new Uint32Array(1);
  const winPid = new Uint32Array(1);
  const cloaked = new Uint32Array(1);
  const titleBuf = new Uint8Array(512);
  const memStatus = new BigUint64Array(8);
  const memStatusView = new DataView(memStatus.buffer);
  const perf = new BigUint64Array(13);
  const perfView = new DataView(perf.buffer);
  const tableOut = new BigUint64Array(1);
  let memCb = 96; // PROCESS_MEMORY_COUNTERS_EX2 (Windows 10 1809+), falls back to EX

  function listProcesses(): WinProc[] {
    const snap = k32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (!valid(snap)) return [];
    const procs: WinProc[] = [];
    try {
      entryView.setUint32(0, ENTRY_SIZE, true);
      let ok = k32.Process32FirstW(snap, ptr(entry));
      while (ok) {
        const pid = entryView.getUint32(8, true);
        if (pid !== 0) {
          procs.push({
            pid,
            ppid: entryView.getUint32(32, true),
            exe: wide(entry.subarray(44, 44 + 520)),
            path: "",
            threads: entryView.getUint32(28, true),
            session: 0,
            cpuNs: 0,
            memory: 0,
            ioRead: 0,
            ioWrite: 0,
            readable: false,
          });
        }
        entryView.setUint32(0, ENTRY_SIZE, true);
        ok = k32.Process32NextW(snap, ptr(entry));
      }
    } finally {
      k32.CloseHandle(snap);
    }
    return procs;
  }

  function inspect(p: WinProc) {
    if (k32.ProcessIdToSessionId(p.pid, ptr(session))) p.session = session[0];
    const handle = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, p.pid);
    if (!valid(handle)) return;
    try {
      p.readable = true;
      if (k32.GetProcessTimes(handle, ptr(created), ptr(exited), ptr(kernel), ptr(user))) {
        p.cpuNs = Number(kernel[0] + user[0]) * 100;
      }
      memView.setUint32(0, memCb, true);
      let memOk = k32.K32GetProcessMemoryInfo(handle, ptr(mem), memCb);
      if (!memOk && memCb === 96) {
        memCb = 80;
        memView.setUint32(0, memCb, true);
        memOk = k32.K32GetProcessMemoryInfo(handle, ptr(mem), memCb);
      }
      if (memOk) p.memory = Number(memCb === 96 ? mem[10] : mem[2]);
      if (k32.GetProcessIoCounters(handle, ptr(io))) {
        p.ioRead = Number(io[3]);
        p.ioWrite = Number(io[4]);
      }
      pathLen[0] = pathBuf.byteLength >> 1;
      if (k32.QueryFullProcessImageNameW(handle, 0, ptr(pathBuf), ptr(pathLen))) {
        p.path = utf16.decode(new Uint16Array(pathBuf.buffer, 0, pathLen[0]));
      }
    } finally {
      k32.CloseHandle(handle);
    }
  }

  /** Task Manager's "Apps": processes with a visible, unowned, titled, uncloaked top-level window. */
  function appWindows(): Map<number, string> {
    const map = new Map<number, string>();
    let hwnd: number | null = null;
    for (let guard = 0; guard < 4000; guard++) {
      hwnd = user32.FindWindowExW(null, hwnd, null, null) as number | null;
      if (!hwnd) break;
      if (!user32.IsWindowVisible(hwnd)) continue;
      if (user32.GetWindow(hwnd, GW_OWNER)) continue;
      const exStyle = Number(user32.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
      if (exStyle & WS_EX_TOOLWINDOW) continue;
      if (dwm) {
        cloaked[0] = 0;
        if (dwm.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, ptr(cloaked), 4) === 0 && cloaked[0]) continue;
      }
      const length = user32.GetWindowTextLengthW(hwnd);
      if (length <= 0) continue;
      user32.GetWindowThreadProcessId(hwnd, ptr(winPid));
      if (map.has(winPid[0])) continue;
      titleBuf.fill(0);
      user32.GetWindowTextW(hwnd, ptr(titleBuf), titleBuf.byteLength >> 1);
      map.set(winPid[0], wide(titleBuf));
    }
    return map;
  }

  function cpuTimes() {
    const idle = new BigUint64Array(1);
    const k = new BigUint64Array(1);
    const u = new BigUint64Array(1);
    if (!k32.GetSystemTimes(ptr(idle), ptr(k), ptr(u))) return { idle: 0, busy: 0 };
    // Kernel time includes idle time.
    return { idle: Number(idle[0]), busy: Number(k[0] + u[0] - idle[0]) };
  }

  function memory(): WinSample["memory"] {
    memStatus.fill(0n);
    memStatusView.setUint32(0, 64, true);
    k32.GlobalMemoryStatusEx(ptr(memStatus));
    perf.fill(0n);
    perfView.setUint32(0, 104, true);
    const havePerf = k32.K32GetPerformanceInfo(ptr(perf), 104);
    const page = havePerf ? Number(perf[10]) || 4096 : 4096;
    return {
      total: Number(memStatus[1]),
      available: Number(memStatus[2]),
      load: memStatusView.getUint32(4, true),
      commit: havePerf ? Number(perf[1]) * page : 0,
      commitLimit: havePerf ? Number(perf[2]) * page : 0,
      cache: havePerf ? Number(perf[6]) * page : 0,
      kernelPaged: havePerf ? Number(perf[8]) * page : 0,
      kernelNonpaged: havePerf ? Number(perf[9]) * page : 0,
    };
  }

  /** Bytes through physical adapters that are up, skipping loopback, tunnels and filter layers. */
  function network(): WinSample["net"] {
    const out = { in: 0, out: 0, interfaces: [] as string[] };
    if (!iphlp) return out;
    tableOut[0] = 0n;
    if (iphlp.GetIfTable2(ptr(tableOut)) !== 0) return out;
    const table = Number(tableOut[0]);
    if (!table) return out;
    try {
      const count = read.u32(table, 0);
      for (let i = 0; i < count && i < 512; i++) {
        const base = 8 + i * IF_ROW_SIZE;
        const type = read.u32(table, base + 1128);
        const flags = read.u8(table, base + 1152);
        const oper = read.u32(table, base + 1156);
        const hardware = (flags & 0x1) !== 0;
        const filter = (flags & 0x2) !== 0;
        if (!hardware || filter || oper !== 1 || type === 24) continue;
        out.in += Number(read.u64(table, base + 1208));
        out.out += Number(read.u64(table, base + 1280));
        out.interfaces.push(wide(new Uint8Array(toArrayBuffer(table, base + 28, 514))));
      }
    } finally {
      iphlp.FreeMibTable(table);
    }
    return out;
  }

  return function sample(): WinSample {
    const procs = listProcesses();
    for (const p of procs) inspect(p);
    return { procs, windows: appWindows(), cpu: cpuTimes(), memory: memory(), net: network() };
  };
}

let reader: (() => WinSample) | null | undefined;

export async function readWindows(): Promise<WinSample | null> {
  if (reader === undefined) {
    reader = null;
    if (process.platform === "win32" && (globalThis as { Bun?: unknown }).Bun) {
      try {
        const ffi = (await import(/* @vite-ignore */ ["bun", "ffi"].join(":"))) as Ffi;
        reader = createWinReader(ffi);
      } catch (error) {
        console.error("[systo] Win32 reader unavailable", error);
      }
    }
  }
  return reader ? reader() : null;
}

let diskApi: { ffi: Ffi; GetDiskFreeSpaceExW: (...args: any[]) => any } | null | undefined;

/** Total and free bytes on the volume holding `root` (e.g. "C:\\"). */
export async function diskSpace(root: string): Promise<{ total: number; free: number } | null> {
  if (diskApi === undefined) {
    diskApi = null;
    if (process.platform === "win32" && (globalThis as { Bun?: unknown }).Bun) {
      try {
        const ffi = (await import(/* @vite-ignore */ ["bun", "ffi"].join(":"))) as Ffi;
        const { symbols } = ffi.dlopen("kernel32.dll", { GetDiskFreeSpaceExW: { args: ["ptr", "ptr", "ptr", "ptr"], returns: "i32" } });
        diskApi = { ffi, GetDiskFreeSpaceExW: symbols.GetDiskFreeSpaceExW };
      } catch {
        diskApi = null;
      }
    }
  }
  if (!diskApi) return null;
  const { ptr } = diskApi.ffi;
  const path = Buffer.from(`${root}\0`, "utf16le");
  const available = new BigUint64Array(1);
  const total = new BigUint64Array(1);
  const free = new BigUint64Array(1);
  if (!diskApi.GetDiskFreeSpaceExW(ptr(path), ptr(available), ptr(total), ptr(free))) return null;
  return { total: Number(total[0]), free: Number(free[0]) };
}

/** The drive Windows is installed on, e.g. "C:\\". */
export function systemDrive() {
  return `${(process.env.SystemDrive || "C:").replace(/\\$/, "")}\\`;
}
