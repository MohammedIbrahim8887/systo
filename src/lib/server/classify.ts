import { homedir } from "node:os";
import type { ProcessKind, Safety, Section } from "../types";
import type { BundleInfo } from "./bundle";
import { CRITICAL_NAMES, KNOWN_SAFETY } from "./knowledge";

const HOME = homedir();

const APPLE_PATH = /^\/(System|usr\/(libexec|sbin|bin|lib)|sbin|bin|Library\/Apple)\//;
const DEV_PATH = new RegExp(
  [
    "^/opt/homebrew/",
    "^/usr/local/(bin|Cellar|lib)/",
    "/\\.(nvm|bun|deno|cargo|rustup|pyenv|rbenv|volta|fnm|asdf|local/share/mise|orbstack)/",
    "/node_modules/",
    "^/Applications/Xcode[^/]*\\.app/Contents/Developer/",
    "^/Library/Developer/",
  ].join("|"),
);
const DEV_NAMES = new Set([
  "node", "bun", "deno", "npm", "pnpm", "yarn", "npx", "python", "python3", "ruby", "java", "go", "cargo",
  "rustc", "git", "ssh", "zsh", "bash", "fish", "sh", "login", "tmux", "vim", "nvim", "make", "esbuild",
  "tsserver", "gopls", "rust-analyzer", "clangd", "sourcekit-lsp", "docker", "kubectl", "postgres", "redis-server",
  "mysqld", "mongod", "php", "perl", "swift", "lldb", "watchman",
]);

/** Where Apple's own user-facing apps live. */
const APPLE_APP_ROOTS =
  /^\/(System\/Applications\/|System\/Cryptexes\/App\/System\/Applications\/|Applications\/|System\/Library\/CoreServices\/Applications\/|System\/Library\/CoreServices\/Finder\.app$)/;

export function isApplePath(path: string): boolean {
  return APPLE_PATH.test(path);
}

export function isAppleBundle(bundle: BundleInfo | undefined, path: string): boolean {
  if (bundle?.id?.startsWith("com.apple.")) return true;
  return path.startsWith("/System/");
}

export interface ProcessFacts {
  pid: number;
  uid: number;
  name: string;
  path: string;
  /** Outermost app bundle for the executable, if any. */
  bundlePath?: string;
  bundle?: BundleInfo;
}

export function classifyProcess(p: ProcessFacts): ProcessKind {
  if (p.pid === 0) return "kernel";
  if (p.bundlePath) {
    const main = p.bundle?.executable ? `${p.bundlePath}/Contents/MacOS/${p.bundle.executable}` : undefined;
    const isMain = main ? p.path === main : p.path.startsWith(`${p.bundlePath}/Contents/MacOS/`);
    if (!isMain) return "helper";
    return bundleKind(p.bundle, p.bundlePath, p.uid);
  }
  if (DEV_NAMES.has(p.name) || DEV_PATH.test(p.path)) return "developer";
  if (!p.path || !p.path.startsWith("/")) {
    return p.uid < 500 ? "system-service" : "user-service";
  }
  if (isApplePath(p.path)) return p.uid < 500 ? "system-service" : "user-service";
  if (p.path.startsWith(HOME + "/") && !p.path.startsWith(HOME + "/Library/")) return "developer";
  return "third-party-service";
}

export function bundleKind(bundle: BundleInfo | undefined, bundlePath: string, uid = 501): ProcessKind {
  const apple = isAppleBundle(bundle, bundlePath);
  if (apple) {
    if (bundle?.agent || !APPLE_APP_ROOTS.test(bundlePath)) return uid < 500 ? "system-service" : "user-service";
    return "system-app";
  }
  // A bundle running as root or a system account is a daemon packaged as an app.
  if (uid < 500) return "third-party-service";
  return bundle?.agent ? "menu-bar" : "app";
}

export function sectionFor(kind: ProcessKind): Section {
  switch (kind) {
    case "app":
    case "system-app":
      return "apps";
    case "menu-bar":
    case "helper":
    case "developer":
    case "third-party-service":
      return "background";
    default:
      return "system";
  }
}

export function safetyFor(name: string, kind: ProcessKind, uid: number): Safety {
  if (kind === "kernel" || CRITICAL_NAMES.has(name)) return "critical";
  const known = KNOWN_SAFETY(name);
  if (known) return known;
  switch (kind) {
    case "system-service":
      return uid === 0 ? "caution" : "relaunches";
    case "user-service":
      return "relaunches";
    default:
      return "safe";
  }
}

const SAFETY_RANK: Record<Safety, number> = { safe: 0, relaunches: 1, caution: 2, critical: 3 };

export function worstSafety(values: Safety[]): Safety {
  return values.reduce<Safety>((worst, s) => (SAFETY_RANK[s] > SAFETY_RANK[worst] ? s : worst), "safe");
}
