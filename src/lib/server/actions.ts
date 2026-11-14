import type { KillMode, KillResult } from "../types";
import { run } from "./exec";

const PROTECTED = new Set([0, 1]);

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
  options: { bundleId?: string; admin?: boolean } = {},
): Promise<KillResult> {
  const targets = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0);
  const failed: KillResult["failed"] = [];
  const killed: number[] = [];

  for (const pid of targets) {
    if (PROTECTED.has(pid)) failed.push({ pid, reason: "macOS won't let this process be ended." });
    if (pid === process.pid) failed.push({ pid, reason: "This is Systo's own server." });
  }
  const allowed = targets.filter((pid) => !PROTECTED.has(pid) && pid !== process.pid);

  if (mode === "quit" && options.bundleId) {
    const ok = await quitApp(options.bundleId);
    if (ok) {
      return { ok: true, killed: allowed, failed, needsAdmin: false, message: "Asked the app to quit." };
    }
  }

  if (options.admin) {
    if (allowed.length === 0) {
      return { ok: false, killed, failed, needsAdmin: false, message: "Nothing to end." };
    }
    const flag = mode === "force" ? "-9" : "-15";
    const command = `/bin/kill ${flag} ${allowed.join(" ")}`;
    const script = `do shell script "${command}" with administrator privileges`;
    const { code, stderr } = await run("/usr/bin/osascript", ["-e", script], 60000);
    if (code === 0) {
      return { ok: true, killed: allowed, failed, needsAdmin: false, message: `Ended ${allowed.length} process${allowed.length === 1 ? "" : "es"} as administrator.` };
    }
    const cancelled = stderr.includes("-128");
    return {
      ok: false,
      killed,
      failed: [...failed, ...allowed.map((pid) => ({ pid, reason: cancelled ? "Cancelled" : stderr.trim() || "Failed" }))],
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
  if (!path.startsWith("/")) return false;
  const { code } = await run("/usr/bin/open", ["-R", path], 4000);
  return code === 0;
}
