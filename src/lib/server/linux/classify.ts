import { homedir } from "node:os";
import type { ProcessKind, Safety } from "../../types";

const HOME = homedir();

/** Ending any of these ends the session or takes the machine down. */
const CRITICAL = new Set([
  "systemd", "init", "Hyprland", "hyprland", "sway", "niri", "gnome-shell", "kwin_wayland", "plasmashell", "Xorg",
  "sddm", "sddm-helper", "gdm", "gdm-session-worker", "greetd", "login", "uwsm",
  "dbus-daemon", "dbus-broker", "dbus-broker-launch", "systemd-logind", "systemd-journald", "systemd-udevd", "systemd-userdbd",
]);

/** systemd restarts these on its own, so ending them is mostly harmless. */
const RELAUNCHES = new Set([
  "pipewire", "pipewire-pulse", "wireplumber", "dconf-service", "systemd-timesyncd", "systemd-resolved", "systemd-oomd",
  "systemd-networkd", "at-spi-bus-launcher", "at-spi2-registryd", "gnome-keyring-daemon", "localsearch-3", "tracker-miner-fs-3",
]);
const RELAUNCH_PREFIX = /^(xdg-desktop-portal|xdg-document-portal|xdg-permission-store|gvfsd|gvfs-|evolution-)/;

/** Part of the desktop: ending them breaks something until you start them again or sign back in. */
const CAUTION = new Set([
  "waybar", "Xwayland", "NetworkManager", "iwd", "wpa_supplicant", "bluetoothd", "polkitd", "hypridle", "hyprpaper", "hyprsunset",
  "mako", "dunst", "swaync", "swayosd-server", "swaybg", "walker", "elephant", "fcitx5", "ibus-daemon", "upowerd", "udisksd",
  "rtkit-daemon", "cupsd", "avahi-daemon", "dockerd", "containerd", "sshd", "polkit-gnome-authentication-agent-1", "hyprpolkitagent",
  "power-profiles-daemon", "thermald", "accounts-daemon", "ModemManager", "tailscaled",
]);

const DEV_NAMES = new Set([
  "node", "bun", "deno", "npm", "pnpm", "yarn", "npx", "python", "python3", "ruby", "java", "go", "cargo", "rustc", "git",
  "ssh", "zsh", "bash", "fish", "sh", "dash", "nu", "tmux", "zellij", "vim", "nvim", "hx", "make", "cmake", "ninja", "gcc", "cc",
  "clang", "ld", "esbuild", "tsserver", "gopls", "rust-analyzer", "clangd", "docker", "podman", "kubectl", "postgres",
  "redis-server", "mysqld", "mariadbd", "mongod", "php", "perl", "lua", "gdb", "lldb", "watchman", "mise", "claude", "codex",
  "lazygit", "lazydocker", "btop", "htop", "fzf", "rg", "fd", "starship", "opencode",
]);

const DEV_PATH = /\/(node_modules|\.nvm|\.bun|\.deno|\.cargo|\.rustup|\.pyenv|\.rbenv|\.volta|\.asdf|\.local\/share\/mise|go\/bin)\//;

/** Where the distribution's own packages install programs. */
export function isSystemPath(path: string): boolean {
  return /^\/(usr|bin|sbin|lib|lib64)\//.test(path);
}

export interface LinuxFacts {
  pid: number;
  uid: number;
  name: string;
  path: string;
  kthread: boolean;
  hasWindow: boolean;
  /** A launcher entry exists for this program, so it's an app even with no window open. */
  hasEntry: boolean;
}

export function classifyLinux(p: LinuxFacts): ProcessKind {
  if (p.kthread) return "kernel";
  if (p.hasWindow) return "app";
  // python3.12, node22… are still the interpreter.
  const stem = p.name.replace(/[\d.]+$/, "");
  if (DEV_NAMES.has(p.name) || DEV_NAMES.has(stem) || DEV_PATH.test(p.path)) return "developer";
  if (p.uid < 1000) return !p.path || isSystemPath(p.path) ? "system-service" : "third-party-service";
  if (p.hasEntry) return "menu-bar";
  if (!p.path || isSystemPath(p.path)) return "user-service";
  if (p.path.startsWith(HOME + "/")) return "developer";
  return "third-party-service";
}

export function safetyLinux(name: string, kind: ProcessKind, pid: number): Safety {
  if (kind === "kernel" || pid === 1 || CRITICAL.has(name)) return "critical";
  if (RELAUNCHES.has(name) || RELAUNCH_PREFIX.test(name)) return "relaunches";
  if (CAUTION.has(name)) return "caution";
  if (kind === "system-service" || kind === "user-service") return "caution";
  return "safe";
}
