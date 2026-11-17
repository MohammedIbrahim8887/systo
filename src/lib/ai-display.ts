import type { AIAccount, AIProvider, AIUsage, AIWindow } from "./ai-types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** How a provider lays out a login folder, so a folder alone is enough to connect an account. */
export const PROVIDER_LOGIN: Record<
  AIProvider,
  { folder?: string; credential?: string; sessions?: string; signIn: string }
> = {
  claude: { folder: "~/.claude", credential: ".credentials.json", sessions: "projects", signIn: "Run `claude` and sign in with /login." },
  codex: { folder: "~/.codex", credential: "auth.json", sessions: "sessions", signIn: "Run `codex login`." },
  pi: { folder: "~/.pi/agent", credential: "auth.json", sessions: "sessions", signIn: "Sign in from Pi with /login." },
  opencode: { folder: "~/.local/share/opencode", credential: "auth.json", signIn: "Run `opencode auth login`." },
  grok: { folder: "~/.grok", credential: "auth.json", signIn: "Sign in from the Grok CLI." },
  antigravity: { folder: "~/.gemini", credential: "antigravity-cli/oauth_creds.json", signIn: "Sign in from Antigravity." },
  cursor: { signIn: "Sign in from the Cursor app." },
  custom: { signIn: "Write a usage snapshot file from your exporter." },
};

export const PROVIDER_MONOGRAM: Record<AIProvider, string> = {
  claude: "Cl",
  codex: "Cx",
  opencode: "Oc",
  pi: "Pi",
  cursor: "Cu",
  antigravity: "Ag",
  grok: "Gk",
  custom: "··",
};

const join = (folder: string, file: string) => `${folder.replace(/\/+$/, "")}/${file}`;

/** Credential and sessions paths for a login folder. Default folders map to the default login. */
export function pathsForFolder(provider: AIProvider, folder: string): Pick<AIAccount, "credentialPath" | "sessionsPath"> {
  const spec = PROVIDER_LOGIN[provider];
  const trimmed = folder.trim().replace(/\/+$/, "");
  if (!trimmed || !spec.credential || trimmed === spec.folder) return {};
  return {
    credentialPath: join(trimmed, spec.credential),
    sessionsPath: spec.sessions ? join(trimmed, spec.sessions) : undefined,
  };
}

/** The folder an account's credential file sits in, for display and editing. */
export function folderForAccount(account: Pick<AIAccount, "provider" | "credentialPath">) {
  const spec = PROVIDER_LOGIN[account.provider];
  if (!account.credentialPath) return spec.folder;
  if (spec.credential && account.credentialPath.endsWith(`/${spec.credential}`))
    return account.credentialPath.slice(0, -spec.credential.length - 1);
  return undefined;
}

/** Length of a quota window inferred from its label; undefined when the label doesn't say. */
export function windowSpanMs(label: string): number | undefined {
  const l = label.toLowerCase();
  const hours = l.match(/(\d+(?:\.\d+)?)\s*(?:h|hour)/);
  if (hours) return Number(hours[1]) * HOUR;
  const days = l.match(/(\d+)\s*(?:d|day)/);
  if (days) return Number(days[1]) * DAY;
  if (/week/.test(l)) return 7 * DAY;
  if (/daily|\bday\b/.test(l)) return DAY;
  if (/month|billing/.test(l)) return 30 * DAY;
  return undefined;
}

export function duration(ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (minutes >= 1440) {
    const d = Math.floor(minutes / 1440);
    const h = Math.floor((minutes % 1440) / 60);
    return h ? `${d}d ${h}h` : `${d}d`;
  }
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${minutes}m`;
}

export function resetText(resetsAt: string | undefined, now = Date.now()) {
  if (!resetsAt) return "Reset time not reported";
  const delta = Date.parse(resetsAt) - now;
  return delta <= 0 ? "Resetting now" : `Resets in ${duration(delta)}`;
}

export interface Pace {
  /** Percent of the window that has elapsed, i.e. the even-spend "used" mark. */
  expectedUsed: number;
  status: "ahead" | "on-track" | "behind";
  /** Time until the limit runs out at the current rate, when that is before the reset. */
  runsOutIn?: number;
}

/** Spend pace for a window, comparing usage against an even burn to the reset. */
export function pace(w: AIWindow, now = Date.now()): Pace | undefined {
  const span = windowSpanMs(w.label);
  if (!span || !w.resetsAt || w.usedPercent === undefined) return undefined;
  const left = Date.parse(w.resetsAt) - now;
  if (!(left > 0) || left > span) return undefined;
  const elapsed = span - left;
  const expectedUsed = (elapsed / span) * 100;
  const diff = w.usedPercent - expectedUsed;
  const status = diff > 10 ? "ahead" : diff < -10 ? "behind" : "on-track";
  let runsOutIn: number | undefined;
  if (w.usedPercent > 0 && w.usedPercent < 100 && elapsed > 0) {
    const t = ((100 - w.usedPercent) / w.usedPercent) * elapsed;
    if (t < left) runsOutIn = t;
  }
  return { expectedUsed, status, runsOutIn };
}

export function paceText(p: Pace | undefined) {
  if (!p) return undefined;
  if (p.runsOutIn !== undefined) return `Runs out in ~${duration(p.runsOutIn)} at this rate`;
  return p.status === "ahead" ? "Using faster than an even pace" : p.status === "behind" ? "Well within pace" : "On pace";
}

export type AccountTone = "ok" | "attention" | "error" | "idle";

/** One status for the row chip, in the order that needs the user most. */
export function accountStatus(u: AIUsage): { tone: AccountTone; label: string } {
  if (u.status === "loading") return { tone: "idle", label: "Checking usage…" };
  if (u.status === "needs-auth") return { tone: "attention", label: "Sign-in needed" };
  if (u.status === "error") return { tone: "error", label: u.stale ? "Showing saved values" : "Unavailable" };
  if (u.status === "unsupported") return { tone: "idle", label: "Local usage only" };
  if (u.stale) return { tone: "attention", label: "Saved values" };
  const exhausted = u.windows.some((w) => (w.usedPercent ?? 0) >= 100);
  if (exhausted) return { tone: "error", label: "Limit reached" };
  const low = u.windows.some((w) => (w.usedPercent ?? 0) >= 85);
  return low ? { tone: "attention", label: "Running low" } : { tone: "ok", label: "Live" };
}

/** The window closest to its limit across every account. */
export function tightestWindow(usages: AIUsage[]) {
  let best: { usage: AIUsage; window: AIWindow } | undefined;
  for (const usage of usages)
    for (const window of usage.windows)
      if (window.usedPercent !== undefined && (!best || window.usedPercent > best.window.usedPercent!)) best = { usage, window };
  return best;
}
