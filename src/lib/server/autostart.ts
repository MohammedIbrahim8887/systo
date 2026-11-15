import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { output, run } from "./exec";

/**
 * "Open at login" for Systo itself.
 * - macOS: a LaunchAgent in ~/Library/LaunchAgents that runs `open -a Systo.app` at login. It needs
 *   no Automation permission (unlike System Events login items) and shows up in Login Items.
 * - Windows: a value under HKCU\…\Run pointing at the launcher, the entry Task Manager lists.
 * Only the packaged app can register itself; the dev server has no app to point at.
 */

export interface AutostartState {
  /** False when Systo isn't running from an installed app (e.g. the dev server). */
  available: boolean;
  enabled: boolean;
  reason?: string;
}

const LABEL = "dev.systo.monitor.login";
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE = "Systo";
const APPROVED_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";

function plistPath() {
  return join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

/** The installed Systo.app, from the Bun binary that runs inside it (Contents/MacOS/bun). */
function macApp(): string | null {
  const match = /^(.*?\.app)\/Contents\/MacOS\//.exec(process.execPath);
  return match ? match[1] : null;
}

/** The Electrobun launcher beside the bundled bun.exe. */
function windowsLauncher(): string | null {
  const launcher = join(dirname(process.execPath), "launcher.exe");
  return /\\bun\.exe$/i.test(process.execPath) && existsSync(launcher) ? launcher : null;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function macState(): Promise<AutostartState> {
  const app = macApp();
  if (!app) return { available: false, enabled: false, reason: "Available in the installed app." };
  if (!existsSync(plistPath())) return { available: true, enabled: false };
  // Turning it off in the Startup view leaves a launchd override rather than deleting the file.
  const disabled = await output("/bin/launchctl", ["print-disabled", `gui/${userInfo().uid}`], 3000);
  return { available: true, enabled: !new RegExp(`"${LABEL.replace(/\./g, "\\.")}" => (disabled|true)`).test(disabled) };
}

async function macSet(enabled: boolean): Promise<AutostartState> {
  const app = macApp();
  if (!app) return { available: false, enabled: false, reason: "Available in the installed app." };
  const target = `gui/${userInfo().uid}/${LABEL}`;
  if (enabled) {
    mkdirSync(dirname(plistPath()), { recursive: true });
    writeFileSync(
      plistPath(),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>-a</string>
    <string>${xml(app)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
</dict>
</plist>
`,
    );
    // Clear any "off" override left by the Startup view, so this toggle is the source of truth.
    await run("/bin/launchctl", ["enable", target], 3000);
  } else {
    await run("/bin/launchctl", ["bootout", target], 3000);
    try {
      unlinkSync(plistPath());
    } catch {
      // already gone
    }
  }
  return macState();
}

async function windowsState(): Promise<AutostartState> {
  const launcher = windowsLauncher();
  if (!launcher) return { available: false, enabled: false, reason: "Available in the installed app." };
  const { stdout, code } = await run("reg.exe", ["query", RUN_KEY, "/v", RUN_VALUE], 4000);
  if (code !== 0 || !stdout.includes(RUN_VALUE)) return { available: true, enabled: false };
  // Task Manager or the Startup view may have turned it off through StartupApproved (first byte odd).
  const approved = await run("reg.exe", ["query", APPROVED_KEY, "/v", RUN_VALUE], 4000);
  const bytes = /REG_BINARY\s+([0-9A-F]{2})/i.exec(approved.stdout)?.[1];
  return { available: true, enabled: !bytes || (Number.parseInt(bytes, 16) & 1) === 0 };
}

async function windowsSet(enabled: boolean): Promise<AutostartState> {
  const launcher = windowsLauncher();
  if (!launcher) return { available: false, enabled: false, reason: "Available in the installed app." };
  if (enabled) {
    await run("reg.exe", ["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", `"${launcher}"`, "/f"], 4000);
    await run("reg.exe", ["add", APPROVED_KEY, "/v", RUN_VALUE, "/t", "REG_BINARY", "/d", "020000000000000000000000", "/f"], 4000);
  } else {
    await run("reg.exe", ["delete", RUN_KEY, "/v", RUN_VALUE, "/f"], 4000);
    await run("reg.exe", ["delete", APPROVED_KEY, "/v", RUN_VALUE, "/f"], 4000);
  }
  return windowsState();
}

export function autostartState(): Promise<AutostartState> {
  if (process.platform === "win32") return windowsState();
  if (process.platform === "darwin") return macState();
  return Promise.resolve({ available: false, enabled: false, reason: "Not supported on this system." });
}

export function setAutostart(enabled: boolean): Promise<AutostartState> {
  if (process.platform === "win32") return windowsSet(enabled);
  if (process.platform === "darwin") return macSet(enabled);
  return autostartState();
}
