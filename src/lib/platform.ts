/**
 * Which OS Systo is running on. The server and the window always run on the same machine, so the
 * server's answer (process.platform) and the page's (user agent) agree and hydration stays stable.
 */
export const IS_WINDOWS: boolean =
  typeof window === "undefined"
    ? typeof process !== "undefined" && process.platform === "win32"
    : /Windows/i.test(navigator.userAgent);

export const IS_LINUX: boolean =
  typeof window === "undefined"
    ? typeof process !== "undefined" && process.platform === "linux"
    : !IS_WINDOWS && /Linux|X11/i.test(navigator.userAgent);

/** Picks the wording for the current OS. */
export function byOS<T>(mac: T, windows: T, linux: T): T {
  return IS_WINDOWS ? windows : IS_LINUX ? linux : mac;
}

/** User-facing names that differ between macOS, Windows and Linux. */
export const OS = IS_LINUX
  ? {
      name: "Linux",
      device: "PC",
      fileManager: "file manager",
      reveal: "Show in File Manager",
      trash: "Trash",
      mod: "Ctrl+",
      volume: "File System",
      menuBar: "system tray",
    }
  : IS_WINDOWS
  ? {
      name: "Windows",
      device: "PC",
      fileManager: "File Explorer",
      reveal: "Show in File Explorer",
      trash: "Recycle Bin",
      mod: "Ctrl+",
      volume: "Local Disk (C:)",
      menuBar: "notification area",
    }
  : {
      name: "macOS",
      device: "Mac",
      fileManager: "Finder",
      reveal: "Show in Finder",
      trash: "Trash",
      mod: "⌘",
      volume: "Macintosh HD",
      menuBar: "menu bar",
    };

/** The platform's command key: ⌘ on macOS, Ctrl on Windows and Linux. */
export function isModKey(event: { metaKey: boolean; ctrlKey: boolean }) {
  return IS_WINDOWS || IS_LINUX ? event.ctrlKey : event.metaKey;
}

/** Absolute paths: `/…` on macOS and Linux, `C:/…` or `C:\…` on Windows. */
export function isAbsolutePath(path: string) {
  return IS_WINDOWS ? /^[A-Za-z]:[\\/]/.test(path) : path.startsWith("/");
}
