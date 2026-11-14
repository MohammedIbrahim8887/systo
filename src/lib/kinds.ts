import type { Metric, ProcessKind, Safety, Section } from "./types";

export const KIND_META: Record<ProcessKind, { label: string; short: string; description: string }> = {
  app: {
    label: "App",
    short: "App",
    description: "An application you installed and opened, with its own windows.",
  },
  "system-app": {
    label: "macOS App",
    short: "macOS",
    description: "An app that ships with macOS, made by Apple.",
  },
  "menu-bar": {
    label: "Menu Bar App",
    short: "Menu bar",
    description: "Runs without a Dock icon, usually as a menu bar item or background agent.",
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
    description: "A background service installed by third-party software, not by Apple.",
  },
  "user-service": {
    label: "macOS Agent",
    short: "Agent",
    description: "A macOS background agent running in your user session.",
  },
  "system-service": {
    label: "macOS Service",
    short: "System",
    description: "A macOS daemon that runs for the whole system, usually as root.",
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
    description: "macOS restarts it automatically when it's needed, so ending it is mostly harmless.",
  },
  caution: {
    label: "Use caution",
    description: "Part of macOS. Ending it may break features until it relaunches or you log in again.",
  },
  critical: {
    label: "Critical",
    description: "Essential to macOS. Ending it will crash your session, log you out, or restart the Mac.",
  },
};

export const SECTION_META: Record<Section, { label: string; hint: string }> = {
  apps: { label: "Apps", hint: "Apps with windows you can see" },
  background: { label: "Background", hint: "Menu bar apps, helpers, dev tools and third-party services" },
  system: { label: "System", hint: "Processes that are part of macOS" },
};

export const METRIC_META: Record<Metric, { label: string; short: string }> = {
  cpu: { label: "CPU", short: "CPU" },
  memory: { label: "Memory", short: "RAM" },
  disk: { label: "Disk", short: "Disk" },
  network: { label: "Network", short: "Net" },
};
