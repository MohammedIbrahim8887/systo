import { dlopen, ptr } from "bun:ffi";

/**
 * A minimal Objective-C bridge for window chrome Electrobun doesn't expose (window level,
 * collection behavior, click-through). Every message goes through NSInvocation so arguments and
 * struct returns are plain byte buffers, and AppKit calls run on the main thread.
 */

const LIBOBJC = "/usr/lib/libobjc.A.dylib";

const runtime = dlopen(LIBOBJC, {
  objc_getClass: { args: ["ptr"], returns: "ptr" },
  sel_registerName: { args: ["ptr"], returns: "ptr" },
  objc_autoreleasePoolPush: { args: [], returns: "ptr" },
  objc_autoreleasePoolPop: { args: ["ptr"], returns: "void" },
}).symbols;

const send = dlopen(LIBOBJC, { objc_msgSend: { args: ["ptr", "ptr"], returns: "ptr" } }).symbols.objc_msgSend;
const sendPtr = dlopen(LIBOBJC, { objc_msgSend: { args: ["ptr", "ptr", "ptr"], returns: "ptr" } }).symbols.objc_msgSend;
const sendIndex = dlopen(LIBOBJC, { objc_msgSend: { args: ["ptr", "ptr", "u64"], returns: "ptr" } }).symbols.objc_msgSend;
const sendPtrIndex = dlopen(LIBOBJC, { objc_msgSend: { args: ["ptr", "ptr", "ptr", "i64"], returns: "void" } }).symbols.objc_msgSend;
const sendMain = dlopen(LIBOBJC, { objc_msgSend: { args: ["ptr", "ptr", "ptr", "ptr", "bool"], returns: "void" } }).symbols.objc_msgSend;

const cstring = (s: string) => Buffer.from(`${s}\0`);
const selectors = new Map<string, number>();

function sel(name: string): number {
  let value = selectors.get(name);
  if (!value) {
    value = runtime.sel_registerName(ptr(cstring(name))) as number;
    selectors.set(name, value);
  }
  return value;
}

function cls(name: string): number {
  return runtime.objc_getClass(ptr(cstring(name))) as number;
}

type Arg = ArrayBufferView;

export const arg = {
  bool: (v: boolean) => new Uint8Array([v ? 1 : 0]),
  int: (v: number | bigint) => new BigInt64Array([BigInt(v)]),
  uint: (v: number | bigint) => new BigUint64Array([BigInt(v)]),
  rect: (x: number, y: number, w: number, h: number) => new Float64Array([x, y, w, h]),
};

/**
 * Sends `selector` to `target` via NSInvocation. `returnDoubles` reads a struct of that many
 * doubles (NSRect = 4, NSPoint = 2, NSEdgeInsets = 4).
 */
export function invoke(target: number, selector: string, args: Arg[] = [], returnDoubles = 0, mainThread = true): Float64Array | null {
  if (!target) return null;
  const pool = runtime.objc_autoreleasePoolPush();
  try {
    const s = sel(selector);
    const signature = sendPtr(target, sel("methodSignatureForSelector:"), s) as number;
    if (!signature) return null;
    const invocation = sendPtr(cls("NSInvocation"), sel("invocationWithMethodSignature:"), signature) as number;
    sendPtr(invocation, sel("setTarget:"), target);
    sendPtr(invocation, sel("setSelector:"), s);
    args.forEach((value, index) => sendPtrIndex(invocation, sel("setArgument:atIndex:"), ptr(value), index + 2));
    if (mainThread) {
      sendMain(invocation, sel("performSelectorOnMainThread:withObject:waitUntilDone:"), sel("invoke"), null, true);
    } else {
      send(invocation, sel("invoke"));
    }
    if (!returnDoubles) return null;
    const out = new Float64Array(returnDoubles);
    sendPtrIndex(invocation, sel("getReturnValue:"), ptr(out), 0);
    return out;
  } finally {
    runtime.objc_autoreleasePoolPop(pool);
  }
}

export interface ScreenGeometry {
  /** Cocoa frame (bottom-left origin) of the screen. */
  frame: { x: number; y: number; width: number; height: number };
  /** Height of the notch (0 when there is none). */
  notchHeight: number;
  /** Notch edges in screen-local points from the left. */
  notchLeft: number;
  notchRight: number;
  /** Menu bar height on this screen. */
  menuBarHeight: number;
  primaryHeight: number;
}

/** The screen with a camera housing if there is one, otherwise the primary (menu bar) screen. */
export function notchScreen(): ScreenGeometry | null {
  const pool = runtime.objc_autoreleasePoolPush();
  try {
    const screens = send(cls("NSScreen"), sel("screens")) as number;
    if (!screens) return null;
    const count = Number(send(screens, sel("count")) ?? 0);
    let primaryHeight = 0;
    let chosen: ScreenGeometry | null = null;
    for (let i = 0; i < count; i++) {
      const screen = sendIndex(screens, sel("objectAtIndex:"), i) as number;
      const frame = invoke(screen, "frame", [], 4);
      const visible = invoke(screen, "visibleFrame", [], 4);
      const insets = invoke(screen, "safeAreaInsets", [], 4);
      if (!frame || !visible) continue;
      if (i === 0) primaryHeight = frame[3];
      const notchHeight = insets?.[0] ?? 0;
      let notchLeft = 0;
      let notchRight = 0;
      if (notchHeight > 0) {
        const left = invoke(screen, "auxiliaryTopLeftArea", [], 4);
        const right = invoke(screen, "auxiliaryTopRightArea", [], 4);
        notchLeft = left ? left[2] : frame[2] / 2 - 92;
        notchRight = right ? right[0] - frame[0] : frame[2] / 2 + 92;
      }
      const geometry: ScreenGeometry = {
        frame: { x: frame[0], y: frame[1], width: frame[2], height: frame[3] },
        notchHeight,
        notchLeft,
        notchRight,
        menuBarHeight: Math.max(0, frame[1] + frame[3] - (visible[1] + visible[3])),
        primaryHeight,
      };
      if (i === 0) chosen = geometry;
      if (notchHeight > 0) {
        chosen = geometry;
        break;
      }
    }
    if (chosen) chosen.primaryHeight = primaryHeight;
    return chosen;
  } finally {
    runtime.objc_autoreleasePoolPop(pool);
  }
}

// NSWindowCollectionBehavior: canJoinAllSpaces | stationary | ignoresCycle | fullScreenAuxiliary
const OVERLAY_BEHAVIOR = (1 << 0) | (1 << 4) | (1 << 6) | (1 << 8);
// Above the menu bar (NSMainMenuWindowLevel = 24), below menus and popups.
const OVERLAY_LEVEL = 25;

export function makeOverlay(window: number) {
  invoke(window, "setLevel:", [arg.int(OVERLAY_LEVEL)]);
  invoke(window, "setCollectionBehavior:", [arg.uint(OVERLAY_BEHAVIOR)]);
  invoke(window, "setHasShadow:", [arg.bool(false)]);
  invoke(window, "setOpaque:", [arg.bool(false)]);
  invoke(window, "setMovable:", [arg.bool(false)]);
}

export function setFrame(window: number, x: number, y: number, width: number, height: number) {
  invoke(window, "setFrame:display:", [arg.rect(x, y, width, height), arg.bool(true)]);
}

export function setClickThrough(window: number, enabled: boolean) {
  invoke(window, "setIgnoresMouseEvents:", [arg.bool(enabled)]);
}

export function orderFront(window: number) {
  invoke(window, "orderFrontRegardless", []);
}
