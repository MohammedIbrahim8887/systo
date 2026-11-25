/** Shared between the server sampler and the UI. */

export type ProcessKind =
  | "app"
  | "system-app"
  | "menu-bar"
  | "helper"
  | "developer"
  | "third-party-service"
  | "user-service"
  | "system-service"
  | "kernel";

export type Section = "apps" | "background" | "system";

/** How much damage ending this process does. */
export type Safety = "safe" | "relaunches" | "caution" | "critical";

export type Metric = "cpu" | "memory" | "disk" | "network";

export interface ProcessRow {
  pid: number;
  ppid: number;
  uid: number;
  user: string;
  name: string;
  path: string;
  /** Percent of one core, like Activity Monitor (can exceed 100). */
  cpu: number;
  /** Bytes. Footprint when readable, otherwise resident size. */
  memory: number;
  diskRead: number;
  diskWrite: number;
  netIn: number;
  netOut: number;
  /** Watts, when the kernel reports energy for the process. */
  power: number;
  kind: ProcessKind;
  safety: Safety;
  /** False for processes owned by another user that libproc can't inspect. */
  inspectable: boolean;
  self: boolean;
}

export interface ProcessGroup {
  id: string;
  name: string;
  section: Section;
  kind: ProcessKind;
  safety: Safety;
  bundleId?: string;
  bundlePath?: string;
  /** Present when the bundle has an icon the server can render. */
  hasIcon: boolean;
  user: string;
  headPid: number;
  processes: ProcessRow[];
  cpu: number;
  memory: number;
  disk: number;
  network: number;
  self: boolean;
}

export interface SystemTotals {
  cpu: number;
  cores: number;
  memoryUsed: number;
  memoryTotal: number;
  memoryApp: number;
  memoryWired: number;
  memoryCompressed: number;
  memoryCached: number;
  swapUsed: number;
  pressure: "normal" | "warning" | "critical";
  diskRead: number;
  diskWrite: number;
  netIn: number;
  netOut: number;
  gpu: number | null;
  processCount: number;
  uptime: number;
}

export interface HistoryPoint {
  t: number;
  cpu: number;
  memory: number;
  diskRead: number;
  diskWrite: number;
  netIn: number;
  netOut: number;
  gpu: number | null;
}

export interface Snapshot {
  at: number;
  interval: number;
  totals: SystemTotals;
  groups: ProcessGroup[];
  history: HistoryPoint[];
  /** False when libproc isn't available, so footprint, disk and grouping are approximations. */
  native: boolean;
  /** Recent peak network throughput (bytes/s), the ceiling for network percentages. */
  netPeak: number;
}

export interface IslandEntry {
  id: string;
  name: string;
  bundlePath?: string;
  hasIcon: boolean;
  kind: ProcessKind;
  value: number;
  share: number;
}

export interface IslandData {
  metric: Metric;
  total: number;
  entries: IslandEntry[];
  totals: Pick<SystemTotals, "cpu" | "cores" | "memoryUsed" | "memoryTotal" | "diskRead" | "diskWrite" | "netIn" | "netOut">;
  /** Percentages for the overview rings: chip load, RAM in use, storage used, network against its recent peak. */
  overview: Record<Metric, number>;
  storage: { used: number; total: number };
  netPeak: number;
  /** The dark theme's accent for rings and bars; null keeps them white. */
  tint?: string | null;
  colorIcons?: boolean;
}

export interface SystemInfo {
  model: string;
  chip: string;
  cores: number;
  performanceCores: number | null;
  efficiencyCores: number | null;
  memory: number;
  osName: string;
  osVersion: string;
  osBuild: string;
  hostname: string;
  bootTime: number;
  diskTotal: number;
  diskFree: number;
  gpuCores: number | null;
}

export interface Explanation {
  title: string;
  kind: ProcessKind;
  kindLabel: string;
  safety: Safety;
  summary: string;
  details: string[];
  quitEffect: string;
  vendor: string;
  source: "knowledge" | "bundle" | "heuristic";
  facts: Array<{ label: string; value: string; mono?: boolean }>;
  connections: string[];
  manSummary?: string;
  searchQuery: string;
}

export type UsageRange = "1h" | "3h" | "1d" | "7d" | "30d" | "90d";
export type UsageMetric = "cpu" | "memory" | "disk" | "network" | "energy";

export interface UsageEntry {
  id: string;
  name: string;
  kind: ProcessKind;
  bundlePath?: string;
  hasIcon: boolean;
  /** CPU core-seconds, average bytes of memory, bytes moved, or joules. */
  total: number;
  /** Share of the whole Mac over the range, 0–1. */
  share: number;
  /** Per bucket: CPU % of the chip, average memory bytes, bytes, or average watts. */
  series: number[];
  lastSeen: number;
}

export interface UsageReport {
  range: UsageRange;
  metric: UsageMetric;
  from: number;
  to: number;
  step: number;
  buckets: number[];
  cores: number;
  system: number[];
  systemTotal: number;
  others: number[];
  entries: UsageEntry[];
  coverage: {
    /** Seconds Systo was sampling within the range. */
    recorded: number;
    /** When recording first started, or null before the first flush. */
    since: number | null;
  };
}

export type StartupKind = "login-item" | "login-helper" | "agent" | "daemon";

export interface StartupItem {
  id: string;
  kind: StartupKind;
  name: string;
  /** launchd label, when the item is a launchd job. */
  label?: string;
  developer?: string;
  /** The app the item belongs to, for its icon and grouping. */
  appName?: string;
  bundlePath?: string;
  hasIcon: boolean;
  program?: string;
  plistPath?: string;
  /** "At login", "Always running", "Every 15 min"… */
  schedule: string;
  enabled: boolean;
  /** Turned off under "Allow in the Background" in System Settings, which only Settings can undo. */
  blockedBySettings: boolean;
  needsAdmin: boolean;
  running: boolean;
  pids: number[];
  memory: number;
  cpu: number;
  impact: "high" | "medium" | "low" | "none";
}

export interface StartupReport {
  items: StartupItem[];
  /** False when System Events access was denied, so "Open at Login" comes from the BTM database. */
  loginItemsReadable: boolean;
  at: number;
}

export interface StartupToggleResult {
  ok: boolean;
  needsAdmin: boolean;
  message: string;
}

export type DiskItemKind = "file" | "folder" | "package" | "rest";

export interface DiskViewNode {
  name: string;
  size: number;
  files: number;
  kind: DiskItemKind;
  /** Absolute path; absent for the aggregate of small items. */
  path?: string;
  /** For .app packages, so the UI can show the real icon. */
  bundlePath?: string;
  children?: DiskViewNode[];
  hasChildren: boolean;
}

export interface DiskScanState {
  status: "idle" | "scanning" | "done" | "error";
  root?: string;
  label?: string;
  startedAt?: number;
  finishedAt?: number;
  progress: { files: number; dirs: number; bytes: number; current: string };
  error?: string;
  stats?: { files: number; dirs: number; bytes: number; denied: number; ms: number };
}

export interface DiskSuggestion {
  id: string;
  title: string;
  description: string;
  path?: string;
  size: number;
  count?: number;
  /** Rebuilt automatically or re-downloadable, so removing it loses nothing permanent. */
  safe: boolean;
  items?: Array<{ path: string; size: number }>;
}

export interface DiskReport {
  state: DiskScanState;
  volume: { used: number; total: number };
  home: string;
  view?: {
    /** Absolute path of the folder being viewed, and the trail from the scan root. */
    path: string;
    display: string;
    crumbs: Array<{ name: string; path: string }>;
    node: DiskViewNode;
  };
  topFiles?: Array<{ path: string; size: number }>;
  categories?: Array<{ id: string; size: number; count: number }>;
  suggestions?: DiskSuggestion[];
}

export type KillMode = "quit" | "terminate" | "force";

export interface KillResult {
  ok: boolean;
  killed: number[];
  failed: Array<{ pid: number; reason: string }>;
  needsAdmin: boolean;
  message: string;
}
