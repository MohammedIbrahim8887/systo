"use client";
import type { AIReport } from "@/lib/ai-types";
import { accountStatus, resetText } from "@/lib/ai-display";
import { Skeleton } from "@/components/ui/skeleton";

const dollars = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: n > 0 && n < 0.01 ? 4 : 2 }).format(n);
const tokens = (n: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);

export function IslandAI({ report, error }: { report: AIReport | null; error: string | null }) {
  return (
    <div className="scrollbar-thin mt-2 min-h-0 flex-1 overflow-y-auto" aria-label="AI account usage">
      {error && <p role="alert" className="py-2 text-xs text-white/75">Could not refresh usage. Retrying automatically.</p>}
      {!report && !error && <div role="status" aria-label="Loading AI usage" className="space-y-3 py-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 bg-white/10" />)}</div>}
      {report?.accounts.length === 0 && <p className="py-8 text-center text-xs text-white/70">Add AI accounts in Systo to see their usage here.</p>}
      <ul className="divide-y divide-white/10">
        {report?.accounts.map(usage => {
          const status = accountStatus(usage);
          const totals = usage.totals;
          const partial = totals?.truncated || (totals?.costRecords !== undefined && totals.costRecords < totals.records);
          return (
            <li key={usage.account.id} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-xs font-medium text-white">{usage.account.label}</span>
                <span className="shrink-0 text-[10px] text-white/70">{status.label}</span>
              </div>
              {usage.status === "loading" ? <Skeleton className="my-2 h-4 bg-white/10" /> : usage.windows.length ? (
                <div className="mt-2 space-y-2">
                  {usage.windows.map((w, i) => {
                    const remaining = w.usedPercent === undefined ? undefined : Math.max(0, 100 - w.usedPercent);
                    return <div key={`${w.label}-${i}`}>
                      <div className="flex justify-between gap-2 text-[10px] text-white/75">
                        <span className="truncate">{w.label} · {resetText(w.resetsAt)}</span>
                        <span className="shrink-0 tabular text-white">{remaining === undefined ? "Not reported" : `${Math.round(remaining)}% left`}</span>
                      </div>
                      <div className="mt-1 h-1 rounded-full bg-white/15" role="progressbar" aria-label={`${usage.account.label} ${w.label} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining}>
                        <div className="h-full rounded-full bg-[color-mix(in_oklab,var(--island-tint)_85%,transparent)]" style={{ width: `${remaining ?? 0}%` }} />
                      </div>
                    </div>;
                  })}
                </div>
              ) : <p className="mt-1 text-[10px] text-white/65">{usage.status === "needs-auth" ? "Sign in to this account to check limits." : "No subscription limits reported."}</p>}
              {totals && <p className="mt-2 text-[10px] tabular text-white/65">
                {totals.sharedAccounts && "Shared history · "}
                {tokens(totals.inputTokens + totals.outputTokens)} tokens · {usage.account.source === "snapshot" ? "snapshot period" : "30 days"}
                {totals.costUsd !== undefined && ` · ${dollars(totals.costUsd)}${partial ? "+" : ""} ${totals.estimatedCostRecords ? "API est." : "reported"}`}
              </p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
