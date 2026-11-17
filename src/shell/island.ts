import { BrowserWindow, Screen } from "electrobun/main";
import { closeOverlay, makeOverlay, screenGeometries, orderFront, setClickThrough, setFrame, type ScreenGeometry } from "./objc";

const WINDOW_WIDTH = 460;
const PANEL_WIDTH = 440;
const PANEL_EXTRA_HEIGHT = 262;
const WING = 62;
const HOVER_DWELL_MS = 90;
const LEAVE_GRACE_MS = 320;
const POLL_MS = 50;

interface Placement {
  /** Notch center and top edge in Electrobun's top-left global coordinates. */
  centerX: number;
  top: number;
  notchWidth: number;
  notchHeight: number;
  windowHeight: number;
  cocoa: { x: number; y: number };
  key: string;
}

function place(geometry: ScreenGeometry): Placement {
  const { frame, primaryHeight } = geometry;
  const hasNotch = geometry.notchHeight > 0;
  const notchHeight = hasNotch ? geometry.notchHeight : Math.max(24, geometry.menuBarHeight || 24);
  const notchWidth = hasNotch ? geometry.notchRight - geometry.notchLeft : 0;
  const localCenter = hasNotch ? (geometry.notchLeft + geometry.notchRight) / 2 : frame.width / 2;
  const windowHeight = notchHeight + PANEL_EXTRA_HEIGHT + 36;
  const centerX = frame.x + localCenter;
  const top = primaryHeight - (frame.y + frame.height);
  const cocoa = { x: Math.round(centerX - WINDOW_WIDTH / 2), y: Math.round(frame.y + frame.height - windowHeight) };
  return {
    centerX,
    top,
    notchWidth,
    notchHeight,
    windowHeight,
    cocoa,
    key: `${frame.x},${frame.y},${frame.width},${frame.height},${notchWidth},${notchHeight},${primaryHeight},${geometry.notchLeft},${geometry.notchRight}`,
  };
}

class ScreenIslandController {
  private window: BrowserWindow | null = null;
  private overlay: number | null = null;
  private placement: Placement | null = null;
  private expanded = false;
  private enterSince = 0;
  private leaveSince = 0;
  private poll: ReturnType<typeof setInterval> | null = null;
  private hasNotch = false;

  constructor(
    private origin: string,
    private onCommand: (url: string) => void,
  ) {}

  get notch() {
    return this.hasNotch;
  }

  get active() {
    return Boolean(this.window);
  }

  show(geometry: ScreenGeometry) {
    if (this.window) return;
    this.hasNotch = geometry.notchHeight > 0;
    const placement = place(geometry);
    this.placement = placement;
    const window = new BrowserWindow({
      title: "Systo Island",
      url: this.url(placement),
      frame: { x: placement.cocoa.x, y: 0, width: WINDOW_WIDTH, height: placement.windowHeight },
      titleBarStyle: "hidden",
      transparent: true,
      activate: false,
      sandbox: true,
      styleMask: { Titled: false, Closable: false, Miniaturizable: false, Resizable: false },
    });
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
    let handle: number;
    try {
      handle = makeOverlay(window.ptr as number);
      this.overlay = handle;
    } catch (error) {
      this.hide();
      throw error;
    }
    setFrame(handle, placement.cocoa.x, placement.cocoa.y, WINDOW_WIDTH, placement.windowHeight);
    setClickThrough(handle, true);
    orderFront(handle);
    this.expanded = false;
    this.poll = setInterval(() => this.tick(), POLL_MS);
  }

  hide() {
    const window = this.window;
    this.teardown(window?.ptr as number | undefined);
    window?.close();
  }

  collapse() {
    this.setExpanded(false);
  }

  private teardown(restoreTo?: number) {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    this.window = null;
    if (this.overlay) closeOverlay(this.overlay, restoreTo);
    this.overlay = null;
    this.expanded = false;
  }

  private url(p: Placement) {
    const params = new URLSearchParams({
      shell: "1",
      nw: String(Math.round(p.notchWidth)),
      nh: String(Math.round(p.notchHeight)),
      w: String(WINDOW_WIDTH),
    });
    return `${this.origin}/island?${params}`;
  }

  private pushState() {
    this.window?.webview.executeJavascript(
      `window.__systoIsland={expanded:${this.expanded}};window.dispatchEvent(new Event("systo:island"));`,
    );
  }

  private setExpanded(expanded: boolean) {
    if (!this.window || this.expanded === expanded) return;
    this.expanded = expanded;
    const handle = this.overlay!;
    if (expanded) setClickThrough(handle, false);
    this.pushState();
    if (!expanded) setClickThrough(handle, true);
  }

  /** Re-asserts the overlay after Space and full-screen transitions reorder windows. */
  reassert() {
    if (this.overlay) orderFront(this.overlay);
  }

  refreshGeometry(geometry: ScreenGeometry) {
    if (!this.window) return;
    const next = place(geometry);
    if (next.key === this.placement?.key) return;
    this.hasNotch = geometry.notchHeight > 0;
    this.placement = next;
    const handle = this.overlay!;
    setFrame(handle, next.cocoa.x, next.cocoa.y, WINDOW_WIDTH, next.windowHeight);
    this.window.webview.loadURL(this.url(next));
  }

  private tick() {
    const p = this.placement;
    if (!p || !this.window) return;
    const now = Date.now();
    const cursor = Screen.getCursorScreenPoint();
    const dx = Math.abs(cursor.x - p.centerX);
    const dy = cursor.y - p.top;
    if (!this.expanded) {
      const half = (p.notchWidth > 0 ? p.notchWidth / 2 + WING : 110) + 4;
      const inside = dx <= half && dy >= -2 && dy <= p.notchHeight + 2;
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
    const inside = dx <= PANEL_WIDTH / 2 + 12 && dy >= -4 && dy <= p.notchHeight + PANEL_EXTRA_HEIGHT + 14;
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

/** A single overlay on the primary display, shared across applications and Spaces. */
export class IslandController {
  private display: ScreenIslandController;
  private poll: ReturnType<typeof setInterval> | null = null;
  constructor(origin: string, onCommand: (url: string) => void) {
    this.display = new ScreenIslandController(origin, onCommand);
  }
  get notch() { return this.display.notch; }
  get active() { return this.display.active; }
  show() {
    if (this.poll) return;
    this.sync();
    this.poll = setInterval(() => this.sync(), 3000);
  }
  private sync() {
    const geometry = screenGeometries()[0];
    if (!geometry) { this.display.hide(); return; }
    if (this.display.active) {
      this.display.refreshGeometry(geometry);
      this.display.reassert();
    } else this.display.show(geometry);
  }
  hide() {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    this.display.hide();
  }
  collapse() { this.display.collapse(); }
}
