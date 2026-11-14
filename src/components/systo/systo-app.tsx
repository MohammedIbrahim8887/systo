"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ActivityIcon, ListTreeIcon, SettingsIcon, type LucideIcon } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { SettingsProvider, useSettings } from "@/lib/client/settings";
import { usePoll } from "@/lib/client/use-poll";
import { formatBytes, formatPercent, formatRate } from "@/lib/format";
import type { Snapshot } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ActionsProvider } from "./actions";
import { AreaChart } from "./chart";
import { Logo } from "./logo";
import { PerformanceView } from "./performance-view";
import { ProcessesView } from "./processes-view";
import { SettingsDialog } from "./settings-dialog";

type View = "processes" | "performance";

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
  shortcut,
  children,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
  shortcut?: string;
  children?: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
            active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
        >
          <Icon className="size-4 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{label}</span>
          {children}
        </button>
      </TooltipTrigger>
      {shortcut && (
        <TooltipContent side="right">
          <Kbd>{shortcut}</Kbd>
        </TooltipContent>
      )}
    </Tooltip>
  );
}

function MiniMeter({ label, value, values, max }: { label: string; value: string; values: number[]; max?: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular text-foreground">{value}</span>
      </div>
      <div className="h-6 text-foreground/80">
        <AreaChart series={[{ values }]} max={max} capacity={40} strokeWidth={1} />
      </div>
    </div>
  );
}

function Shell() {
  const [view, setView] = useState<View>("processes");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { settings } = useSettings();
  const interval = settings.interval || 1500;
  const { data: snapshot, error, refresh } = usePoll<Snapshot>(`/api/snapshot?interval=${interval}`, interval, settings.interval === 0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey) return;
      if (event.key === "1") setView("processes");
      else if (event.key === "2") setView("performance");
      else if (event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const history = snapshot?.history ?? [];
  const totals = snapshot?.totals;

  return (
    <ActionsProvider onChanged={refresh}>
      <div className="flex h-screen min-h-0 overflow-hidden bg-background">
        <aside className="flex w-[188px] shrink-0 flex-col border-r bg-sidebar">
          <div className="flex h-14 items-center gap-2 px-4">
            <Logo className="size-5" />
            <span className="text-[14px] font-semibold tracking-tight">Systo</span>
          </div>
          <nav className="space-y-0.5 px-2">
            <NavItem icon={ListTreeIcon} label="Processes" active={view === "processes"} onClick={() => setView("processes")} shortcut="⌘1" />
            <NavItem icon={ActivityIcon} label="Performance" active={view === "performance"} onClick={() => setView("performance")} shortcut="⌘2" />
          </nav>

          <div className="mt-auto space-y-3 px-4 pb-3">
            {totals && (
              <div className="space-y-2.5">
                <MiniMeter label="CPU" value={formatPercent(totals.cpu, 0)} values={history.map((h) => h.cpu)} max={100} />
                <MiniMeter label="Memory" value={formatBytes(totals.memoryUsed)} values={history.map((h) => h.memory)} max={totals.memoryTotal} />
                <MiniMeter label="Network" value={formatRate(totals.netIn + totals.netOut)} values={history.map((h) => h.netIn + h.netOut)} />
              </div>
            )}
            {error && <p className="text-[11px] leading-snug text-muted-foreground">Can't reach the sampler: {error}</p>}
          </div>
          <div className="border-t px-2 py-2">
            <NavItem icon={SettingsIcon} label="Settings" onClick={() => setSettingsOpen(true)} shortcut="⌘," />
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          {view === "processes" ? <ProcessesView snapshot={snapshot} /> : <PerformanceView snapshot={snapshot} />}
        </main>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </ActionsProvider>
  );
}

export function SystoApp() {
  // Farm's SSR tree differs from the hydrated one, which skews Radix's useId-based ids.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-screen bg-background" />;

  return (
    <SettingsProvider>
      <TooltipProvider delayDuration={400}>
        <Shell />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </SettingsProvider>
  );
}
