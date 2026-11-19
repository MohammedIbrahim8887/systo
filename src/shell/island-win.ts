import { FloatingPosition } from "./floating-position";
import { BrowserWindow } from "electrobun/main";
import { cursor, fullscreenBusy, makeOverlay, place, primaryMonitor, resolveHwnd, scaleFor, setVisible, windowRect } from "./win32";

/**
 * The Windows Dynamic Island: a movable pill on the primary display.
 * Collapsed, the window is exactly the pill, so nothing invisible blocks clicks around it; on
 * hover it grows to the panel and the page animates into it. It hides while something is
 * fullscreen and never takes keyboard focus.
 */

const TITLE = "Systo Island";
/** CSS pixels; keep in sync with the island page (FLOAT_TOP, ISLAND_PANEL_HEIGHT). */
const FLOAT_TOP = 8;
const PILL_WIDTH = 220;
const PILL_HEIGHT = 34;
const PANEL_WIDTH = 460;
const PANEL_EXTRA_HEIGHT = 262;
const HOVER_DWELL_MS = 90;
const LEAVE_GRACE_MS = 320;
const COLLAPSE_ANIMATION_MS = 420;
const POLL_MS = 50;

export class WinIslandController {
  private window: BrowserWindow | null = null;
  private hwnd: number | null = null;
  private expanded = false;
  private enterSince = 0;
  private leaveSince = 0;
  private poll: ReturnType<typeof setInterval> | null = null;
  private shrinkTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCheck = 0;
  private hidden = false;
  private monitorKey = "";

  constructor(
    private origin: string,
    private onCommand: (url: string) => void,
    private position = new FloatingPosition(),
  ) {}

  /** Windows has no notch; the page uses this to word the setting. */
  get notch() {
    return false;
  }

  get active() {
    return Boolean(this.window);
  }

  show() {
    if (this.window) return;
    const params = new URLSearchParams({ shell: "1", fl: "1", nw: "0", nh: String(PILL_HEIGHT), w: String(PANEL_WIDTH) });
    const window = new BrowserWindow({
      title: TITLE,
      url: `${this.origin}/island?${params}`,
      frame: { x: -4000, y: -4000, width: PILL_WIDTH, height: PILL_HEIGHT + FLOAT_TOP },
      titleBarStyle: "hidden",
      transparent: true,
      activate: false,
      sandbox: true,
    } as ConstructorParameters<typeof BrowserWindow>[0]);
    window.webview.setNavigationRules(["^*", `${this.origin}/*`]);
    window.webview.on("did-navigate-in-page", (event) => {
      const detail = event.data?.detail;
      if (typeof detail === "string") this.onCommand(detail);
    });
    window.webview.on("dom-ready", () => this.pushState());
    window.on("close", () => {
      if (this.window === window) this.teardown();
    });
    this.window = window;
    this.expanded = false;
    this.poll = setInterval(() => this.tick(), POLL_MS);
  }

  hide() {
    const window = this.window;
    this.teardown();
    window?.close();
  }

  collapse() {
    this.setExpanded(false);
  }

  drag(dx: number, dy: number, done: boolean) {
    if (!this.hwnd || this.hidden) return;
    this.position.dragging = !done;
    this.layout(false, dx, dy);
    this.leaveSince = 0;
    if (done) this.position.finish();
  }

  private teardown() {
    if (this.poll) clearInterval(this.poll);
    if (this.shrinkTimer) clearTimeout(this.shrinkTimer);
    this.poll = null;
    this.shrinkTimer = null;
    this.window = null;
    this.hwnd = null;
    this.expanded = false;
    this.monitorKey = "";
    this.position.dragging = false;
    this.hidden = false;
  }

  /** The HWND appears a moment after the window is created; style it once it does. */
  private handle(): number | null {
    if (this.hwnd) return this.hwnd;
    if (!this.window) return null;
    const hwnd = resolveHwnd(this.window.ptr, TITLE);
    if (!hwnd) return null;
    this.hwnd = hwnd;
    makeOverlay(hwnd);
    this.layout(true);
    return hwnd;
  }

  /** Keeps the pill and panel centered on the same saved position. */
  private layout(frameChanged = false, dx = 0, dy = 0) {
    const hwnd = this.hwnd;
    const monitor = primaryMonitor();
    if (!hwnd || !monitor) return;
    const scale = scaleFor(hwnd);
    const width = (this.expanded ? PANEL_WIDTH : PILL_WIDTH) * scale;
    const height = (this.expanded ? FLOAT_TOP + PILL_HEIGHT + PANEL_EXTRA_HEIGHT + 36 : FLOAT_TOP + PILL_HEIGHT) * scale;
    const panelWidth = PANEL_WIDTH * scale;
    const target = this.position.layout(monitor, panelWidth, (FLOAT_TOP + PILL_HEIGHT + PANEL_EXTRA_HEIGHT + 36) * scale, dx * scale, dy * scale);
    const centerX = target.x + panelWidth / 2;
    place(hwnd, centerX - width / 2, target.y, width, height, frameChanged);
    this.monitorKey = `${monitor.left},${monitor.top},${monitor.right},${monitor.bottom},${scale}`;
  }

  private pushState() {
    this.window?.webview.executeJavascript(
      `window.__systoIsland={expanded:${this.expanded}};window.dispatchEvent(new Event("systo:island"));`,
    );
  }

  private setExpanded(expanded: boolean) {
    if (!this.window || this.expanded === expanded) return;
    this.expanded = expanded;
    if (this.shrinkTimer) clearTimeout(this.shrinkTimer);
    this.shrinkTimer = null;
    if (expanded) {
      // Grow first so the page has room to animate into.
      this.layout();
      this.pushState();
    } else {
      this.pushState();
      this.shrinkTimer = setTimeout(() => {
        this.shrinkTimer = null;
        if (!this.expanded && !this.hidden) this.layout();
      }, COLLAPSE_ANIMATION_MS);
    }
  }

  private tick() {
    const hwnd = this.handle();
    if (!hwnd) return;
    const now = Date.now();
    if (now - this.lastCheck > 1000) {
      this.lastCheck = now;
      const busy = fullscreenBusy();
      if (busy !== this.hidden) {
        this.hidden = busy;
        if (busy) {
          this.position.dragging = false;
          this.setExpanded(false);
        }
        setVisible(hwnd, !busy);
        if (!busy) this.layout();
      }
      const monitor = primaryMonitor();
      const key = monitor ? `${monitor.left},${monitor.top},${monitor.right},${monitor.bottom},${scaleFor(hwnd)}` : "";
      if (!this.hidden && key && key !== this.monitorKey) this.layout();
    }
    if (this.hidden || this.position.dragging) return;
    const point = cursor();
    const rect = windowRect(hwnd);
    if (!point || !rect) return;
    const inside = point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom;
    if (!this.expanded) {
      if (!inside) {
        this.enterSince = 0;
        return;
      }
      if (!this.enterSince) this.enterSince = now;
      if (now - this.enterSince >= HOVER_DWELL_MS) {
        this.enterSince = 0;
        this.leaveSince = 0;
        this.setExpanded(true);
      }
      return;
    }
    if (inside) {
      this.leaveSince = 0;
      return;
    }
    if (!this.leaveSince) this.leaveSince = now;
    if (now - this.leaveSince >= LEAVE_GRACE_MS) {
      this.leaveSince = 0;
      this.setExpanded(false);
    }
  }
}
