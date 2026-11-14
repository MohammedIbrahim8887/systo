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

export type KillMode = "quit" | "terminate" | "force";

export interface KillResult {
  ok: boolean;
  killed: number[];
  failed: Array<{ pid: number; reason: string }>;
  needsAdmin: boolean;
  message: string;
}
