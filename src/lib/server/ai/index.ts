import { realpath } from "node:fs/promises";
import { ProgressiveCache, taskQueue } from "./progressive";
import type { AIReport, AIUsage, AIAccount, AITotals, AIDiscoveredLogin } from "../../ai-types";
import { loadAccounts } from "./accounts";
import { discoverLogins } from "./discover";
import { fetchAccount } from "./providers";
import { sessionTotals, sessionsRoot } from "./sessions";

const quotas = new Map<
  string,
  { expires: number; promise: Promise<AIUsage>; lastGood?: AIUsage }
>();
const histories = new Map<string, { expires: number; promise: Promise<AITotals | undefined> }>();
function quota(a: AIAccount) {
  const key = JSON.stringify(a),
    old = quotas.get(key);
  if (old && old.expires > Date.now()) return old.promise;
  const entry = {
    expires: Date.now() + 120000,
    lastGood: old?.lastGood,
    promise: Promise.resolve(null as unknown as AIUsage),
  };
  entry.promise = fetchAccount(a).then((next) => {
    if (next.status === "ok") entry.lastGood = next;
    else if (entry.lastGood)
      return {
        ...entry.lastGood,
        checkedAt: next.checkedAt,
        status: next.status,
        stale: true,
        detail: next.detail,
      };
    return next;
  });
  if (quotas.size > 100) quotas.clear();
  quotas.set(key, entry);
  return entry.promise;
}
const reports = new ProgressiveCache<AIUsage>();
const discoveries = new ProgressiveCache<AIDiscoveredLogin[]>(30000, 20);
const runAccount = taskQueue(4);

export async function aiReport(days: number, limitsOnly = false): Promise<AIReport> {
  const accounts = await loadAccounts();
  const { resolved, roots } = await groupSessionRoots(accounts);
  const discovered = limitsOnly ? { value: [], pending: false } : discoveries.read(
    JSON.stringify(accounts), () => discoverLogins(accounts), [],
  );
  let pending = discovered.pending;
  const result = accounts.map(a => {
    const root = resolved.get(a.id);
    const shared = root ? roots.get(root)! : [];
    const duplicate = shared.length > 1 && shared[0].id !== a.id;
    const key = `${JSON.stringify(a)}:${days}:${limitsOnly}:${shared.map(a => a.id).join(",")}`;
    const entry = reports.read(key, () => runAccount(async () => {
      try {
        const historyKey = `${JSON.stringify(a)}:${days}:${Boolean(duplicate)}`;
        let history = histories.get(historyKey);
        if (!limitsOnly && (!history || history.expires <= Date.now())) {
          if (histories.size > 200) histories.clear();
          history = {
            expires: Date.now() + 120000,
            promise: a.source === "local" && !duplicate
              ? sessionTotals(a, days).catch(() => undefined)
              : Promise.resolve(undefined),
          };
          histories.set(historyKey, history);
        }
        const [usage, totals] = await Promise.all([quota(a), limitsOnly ? undefined : history?.promise]);
        return {
          ...usage,
          totals: totals ? { ...totals, ...(shared.length > 1 ? { sharedAccounts: shared.map(a => a.label) } : {}) } : usage.totals,
          lines: [...usage.lines, ...(shared.length > 1 ? [{ label: "Shared history", value: duplicate ? `Counted once under ${shared[0].label}; these sessions cannot be split by subscription.` : "These token and cost totals combine accounts sharing this folder." }] : [])],
        };
      } catch {
        return { account: a, status: "error" as const, checkedAt: new Date().toISOString(), windows: [], lines: [], detail: "Could not read usage. Try checking again." };
      }
    }), { account: a, status: "loading", checkedAt: new Date().toISOString(), windows: [], lines: [] });
    pending ||= entry.pending;
    return entry.value;
  });
  return { accounts: result, discovered: discovered.value, pending };
}

export async function groupSessionRoots(accounts: AIAccount[]) {
  const resolved = new Map(await Promise.all(accounts.map(async a => {
    const root = a.source === "local" ? sessionsRoot(a) : undefined;
    return [a.id, root ? await realpath(root).catch(() => root) : undefined] as const;
  })));
  const roots = new Map<string, AIAccount[]>();
  for (const a of accounts) {
    const root = resolved.get(a.id);
    if (root) roots.set(root, [...(roots.get(root) ?? []), a]);
  }
  return { resolved, roots };
}
