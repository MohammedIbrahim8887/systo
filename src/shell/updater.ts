import { Updater, Utils } from "electrobun/main";
import type { UpdateState } from "../lib/update-types";

/**
 * Keeps Systo up to date through Electrobun's updater. Releases publish an update manifest and
 * archive per platform to GitHub (see .github/workflows/release.yml); the app checks shortly after
 * launch and every few hours, downloads new versions in the background, and installs on restart.
 */

const FIRST_CHECK_MS = 20_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export class AppUpdater {
  state: UpdateState = { phase: "idle", version: "" };
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param stopServer Shuts the app's server down. Farm vetoes the first quit request so it can
   *   do that itself, and Electrobun's updater takes a veto to mean "restart cancelled": the app
   *   would close without installing anything. Stopping the server first lets the restart through.
   */
  constructor(
    private onChange: (state: UpdateState) => void,
    private stopServer?: () => Promise<unknown>,
  ) {}

  async start() {
    const info = await Updater.getLocalInfo().catch(() => null);
    if (!info?.baseUrl || !info.hash) {
      this.set({ phase: "unavailable", version: info?.version ?? "" });
      return;
    }
    this.set({ phase: "idle", version: info.version });
    Updater.onStatusChange((entry) => {
      if (entry.status === "download-progress" && typeof entry.details?.progress === "number" && this.state.phase === "downloading") {
        this.set({ ...this.state, progress: Math.round(entry.details.progress) });
      }
    });
    setTimeout(() => void this.check(), FIRST_CHECK_MS);
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Checks for a newer release and downloads it. Safe to call repeatedly; concurrent calls share one run. */
  check(): Promise<void> {
    if (this.state.phase === "unavailable" || this.state.phase === "ready" || this.state.phase === "installing") return Promise.resolve();
    return (this.running ??= this.run().finally(() => (this.running = null)));
  }

  private async run() {
    this.set({ ...this.state, phase: "checking", error: undefined });
    try {
      const result = await Updater.checkForUpdate();
      const checkedAt = Date.now();
      if (result.error) throw new Error(result.error);
      if (!result.updateAvailable) {
        this.set({ ...this.state, phase: "up-to-date", latest: result.version || this.state.version, checkedAt });
        return;
      }
      if (result.updateReady) {
        this.set({ ...this.state, phase: "ready", latest: result.version, checkedAt });
        return;
      }
      this.set({ ...this.state, phase: "downloading", latest: result.version, progress: 0, checkedAt });
      await Updater.downloadUpdate();
      const after = Updater.updateInfo();
      if (after.error) throw new Error(after.error);
      this.set({ ...this.state, phase: after.updateReady ? "ready" : "up-to-date", progress: 100 });
    } catch (error) {
      this.set({ ...this.state, phase: "error", error: friendly(error), checkedAt: Date.now() });
    }
  }

  /** Quits, swaps in the downloaded version and relaunches it. */
  async install() {
    if (this.state.phase !== "ready") return;
    this.set({ ...this.state, phase: "installing" });
    try {
      await this.stopServer?.();
      await Updater.applyUpdate();
      const failure = Updater.updateInfo().error;
      if (failure) throw new Error(failure);
    } catch (error) {
      this.set({ ...this.state, phase: "error", error: friendly(error) });
      // With the server already stopped the window can't recover; reopening Systo retries.
      if (this.stopServer) Utils.quit();
    }
  }

  private set(state: UpdateState) {
    this.state = state;
    this.onChange(state);
  }
}

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch|network|ENOTFOUND|ECONN|timed out|offline/i.test(message)) return "Couldn't reach the update server. Check your connection.";
  if (/404|not found/i.test(message)) return "No published update was found.";
  return message.length > 160 ? `${message.slice(0, 157)}…` : message;
}
