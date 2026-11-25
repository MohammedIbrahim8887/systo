import type { ShellCommand } from "./lib/client/shell";
import { FloatingPosition, type IslandPosition } from "./shell/floating-position";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineDesktop } from "@farm.js/core/desktop";
import Electrobun, { BrowserWindow, Tray, Utils } from "electrobun/main";
import { hyprlandAvailable } from "./lib/server/linux/hyprland";
import { IslandController } from "./shell/island";
import { LinuxIslandController } from "./shell/island-linux";
import { paintWindow } from "./shell/objc";
import { WinIslandController } from "./shell/island-win";
import { TRAY_ICON_PNG, TRAY_ICON_PNG_WINDOWS } from "./shell/tray-icon";
import { AppUpdater } from "./shell/updater";
import { HotkeyHost } from "./shell/hotkeys";
import { initializeAutostart } from "./lib/server/autostart";
import { hexToRgb, normalizeHex } from "./lib/color";
import { loadAppearance } from "./lib/server/appearance";
import type { UpdateState } from "./lib/update-types";

const IS_WINDOWS = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const IS_LINUX = process.platform === "linux";
/**
 * The island needs the OS to float a window above everything: AppKit on macOS, Win32 on Windows,
 * and on Linux a compositor that can be asked to, which today is Hyprland. Elsewhere Systo is the
 * main window and the tray.
 */
const ISLAND_SUPPORTED = IS_MAC || IS_WINDOWS || (IS_LINUX && hyprlandAvailable());

interface Island {
  readonly active: boolean;
  readonly notch: boolean;
  show(): void;
  hide(): void;
  collapse(): void;
  drag?(dx: number, dy: number, done: boolean): void;
}

const NO_ISLAND: Island = { active: false, notch: false, show() {}, hide() {}, collapse() {} };

interface ShellPrefs {
  islandPosition?: IslandPosition;
  island: boolean;
}

const MAIN_FRAME = { width: 1180, height: 760 };

function prefsFile() {
  return join(Utils.paths.userData, "shell.json");
}

function loadPrefs(): ShellPrefs {
  try {
    return { island: true, ...(JSON.parse(readFileSync(prefsFile(), "utf8")) as Partial<ShellPrefs>) };
  } catch {
    return { island: true };
  }
}

function savePrefs(prefs: ShellPrefs) {
  try {
    mkdirSync(Utils.paths.userData, { recursive: true });
    writeFileSync(prefsFile(), JSON.stringify(prefs));
  } catch (error) {
    console.error("[systo] couldn't save shell preferences", error);
  }
}

function trayIconPath() {
  const file = join(Utils.paths.userData, "tray-icon.png");
  try {
    mkdirSync(Utils.paths.userData, { recursive: true });
    // macOS tints its black template to match the menu bar. Windows and Linux panels show the
    // image as it is, so they get the outlined one that reads on dark and light bars alike.
    writeFileSync(file, Buffer.from(IS_MAC ? TRAY_ICON_PNG : TRAY_ICON_PNG_WINDOWS, "base64"));
  } catch {
    // tray falls back to its title
  }
  return file;
}

/** Commands arrive as `#systo=<json>&n=<nonce>` same-document navigations (see lib/client/shell.ts). */
function parseCommand(url: string, seen: Set<string>): ShellCommand | null {
  const hash = url.split("#")[1];
  if (!hash?.startsWith("systo=")) return null;
  const params = new URLSearchParams(hash);
  const nonce = params.get("n") ?? "";
  if (seen.has(nonce)) return null;
  seen.add(nonce);
  if (seen.size > 64) seen.delete(seen.values().next().value as string);
  try {
    return JSON.parse(params.get("systo") ?? "") as ShellCommand;
  } catch {
    return null;
  }
}

export default defineDesktop<BrowserWindow>({
  onReady({ window, server }) {
    const prefs = loadPrefs();
    const seen = new Set<string>();
    let main: BrowserWindow | null = window;
    let tray: Tray | null = null;

    const shellState = () => ({ desktop: true, island: island.active, islandSupported: ISLAND_SUPPORTED, notch: island.notch, translucency: IS_MAC, update: updater.state });

    const pushShellState = (target: BrowserWindow | null) => {
      target?.webview.executeJavascript(
        `window.__systoShell=${JSON.stringify(shellState())};window.dispatchEvent(new Event("systo:shell"));`,
      );
    };

    /** The window's own chrome, which the page can't reach. The page says what it's showing. */
    const paintMain = (theme: { variant: "dark" | "light"; background: string; opacity: number; blur: number }) => {
      const background = normalizeHex(theme.background);
      if (!IS_MAC || !main || !background || !Number.isFinite(theme.opacity) || !Number.isFinite(theme.blur)) return;
      const [r, g, b] = hexToRgb(background).map((v) => v / 255);
      try {
        paintWindow(main.ptr as number, {
          dark: theme.variant !== "light",
          color: [r, g, b],
          opacity: Math.max(0.3, Math.min(1, theme.opacity / 100)),
          blur: Math.max(0, Math.min(64, Math.round(theme.blur))),
        });
      } catch (error) {
        console.error("[systo] couldn't paint the window", error);
      }
    };

    const handle = (url: string) => {
      const command = parseCommand(url, seen);
      if (!command) return;
      if (command.type === "drag-island") {
        if (Number.isFinite(command.dx) && Number.isFinite(command.dy) && typeof command.done === "boolean") {
          island.drag?.(command.dx, command.dy, command.done);
        }
      } else if (command.type === "window-theme") paintMain(command);
      else if (command.type === "island") setIsland(command.enabled);
      else if (command.type === "open-main") {
        island.collapse();
        openMain();
      } else if (command.type === "collapse-island") island.collapse();
    };

    /** Before the page has loaded: the saved theme's title bar, so it doesn't flash the system color. */
    const paintSaved = () => {
      const saved = loadAppearance();
      if (saved.mode === "system") return;
      paintMain({ variant: saved.mode, background: saved[saved.mode].background, opacity: 100, blur: 0 });
    };

    const updater = new AppUpdater(
      () => {
        pushShellState(main);
        updateTray();
      },
      // Added to Farm's desktop template by patches/@farm.js__desktop: see AppUpdater.
      (server as { stop?: () => Promise<unknown> }).stop,
    );
    // /api/update reaches the updater through the shared process, like shell commands.
    (globalThis as { __systoUpdater?: { state: () => UpdateState; check: () => Promise<void>; install: () => Promise<void> } }).__systoUpdater = {
      state: () => updater.state,
      check: () => updater.check(),
      install: () => updater.install(),
    };

    const position = new FloatingPosition(prefs.islandPosition, (value) => {
      prefs.islandPosition = value;
      savePrefs(prefs);
    });
    const island: Island = IS_WINDOWS
      ? new WinIslandController(server.origin, handle, position)
      : IS_MAC
        ? new IslandController(server.origin, handle)
        : ISLAND_SUPPORTED
          ? new LinuxIslandController(server.origin, handle, position)
          : NO_ISLAND;

    // The server runs in this process. Pages also POST commands to /api/shell, which hands them over
    // here, in case a platform's webview doesn't report in-page navigations. Nonces dedupe the two.
    (globalThis as { __systoShellCommand?: (url: string) => void }).__systoShellCommand = handle;

    const wireMain = (target: BrowserWindow) => {
      target.webview.on("dom-ready", () => pushShellState(target));
      target.webview.on("did-navigate-in-page", (event) => {
        const detail = event.data?.detail;
        if (typeof detail === "string") handle(detail);
      });
      target.on("close", () => {
        if (main === target) main = null;
      });
    };

    const openMain = () => {
      if (main) {
        if (main.isMinimized()) main.unminimize();
        main.show();
        main.activate();
        return;
      }
      const created = new BrowserWindow({
        title: "Systo",
        url: `${server.origin}/`,
        frame: MAIN_FRAME,
        sandbox: true,
      });
      created.webview.setNavigationRules(["^*", `${server.origin}/*`]);
      wireMain(created);
      main = created;
      paintSaved();
    };

    const updateTray = () => {
      const update = updater.state;
      tray?.setMenu([
        { type: "normal", label: "Open Systo", action: "open" },
        ...(ISLAND_SUPPORTED ? [{ type: "normal" as const, label: "Show Dynamic Island", action: "island", checked: island.active }] : []),
        { type: "divider" },
        update.phase === "ready"
          ? { type: "normal", label: `Restart to Update${update.latest ? ` to ${update.latest}` : ""}`, action: "install-update" }
          : {
              type: "normal",
              label: update.phase === "checking" ? "Checking for Updates…" : update.phase === "downloading" ? "Downloading Update…" : "Check for Updates…",
              action: "check-update",
              enabled: update.phase !== "unavailable" && update.phase !== "checking" && update.phase !== "downloading",
            },
        { type: "divider" },
        { type: "normal", label: "Quit Systo", action: "quit" },
      ]);
    };

    const setIsland = (enabled: boolean) => {
      if (!ISLAND_SUPPORTED) return;
      if (enabled) island.show();
      else island.hide();
      prefs.island = enabled;
      savePrefs(prefs);
      pushShellState(main);
      updateTray();
    };

    wireMain(window);
    paintSaved();
    pushShellState(window);

    // System-wide shortcuts. /api/hotkeys edits them and reaches the host through the shared process.
    const hotkeys = new HotkeyHost((command) => {
      if (command === "open-main") {
        island.collapse();
        openMain();
      } else if (command === "toggle-island") setIsland(!island.active);
    }, ISLAND_SUPPORTED);
    (globalThis as { __systoHotkeys?: HotkeyHost }).__systoHotkeys = hotkeys;
    hotkeys.start();

    try {
      tray = IS_MAC
        ? new Tray({ image: trayIconPath(), template: true, width: 18, height: 18 })
        : new Tray({ title: "Systo", image: trayIconPath(), template: false, width: 16, height: 16 });
      tray.on("tray-clicked", (event) => {
        const action = event.data?.action;
        if (action === "open") openMain();
        else if (action === "island") setIsland(!island.active);
        else if (action === "check-update") void updater.check();
        else if (action === "install-update") void updater.install();
        else if (action === "quit") Utils.quit();
      });
      updateTray();
    } catch (error) {
      console.error("[systo] tray unavailable", error);
    }

    // Only hide login launches once there is a tray entry to open the app again.
    if (tray && process.argv.includes("--background")) window.hide();
    void initializeAutostart().catch((error) => console.error("[systo] couldn't enable login startup", error));

    // Starts after the tray exists, since every state change refreshes its menu.
    void updater.start();

    Electrobun.events.on("reopen", () => openMain());

    // The island shares the main window's session cookie, which the handshake sets on first load.
    if (prefs.island && ISLAND_SUPPORTED) {
      let started = false;
      const start = () => {
        if (started) return;
        started = true;
        setIsland(true);
      };
      window.webview.on("did-navigate", (event) => {
        const detail = event.data?.detail;
        if (typeof detail === "string" && !detail.includes("/__farm/desktop/handshake")) start();
      });
      setTimeout(start, 4000);
    }
  },
});
