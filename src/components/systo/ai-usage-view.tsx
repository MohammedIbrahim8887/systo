"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircleIcon,
  ChevronDownIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSettings } from "@/lib/client/settings";
import { usePoll } from "@/lib/client/use-poll";
import { AI_NAMES, AI_PROVIDERS, type AIAccount, type AIDiscoveredLogin, type AIReport, type AIUsage, type AIWindow } from "@/lib/ai-types";
import { PROVIDER_LOGIN, accountStatus, folderForAccount, pace, paceText, resetText, tightestWindow, type AccountTone } from "@/lib/ai-display";
import { cn } from "@/lib/utils";
import { ConnectDialog, accountFromLogin, saveAccount, type ConnectRequest } from "./ai-connect-dialog";
import { ProviderMark } from "./ai-provider-mark";

const PERIODS = [
  { days: 1, short: "24h", long: "last 24 hours" },
  { days: 7, short: "7d", long: "last 7 days" },
  { days: 30, short: "30d", long: "last 30 days" },
  { days: 90, short: "90d", long: "last 90 days" },
];
const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: n >= 1e6 ? 2 : 1 }).format(n);
const full = (n: number) => new Intl.NumberFormat().format(n);
const usd = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: n > 0 && n < 0.01 ? 4 : 2 }).format(n);

function StatusDot({ tone, className }: { tone: AccountTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        tone === "ok" && "bg-data",
        tone === "attention" && "bg-data ring-2 ring-data/20 animate-[systo-pulse_2s_ease-in-out_infinite]",
        tone === "error" && "border border-foreground bg-transparent",
        tone === "idle" && "bg-muted-foreground/40",
        className,
      )}
    />
  );
}

function Meter({ window: w }: { window: AIWindow }) {
  const used = w.usedPercent;
  const left = used === undefined ? undefined : Math.max(0, 100 - used);
  const p = pace(w);
  const note = paceText(p);
  const critical = used !== undefined && used >= 85;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12px] text-muted-foreground">{w.label}</span>
        <span className="tabular shrink-0 text-[12px]">
          {left === undefined ? (
            <span className="text-muted-foreground">Not reported</span>
          ) : (
            <>
              <span className={cn("text-[15px] font-semibold tracking-tight", critical && "underline decoration-2 underline-offset-4")}>{Math.round(left)}%</span>
              <span className="text-muted-foreground"> left</span>
            </>
          )}
        </span>
      </div>
      <div
        className="relative mt-2 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${w.label} remaining`}
        aria-valuenow={left === undefined ? undefined : Math.round(left)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-700 ease-out",
            critical ? "bg-[repeating-linear-gradient(135deg,var(--data)_0_4px,color-mix(in_oklch,var(--data)_70%,transparent)_4px_8px)]" : "bg-data",
          )}
          style={{ width: `${left ?? 0}%` }}
        />
        {p && left !== undefined && left > 0 && left < 100 && (
          <span
            aria-hidden
            className="absolute inset-y-0 w-[3px] -translate-x-1/2 bg-background"
            style={{ left: `${100 - p.expectedUsed}%` }}
          >
            <span className="mx-auto block h-full w-px bg-muted-foreground" />
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate" title={w.resetsAt ? new Date(w.resetsAt).toLocaleString() : undefined}>
          {resetText(w.resetsAt)}
        </span>
        {note && (
          <span className={cn("truncate text-right", p?.runsOutIn !== undefined && "font-medium text-foreground")} title="The tick marks an even pace to the reset.">
            {note}
          </span>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hint, loading }: { label: string; value: string; hint?: string; loading?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
      <dd className="tabular mt-0.5 truncate text-[13px] font-medium" title={hint}>
        {loading ? <Skeleton className="mt-1 h-4 w-14" /> : value}
      </dd>
    </div>
  );
}

function AccountCard({
  usage,
  period,
  switching,
  onEdit,
  onRemove,
  onRetry,
}: {
  usage: AIUsage;
  period: string;
  switching: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const { account, totals } = usage;
  const status = accountStatus(usage);
  const [open, setOpen] = useState(false);
  const folder = account.source === "snapshot" ? account.usagePath : folderForAccount(account) ?? account.credentialPath;
  const partialCost = Boolean(totals?.truncated || (totals?.costRecords !== undefined && totals.costRecords < totals.records));
  return (
    <article className="rounded-xl border bg-card" aria-label={account.label}>
      <header className="flex items-start gap-3 px-4 pt-3.5">
        <ProviderMark provider={account.provider} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-[13.5px] font-medium">{account.label}</h3>
            {usage.plan && <span className="shrink-0 rounded border px-1.5 py-px text-[10.5px] text-muted-foreground capitalize">{usage.plan}</span>}
          </div>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <StatusDot tone={status.tone} />
            <span className="shrink-0">{status.label}</span>
            {folder && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate font-mono text-[11px]">{folder}</span>
              </>
            )}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="-mr-1.5 -mt-0.5 size-7" aria-label={`Actions for ${account.label}`}>
              <MoreHorizontalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={onEdit}>
              <PencilIcon /> Edit account
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRetry}>
              <RefreshCwIcon /> Check now
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRemove}>
              <Trash2Icon /> Remove from Systo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {usage.status === "loading" && <div role="status" aria-label={`Loading ${account.label}`} className="space-y-3 px-4 pt-4"><Skeleton className="h-2 w-full" /><Skeleton className="h-4 w-40" /></div>}
      {(usage.status === "needs-auth" || (usage.status === "error" && usage.detail)) && (
        <div className="mx-4 mt-3 flex items-start gap-2.5 rounded-lg bg-muted/70 px-3 py-2.5 text-[12px]" role="status">
          <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
          <div className="min-w-0 flex-1 leading-relaxed">
            <p className="font-medium">{usage.status === "needs-auth" ? "Sign in to see limits" : "Couldn't check this account"}</p>
            <p className="text-muted-foreground">
              {usage.detail}
              {usage.status === "needs-auth" && account.source === "local" ? ` ${PROVIDER_LOGIN[account.provider].signIn}` : ""}
            </p>
          </div>
          <Button size="xs" variant="outline" className="shrink-0 bg-background" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
      {usage.status === "unsupported" && usage.detail && (
        <p className="mx-4 mt-3 text-[12px] leading-relaxed text-muted-foreground">{usage.detail}</p>
      )}

      {usage.windows.length > 0 && (
        <div className="grid gap-x-6 gap-y-4 px-4 pt-4 sm:grid-cols-2 xl:grid-cols-3">
          {usage.windows.map((w, i) => (
            <Meter key={`${w.label}-${i}`} window={w} />
          ))}
        </div>
      )}

      {usage.lines.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {usage.lines.map((line, i) => (
            <span key={i} className="rounded-md bg-muted/70 px-2 py-1 text-[11.5px]">
              <span className="text-muted-foreground">{line.label} </span>
              <span className="tabular font-medium">{line.value}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 border-t px-4 py-3">
        {totals?.sharedAccounts && <p className="mb-2 text-[11px] text-muted-foreground">Combined history: {totals.sharedAccounts.join(" + ")}. Counted once.</p>}
        {totals && partialCost && <p className="mb-2 text-[11px] text-muted-foreground">Partial total · {totals.costRecords ?? 0} of {totals.records} responses priced{totals.truncated ? "; history scan incomplete" : ""}</p>}
        {totals ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Stat label="Input tokens" value={compact(totals.inputTokens)} hint={`${full(totals.inputTokens)} tokens, including cache`} loading={switching} />
            <Stat label="Output tokens" value={compact(totals.outputTokens)} hint={full(totals.outputTokens)} loading={switching} />
            <Stat label="Cache reads" value={compact(totals.cachedTokens)} hint={full(totals.cachedTokens)} loading={switching} />
            <Stat
              label={totals.estimatedCostRecords ? "API value (est.)" : "Spend"}
              value={totals.costUsd === undefined ? "—" : `${usd(totals.costUsd)}${partialCost ? "+" : ""}`}
              hint={totals.estimatedCostRecords ? "Public API list prices. Not a subscription charge." : undefined}
              loading={switching}
            />
          </dl>
        ) : usage.status === "loading" ? <Skeleton className="h-5 w-40" /> : (
          <p className="text-[11.5px] text-muted-foreground">
            {usage.lines.some((line) => line.label === "Shared history") ? "See the shared history total above; individual account attribution is unavailable." : account.source === "local" && PROVIDER_LOGIN[account.provider].sessions
              ? "No token history for this login. Set its token history folder to see tokens and cost."
              : "This provider doesn't record token history locally."}
          </p>
        )}
        <button
          type="button"
          className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDownIcon className={cn("size-3 transition-transform", !open && "-rotate-90")} />
          Checked {new Date(usage.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          {totals && account.source === "local" ? ` · ${full(totals.records)} responses, ${period}` : ""}
        </button>
        {open && (
          <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
            <li>{AI_NAMES[account.provider]} · {account.source === "snapshot" ? "usage snapshot file" : account.credentialPath ? "separate login" : "default login"}</li>
            {account.credentialPath && <li className="font-mono">Login: {account.credentialPath}</li>}
            {account.sessionsPath && <li className="font-mono">History: {account.sessionsPath}</li>}
            {usage.stale && usage.updatedAt && <li>Saved values from {new Date(usage.updatedAt).toLocaleString()}.</li>}
            {totals?.estimatedCostRecords ? <li>API value uses public list prices; it is not what your subscription costs.</li> : null}
            {totals?.unpricedModels?.length ? <li>No matching price for: {totals.unpricedModels.join(", ")}. These responses are excluded from the dollar total.</li> : null}
            {partialCost && <li>Some responses had no reported cost or matching price, so cost is a lower bound.</li>}
            {totals?.truncated && <li>Scan limit reached; totals are partial.</li>}
            {account.source === "snapshot" && totals?.since && (
              <li>
                Snapshot period {new Date(totals.since).toLocaleDateString()}
                {totals.until ? ` – ${new Date(totals.until).toLocaleDateString()}` : ""}.
              </li>
            )}
          </ul>
        )}
      </div>
    </article>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-xl border px-4 py-3.5" aria-hidden>
      <div className="flex items-center gap-3">
        <Skeleton className="size-8" />
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-3 w-52" />
        </div>
      </div>
      <div className="mt-5 grid gap-6 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-between">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-12" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-2.5 w-24" />
          </div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-4 gap-6 border-t pt-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-2.5 w-14" />
            <Skeleton className="h-3.5 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div role="status" aria-label="Loading AI usage">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 bg-background px-4 py-3.5">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-2.5 w-28" />
          </div>
        ))}
      </div>
      <div className="mt-8 space-y-3">
        <Skeleton className="h-3 w-24" />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}

function Overview({ usages, days, switching }: { usages: AIUsage[]; days: number; switching: boolean }) {
  const period = PERIODS.find((p) => p.days === days)!;
  const attention = usages.filter((u) => accountStatus(u).tone !== "ok" && accountStatus(u).tone !== "idle").length;
  const tight = tightestWindow(usages);
  const withTotals = usages.filter((u) => u.account.source === "local" && u.totals);
  const tokens = withTotals.reduce((n, u) => n + u.totals!.inputTokens + u.totals!.outputTokens, 0);
  const cost = withTotals.reduce((n, u) => n + (u.totals!.costUsd ?? 0), 0);
  const estimated = withTotals.some((u) => u.totals!.estimatedCostRecords);
  const partial = withTotals.some((u) => u.totals!.truncated || (u.totals!.costRecords !== undefined && u.totals!.costRecords! < u.totals!.records));
  const cells = [
    {
      label: "Accounts",
      value: String(usages.length),
      note: attention ? `${attention} need${attention === 1 ? "s" : ""} attention` : `${usages.filter((u) => accountStatus(u).tone === "ok").length} reporting limits`,
    },
    {
      label: "Closest to limit",
      value: tight ? `${Math.round(100 - tight.window.usedPercent!)}% left` : "—",
      note: tight ? `${tight.usage.account.label} · ${tight.window.label}` : "No limits reported yet",
    },
    { label: `Tokens · ${period.short}`, value: compact(tokens), note: `${withTotals.length} with local history`, loading: switching },
    {
      label: `${estimated ? "API value" : "Spend"} · ${period.short}`,
      value: withTotals.some((u) => u.totals?.costUsd !== undefined) ? `${usd(cost)}${partial ? "+" : ""}` : "—",
      note: partial ? "Partial total · see account details" : estimated ? "At public API prices" : "Reported by providers",
      loading: switching,
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="min-w-0 bg-background px-4 py-3.5">
          <dt className="truncate text-[11px] text-muted-foreground">{c.label}</dt>
          <dd className="tabular mt-1 truncate text-[20px] font-semibold tracking-tight">
            {c.loading ? <Skeleton className="my-1 h-5 w-16" /> : c.value}
          </dd>
          <dd className="mt-0.5 truncate text-[11px] text-muted-foreground" title={c.note}>
            {c.note}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FoundLogins({ logins, onConnect, onDismiss }: { logins: AIDiscoveredLogin[]; onConnect: (l: AIDiscoveredLogin) => void; onDismiss: (l: AIDiscoveredLogin) => void }) {
  return (
    <section className="rounded-xl border border-dashed px-4 py-3" aria-label="Logins found on this Mac">
      <div className="flex items-center gap-2 text-[12px]">
        <SparklesIcon className="size-3.5" />
        <span className="font-medium">
          {logins.length === 1 ? "Found another login on this Mac" : `Found ${logins.length} more logins on this Mac`}
        </span>
      </div>
      <ul className="mt-2 divide-y">
        {logins.map((l) => (
          <li key={l.id} className="flex items-center gap-3 py-2">
            <ProviderMark provider={l.provider} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium">{l.label}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {[l.email, l.via ? `from ${l.via}` : undefined, l.folder].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Button size="xs" variant="outline" onClick={() => onConnect(l)}>
              Connect
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-xs" variant="ghost" aria-label={`Dismiss ${l.label}`} onClick={() => onDismiss(l)}>
                  <XIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Don&apos;t suggest</TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AIUsageView() {
  const [days, setDays] = useState(30);
  const [loadedDays, setLoadedDays] = useState<number | null>(null);
  const [connect, setConnect] = useState<ConnectRequest | null>(null);
  const [removing, setRemoving] = useState<AIAccount | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const { settings, update } = useSettings();
  const dismissed = settings.dismissedLogins;
  const [pollMs, setPollMs] = useState(1000);
  const { data, error, refresh } = usePoll<AIReport>(`/api/ai-usage?days=${days}`, pollMs);
  useEffect(() => { if (data) setPollMs(data.pending ? 1000 : 60000); }, [data?.pending]);

  useEffect(() => {
    if (!data) return;
    setLoadedDays(days);
    setRefreshing(false);
    // Only a new response marks the selected period as loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  useEffect(() => {
    if (error) setRefreshing(false);
  }, [error]);

  const switching = Boolean(data) && loadedDays !== days;
  const period = PERIODS.find((p) => p.days === days)!;
  const usages = data?.accounts ?? [];
  const logins = data?.discovered ?? [];
  const suggestions = logins.filter((l) => !l.tracked && !dismissed.includes(l.id));
  const groups = useMemo(
    () =>
      AI_PROVIDERS.map((provider) => ({ provider, usages: usages.filter((u) => u.account.provider === provider) })).filter(
        (g) => g.usages.length > 0,
      ),
    [usages],
  );

  const reload = () => {
    setRefreshing(true);
    refresh();
  };
  const saved = (message: string) => {
    toast.success(message);
    reload();
  };
  async function quickConnect(login: AIDiscoveredLogin) {
    try {
      await saveAccount(accountFromLogin(login));
      saved(`Connected ${login.label}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  function dismiss(login: AIDiscoveredLogin) {
    update({ dismissedLogins: [...dismissed, login.id] });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-14 flex-wrap items-center gap-3 border-b px-5 py-2.5">
        <div className="min-w-0">
          <h1 className="text-[14px] font-medium">AI usage</h1>
          <p className="truncate text-[11.5px] text-muted-foreground">Subscription limits and local token spend</p>
        </div>
        <div className="flex-1" />
        <ToggleGroup type="single" variant="outline" size="sm" value={String(days)} onValueChange={(v) => v && setDays(Number(v))} aria-label="Token period">
          {PERIODS.map((p) => (
            <ToggleGroupItem key={p.days} value={String(p.days)} className="h-8 px-3 text-[12px]" aria-label={p.long}>
              {p.short}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" onClick={reload} aria-label="Refresh usage">
              <RefreshCwIcon className={cn("size-4", refreshing && "animate-spin")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh · provider checks are cached for 2 minutes</TooltipContent>
        </Tooltip>
        <Button size="sm" className="h-8 text-[12px]" onClick={() => setConnect({})}>
          <PlusIcon className="size-3.5" /> Add account
        </Button>
      </header>

      <section className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-6 px-5 py-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[12.5px]" role="alert">
              <AlertCircleIcon className="size-4 shrink-0" />
              <span className="flex-1">Couldn&apos;t load AI usage. {error}</span>
              <Button size="xs" variant="outline" onClick={reload}>
                Try again
              </Button>
            </div>
          )}
          {!data && !error && <LoadingState />}

          {data && usages.length === 0 && (
            <div className="mx-auto max-w-xl py-10 text-center">
              <div className="mx-auto flex w-fit -space-x-2">
                {(["claude", "codex", "cursor"] as const).map((p) => (
                  <ProviderMark key={p} provider={p} size="lg" className="bg-background ring-4 ring-background" />
                ))}
              </div>
              <h2 className="mt-5 text-[17px] font-semibold tracking-tight">Track every AI subscription in one place</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                See how much of each plan&apos;s 5-hour and weekly limits you have left, when they reset, and what your local sessions would
                cost at API prices. Connect work and personal accounts side by side.
              </p>
              <div className="mt-6 flex justify-center gap-2">
                <Button onClick={() => setConnect({})}>
                  <PlusIcon /> Add account
                </Button>
                {suggestions.length > 0 && (
                  <Button
                    variant="outline"
                    disabled={connecting}
                    onClick={async () => {
                      setConnecting(true);
                      let count = 0;
                      for (const l of suggestions) {
                        try { await saveAccount(accountFromLogin(l)); count++; }
                        catch (e) { toast.error(`${l.label}: ${(e as Error).message}`); }
                      }
                      if (count) saved(`Connected ${count} login${count === 1 ? "" : "s"}`);
                      setConnecting(false);
                    }}
                  >
                    Connect {suggestions.length} found login{suggestions.length === 1 ? "" : "s"}
                  </Button>
                )}
              </div>
            </div>
          )}

          {data && usages.length > 0 && <Overview usages={usages} days={days} switching={switching || usages.some((u) => u.status === "loading")} />}
          {data && suggestions.length > 0 && <FoundLogins logins={suggestions} onConnect={(l) => void quickConnect(l)} onDismiss={dismiss} />}

          {groups.map((group) => (
            <section key={group.provider} aria-label={`${AI_NAMES[group.provider]} accounts`}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{AI_NAMES[group.provider]}</h2>
                <span className="tabular text-[11px] text-muted-foreground/70">
                  {group.usages.length} account{group.usages.length === 1 ? "" : "s"}
                </span>
                <div className="flex-1" />
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => setConnect({ provider: group.provider })}
                >
                  <PlusIcon /> Add {AI_NAMES[group.provider]} account
                </Button>
              </div>
              <div className="space-y-3">
                {group.usages.map((usage) => (
                  <AccountCard
                    key={usage.account.id}
                    usage={usage}
                    period={period.long}
                    switching={switching}
                    onEdit={() => setConnect({ account: usage.account })}
                    onRemove={() => setRemoving(usage.account)}
                    onRetry={reload}
                  />
                ))}
              </div>
            </section>
          ))}

          {data && usages.length > 0 && (
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Limits follow each provider&apos;s own reset windows; the period switch only changes token and cost totals from local sessions. The
              tick on each bar marks an even pace to the next reset.
            </p>
          )}
        </div>
      </section>

      <ConnectDialog
        request={connect}
        logins={logins}
        accounts={usages.map((u) => u.account)}
        onClose={() => setConnect(null)}
        onSaved={saved}
      />
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Systo stops tracking this account. Nothing is signed out or deleted, and you can connect it again any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const account = removing!;
                try {
                  await saveAccount({ id: account.id }, "remove");
                  saved(`Removed ${account.label}`);
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
