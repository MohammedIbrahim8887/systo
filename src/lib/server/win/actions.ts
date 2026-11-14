import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { KillMode, KillResult } from "../../types";
import { run } from "../exec";
import { powershell } from "./apps";

const PROTECTED = new Set([0, 4]);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function terminate(pid: number): "ok" | "denied" | string {
  try {
    process.kill(pid, "SIGKILL");
    return "ok";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return "ok";
    if (code === "EPERM" || code === "EACCES") return "denied";
    return String((error as Error).message);
  }
}

const plural = (n: number) => `${n} process${n === 1 ? "" : "es"}`;

/**
 * Quit and End task first ask politely (taskkill without /F posts WM_CLOSE, like closing the
 * window), then terminate whatever is left. Quit spares processes that still have a window open,
 * since that's usually an app asking to save. Force terminates straight away.
 */
export async function endProcessesWindows(
  pids: number[],
  mode: KillMode,
  admin: boolean,
  windowPids: Set<number> = new Set(),
): Promise<KillResult> {
  const targets = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0);
  const failed: KillResult["failed"] = [];
  for (const pid of targets) {
    if (PROTECTED.has(pid)) failed.push({ pid, reason: "Windows won't let this process be ended." });
    if (pid === process.pid) failed.push({ pid, reason: "This is Systo's own server." });
  }
  const allowed = targets.filter((pid) => !PROTECTED.has(pid) && pid !== process.pid);
  if (allowed.length === 0) return { ok: failed.length === 0, killed: [], failed, needsAdmin: false, message: failed[0]?.reason ?? "Nothing to end." };

  if (admin) {
    const args = ["/F", ...allowed.flatMap((pid) => ["/PID", String(pid)])].join(" ");
    const { code, stderr } = await powershell(
      `try { Start-Process -FilePath taskkill.exe -ArgumentList $env:SYSTO_ARGS -Verb RunAs -WindowStyle Hidden -Wait -ErrorAction Stop } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`,
      { SYSTO_ARGS: args },
      120000,
    );
    await new Promise((r) => setTimeout(r, 400));
    const left = allowed.filter(alive);
    if (code === 0 && left.length === 0) {
      return { ok: true, killed: allowed, failed, needsAdmin: false, message: `Ended ${plural(allowed.length)} as administrator.` };
    }
    const cancelled = /cancel/i.test(stderr);
    return {
      ok: false,
      killed: allowed.filter((pid) => !left.includes(pid)),
      failed: [...failed, ...left.map((pid) => ({ pid, reason: cancelled ? "Cancelled" : "Failed" }))],
      needsAdmin: false,
      message: cancelled ? "The administrator prompt was cancelled." : "Couldn't end the process as administrator.",
    };
  }

  let remaining = allowed;
  if (mode !== "force") {
    await run("taskkill.exe", allowed.flatMap((pid) => ["/PID", String(pid)]), 8000);
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      remaining = remaining.filter(alive);
      if (remaining.length === 0) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    if (mode === "quit") remaining = remaining.filter((pid) => !windowPids.has(pid));
  }

  const killed = allowed.filter((pid) => !remaining.includes(pid) || !alive(pid));
  let needsAdmin = false;
  for (const pid of remaining) {
    if (killed.includes(pid)) continue;
    const result = terminate(pid);
    if (result === "ok") killed.push(pid);
    else if (result === "denied") {
      needsAdmin = true;
      failed.push({ pid, reason: "Owned by Windows or another user" });
    } else failed.push({ pid, reason: result });
  }
  const waiting = mode === "quit" ? allowed.filter((pid) => !killed.includes(pid) && !failed.some((f) => f.pid === pid)) : [];

  const ok = failed.length === 0;
  let message: string;
  if (ok && waiting.length) message = "Asked the app to close. It may be waiting for you to save.";
  else if (ok) message = `${mode === "force" ? "Force quit" : "Ended"} ${plural(killed.length)}.`;
  else if (needsAdmin) message = "Some processes belong to Windows. End them as administrator?";
  else message = failed[0]?.reason ?? "Couldn't end the process.";
  return { ok, killed, failed, needsAdmin, message };
}

export async function revealWindows(path: string): Promise<boolean> {
  if (!/^[A-Za-z]:[\\/]/.test(path)) return false;
  const target = path.replace(/\//g, "\\");
  if (!existsSync(target)) return false;
  // explorer.exe wants `/select,"path"` verbatim, and exits with 1 even when it opened the window.
  spawn("explorer.exe", [`/select,"${target}"`], { windowsVerbatimArguments: true, detached: true, stdio: "ignore" }).unref();
  return true;
}
