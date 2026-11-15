import { dlopen, ptr, read } from "bun:ffi";

/**
 * Just enough Xlib to make a window ignore the pointer. Electrobun's windows are X11 clients
 * (under Wayland they run in XWayland), and the X server picks the window under the pointer on
 * its own: a compositor can refuse to focus the island, yet clicks meant for another X11 window
 * beneath its transparent area would still land on it. An empty input shape tells the X server
 * the window isn't there for input at all.
 *
 * This uses its own connection to the display, so it is safe off GTK's thread.
 */

const SHAPE_INPUT = 2;
const SHAPE_SET = 0;

function load() {
  const x11 = dlopen("libX11.so.6", {
    XOpenDisplay: { args: ["ptr"], returns: "ptr" },
    XDefaultRootWindow: { args: ["ptr"], returns: "u64" },
    XQueryTree: { args: ["ptr", "u64", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
    XFetchName: { args: ["ptr", "u64", "ptr"], returns: "i32" },
    XInternAtom: { args: ["ptr", "ptr", "i32"], returns: "u64" },
    XGetWindowProperty: { args: ["ptr", "u64", "u64", "i64", "i64", "i32", "u64", "ptr", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
    XFree: { args: ["ptr"], returns: "i32" },
    XFlush: { args: ["ptr"], returns: "i32" },
  }).symbols;
  const xext = dlopen("libXext.so.6", {
    XShapeCombineRectangles: { args: ["ptr", "u64", "i32", "i32", "i32", "ptr", "i32", "i32", "i32"], returns: "void" },
    XShapeCombineMask: { args: ["ptr", "u64", "i32", "i32", "i32", "u64", "i32"], returns: "void" },
  }).symbols;
  const display = x11.XOpenDisplay(null);
  if (!display) throw new Error("no X display");
  const cstring = (s: string) => ptr(Buffer.from(`${s}\0`, "utf8"));
  return { x11, xext, display, pidAtom: x11.XInternAtom(display, cstring("_NET_WM_PID"), 1) as bigint };
}

let loaded: ReturnType<typeof load> | null | undefined;
/** Null when there is no X server to talk to (a native Wayland window needs none of this). */
function x() {
  if (loaded === undefined) {
    try {
      loaded = load();
    } catch {
      loaded = null;
    }
  }
  return loaded;
}

function children(window: bigint): bigint[] {
  const lib = x();
  if (!lib) return [];
  const root = new BigUint64Array(1);
  const parent = new BigUint64Array(1);
  const list = new BigUint64Array(1);
  const count = new Uint32Array(1);
  if (!lib.x11.XQueryTree(lib.display, window, ptr(root), ptr(parent), ptr(list), ptr(count)) || !list[0]) return [];
  const address = Number(list[0]);
  const out: bigint[] = [];
  for (let i = 0; i < count[0]; i++) out.push(read.u64(address, i * 8));
  lib.x11.XFree(address);
  return out;
}

function title(window: bigint): string {
  const lib = x()!;
  const name = new BigUint64Array(1);
  if (!lib.x11.XFetchName(lib.display, window, ptr(name)) || !name[0]) return "";
  const address = Number(name[0]);
  let text = "";
  for (let i = 0; i < 256; i++) {
    const byte = read.u8(address, i);
    if (!byte) break;
    text += String.fromCharCode(byte);
  }
  lib.x11.XFree(address);
  return text;
}

function ownerPid(window: bigint): number {
  const lib = x()!;
  if (!lib.pidAtom) return 0;
  const type = new BigUint64Array(1);
  const format = new Int32Array(1);
  const items = new BigUint64Array(1);
  const rest = new BigUint64Array(1);
  const data = new BigUint64Array(1);
  const status = lib.x11.XGetWindowProperty(lib.display, window, lib.pidAtom, 0n, 1n, 0, 0n, ptr(type), ptr(format), ptr(items), ptr(rest), ptr(data));
  if (status !== 0 || !data[0]) return 0;
  const address = Number(data[0]);
  // 32-bit properties come back as C longs.
  const pid = items[0] ? Number(read.u64(address, 0) & 0xffffffffn) : 0;
  lib.x11.XFree(address);
  return pid;
}

/** The X window with this title that belongs to this process, or null. */
export function findWindow(name: string, pid = process.pid): bigint | null {
  const lib = x();
  if (!lib) return null;
  const top = children(lib.x11.XDefaultRootWindow(lib.display) as bigint);
  // Toplevels hang off the root; a window manager that reparents puts them one level down.
  for (const window of [...top, ...top.flatMap(children)]) {
    if (title(window) === name && ownerPid(window) === pid) return window;
  }
  return null;
}

/** Lets the pointer pass through the window (and everything in it), or restores normal input. */
export function setClickThrough(window: bigint, through: boolean) {
  const lib = x();
  if (!lib) return;
  if (through) lib.xext.XShapeCombineRectangles(lib.display, window, SHAPE_INPUT, 0, 0, null, 0, SHAPE_SET, 0);
  else lib.xext.XShapeCombineMask(lib.display, window, SHAPE_INPUT, 0, 0, 0n, SHAPE_SET);
  lib.x11.XFlush(lib.display);
}
