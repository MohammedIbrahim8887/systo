import { dlopen, ptr } from "bun:ffi";

/**
 * The little of user32 the Windows island needs: window styles Electrobun doesn't expose (no
 * taskbar button, never takes focus, topmost), placement in the window's own pixel space, the
 * cursor, and whether something is running fullscreen. Loaded on first use.
 */

function load() {
  const user32 = dlopen("user32.dll", {
    IsWindow: { args: ["ptr"], returns: "i32" },
    FindWindowW: { args: ["ptr", "ptr"], returns: "ptr" },
    GetWindowLongPtrW: { args: ["ptr", "i32"], returns: "i64" },
    SetWindowLongPtrW: { args: ["ptr", "i32", "i64"], returns: "i64" },
    SetWindowPos: { args: ["ptr", "i64", "i32", "i32", "i32", "i32", "u32"], returns: "i32" },
    ShowWindow: { args: ["ptr", "i32"], returns: "i32" },
    GetWindowRect: { args: ["ptr", "ptr"], returns: "i32" },
    GetCursorPos: { args: ["ptr"], returns: "i32" },
    MonitorFromPoint: { args: ["u64", "u32"], returns: "ptr" },
    GetMonitorInfoW: { args: ["ptr", "ptr"], returns: "i32" },
    GetDpiForWindow: { args: ["ptr"], returns: "u32" },
  }).symbols;
  let shell32: { SHQueryUserNotificationState: (...args: any[]) => any } | null = null;
  try {
    shell32 = dlopen("shell32.dll", { SHQueryUserNotificationState: { args: ["ptr"], returns: "i32" } }).symbols;
  } catch {
    shell32 = null;
  }
  let dwm: { DwmSetWindowAttribute: (...args: any[]) => any } | null = null;
  try {
    dwm = dlopen("dwmapi.dll", { DwmSetWindowAttribute: { args: ["ptr", "u32", "ptr", "u32"], returns: "i32" } }).symbols;
  } catch {
    dwm = null;
  }
  return { user32, shell32, dwm };
}

let loaded: ReturnType<typeof load> | null = null;
const win = () => (loaded ??= load());

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_CAPTION = 0x00c00000;
const WS_THICKFRAME = 0x00040000;
const WS_SYSMENU = 0x00080000;
const WS_MINIMIZEBOX = 0x00020000;
const WS_MAXIMIZEBOX = 0x00010000;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_APPWINDOW = 0x00040000;
const WS_EX_NOACTIVATE = 0x08000000;
const HWND_TOPMOST = -1n;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const SWP_SHOWWINDOW = 0x0040;
const SW_HIDE = 0;
const SW_SHOWNOACTIVATE = 4;
const MONITOR_DEFAULTTOPRIMARY = 1;
const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
const DWMWCP_DONOTROUND = 1;
const DWMWA_TRANSITIONS_FORCEDISABLED = 3;

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const wide = (s: string) => Buffer.from(`${s}\0`, "utf16le");

/** The native handle: Electrobun's pointer when it is an HWND, otherwise found by title. */
export function resolveHwnd(pointer: unknown, title: string): number | null {
  const { user32 } = win();
  if (typeof pointer === "number" && pointer > 0 && user32.IsWindow(pointer)) return pointer;
  const found = user32.FindWindowW(null, ptr(wide(title))) as number | null;
  return found && user32.IsWindow(found) ? found : null;
}

/** No title bar, no taskbar or Alt+Tab entry, never steals focus, no rounded corners from Windows 11. */
export function makeOverlay(hwnd: number) {
  const { user32, dwm } = win();
  const style = Number(user32.GetWindowLongPtrW(hwnd, GWL_STYLE));
  user32.SetWindowLongPtrW(hwnd, GWL_STYLE, BigInt(style & ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX)));
  const exStyle = Number(user32.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  user32.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, BigInt(((exStyle | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) & ~WS_EX_APPWINDOW) >>> 0));
  if (dwm) {
    dwm.DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ptr(new Uint32Array([DWMWCP_DONOTROUND])), 4);
    dwm.DwmSetWindowAttribute(hwnd, DWMWA_TRANSITIONS_FORCEDISABLED, ptr(new Uint32Array([1])), 4);
  }
}

/** Places the window above everything else without activating it. Coordinates are the window's pixels. */
export function place(hwnd: number, x: number, y: number, width: number, height: number, frameChanged = false) {
  win().user32.SetWindowPos(hwnd, HWND_TOPMOST, Math.round(x), Math.round(y), Math.round(width), Math.round(height), SWP_NOACTIVATE | SWP_SHOWWINDOW | (frameChanged ? SWP_FRAMECHANGED : 0));
}

export function setVisible(hwnd: number, visible: boolean) {
  win().user32.ShowWindow(hwnd, visible ? SW_SHOWNOACTIVATE : SW_HIDE);
}

/** Device pixels per CSS pixel for this window (1 when the process isn't DPI aware). */
export function scaleFor(hwnd: number): number {
  const dpi = win().user32.GetDpiForWindow(hwnd) as number;
  return dpi > 0 ? dpi / 96 : 1;
}

export function windowRect(hwnd: number): Rect | null {
  const rect = new Int32Array(4);
  if (!win().user32.GetWindowRect(hwnd, ptr(rect))) return null;
  return { left: rect[0], top: rect[1], right: rect[2], bottom: rect[3] };
}

export function cursor(): { x: number; y: number } | null {
  const point = new Int32Array(2);
  if (!win().user32.GetCursorPos(ptr(point))) return null;
  return { x: point[0], y: point[1] };
}

/** The primary monitor's full bounds, where the island sits. */
export function primaryMonitor(): Rect | null {
  const { user32 } = win();
  const monitor = user32.MonitorFromPoint(0n, MONITOR_DEFAULTTOPRIMARY) as number | null;
  if (!monitor) return null;
  const info = new Int32Array(10);
  info[0] = 40;
  if (!user32.GetMonitorInfoW(monitor, ptr(info))) return null;
  return { left: info[1], top: info[2], right: info[3], bottom: info[4] };
}

/** True while a fullscreen game, video or presentation owns the screen. */
export function fullscreenBusy(): boolean {
  const { shell32 } = win();
  if (!shell32) return false;
  const state = new Int32Array(1);
  if (shell32.SHQueryUserNotificationState(ptr(state)) !== 0) return false;
  // QUNS_BUSY = 2, QUNS_RUNNING_D3D_FULL_SCREEN = 3, QUNS_PRESENTATION_MODE = 4
  return state[0] === 2 || state[0] === 3 || state[0] === 4;
}
