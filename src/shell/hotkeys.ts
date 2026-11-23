import { GlobalShortcut, Utils } from "electrobun/main";
import { dlopen } from "bun:ffi";
import { runHotkeyAction } from "../lib/server/hotkeys/launch";
import { loadHotkeys, loadStats, saveStats, type HotkeyBridge, type HotkeyStats } from "../lib/server/hotkeys/store";
import { probeSupported, sweepClaimed } from "./hotkey-probe";
import { comboId, toAccelerator, type KeyCombo, type Hotkey, type HotkeyAction, type HotkeyOS, type HotkeyStatus, type SystoCommand } from "../lib/hotkeys";

const OS: HotkeyOS = process.platform === "win32" ? "windows" : process.platform === "linux" ? "linux" : "mac";

/** Recording never leaves shortcuts off for long, even if the page goes away mid-record. */
const PAUSE_LIMIT = 60_000;

let axTrusted: (() => boolean) | null | undefined;

/**
 * macOS only delivers other apps' key presses to a global monitor once the user has allowed
 * Systo under Privacy & Security › Accessibility.
 */
function accessibilityGranted(): boolean {
  if (OS !== "mac") return true;
  if (axTrusted === undefined) {
    try {
      const lib = dlopen("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices", {
        AXIsProcessTrusted: { args: [], returns: "bool" },
      });
      axTrusted = () => Boolean(lib.symbols.AXIsProcessTrusted());
    } catch {
      axTrusted = null;
    }
  }
  return axTrusted ? axTrusted() : true;
}

/**
 * Owns the OS registrations for the user's shortcuts. The API route edits the list on disk and
 * calls `sync`; a press runs the action here, in the shell, where Systo's own window and island
 * are reachable too.
 */
export class HotkeyHost implements HotkeyBridge {
  private hotkeys: Hotkey[] = [];
  /** accelerator → hotkey id, for what's registered right now. */
  private registered = new Map<string, string>();
  private problems = new Map<string, string>();
  private stats: HotkeyStats = loadStats();
  private paused = false;
  private pauseTimer: ReturnType<typeof setTimeout> | undefined;
  private permission = accessibilityGranted();
  private permissionTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly systoCommand: (command: SystoCommand) => void,
    private readonly islandSupported: boolean,
  ) {}

  start() {
    this.sync(loadHotkeys());
    // Warm the probe so the Other apps tab opens with its answer ready.
    setTimeout(() => this.claimed(true), 4000);
    if (OS === "mac" && !this.permission) this.watchPermission();
  }

  /** Monitors created before access was granted stay deaf, so register again once it is. */
  private watchPermission() {
    clearInterval(this.permissionTimer);
    this.permissionTimer = setInterval(() => {
      if (!accessibilityGranted()) return;
      this.permission = true;
      clearInterval(this.permissionTimer);
      this.sync(this.hotkeys);
    }, 2000);
  }

  sync(hotkeys: Hotkey[]) {
    this.hotkeys = hotkeys;
    this.unregisterAll();
    this.problems.clear();
    if (this.paused) return;
    for (const hotkey of hotkeys) {
      if (!hotkey.enabled) continue;
      const accelerator = toAccelerator(hotkey.combo, OS);
      let ok = false;
      try {
        ok = GlobalShortcut.register(accelerator, () => this.fire(hotkey.id));
      } catch (error) {
        console.error(`[systo] couldn't register ${accelerator}`, error);
      }
      if (ok) this.registered.set(accelerator, hotkey.id);
      else this.problems.set(hotkey.id, OS === "windows" ? "Windows or another app already uses these keys." : "Another app already uses these keys, or the system reserves them.");
    }
  }

  private unregisterAll() {
    for (const accelerator of this.registered.keys()) {
      try {
        GlobalShortcut.unregister(accelerator);
      } catch {
        // already gone
      }
    }
    this.registered.clear();
  }

  private fire(id: string) {
    const hotkey = this.hotkeys.find((h) => h.id === id);
    if (!hotkey || !hotkey.enabled || this.paused) return;
    const previous = this.stats[id];
    this.stats[id] = { uses: (previous?.uses ?? 0) + 1, lastUsedAt: Date.now() };
    saveStats(this.stats);
    void this.run(hotkey.action);
  }

  async run(action: HotkeyAction) {
    if (action.type === "systo") {
      if (action.command === "toggle-island" && !this.islandSupported) return { ok: false, message: "The Dynamic Island isn't available here." };
      this.systoCommand(action.command);
      return { ok: true, message: "Done." };
    }
    return runHotkeyAction(action);
  }

  pause() {
    this.paused = true;
    this.unregisterAll();
    clearTimeout(this.pauseTimer);
    this.pauseTimer = setTimeout(() => this.resume(), PAUSE_LIMIT);
  }

  resume() {
    clearTimeout(this.pauseTimer);
    if (!this.paused) return;
    this.paused = false;
    this.sync(this.hotkeys);
  }

  status() {
    const permission = OS !== "mac" ? "not-required" : this.permission || accessibilityGranted() ? "granted" : "needed";
    if (permission === "needed" && !this.permissionTimer) this.watchPermission();
    const listening = new Set(this.registered.values());
    const statuses: Record<string, HotkeyStatus> = {};
    for (const hotkey of this.hotkeys) {
      const stat = this.stats[hotkey.id];
      const active = listening.has(hotkey.id) && permission !== "needed";
      statuses[hotkey.id] = {
        active,
        problem: !hotkey.enabled || active || this.paused
          ? undefined
          : permission === "needed"
            ? "Waiting for Accessibility access."
            : this.problems.get(hotkey.id) ?? "Not registered.",
        uses: stat?.uses ?? 0,
        lastUsedAt: stat?.lastUsedAt,
      };
    }
    return { permission, paused: this.paused, statuses, islandSupported: this.islandSupported } as const;
  }

  async pick(kind: "app" | "file" | "folder"): Promise<string | null> {
    try {
      const startingFolder = kind === "app" ? (OS === "mac" ? "/Applications" : OS === "windows" ? "C:\\Program Files" : "/usr/share/applications") : "~/";
      const paths = await Utils.openFileDialog({
        startingFolder,
        allowedFileTypes: kind === "app" ? (OS === "mac" ? "app" : OS === "windows" ? "exe,lnk" : "desktop") : "*",
        canChooseFiles: kind !== "folder",
        canChooseDirectory: kind !== "app",
        allowsMultipleSelection: false,
      });
      return paths.find(Boolean) ?? null;
    } catch (error) {
      console.error("[systo] file picker failed", error);
      return null;
    }
  }

  systo(command: SystoCommand) {
    this.systoCommand(command);
  }

  private claimedCache: { at: number; combos: KeyCombo[] } | null = null;

  claimed(force = false): KeyCombo[] | null {
    if (!probeSupported()) return null;
    if (!force && this.claimedCache && Date.now() - this.claimedCache.at < 20_000) return this.claimedCache.combos;
    // On Windows our own registrations would look taken too, so they're left out.
    const ours = OS === "windows" ? new Set([...this.registered.values()].map((id) => this.hotkeys.find((h) => h.id === id)).filter(Boolean).map((h) => comboId(h!.combo))) : new Set<string>();
    const started = performance.now();
    const combos = sweepClaimed().filter((c) => !ours.has(comboId(c)));
    console.log(`[systo] probed hotkeys held by other apps in ${Math.round(performance.now() - started)}ms: ${combos.length} found`);
    this.claimedCache = { at: Date.now(), combos };
    return combos;
  }
}
