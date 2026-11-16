import { homedir } from "node:os";
import { join } from "node:path";

/** Where Systo keeps its own data: Application Support on macOS, %LOCALAPPDATA% on Windows, XDG data on Linux. */
export function appDataDir(): string {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Systo");
  }
  if (process.platform === "linux") {
    return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "systo");
  }
  return join(homedir(), "Library", "Application Support", "Systo");
}

export function appDataFile(name: string): string {
  return join(appDataDir(), name);
}
