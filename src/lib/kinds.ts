import { OS, byOS } from "./platform";
import type { Metric, ProcessKind, Safety, Section } from "./types";

export const KIND_META: Record<ProcessKind, { label: string; short: string; description: string }> = {
  app: {
    label: "App",
    short: "App",
    description: "An application you installed and opened, with its own windows.",
  },
  "system-app": {
    label: byOS("macOS App", "Windows App", "System App"),
    short: byOS("macOS", "Windows", "System"),
    description: byOS("An app that ships with macOS, made by Apple.", "An app that ships with Windows, made by Microsoft.", "An app that ships with your distribution."),
  },
  "menu-bar": {
    label: byOS("Menu Bar App", "Background App", "Background App"),
    short: byOS("Menu bar", "Background", "Background"),
    description: byOS(
      "Runs without a Dock icon, usually as a menu bar item or background agent.",
      "Runs without a window, usually as a notification area icon, updater or sync tool.",
      "An app running without a window, usually as a tray icon, updater or sync tool.",
    ),
  },
  helper: {
    label: "Helper",
    short: "Helper",
    description: "A worker process an app starts to do part of its job, such as rendering a tab.",
  },
  developer: {
    label: "Dev Tool",
    short: "Dev",
    description: "A runtime, shell, or tool you or your editor started from a terminal.",
  },
  "third-party-service": {
    label: "3rd-party Service",
    short: "Service",
    description: `A background service installed by third-party software, not by ${byOS("Apple", "Microsoft", "your distribution")}.`,
  },
  "user-service": {
    label: byOS("macOS Agent", "Windows Process", "Session Service"),
    short: byOS("Agent", "Windows", "Session"),
    description: byOS(
      "A macOS background process running in your user session.",
      "A Windows background process running in your user session.",
      "Part of your desktop session, such as the compositor, the bar or the audio server.",
    ),
  },
  "system-service": {
    label: byOS("macOS Service", "Windows Service", "System Service"),
    short: "System",
    description: byOS(
      "A macOS daemon that runs for the whole system, usually as root.",
      "A Windows service that runs for the whole system, usually as SYSTEM.",
      "A service that runs for the whole system, usually as root.",
    ),
  },
  kernel: {
    label: "Kernel",
    short: "Kernel",
    description: "The core of the operating system. It can't be stopped.",
  },
};

export const SAFETY_META: Record<Safety, { label: string; description: string }> = {
  safe: {
    label: "Safe to end",
    description: "Ending it only closes this program. Unsaved work in it may be lost.",
  },
  relaunches: {
    label: "Relaunches",
    description: `${OS.name} restarts it automatically when it's needed, so ending it is mostly harmless.`,
  },
  caution: {
    label: "Use caution",
    description: `Part of ${OS.name}. Ending it may break features until it relaunches or you sign in again.`,
  },
  critical: {
    label: "Critical",
    description: `Essential to ${OS.name}. Ending it will crash your session, sign you out, or restart the ${OS.device}.`,
  },
};

export const SECTION_META: Record<Section, { label: string; hint: string }> = {
  apps: { label: "Apps", hint: "Apps with windows you can see" },
  background: {
    label: "Background",
    hint: byOS("Menu bar apps, helpers, dev tools and third-party services", "Background apps, helpers, dev tools and third-party services", "Background apps, helpers, dev tools and third-party services"),
  },
  system: { label: "System", hint: `Processes that are part of ${OS.name}` },
};

export const METRIC_META: Record<Metric, { label: string; short: string }> = {
  cpu: { label: "CPU", short: "CPU" },
  memory: { label: "Memory", short: "RAM" },
  disk: { label: "Disk", short: "Disk" },
  network: { label: "Network", short: "Net" },
};
