import type { AIProvider, AIWindow, AIUsage, AITotals } from "../../ai-types";
export const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
export const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
export const num = (v: unknown): number | undefined =>
  (typeof v === "number" || (typeof v === "string" && v.trim())) &&
  Number.isFinite(Number(v)) &&
  Number(v) >= 0
    ? Number(v)
    : undefined;
export function iso(v: unknown): string | undefined {
  const d = typeof v === "number" ? new Date(v) : typeof v === "string" ? new Date(v) : null;
  return d && Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
}
type Parsed = Pick<AIUsage, "windows" | "lines" | "plan" | "totals" | "updatedAt">;
export function parseUsage(provider: AIProvider, value: unknown, now = Date.now()): Parsed {
  const root = record(value);
  const windows: AIWindow[] = [];
  const lines: AIUsage["lines"] = [];
  const add = (label: string, percent: unknown, reset: unknown) => {
    const n = num(percent);
    const resetsAt = iso(reset);
    if (n !== undefined || resetsAt)
      windows.push({
        label,
        usedPercent: n === undefined ? undefined : Math.min(100, n),
        resetsAt,
      });
  };
  let plan = str(root.plan_type) || str(root.plan);
  if (provider === "codex") {
    const limits = record(root.rate_limit);
    for (const [key, fallback] of [
      ["primary_window", "5 hours"],
      ["secondary_window", "Weekly"],
    ]) {
      const w = record(limits[key]);
      const seconds = num(w.limit_window_seconds);
      const label =
        seconds === undefined
          ? fallback
          : seconds === 604800
            ? "Weekly"
            : seconds === 18000
              ? "5 hours"
              : `${Math.round(seconds / 3600)} hours`;
      const reset = num(w.reset_at);
      const after = num(w.reset_after_seconds);
      add(
        label,
        w.used_percent,
        reset !== undefined ? reset * 1000 : after !== undefined ? now + after * 1000 : undefined,
      );
    }
    const credits = record(root.credits);
    if (credits.unlimited === true) lines.push({ label: "Credits", value: "Unlimited" });
    else if (num(credits.balance) !== undefined)
      lines.push({ label: "Credits remaining", value: String(credits.balance) });
  } else if (provider === "claude") {
    for (const [key, label] of [
      ["five_hour", "5 hours"],
      ["seven_day", "Weekly"],
      ["seven_day_opus", "Weekly · Opus"],
      ["seven_day_sonnet", "Weekly · Sonnet"],
    ]) {
      const w = record(root[key]);
      add(label, w.utilization, w.resets_at);
    }
    for (const entry of Array.isArray(root.limits) ? root.limits : []) {
      const w = record(entry);
      if (w.kind === "weekly_scoped")
        add(
          `Weekly · ${str(record(record(w.scope).model).display_name) || "Model"}`,
          w.utilization,
          w.resets_at,
        );
    }
    const extra = record(root.extra_usage);
    if (extra.is_enabled === true && num(extra.used_credits) !== undefined)
      lines.push({
        label: "Extra usage (USD)",
        value: `$${(Number(extra.used_credits) / 100).toFixed(2)}`,
      });
  } else if (provider === "opencode") {
    plan = "Go";
    for (const [key, label] of [
      ["rolling", "5 hours"],
      ["weekly", "Weekly"],
      ["monthly", "Monthly"],
    ]) {
      const w = record(record(root.usage)[key]);
      add(label, w.percent, w.resetsAt);
    }
  } else if (provider === "cursor") {
    add("Billing cycle", record(root.planUsage).totalPercentUsed, num(root.billingCycleEnd));
    const spend = record(root.spendLimitUsage);
    const cap = num(spend.individualLimit),
      remaining = num(spend.individualRemaining);
    if (cap !== undefined && remaining !== undefined)
      lines.push({
        label: "On-demand (USD)",
        value: `$${(Math.max(0, cap - remaining) / 100).toFixed(2)} / $${(cap / 100).toFixed(2)}`,
      });
  } else if (provider === "grok") {
    const config = Object.keys(record(root.config)).length ? record(root.config) : root;
    const usage = record(root.usage || config.usage);
    const period = record(config.currentPeriod || root.currentPeriod);
    const amount = (v: unknown) => num(v) ?? num(record(v).val);
    const cap = amount(root.monthlyLimit ?? config.monthlyLimit),
      used = amount(usage.totalUsed);
    const fraction = num(config.creditUsagePercent ?? root.creditUsagePercent);
    add(
      /weekly/i.test(str(period.type) || "") || config.isUnifiedBillingUser === true
        ? "Weekly"
        : "Credits",
      fraction === undefined
        ? cap && used !== undefined
          ? (used / cap) * 100
          : undefined
        : fraction <= 1
          ? fraction * 100
          : fraction,
      period.end || config.billingPeriodEnd || root.billingPeriodEnd,
    );
    const demand = amount(config.onDemandUsed ?? root.onDemandUsed);
    if (demand !== undefined)
      lines.push({ label: "On-demand (USD)", value: `$${demand.toFixed(2)}` });
    plan = "SuperGrok";
  } else if (provider === "antigravity") {
    const buckets = Array.isArray(root.groups)
      ? root.groups.flatMap((g) =>
          Array.isArray(record(g).buckets) ? (record(g).buckets as unknown[]) : [],
        )
      : Array.isArray(root.buckets)
        ? root.buckets
        : [];
    const seen = new Set<string>();
    for (const entry of buckets) {
      const w = record(entry),
        label =
          (
            {
              "gemini-pro-5h": "Gemini Pro · 5 hours",
              "gemini-pro-weekly": "Gemini Pro · Weekly",
              "3p-5h": "Claude · 5 hours",
              "3p-weekly": "Claude · Weekly",
            } as Record<string, string>
          )[str(w.bucketId) || ""] ||
          str(w.bucketId) ||
          str(w.modelId) ||
          "Quota";
      if (seen.has(label)) continue;
      seen.add(label);
      const remaining = num(w.remainingFraction);
      add(
        label,
        remaining === undefined ? undefined : Math.max(0, 1 - remaining) * 100,
        w.resetTime,
      );
    }
  }
  return { windows, lines, plan };
}
/** A versioned bridge for tools without a quota API, and future providers. */
export function parseSnapshot(value: unknown): Parsed {
  const root = record(value);
  if (root.version !== 1 || !Array.isArray(root.windows) || !iso(root.updatedAt))
    throw new Error("Use a version 1 usage snapshot with updatedAt and windows.");
  const windows = root.windows.slice(0, 30).map((entry): AIWindow => {
    const w = record(entry),
      n = num(w.usedPercent);
    if (!str(w.label) || (w.usedPercent !== undefined && (n === undefined || n > 100)))
      throw new Error("Invalid quota window.");
    return { label: str(w.label)!.slice(0, 100), usedPercent: n, resetsAt: iso(w.resetsAt) };
  });
  let totals: AITotals | undefined;
  if (root.totals) {
    const t = record(root.totals);
    if (num(t.inputTokens) === undefined || num(t.outputTokens) === undefined)
      throw new Error("Snapshot totals need inputTokens and outputTokens.");
    totals = {
      inputTokens: num(t.inputTokens)!,
      outputTokens: num(t.outputTokens)!,
      cachedTokens: num(t.cachedTokens) ?? 0,
      costUsd: num(t.costUsd),
      records: num(t.records) ?? 0,
      since: iso(t.since),
      until: iso(t.until),
    };
  }
  return {
    windows,
    lines: [],
    plan: str(root.plan)?.slice(0, 100),
    updatedAt: iso(root.updatedAt),
    totals,
  };
}
