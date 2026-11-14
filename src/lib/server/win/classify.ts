import { homedir } from "node:os";
import type { ProcessKind, Safety } from "../../types";

const WINDIR = (process.env.SystemRoot || process.env.windir || "C:\\Windows").toLowerCase();
const HOME = homedir().toLowerCase();

/** Pseudo-processes the kernel owns. They have no image path and can't be opened. */
export const KERNEL_NAMES = new Set(["system", "registry", "memory compression", "secure system", "system idle process", "vmmem", "vmmemwsl"]);

/** Ending any of these crashes or signs out Windows. */
const CRITICAL = new Set([
  "csrss.exe", "wininit.exe", "winlogon.exe", "smss.exe", "services.exe", "lsass.exe", "lsaiso.exe",
  "fontdrvhost.exe", "msmpeng.exe", "securityhealthservice.exe", "system", "registry", "memory compression", "secure system",
]);

/** Windows restarts these on its own, so ending them is mostly harmless. */
const RELAUNCHES = new Set([
  "dwm.exe", "explorer.exe", "searchhost.exe", "searchapp.exe", "startmenuexperiencehost.exe", "shellexperiencehost.exe",
  "runtimebroker.exe", "textinputhost.exe", "ctfmon.exe", "sihost.exe", "taskhostw.exe", "widgets.exe", "phoneexperiencehost.exe",
  "lockapp.exe", "searchindexer.exe", "smartscreen.exe", "applicationframehost.exe", "systemsettings.exe", "useroobebroker.exe",
]);

const CAUTION = new Set(["svchost.exe", "spoolsv.exe", "audiodg.exe", "wudfhost.exe", "conhost.exe", "dllhost.exe", "wmiprvse.exe", "msedgewebview2.exe"]);

const DEV_NAMES = new Set([
  "node", "bun", "deno", "npm", "pnpm", "yarn", "python", "python3", "pythonw", "py", "ruby", "java", "javaw", "go", "cargo",
  "rustc", "git", "ssh", "bash", "pwsh", "powershell", "cmd", "wsl", "wslhost", "wslservice", "windowsterminal", "openconsole",
  "esbuild", "tsserver", "gopls", "rust-analyzer", "clangd", "docker", "com.docker.backend", "kubectl", "postgres", "redis-server",
  "mysqld", "mongod", "php", "perl", "dotnet", "msbuild", "cl", "link",
]);

export function isWindowsPath(path: string) {
  return path.toLowerCase().startsWith(WINDIR + "\\");
}

export interface WinFacts {
  pid: number;
  exe: string;
  path: string;
  session: number;
  hasWindow: boolean;
}

export function classifyWin(p: WinFacts): ProcessKind {
  const exe = p.exe.toLowerCase();
  if (p.pid === 4 || (!p.path && KERNEL_NAMES.has(exe))) return "kernel";
  const stem = exe.replace(/\.exe$/, "");
  const lower = p.path.toLowerCase();
  const windows = !p.path ? p.session === 0 : isWindowsPath(p.path) || lower.includes("\\windowsapps\\microsoft.windows");
  if (p.hasWindow) return windows ? "system-app" : DEV_NAMES.has(stem) ? "developer" : "app";
  if (DEV_NAMES.has(stem) || lower.includes("\\node_modules\\") || lower.includes("\\.bun\\")) return "developer";
  if (windows) return p.session === 0 ? "system-service" : "user-service";
  if (p.session === 0) return "third-party-service";
  if (lower.startsWith(HOME + "\\") && !lower.includes("\\appdata\\")) return "developer";
  return "menu-bar";
}

export function safetyWin(exe: string, kind: ProcessKind, session: number): Safety {
  const name = exe.toLowerCase();
  if (kind === "kernel" || CRITICAL.has(name)) return "critical";
  if (RELAUNCHES.has(name)) return "relaunches";
  if (CAUTION.has(name)) return "caution";
  if (kind === "system-service") return session === 0 ? "caution" : "relaunches";
  if (kind === "user-service") return "relaunches";
  return "safe";
}
