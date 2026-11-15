import { dirname } from "node:path";
import type { KillMode, KillResult } from "../types";
import { run } from "./exec";
import { endProcessesWindows, revealWindows } from "./win/actions";

const IS_LINUX = process.platform === "linux";
/** The kernel and init; on Linux also kthreadd, the parent of every kernel thread. */
const PROTECTED = new Set(IS_LINUX ? [0, 1, 2] : [0, 1]);
const OS_NAME = IS_LINUX ? "Linux" : "macOS";

interface AdminKill {
  ok: boolean;
  cancelled: boolean;
  error: string;
}

/** Runs kill as root behind the system's own password prompt: an AppleScript dialog on macOS, polkit on Linux. */
async function killAsAdmin(flag: string, pids: number[]): Promise<AdminKill> {
  if (IS_LINUX) {
    const { code, stderr } = await run("pkexec", ["/usr/bin/kill", flag, ...pids.map(String)], 120000);
    // 126: the prompt was dismissed or authorization failed. 127: no polkit agent to show it.
    return { ok: code === 0, cancelled: code === 126, error: code === 127 ? "No polkit agent is running to ask for the password." : stderr.trim() };
  }
  const script = `do shell script "/bin/kill ${flag} ${pids.join(" ")}" with administrator privileges`;
  const { code, stderr } = await run("/usr/bin/osascript", ["-e", script], 60000);
  return { ok: code === 0, cancelled: stderr.includes("-128"), error: stderr.trim() };
}

function signalFor(mode: KillMode): NodeJS.Signals {
  return mode === "force" ? "SIGKILL" : "SIGTERM";
}

async function quitApp(bundleId: string): Promise<boolean> {
  if (!/^[\w.-]+$/.test(bundleId)) return false;
  const { code } = await run("/usr/bin/osascript", ["-e", `tell application id "${bundleId}" to quit`], 10000);
  return code === 0;
}

export async function endProcesses(
  pids: number[],
  mode: KillMode,
  options: { bundleId?: string; admin?: boolean; windowPids?: Set<number> } = {},
): Promise<KillResult> {
  if (process.platform === "win32") return endProcessesWindows(pids, mode, options.admin === true, options.windowPids);
  const targets = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0);
  const failed: KillResult["failed"] = [];
  const killed: number[] = [];

  for (const pid of targets) {
    if (PROTECTED.has(pid)) failed.push({ pid, reason: `${OS_NAME} won't let this process be ended.` });
    if (pid === process.pid) failed.push({ pid, reason: "This is Systo's own server." });
  }
  const allowed = targets.filter((pid) => !PROTECTED.has(pid) && pid !== process.pid);

  // Linux has no "ask the app to quit" call; SIGTERM below is what a polite quit already means there.
  if (mode === "quit" && options.bundleId && !IS_LINUX) {
    const ok = await quitApp(options.bundleId);
    if (ok) {
      return { ok: true, killed: allowed, failed, needsAdmin: false, message: "Asked the app to quit." };
    }
  }

  if (options.admin) {
    if (allowed.length === 0) {
      return { ok: false, killed, failed, needsAdmin: false, message: "Nothing to end." };
    }
    const { ok, cancelled, error } = await killAsAdmin(mode === "force" ? "-9" : "-15", allowed);
    if (ok) {
      return { ok: true, killed: allowed, failed, needsAdmin: false, message: `Ended ${allowed.length} process${allowed.length === 1 ? "" : "es"} as administrator.` };
    }
    return {
      ok: false,
      killed,
      failed: [...failed, ...allowed.map((pid) => ({ pid, reason: cancelled ? "Cancelled" : error || "Failed" }))],
      needsAdmin: false,
      message: cancelled ? "Administrator authorization was cancelled." : "Couldn't end the process as administrator.",
    };
  }

  const signal = signalFor(mode);
  let needsAdmin = false;
  for (const pid of allowed) {
    try {
      process.kill(pid, signal);
      killed.push(pid);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ESRCH") {
        killed.push(pid);
      } else if (code === "EPERM") {
        needsAdmin = true;
        failed.push({ pid, reason: "Owned by another user" });
      } else {
        failed.push({ pid, reason: String((error as Error).message) });
      }
    }
  }

  const ok = failed.length === 0;
  let message: string;
  if (ok) message = `${mode === "force" ? "Force quit" : "Ended"} ${killed.length} process${killed.length === 1 ? "" : "es"}.`;
  else if (needsAdmin) message = "Some processes belong to the system. End them as administrator?";
  else message = failed[0]?.reason ?? "Couldn't end the process.";
  return { ok, killed, failed, needsAdmin, message };
}

export async function reveal(path: string): Promise<boolean> {
  if (process.platform === "win32") return revealWindows(path);
  if (!path.startsWith("/")) return false;
  if (IS_LINUX) return revealLinux(path);
  const { code } = await run("/usr/bin/open", ["-R", path], 4000);
  return code === 0;
}

/** Selects the item in the file manager through the FileManager1 D-Bus API, or just opens its folder. */
async function revealLinux(path: string): Promise<boolean> {
  const uri = `file://${path.split("/").map(encodeURIComponent).join("/")}`;
  const shown = await run(
    "gdbus",
    ["call", "--session", "--dest", "org.freedesktop.FileManager1", "--object-path", "/org/freedesktop/FileManager1", "--method", "org.freedesktop.FileManager1.ShowItems", `['${uri.replace(/'/g, "%27")}']`, ""],
    4000,
  );
  if (shown.code === 0) return true;
  const { code } = await run("xdg-open", [dirname(path)], 4000);
  return code === 0;
}
