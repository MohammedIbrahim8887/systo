import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import { run } from "../exec";
import { actionTitle, type HotkeyAction } from "../../hotkeys";

export interface LaunchResult {
  ok: boolean;
  message: string;
}

const IS_WINDOWS = process.platform === "win32";
const IS_LINUX = process.platform === "linux";

/** Starts something without waiting on it or keeping its output. */
function detached(file: string, args: string[], options: { shell?: boolean } = {}): Promise<LaunchResult> {
  return new Promise((resolve) => {
    try {
      const child = spawn(file, args, {
        detached: !IS_WINDOWS,
        stdio: "ignore",
        windowsHide: true,
        cwd: homedir(),
        env: process.env,
        shell: options.shell,
      });
      let settled = false;
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, message: error.message });
      });
      child.once("spawn", () => {
        if (settled) return;
        settled = true;
        child.unref();
        resolve({ ok: true, message: "Started." });
      });
    } catch (error) {
      resolve({ ok: false, message: (error as Error).message });
    }
  });
}

/** Opens a file, folder, app or URL with whatever the OS would use on a double-click. */
async function openWithSystem(target: string): Promise<LaunchResult> {
  if (IS_WINDOWS) {
    // FileProtocolHandler opens .lnk, .exe, folders and URLs without cmd.exe's quoting rules.
    return detached("rundll32.exe", ["url.dll,FileProtocolHandler", target]);
  }
  if (IS_LINUX) return detached("xdg-open", [target]);
  const { code, stderr } = await run("/usr/bin/open", [target], 8000);
  return code === 0 ? { ok: true, message: "Opened." } : { ok: false, message: stderr.trim() || "macOS couldn't open it." };
}

async function launchApp(path: string): Promise<LaunchResult> {
  if (IS_WINDOWS || !path) return openWithSystem(path);
  if (IS_LINUX) {
    // gio understands .desktop files directly; gtk-launch wants the id; both honour Terminal=true.
    const gio = await run("gio", ["launch", path], 8000);
    if (gio.code === 0) return { ok: true, message: "Opened." };
    const id = basename(path).replace(/\.desktop$/, "");
    const gtk = await run("gtk-launch", [id], 8000);
    if (gtk.code === 0) return { ok: true, message: "Opened." };
    return { ok: false, message: gio.stderr.trim() || gtk.stderr.trim() || "Couldn't start the app." };
  }
  // `open -a` launches the app, or brings it forward when it's already running.
  const { code, stderr } = await run("/usr/bin/open", ["-a", path], 8000);
  return code === 0 ? { ok: true, message: "Opened." } : { ok: false, message: stderr.trim() || "macOS couldn't open the app." };
}

function runCommand(command: string): Promise<LaunchResult> {
  if (IS_WINDOWS) return detached("cmd.exe", ["/d", "/s", "/c", command]);
  // A login shell, so PATH matches what the user's terminal has (Homebrew, ~/.local/bin, …).
  const shell = process.env.SHELL && existsSync(process.env.SHELL) ? process.env.SHELL : IS_LINUX ? "/bin/sh" : "/bin/zsh";
  return detached(shell, ["-lc", command]);
}

/** Everything except Systo's own commands, which only the desktop shell can carry out. */
export async function runHotkeyAction(action: HotkeyAction): Promise<LaunchResult> {
  let result: LaunchResult;
  switch (action.type) {
    case "app":
      result = await launchApp(action.path);
      break;
    case "url":
      result = await openWithSystem(action.url);
      break;
    case "path":
      if (!existsSync(action.path)) return { ok: false, message: `${action.path} doesn't exist anymore.` };
      result = await openWithSystem(action.path);
      break;
    case "command":
      result = await runCommand(action.command);
      break;
    case "systo":
      return { ok: false, message: "Systo commands need the desktop app." };
  }
  if (!result.ok) console.error(`[systo] shortcut couldn't open ${actionTitle(action)}: ${result.message}`);
  return result;
}
