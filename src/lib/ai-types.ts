export const AI_PROVIDERS = [
  "claude",
  "codex",
  "opencode",
  "pi",
  "cursor",
  "antigravity",
  "grok",
  "custom",
] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];
export const AI_NAMES: Record<AIProvider, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "Pi",
  cursor: "Cursor",
  antigravity: "Antigravity",
  grok: "Grok",
  custom: "Other provider",
};
export interface AIAccount {
  id: string;
  provider: AIProvider;
  label: string;
  /** Credential reference, never a token. Explicit accounts never fall back to a default login. */
  credentialPath?: string;
  usagePath?: string;
  sessionsPath?: string;
  source: "local" | "snapshot";
}
export interface AIWindow {
  label: string;
  usedPercent?: number;
  resetsAt?: string;
}
export interface AITotals {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd?: number;
  records: number;
  costRecords?: number;
  estimatedCostRecords?: number;
  since?: string;
  until?: string;
  truncated?: boolean;
  unpricedModels?: string[];
  sharedAccounts?: string[];
}
export interface AIUsage {
  account: AIAccount;
  status: "ok" | "needs-auth" | "unsupported" | "error" | "loading";
  checkedAt: string;
  updatedAt?: string;
  plan?: string;
  windows: AIWindow[];
  lines: { label: string; value: string }[];
  totals?: AITotals;
  detail?: string;
  stale?: boolean;
}
/** A login found on this Mac that can be connected in one step. Holds paths only, never tokens. */
export interface AIDiscoveredLogin {
  id: string;
  provider: AIProvider;
  label: string;
  folder: string;
  credentialPath?: string;
  sessionsPath?: string;
  isDefault: boolean;
  email?: string;
  plan?: string;
  /** App that created the folder, e.g. Sona. */
  via?: string;
  tracked: boolean;
}
export interface AIReport {
  accounts: AIUsage[];
  discovered?: AIDiscoveredLogin[];
  pending?: boolean;
}
