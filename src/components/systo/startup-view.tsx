"use client";

import { OS, IS_WINDOWS } from "@/lib/platform";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CopyIcon, FolderOpenIcon, MoreHorizontalIcon, RefreshCwIcon, SearchIcon, SettingsIcon, ShieldIcon, SquareIcon } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePoll } from "@/lib/client/use-poll";
import { useSettings } from "@/lib/client/settings";
import { formatBytes, formatPercent } from "@/lib/format";
import type { StartupItem, StartupKind, StartupReport, StartupToggleResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AppIcon } from "./app-icon";

type Filter = "all" | "login" | "background" | "system";

const SECTIONS: Array<{ kind: StartupKind; title: string; hint: string }> = IS_WINDOWS
  ? [
      { kind: "login-item", title: "Your startup apps", hint: "Start when you sign in" },
      { kind: "agent", title: "For everyone on this PC", hint: "Start for every user; changes need administrator approval" },
    ]
  : [
  { kind: "login-item", title: "Open at login", hint: "Apps that open when you log in" },
  { kind: "login-helper", title: "Login helpers", hint: "Small helpers apps start at login, often to launch themselves" },
  { kind: "agent", title: "Background agents", hint: "Run in your session, usually updaters and sync tools" },
  { kind: "daemon", title: "System daemons", hint: "Run for the whole Mac, before anyone logs in" },
];

const FILTER_KINDS: Record<Filter, StartupKind[]> = {
  all: ["login-item", "login-helper", "agent", "daemon"],
  login: ["login-item", "login-helper"],
  background: ["agent"],
  system: ["daemon"],
};

const IMPACT_META: Record<StartupItem["impact"], { label: string; bars: number; hint: string }> = {
  high: { label: "High", bars: 3, hint: "Using a lot of memory or CPU right now" },
  medium: { label: "Medium", bars: 2, hint: "Noticeable memory or CPU, or kept running all the time" },
  low: { label: "Low", bars: 1, hint: "Running, but light" },
  none: { label: "None", bars: 0, hint: "Not running right now" },
};

function ImpactMeter({ impact }: { impact: StartupItem["impact"] }) {
  const meta = IMPACT_META[impact];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2">
          <div className="flex h-3.5 items-end gap-[2px]" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className={cn("w-[3px] rounded-[1px]", i < meta.bars ? "bg-foreground" : "bg-foreground/15")} style={{ height: `${40 + i * 30}%` }} />
            ))}
          </div>
          <span className={cn("text-[12px]", impact === "none" ? "text-muted-foreground" : "")}>{meta.label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>{meta.hint}</TooltipContent>
    </Tooltip>
  );
}

async function post(body: Record<string, unknown>): Promise<StartupToggleResult> {
  const res = await fetch("/api/startup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as StartupToggleResult;
}

function Row({
  item,
  pending,
  onToggle,
  colorIcons,
}: {
  item: StartupItem;
  pending: boolean;
  onToggle: (item: StartupItem, enabled: boolean) => void;
  colorIcons: boolean;
}) {
  const subtitle = [item.appName && item.appName !== item.name ? item.appName : null, item.developer].filter(Boolean).join(" · ");
  const revealPath = item.plistPath ?? item.bundlePath ?? item.program;
  return (
    <div className={cn("group/row grid grid-cols-[minmax(0,1fr)_128px_118px_92px_76px] items-center gap-3 px-3 py-2.5", !item.enabled && "text-muted-foreground")}>
      <div className="flex min-w-0 items-center gap-3">
        <AppIcon
          bundlePath={item.bundlePath}
          hasIcon={item.hasIcon}
          kind={item.kind === "daemon" ? "third-party-service" : item.kind === "agent" ? "user-service" : "app"}
          size={26}
          color={colorIcons}
          className={cn(!item.enabled && "opacity-50")}
        />
        <div className="min-w-0">
          <div className={cn("truncate text-[13px] font-medium", item.enabled ? "text-foreground" : "text-foreground/60")}>{item.name}</div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            {subtitle || item.label || item.program || "\u00a0"}
            {subtitle && item.label && <span className="font-mono text-[10.5px] text-muted-foreground/70"> · {item.label}</span>}
          </div>
        </div>
      </div>
      <div className="min-w-0 text-[12px] text-muted-foreground">
        <div className="truncate">{item.schedule}</div>
        {item.blockedBySettings && <div className="truncate text-[11px] text-muted-foreground/70">Off in System Settings</div>}
      </div>
      <div className="flex items-center gap-1.5 text-[12px]">
        {item.running ? (
          <>
            <span className="size-1.5 rounded-full bg-foreground" />
            <span className="tabular">{formatBytes(item.memory)}</span>
            {item.cpu >= 0.5 && <span className="tabular text-muted-foreground">· {formatPercent(item.cpu, 0)}</span>}
          </>
        ) : (
          <>
            <span className="size-1.5 rounded-full border border-foreground/30" />
            <span className="text-muted-foreground">Not running</span>
          </>
        )}
      </div>
      <ImpactMeter impact={item.impact} />
      <div className="flex items-center justify-end gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7 opacity-0 group-hover/row:opacity-100 data-[state=open]:opacity-100" aria-label={`More for ${item.name}`}>
              <MoreHorizontalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {revealPath && (
              <DropdownMenuItem
                onSelect={() => void fetch("/api/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: revealPath }) })}
              >
                <FolderOpenIcon /> {OS.reveal}
              </DropdownMenuItem>
            )}
            {item.label && (
              <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(item.label!).then(() => toast.success("Copied label"))}>
                <CopyIcon /> Copy label
              </DropdownMenuItem>
            )}
            {item.running && item.pids.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={async () => {
                    const res = await fetch("/api/end", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ pids: item.pids, mode: "terminate" }),
                    });
                    const result = (await res.json()) as { ok: boolean; message: string };
                    if (result.ok) toast.success(`Stopped ${item.name}`, { description: "It may start again if launchd keeps it alive." });
                    else toast.error(result.message);
                  }}
                >
                  <SquareIcon /> Stop now
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {item.blockedBySettings ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Switch checked={false} disabled aria-label={`${item.name} is turned off in System Settings`} />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-56">Turned off in System Settings › Login Items. Only Settings can turn it back on.</TooltipContent>
          </Tooltip>
        ) : (
          <Switch checked={item.enabled} disabled={pending} onCheckedChange={(v) => onToggle(item, v)} aria-label={`Start ${item.name} automatically`} />
        )}
      </div>
    </div>
  );
}

function Summary({ items }: { items: StartupItem[] }) {
  const enabled = items.filter((i) => i.enabled);
  const running = items.filter((i) => i.running);
  const memory = running.reduce((s, i) => s + i.memory, 0);
  const heavy = items.filter((i) => i.impact === "high" || i.impact === "medium");
  const stats = [
    { label: "Open at login", value: String(items.filter((i) => i.kind === "login-item" && i.enabled).length), hint: "apps" },
    { label: "Start automatically", value: String(enabled.length), hint: `of ${items.length} items` },
    { label: "Running now", value: String(running.length), hint: `${formatBytes(memory)} of memory` },
    { label: "Noticeable impact", value: String(heavy.length), hint: heavy.slice(0, 2).map((i) => i.name).join(", ") || "Nothing heavy" },
  ];
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="min-w-0">
          <div className="text-[11px] text-muted-foreground">{s.label}</div>
          <div className="tabular mt-0.5 text-[22px] leading-tight font-semibold tracking-tight">{s.value}</div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{s.hint}</div>
        </div>
      ))}
    </div>
  );
}

export function StartupView() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [rescanning, setRescanning] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [adminFor, setAdminFor] = useState<{ item: StartupItem; enabled: boolean } | null>(null);
  const { settings } = useSettings();
  const { data, error, refresh } = usePoll<StartupReport>("/api/startup", 20000);

  const items = useMemo(() => (data?.items ?? []).map((i) => (i.id in overrides ? { ...i, enabled: overrides[i.id] } : i)), [data, overrides]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        FILTER_KINDS[filter].includes(i.kind) &&
        (!q || [i.name, i.appName, i.developer, i.label, i.program].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [items, filter, query]);

  const apply = async (item: StartupItem, enabled: boolean, admin = false) => {
    setPending((p) => new Set(p).add(item.id));
    setOverrides((o) => ({ ...o, [item.id]: enabled }));
    try {
      const result = await post({ id: item.id, enabled, admin });
      if (result.needsAdmin) {
        setOverrides((o) => {
          const { [item.id]: _, ...rest } = o;
          return rest;
        });
        setAdminFor({ item, enabled });
        return;
      }
      if (result.ok) toast.success(item.name, { description: result.message });
      else {
        setOverrides((o) => ({ ...o, [item.id]: item.enabled }));
        toast.error(`Couldn't change ${item.name}`, { description: result.message });
      }
      refresh();
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(item.id);
        return next;
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="mr-1 text-[15px] font-semibold tracking-tight">Startup</h1>
        <div className="relative w-56">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search startup items" className="h-8 pl-8 text-[12.5px]" />
        </div>
        <ToggleGroup type="single" variant="outline" size="sm" value={filter} onValueChange={(v) => v && setFilter(v as Filter)}>
          <ToggleGroupItem value="all" className="h-8 px-3 text-[12px]">All</ToggleGroupItem>
          <ToggleGroupItem value="login" className="h-8 px-3 text-[12px]">Login</ToggleGroupItem>
          <ToggleGroupItem value="background" className="h-8 px-3 text-[12px]">Background</ToggleGroupItem>
          <ToggleGroupItem value="system" className="h-8 px-3 text-[12px]">System</ToggleGroupItem>
        </ToggleGroup>
        <div className="flex-1" />
        {!IS_WINDOWS && <Button variant="ghost" size="sm" disabled={rescanning} onClick={async () => {
          setRescanning(true);
          try {
            const response = await fetch("/api/startup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rescan" }) });
            if (!response.ok) throw new Error("Could not rescan helpers");
            refresh();
          } catch { toast.error("Could not rescan helpers"); }
          finally { setRescanning(false); }
        }} title="Discover registered helpers. macOS may ask for permission.">
          {rescanning ? "Scanning…" : "Rescan helpers"}
        </Button>}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" onClick={refresh} aria-label="Reload startup items">
              <RefreshCwIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reload</TooltipContent>
        </Tooltip>
        <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => void post({ action: "open-settings" })}>
          <SettingsIcon className="size-3.5" /> {IS_WINDOWS ? "Startup Apps Settings" : "Login Items Settings"}
        </Button>
      </header>

      <section className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-5">
        {!data && !error && (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-6">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
            <p className="pt-2 text-[12px] text-muted-foreground">Reading login items and background services…</p>
            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        )}
        {error && !data && <p className="text-[13px] text-muted-foreground">Couldn't read startup items: {error}</p>}

        {data && (
          <>
            <Summary items={items} />
            {!data.loginItemsReadable && (
              <div className="mt-5 flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[12px] text-muted-foreground">
                <ShieldIcon className="mt-0.5 size-3.5 shrink-0" />
                Allow Systo to control System Events (System Settings › Privacy & Security › Automation) to turn “Open at login” apps on and off.
              </div>
            )}

            {SECTIONS.filter((s) => FILTER_KINDS[filter].includes(s.kind)).map((section) => {
              const rows = visible.filter((i) => i.kind === section.kind);
              if (rows.length === 0) return null;
              return (
                <div key={section.kind} className="mt-7">
                  <div className="mb-2 flex items-baseline gap-2">
                    <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{section.title}</h3>
                    <span className="tabular text-[11px] text-muted-foreground/70">
                      {rows.filter((r) => r.enabled).length} of {rows.length} on
                    </span>
                    <span className="ml-auto truncate text-[11px] text-muted-foreground/70">{section.hint}</span>
                  </div>
                  <div className="rounded-xl border">
                    <div className="grid grid-cols-[minmax(0,1fr)_128px_118px_92px_76px] gap-3 border-b px-3 py-1.5 text-[11px] text-muted-foreground">
                      <span>Name</span>
                      <span>Starts</span>
                      <span>Status</span>
                      <span>Impact</span>
                      <span className="text-right">Enabled</span>
                    </div>
                    <div className="divide-y">
                      {rows.map((item) => (
                        <Row key={item.id} item={item} pending={pending.has(item.id)} onToggle={(i, v) => void apply(i, v)} colorIcons={settings.colorIcons} />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
            {visible.length === 0 && <p className="mt-10 text-center text-[13px] text-muted-foreground">No startup items match “{query}”.</p>}
            <p className="mt-6 text-[11.5px] leading-relaxed text-muted-foreground">
              Turning an item off stops it from starting automatically; it doesn't delete anything, and anything already running keeps
              running until you quit it or restart. {IS_WINDOWS ? "Windows services and scheduled tasks aren't listed." : "Apple's own services aren't listed."}
            </p>
          </>
        )}
      </section>

      <AlertDialog open={adminFor !== null} onOpenChange={(open) => !open && setAdminFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {adminFor?.enabled ? "Enable" : "Disable"} {adminFor?.item.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {IS_WINDOWS
                ? `This starts for every user on this PC, so Windows will ask for administrator approval. ${adminFor?.enabled ? "It will start the next time anyone signs in." : "It won't start at sign-in anymore."}`
                : `This is a system daemon, so macOS will ask for an administrator password. ${adminFor?.enabled ? "It will start the next time the Mac restarts." : "It won't start with the Mac anymore. Features that depend on it may stop working until you turn it back on."}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (adminFor) void apply(adminFor.item, adminFor.enabled, true);
                setAdminFor(null);
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
