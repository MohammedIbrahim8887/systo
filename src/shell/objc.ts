import { configureOverlay, NONACTIVATING_PANEL } from "./overlay-policy";
import { dlopen, ptr } from "bun:ffi";

/**
 * A minimal Objective-C bridge for window chrome Electrobun doesn't expose (window level,
 * collection behavior, click-through). Every message goes through NSInvocation so arguments and
 * struct returns are plain byte buffers, and AppKit calls run on the main thread.
 */

const LIBOBJC = "/usr/lib/libobjc.A.dylib";

function load() {
  const runtime = dlopen(LIBOBJC, {
    objc_getClass: { args: ["ptr"], returns: "ptr" },
    sel_registerName: { args: ["ptr"], returns: "ptr" },
    objc_autoreleasePoolPush: { args: [], returns: "ptr" },
    objc_autoreleasePoolPop: { args: ["ptr"], returns: "void" },
  }).symbols;
  return {
    runtime,
    send: dlopen(LIBOBJC, { objc_msgSend: { args: ["ptr", "ptr"], returns: "ptr" } }).symbols.objc_msgSend,
    sendPtr: dlopen(LIBOBJC, { objc_msgSend: { args: ["ptr", "ptr", "ptr"], returns: "ptr" } }).symbols.objc_msgSend,
    sendU64: dlopen(LIBOBJC, { objc_msgSend: { args: ["ptr", "ptr"], returns: "u64" } }).symbols.objc_msgSend,
    sendIndex: dlopen(LIBOBJC, { objc_msgSend: { args: ["ptr", "ptr", "u64"], returns: "ptr" } }).symbols.objc_msgSend,
    sendPtrIndex: dlopen(LIBOBJC, { objc_msgSend: { args: ["ptr", "ptr", "ptr", "i64"], returns: "void" } }).symbols.objc_msgSend,
    sendMain: dlopen(LIBOBJC, { objc_msgSend: { args: ["ptr", "ptr", "ptr", "ptr", "bool"], returns: "void" } }).symbols.objc_msgSend,
  };
}

/** Loaded on first use, so importing this module on Windows doesn't try to open libobjc. */
let loaded: ReturnType<typeof load> | null = null;
const objc = () => (loaded ??= load());

const cstring = (s: string) => Buffer.from(`${s}\0`);
const selectors = new Map<string, number>();

function sel(name: string): number {
  let value = selectors.get(name);
  if (!value) {
    value = objc().runtime.sel_registerName(ptr(cstring(name))) as number;
    selectors.set(name, value);
  }
  return value;
}

function cls(name: string): number {
  return objc().runtime.objc_getClass(ptr(cstring(name))) as number;
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
export function invoke(target: number, selector: string, args: Arg[] = [], returnDoubles = 0, mainThread = true, retainResult = false): Float64Array | null {
  if (!target) return null;
  const pool = objc().runtime.objc_autoreleasePoolPush();
  try {
    const s = sel(selector);
    const signature = objc().sendPtr(target, sel("methodSignatureForSelector:"), s) as number;
    if (!signature) return null;
    const invocation = objc().sendPtr(cls("NSInvocation"), sel("invocationWithMethodSignature:"), signature) as number;
    objc().sendPtr(invocation, sel("setTarget:"), target);
    objc().sendPtr(invocation, sel("setSelector:"), s);
    args.forEach((value, index) => objc().sendPtrIndex(invocation, sel("setArgument:atIndex:"), ptr(value), index + 2));
    if (mainThread) {
      objc().sendMain(invocation, sel("performSelectorOnMainThread:withObject:waitUntilDone:"), sel("invoke"), null, true);
    } else {
      objc().send(invocation, sel("invoke"));
    }
    if (!returnDoubles) return null;
    const out = new Float64Array(returnDoubles);
    objc().sendPtrIndex(invocation, sel("getReturnValue:"), ptr(out), 0);
    if (retainResult) {
      // Tagged Objective-C objects use the high bits; converting them to Number corrupts them.
      // They are immortal values and do not need retain/release. Heap pointers fit exactly.
      const object = new BigUint64Array(out.buffer)[0];
      if (object && object <= BigInt(Number.MAX_SAFE_INTEGER)) objc().send(Number(object), sel("retain"));
    }
    return out;
  } finally {
    objc().runtime.objc_autoreleasePoolPop(pool);
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

/** Every attached display in AppKit order, with a common primary-screen coordinate origin. */
export function screenGeometries(): ScreenGeometry[] {
  const pool = objc().runtime.objc_autoreleasePoolPush();
  try {
    const screens = objc().send(cls("NSScreen"), sel("screens")) as number;
    if (!screens) return [];
    const count = Number(objc().send(screens, sel("count")) ?? 0);
    let primaryHeight = 0;
    const geometries: ScreenGeometry[] = [];
    for (let i = 0; i < count; i++) {
      const screen = objc().sendIndex(screens, sel("objectAtIndex:"), i) as number;
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
      geometries.push(geometry);
    }
    return geometries.map((geometry) => ({ ...geometry, primaryHeight }));
  } finally {
    objc().runtime.objc_autoreleasePoolPop(pool);
  }
}

/** Return an Objective-C pointer without interpreting its bits as a floating-point value. */
function invokePointer(target: number, selector: string, args: Arg[] = [], retainResult = false): number {
  const result = invoke(target, selector, args, 1, true, retainResult);
  return result ? Number(new BigUint64Array(result.buffer)[0]) : 0;
}

/**
 * Create a real non-activating panel on AppKit's main thread. Electrobun's observed NSWindow
 * remains the webview's lifecycle owner, hidden, while the panel owns its content view.
 * Never re-class an existing window: KVO subclasses and WindowServer activation tags make that
 * unsafe and prevent a regular window from reliably joining another app's full-screen Space.
 */
export function makeOverlay(window: number): number {
  const frame = invoke(window, "frame", [], 4);
  if (!frame) throw new Error("Could not read the island window frame.");
  const allocated = invokePointer(cls("NSPanel"), "alloc");
  const panel = invokePointer(allocated, "initWithContentRect:styleMask:backing:defer:", [
    arg.rect(frame[0], frame[1], frame[2], frame[3]), arg.uint(NONACTIVATING_PANEL), arg.uint(2), arg.bool(false),
  ]);
  if (!panel) throw new Error("Could not create the island panel.");
  invoke(panel, "setReleasedWhenClosed:", [arg.bool(false)]);
  invoke(panel, "setFloatingPanel:", [arg.bool(true)]);
  invoke(panel, "setBecomesKeyOnlyIfNeeded:", [arg.bool(true)]);
  configureOverlay((selector, value) => {
    invoke(panel, selector, [typeof value === "boolean" ? arg.bool(value) : arg.int(value)]);
  });
  const colorResult = invoke(cls("NSColor"), "clearColor", [], 1, true, true)!;
  const clear = new BigUint64Array(colorResult.buffer)[0];
  invoke(panel, "setBackgroundColor:", [arg.uint(clear)]);
  if (clear <= BigInt(Number.MAX_SAFE_INTEGER)) invoke(Number(clear), "release");
  const content = invokePointer(window, "contentView");
  if (!content) {
    closeOverlay(panel);
    throw new Error("The island window has no content view.");
  }
  invoke(content, "retain");
  invoke(window, "setContentView:", [arg.uint(0)]);
  invoke(panel, "setContentView:", [arg.uint(content)]);
  invoke(content, "release");
  invoke(window, "orderOut:", [arg.uint(0)]);
  return panel;
}

export function closeOverlay(panel: number, restoreTo?: number) {
  // Return the webview to its lifecycle owner before Electrobun destroys that window.
  if (restoreTo) {
    const content = invokePointer(panel, "contentView");
    if (content) {
      invoke(content, "retain");
      invoke(panel, "setContentView:", [arg.uint(0)]);
      invoke(restoreTo, "setContentView:", [arg.uint(content)]);
      invoke(content, "release");
    }
  }
  invoke(panel, "close");
  invoke(panel, "release");
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
