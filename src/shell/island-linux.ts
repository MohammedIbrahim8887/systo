import { BrowserWindow } from "electrobun/main";
import { clients, cursor, monitors, moveWindow, overlayRule, raiseWindow, setProp, workspaceFullscreen, xwaylandUnscaled, type HyprMonitor } from "../lib/server/linux/hyprland";

/**
 * The Linux Dynamic Island, for Hyprland: a black pill floating under the bar at the top center
 * of the focused display. Like the macOS island, the window is always the size of the open
 * panel and transparent around the pill; it ignores the pointer until the cursor rests on the
 * pill, then takes clicks while the panel is open. It hides while something is fullscreen.
 *
 * Electrobun only creates the window. Everything that makes it an overlay (floating, pinned to
 * every workspace, undecorated, unfocusable) is asked of the compositor, through a window rule
 * set before the window opens so it never flashes into the tiling layout.
 */

const TITLE = "Systo Island";
const RULE = "systo-island";
/** CSS pixels; keep in sync with the island page (FLOAT_TOP, ISLAND_PANEL_HEIGHT). */
const FLOAT_TOP = 8;
const PILL_WIDTH = 220;
const PILL_HEIGHT = 34;
const PANEL_WIDTH = 460;
const PANEL_EXTRA_HEIGHT = 262;
const WINDOW_HEIGHT = FLOAT_TOP + PILL_HEIGHT + PANEL_EXTRA_HEIGHT + 36;
const HOVER_DWELL_MS = 90;
const LEAVE_GRACE_MS = 320;
const POLL_MS = 50;
/** Asking the compositor for the pointer costs a socket round trip, so poll slowly while it's far away. */
const FAR_POLL_MS = 200;
const NEAR_PX = 260;
const OFFSCREEN = -8000;

interface Placement {
  /** The window in layout coordinates, as the compositor reports it. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Layout pixels per CSS pixel of the page. */
  ratio: number;
}

/** The display the island lives on: the focused one, in layout coordinates below its bar. */
function anchor(monitor: HyprMonitor) {
  const width = monitor.width / monitor.scale;
  return { centerX: monitor.x + width / 2, top: monitor.y + (monitor.reserved?.[1] ?? 0) };
}

export class LinuxIslandController {
  private window: BrowserWindow | null = null;
  /** Hyprland's handle for the window, known a moment after it opens. */
  private address: string | null = null;
  private placement: Placement | null = null;
  private monitor: string | null = null;
  private shown = false;
  private expanded = false;
  private hidden = false;
  private enterSince = 0;
  private leaveSince = 0;
  private lastCheck = 0;
  private poll: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private origin: string,
    private onCommand: (url: string) => void,
  ) {}

  /** No notch on a PC; the page uses this to word the setting. */
  get notch() {
    return false;
  }

  get active() {
    return this.shown;
  }

  show() {
    if (this.shown) return;
    this.shown = true;
    void this.open().catch((error) => {
      console.error("[systo] couldn't open the island", error);
      this.hide();
    });
  }

  hide() {
    const window = this.window;
    this.teardown();
    window?.close();
  }

  collapse() {
    void this.setExpanded(false);
  }

  private async open() {
    const [all, unscaled] = await Promise.all([monitors(), xwaylandUnscaled()]);
    const monitor = all.find((m) => m.focused) ?? all[0];
    if (!monitor) throw new Error("Hyprland reported no displays");
    if (!this.shown) return;
    this.monitor = monitor.name;
    // The page is an XWayland window, drawn in device pixels when the compositor doesn't scale it.
    const guess = unscaled ? 1 / monitor.scale : 1;
    const { centerX, top } = anchor(monitor);
    await overlayRule(RULE, TITLE, centerX - (PANEL_WIDTH * guess) / 2, top);
    if (!this.shown) return;

    const params = new URLSearchParams({ shell: "1", fl: "1", nw: "0", nh: String(PILL_HEIGHT), w: String(PANEL_WIDTH) });
    const window = new BrowserWindow({
      title: TITLE,
      url: `${this.origin}/island?${params}`,
      frame: { x: 0, y: 0, width: PANEL_WIDTH, height: WINDOW_HEIGHT },
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
    this.schedule(POLL_MS);
  }

  private schedule(delay: number) {
    this.poll = setTimeout(() => {
      void this.tick()
        // The compositor went away mid-request (reload, logout); keep trying at the slow pace.
        .catch(() => FAR_POLL_MS)
        .then((next) => {
          if (this.window) this.schedule(next);
        });
    }, delay);
  }

  private teardown() {
    if (this.poll) clearTimeout(this.poll);
    this.poll = null;
    this.window = null;
    this.address = null;
    this.placement = null;
    this.shown = false;
    this.expanded = false;
    this.hidden = false;
  }

  private pushState() {
    this.window?.webview.executeJavascript(
      `window.__systoIsland={expanded:${this.expanded}};window.dispatchEvent(new Event("systo:island"));`,
    );
  }

  private async setExpanded(expanded: boolean) {
    if (!this.window || !this.address || this.expanded === expanded) return;
    this.expanded = expanded;
    // Clicks reach the panel only while it's open; closed, they fall through to what's beneath.
    if (expanded) await setProp(this.address, "no_focus", false);
    this.pushState();
    if (!expanded) await setProp(this.address, "no_focus", true);
  }

  /** Finds the window, then keeps it centered under the bar of its display, above other floating windows. */
  private async layout(): Promise<boolean> {
    const [all, list] = await Promise.all([monitors(), clients()]);
    const monitor = all.find((m) => m.name === this.monitor) ?? all.find((m) => m.focused) ?? all[0];
    const client = list.find((c) => c.title === TITLE && c.pid === process.pid);
    if (!monitor || !client) return false;
    this.monitor = monitor.name;
    this.address = client.address;
    const [width, height] = client.size;
    const { centerX, top } = anchor(monitor);
    const x = Math.round(centerX - width / 2);
    const busy = await workspaceFullscreen(monitor.activeWorkspace.id);
    if (busy !== this.hidden) {
      this.hidden = busy;
      if (busy) await this.setExpanded(false);
    }
    const target = this.hidden ? { x: OFFSCREEN, y: OFFSCREEN } : { x, y: top };
    if (client.at[0] !== target.x || client.at[1] !== target.y) await moveWindow(client.address, target.x, target.y);
    if (!this.hidden) await raiseWindow(client.address);
    this.placement = { x, y: top, width, height, ratio: width / PANEL_WIDTH };
    return true;
  }

  /** One hover check. Resolves to how long to wait before the next one. */
  private async tick(): Promise<number> {
    const now = Date.now();
    if (!this.address || now - this.lastCheck > 1000) {
      this.lastCheck = now;
      if (!(await this.layout())) return POLL_MS;
    }
    const p = this.placement;
    if (!p || this.hidden) return FAR_POLL_MS;
    const point = await cursor();
    if (!point) return FAR_POLL_MS;
    const dx = Math.abs(point.x - (p.x + p.width / 2));
    const dy = point.y - p.y;
    if (!this.expanded) {
      const inside = dx <= (PILL_WIDTH / 2 + 4) * p.ratio && dy >= 0 && dy <= (FLOAT_TOP + PILL_HEIGHT + 2) * p.ratio;
      if (!inside) {
        this.enterSince = 0;
        return dx > p.width / 2 + NEAR_PX || dy > p.height + NEAR_PX ? FAR_POLL_MS : POLL_MS;
      }
      if (!this.enterSince) this.enterSince = now;
      if (now - this.enterSince >= HOVER_DWELL_MS) {
        this.enterSince = 0;
        this.leaveSince = 0;
        await this.setExpanded(true);
      }
      return POLL_MS;
    }
    const inside = dx <= p.width / 2 + 12 * p.ratio && dy >= -4 && dy <= p.height + 14 * p.ratio;
    if (inside) {
      this.leaveSince = 0;
      return POLL_MS;
    }
    if (!this.leaveSince) this.leaveSince = now;
    if (now - this.leaveSince >= LEAVE_GRACE_MS) {
      this.leaveSince = 0;
      await this.setExpanded(false);
    }
    return POLL_MS;
  }
}
