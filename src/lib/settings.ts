import type { Metric } from "./types";

/** Everything Systo remembers besides the theme (see lib/theme.ts). */
export interface Settings {
  /** Milliseconds between samples; 0 pauses updates. */
  interval: number;
  /** "total" matches Windows Task Manager (0–100%); "core" matches Activity Monitor (100% per core). */
  cpuMode: "total" | "core";
  colorIcons: boolean;
  heatmap: boolean;
  /** What the Dynamic Island shows. */
  islandMetric: Metric;
  islandAI: boolean;
  /** AI logins found on this computer that you chose not to connect. */
  dismissedLogins: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  interval: 1500,
  cpuMode: "total",
  colorIcons: false,
  heatmap: true,
  islandMetric: "cpu",
  islandAI: false,
  dismissedLogins: [],
};

const INTERVALS = [0, 1000, 1500, 3000, 5000];
const METRICS: Metric[] = ["cpu", "memory", "disk", "network"];

export function sanitizeSettings(value: unknown): Settings {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const flag = (x: unknown, fallback: boolean) => (typeof x === "boolean" ? x : fallback);
  const pick = <T>(x: unknown, allowed: readonly T[], fallback: T) => (allowed.includes(x as T) ? (x as T) : fallback);
  return {
    interval: pick(v.interval, INTERVALS, d.interval),
    cpuMode: pick(v.cpuMode, ["total", "core"] as const, d.cpuMode),
    colorIcons: flag(v.colorIcons, d.colorIcons),
    heatmap: flag(v.heatmap, d.heatmap),
    islandMetric: pick(v.islandMetric, METRICS, d.islandMetric),
    islandAI: flag(v.islandAI, d.islandAI),
    dismissedLogins: Array.isArray(v.dismissedLogins)
      ? [...new Set(v.dismissedLogins.filter((id): id is string => typeof id === "string" && id.length <= 300))].slice(-200)
      : [],
  };
}
