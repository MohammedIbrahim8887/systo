import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineDesktop } from "@farm.js/core/desktop";
import Electrobun, { BrowserWindow, Tray, Utils } from "electrobun/main";
import { IslandController } from "./shell/island";
import { TRAY_ICON_PNG } from "./shell/tray-icon";

interface ShellPrefs {
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
    writeFileSync(file, Buffer.from(TRAY_ICON_PNG, "base64"));
  } catch {
    // tray falls back to its title
  }
  return file;
}

type Command = { type: "island"; enabled: boolean } | { type: "open-main" } | { type: "collapse-island" };

/** Commands arrive as `#systo=<json>&n=<nonce>` same-document navigations (see lib/client/shell.ts). */
function parseCommand(url: string, seen: Set<string>): Command | null {
  const hash = url.split("#")[1];
  if (!hash?.startsWith("systo=")) return null;
  const params = new URLSearchParams(hash);
  const nonce = params.get("n") ?? "";
  if (seen.has(nonce)) return null;
  seen.add(nonce);
  if (seen.size > 64) seen.delete(seen.values().next().value as string);
  try {
    return JSON.parse(params.get("systo") ?? "") as Command;
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

    const shellState = () => ({ desktop: true, island: island.active, notch: island.notch });

    const pushShellState = (target: BrowserWindow | null) => {
      target?.webview.executeJavascript(
        `window.__systoShell=${JSON.stringify(shellState())};window.dispatchEvent(new Event("systo:shell"));`,
      );
    };

    const handle = (url: string) => {
      const command = parseCommand(url, seen);
      if (!command) return;
      if (command.type === "island") setIsland(command.enabled);
      else if (command.type === "open-main") {
        island.collapse();
        openMain();
      } else if (command.type === "collapse-island") island.collapse();
    };

    const island = new IslandController(server.origin, handle);

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
    };

    const updateTray = () => {
      tray?.setMenu([
        { type: "normal", label: "Open Systo", action: "open" },
        { type: "normal", label: "Show Dynamic Island", action: "island", checked: island.active },
        { type: "divider" },
        { type: "normal", label: "Quit Systo", action: "quit" },
      ]);
    };

    const setIsland = (enabled: boolean) => {
      if (enabled) island.show();
      else island.hide();
      prefs.island = enabled;
      savePrefs(prefs);
      pushShellState(main);
      updateTray();
    };

    wireMain(window);
    pushShellState(window);

    try {
      tray = new Tray({ image: trayIconPath(), template: true, width: 18, height: 18 });
      tray.on("tray-clicked", (event) => {
        const action = event.data?.action;
        if (action === "open") openMain();
        else if (action === "island") setIsland(!island.active);
        else if (action === "quit") Utils.quit();
      });
      updateTray();
    } catch (error) {
      console.error("[systo] tray unavailable", error);
    }

    Electrobun.events.on("reopen", () => openMain());

    // The island shares the main window's session cookie, which the handshake sets on first load.
    if (prefs.island) {
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
