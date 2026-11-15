import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  HardDriveIcon,
  HistoryIcon,
  ListTreeIcon,
  MinusIcon,
  PowerIcon,
  SearchIcon,
  SettingsIcon,
  SquareIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Logo } from "@/components/systo/logo";
import { formatBytes, formatRate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CORES, MEMORY_TOTAL, type DemoGroup, type DemoState, type Section } from "../lib/demo";
import type { Platform } from "../lib/releases";
import { GlyphTile } from "./glyph";

type SortKey = "name" | "cpu" | "memory" | "disk" | "network";

const SECTIONS: Array<{ id: Section; label: string; hint: string }> = [
  { id: "apps", label: "Apps", hint: "Apps with windows you can see" },
  { id: "background", label: "Background", hint: "Helpers, dev tools and third-party services" },
  { id: "system", label: "System", hint: "Part of the operating system" },
];

const GRID = "grid grid-cols-[minmax(0,1fr)_76px_92px] sm:grid-cols-[minmax(0,1fr)_118px_76px_92px_86px_86px]";

/** Heat shading like the app: the busier the cell, the darker its ground. */
function heat(share: number) {
  const a = Math.min(0.5, Math.max(0, share) * 0.9);
  return a < 0.03 ? undefined : { backgroundColor: `color-mix(in oklch, var(--heat) ${Math.round(a * 100)}%, transparent)` };
}

function Cell({ value, share, className }: { value: string; share: number; className?: string }) {
  return (
    <span className={cn("flex items-center justify-end px-3 text-[12.5px] tnum", share > 0.28 && "text-background dark:text-background", className)} style={heat(share)}>
      {value}
    </span>
  );
}

function SideItem({ icon: Icon, label, active }: { icon: LucideIcon; label: string; active?: boolean }) {
  return (
    <span className={cn("flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px]", active ? "bg-accent font-medium" : "text-muted-foreground")}>
      <Icon className="size-4" strokeWidth={1.8} />
      {label}
    </span>
  );
}

/** A working replica of the Processes view: sort, search, expand. Example data. */
export function ProcessesReplica({ platform, demo }: { platform: Platform; demo: DemoState }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "cpu", dir: -1 });
  const [open, setOpen] = useState<Set<string>>(() => new Set(["Chrome"]));
  const mod = platform === "windows" ? "Ctrl+" : "⌘";

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (g: DemoGroup) => !q || g.name.toLowerCase().includes(q) || g.processes.some((p) => p.name.toLowerCase().includes(q) || String(p.pid) === q);
    const value = (g: DemoGroup) => (sort.key === "name" ? 0 : g[sort.key]);
    return SECTIONS.map((section) => ({
      section,
      groups: demo.groups
        .filter((g) => g.section === section.id && match(g))
        .sort((a, b) => (sort.key === "name" ? a.name.localeCompare(b.name) * sort.dir : (value(a) - value(b)) * sort.dir) || a.name.localeCompare(b.name)),
    })).filter((s) => s.groups.length);
  }, [demo.groups, query, sort]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const header = (key: SortKey, label: string, value: string, className?: string) => (
    <button
      type="button"
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 }))}
      className={cn("flex flex-col justify-end px-3 pb-2 text-right transition-colors hover:bg-accent/60", key === "name" && "items-start pl-4 text-left", className)}
      aria-label={`Sort by ${label}`}
    >
      {value && <span className="text-[15px] font-medium whitespace-nowrap tnum">{value}</span>}
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {sort.key === key && (sort.dir === -1 ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" />)}
        {label}
      </span>
    </button>
  );

  const totalDisk = demo.groups.reduce((s, g) => s + g.disk, 0);
  const totalNet = demo.netIn + demo.netOut;

  return (
    <div className="overflow-hidden rounded-xl border bg-background shadow-[0_40px_90px_-50px_rgb(0_0_0/0.45)]">
      {/* Title bar in the platform's own manner. */}
      <div className="flex h-9 items-center border-b bg-sidebar px-3.5">
        {platform === "macos" ? (
          <span className="flex gap-2" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-3 rounded-full bg-foreground/15" />
            ))}
          </span>
        ) : (
          <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Logo className="size-3.5" /> Systo
          </span>
        )}
        <span className="flex-1" />
        {platform === "windows" && (
          <span className="flex items-center gap-5 text-muted-foreground" aria-hidden>
            <MinusIcon className="size-3.5" />
            <SquareIcon className="size-3" />
            <XIcon className="size-3.5" />
          </span>
        )}
      </div>
      <div className="flex h-[500px]">
        <aside className="hidden w-[184px] shrink-0 flex-col border-r bg-sidebar p-2 md:flex" aria-hidden>
          <span className="flex h-11 items-center gap-2 px-2.5 text-[14px] font-medium">
            <Logo className="size-5" /> Systo
          </span>
          <SideItem icon={ListTreeIcon} label="Processes" active />
          <SideItem icon={ActivityIcon} label="Performance" />
          <SideItem icon={HistoryIcon} label="History" />
          <SideItem icon={PowerIcon} label="Startup" />
          <SideItem icon={HardDriveIcon} label="Disk" />
          <span className="mt-auto space-y-2.5 px-2.5 pb-2 text-[11px]">
            <span className="flex justify-between">
              <span className="text-muted-foreground">CPU</span>
              <span className="tnum">{Math.round(demo.cpu)}%</span>
            </span>
            <span className="flex justify-between">
              <span className="text-muted-foreground">Memory</span>
              <span className="tnum">{formatBytes(demo.memoryUsed)}</span>
            </span>
          </span>
          <SideItem icon={SettingsIcon} label="Settings" />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
            <span className="hidden text-[15px] font-medium sm:inline">Processes</span>
            <label className="relative flex-1 sm:max-w-[240px]">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or PID"
                aria-label="Search the example processes"
                className="h-8 w-full rounded-md border bg-transparent pr-12 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
              />
              <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-muted px-1 font-sans text-[10px] text-muted-foreground">{mod}F</kbd>
            </label>
          </div>
          <div className={cn(GRID, "h-[54px] shrink-0 border-b")} role="row">
            {header("name", "Name", "")}
            <span className="hidden items-end px-3 pb-2 text-[11px] text-muted-foreground sm:flex">Type</span>
            {header("cpu", "CPU", `${Math.round(demo.cpu)}%`)}
            {header("memory", "Memory", `${Math.round((demo.memoryUsed / MEMORY_TOTAL) * 100)}%`)}
            {header("disk", "Disk", formatRate(totalDisk), "hidden sm:flex")}
            {header("network", "Network", formatRate(totalNet), "hidden sm:flex")}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" role="grid" aria-label="Example processes">
            {rows.length === 0 && <p className="py-16 text-center text-[13px] text-muted-foreground">No matches for “{query}”.</p>}
            {rows.map(({ section, groups }) => (
              <div key={section.id}>
                <div className="flex h-8 items-center gap-2 border-b border-border/60 px-3 pt-1.5">
                  <ChevronDownIcon className="size-3.5 text-muted-foreground" />
                  <span className="text-[12px] font-medium">{section.label}</span>
                  <span className="text-[11px] text-muted-foreground tnum">({groups.length})</span>
                  <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">{section.hint}</span>
                </div>
                {groups.map((g) => {
                  const multi = g.processes.length > 1;
                  const expanded = multi && (open.has(g.id) || Boolean(query));
                  return (
                    <div key={g.id}>
                      <div className={cn(GRID, "h-9 border-b border-border/50 transition-colors hover:bg-accent/50")} role="row">
                        <button
                          type="button"
                          disabled={!multi}
                          onClick={() => toggle(g.id)}
                          aria-expanded={multi ? expanded : undefined}
                          className="flex min-w-0 items-center gap-2 pr-3 pl-2 text-left disabled:cursor-default"
                        >
                          <span className={cn("flex size-5 shrink-0 items-center justify-center text-muted-foreground", !multi && "invisible")}>
                            {expanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
                          </span>
                          <GlyphTile glyph={g.glyph} />
                          <span className="truncate text-[13px] font-[450]">{g.name}</span>
                          {multi && <span className="shrink-0 text-[11px] text-muted-foreground tnum">({g.processes.length})</span>}
                        </button>
                        <span className="hidden items-center truncate px-3 text-[11px] text-muted-foreground sm:flex">{g.kind}</span>
                        <Cell value={`${(g.cpu / CORES).toFixed(1)}%`} share={g.cpu / (CORES * 18)} />
                        <Cell value={formatBytes(g.memory)} share={g.memory / 4e9} />
                        <Cell value={formatRate(g.disk)} share={g.disk / 4e6} className="hidden sm:flex" />
                        <Cell value={formatRate(g.network)} share={g.network / 6e5} className="hidden sm:flex" />
                      </div>
                      {expanded &&
                        g.processes.map((p, i) => (
                          <div key={p.pid} className={cn(GRID, "h-8", i === g.processes.length - 1 && "border-b border-border/50")} role="row">
                            <span className="relative flex min-w-0 items-center gap-2 pr-3 pl-[38px]">
                              <span className={cn("absolute top-0 left-[19px] w-px bg-border", i === g.processes.length - 1 ? "h-1/2" : "h-full")} />
                              <span className="absolute top-1/2 left-[19px] h-px w-3 bg-border" />
                              <span className="truncate text-[12px] text-foreground/90">{p.name}</span>
                              <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{p.pid}</span>
                            </span>
                            <span className="hidden sm:block" />
                            <Cell value={`${(p.cpu / CORES).toFixed(1)}%`} share={0} />
                            <Cell value={formatBytes(p.memory)} share={0} />
                            <span className="hidden sm:block" />
                            <span className="hidden sm:block" />
                          </div>
                        ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex h-8 shrink-0 items-center gap-4 border-t px-4 text-[11px] text-muted-foreground tnum">
            <span>Example data</span>
            <span className="hidden sm:inline">
              Memory {formatBytes(demo.memoryUsed)} of {formatBytes(MEMORY_TOTAL, 0)}
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-foreground/60" /> Live · every 1.5s
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
