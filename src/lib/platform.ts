/**
 * Which OS Systo is running on. The server and the window always run on the same machine, so the
 * server's answer (process.platform) and the page's (user agent) agree and hydration stays stable.
 */
export const IS_WINDOWS: boolean =
  typeof window === "undefined"
    ? typeof process !== "undefined" && process.platform === "win32"
    : /Windows/i.test(navigator.userAgent);

/** User-facing names that differ between macOS and Windows. */
export const OS = IS_WINDOWS
  ? { name: "Windows", device: "PC", fileManager: "File Explorer", reveal: "Show in File Explorer", trash: "Recycle Bin", mod: "Ctrl+" }
  : { name: "macOS", device: "Mac", fileManager: "Finder", reveal: "Show in Finder", trash: "Trash", mod: "⌘" };

/** The platform's command key: ⌘ on macOS, Ctrl on Windows. */
export function isModKey(event: { metaKey: boolean; ctrlKey: boolean }) {
  return IS_WINDOWS ? event.ctrlKey : event.metaKey;
}

/** Absolute paths: `/…` on macOS, `C:/…` or `C:\…` on Windows. */
export function isAbsolutePath(path: string) {
  return IS_WINDOWS ? /^[A-Za-z]:[\\/]/.test(path) : path.startsWith("/");
}
