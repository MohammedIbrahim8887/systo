"use client";
import { Skeleton } from "@/components/ui/skeleton";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRightIcon, CpuIcon, HardDriveIcon, MemoryStickIcon, WifiIcon, type LucideIcon } from "lucide-react";
import { usePoll } from "@/lib/client/use-poll";
import { createIslandDragHandlers } from "@/lib/client/island-drag";
import { bootSettings, saveSettings } from "@/lib/client/settings";
import { sendShellCommand } from "@/lib/client/shell";
import { formatBytes, formatRate } from "@/lib/format";
import { METRIC_META } from "@/lib/kinds";
import type { IslandData, Metric } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AppIcon } from "./app-icon";
import { Logo } from "./logo";
import { IslandAI } from "./island-ai";
import type { AIReport } from "@/lib/ai-types";
import { tightestWindow } from "@/lib/ai-display";

declare global {
  interface Window {
    __systoIsland?: { expanded: boolean };
  }
}

const METRICS: Array<{ id: Metric; icon: LucideIcon }> = [
  { id: "cpu", icon: CpuIcon },
  { id: "memory", icon: MemoryStickIcon },
  { id: "disk", icon: HardDriveIcon },
  { id: "network", icon: WifiIcon },
];

/** Expanded panel height below the notch; keep in sync with PANEL_EXTRA_HEIGHT in shell/island.ts. */
const ISLAND_PANEL_HEIGHT = 262;

const RING_LABEL: Record<Metric, string> = { cpu: "CPU", memory: "RAM", disk: "SSD", network: "NET" };

function Ring({ value, size, stroke, children }: { value: number; size: number; stroke: number; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.14} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--island-tint, currentColor)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped / 100)}
          style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.3, 0.9, 0.3, 1)" }}
        />
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  );
}

function ringDetail(metric: Metric, data: IslandData) {
  const t = data.totals;
  switch (metric) {
    case "cpu":
      return `${t.cores} cores`;
    case "memory":
      return formatBytes(t.memoryUsed, 0);
    case "disk":
      return `${formatBytes(Math.max(0, data.storage.total - data.storage.used), 0)} free`;
    case "network":
      return `↓ ${compactRate(t.netIn)}/s · ↑ ${compactRate(t.netOut)}/s`;
  }
}

function compactRate(bytes: number) {
  if (bytes < 1024) return `${Math.round(bytes)}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)}M`;
  return `${(bytes / 1024 ** 3).toFixed(1)}G`;
}

function formatValue(metric: Metric, value: number, cores: number) {
  if (metric === "cpu") return `${(value / cores).toFixed(value / cores < 10 ? 1 : 0)}%`;
  if (metric === "memory") return formatBytes(value);
  return formatRate(value);
}

function totalLabel(data: IslandData) {
  const t = data.totals;
  switch (data.metric) {
    case "cpu":
      return `${Math.round(t.cpu)}%`;
    case "memory":
      return `${Math.round((t.memoryUsed / t.memoryTotal) * 100)}%`;
    case "disk":
      return `${compactRate(t.diskRead + t.diskWrite)}/s`;
    case "network":
      return `↓ ${compactRate(t.netIn)}/s · ↑ ${compactRate(t.netOut)}/s`;
  }
}

/** Gap above the floating (Windows) pill; keep in sync with FLOAT_TOP in shell/island-win.ts. */
const FLOAT_TOP = 8;

export type IslandParams = Record<string, string | string[] | undefined>;

function readParam(params: IslandParams, name: string, fallback: number) {
  const value = Number(params[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function Island({ params = {} }: { params?: IslandParams }) {
  const geometry = {
    notchWidth: readParam(params, "nw", 0),
    notchHeight: readParam(params, "nh", 32),
    width: readParam(params, "w", 460),
    desktop: params.shell !== undefined,
    /** Windows: a floating pill below the top edge instead of one hanging from a notch. */
    floating: params.fl !== undefined,
  };
  const movable = geometry.desktop && geometry.floating;
  const dragEvents = useMemo(() => movable ? createIslandDragHandlers() : {}, [movable]);
  const grip = movable ? { "data-island-grip": true, title: "Drag to move the island" } : {};
  const [expanded, setExpanded] = useState(false);
  const [metric, setMetric] = useState<Metric>("cpu");
  const [showAI, setShowAI] = useState(false);
  const [aiPollMs, setAiPollMs] = useState(1000);

  useEffect(() => {
    const saved = bootSettings();
    setShowAI(saved.islandAI);
    setMetric(saved.islandMetric);
    const sync = () => setExpanded(Boolean(window.__systoIsland?.expanded));
    sync();
    window.addEventListener("systo:island", sync);
    return () => window.removeEventListener("systo:island", sync);
  }, []);

  const chooseMetric = (next: Metric) => {
    setMetric(next);
    void saveSettings({ islandMetric: next }).catch(() => {});
  };

  // Collapsed, the pill shows one number; a slower poll is plenty and lets the sampler idle down.
  const { data } = usePoll<IslandData>(`/api/island?metric=${metric}`, expanded ? 1000 : 3000, false, { whenHidden: true });
  const colorIcons = Boolean(data?.colorIcons);

  const { data: ai, error: aiError } = usePoll<AIReport>(showAI ? "/api/ai-usage?days=30" : null, aiPollMs, false, { whenHidden: true });
  useEffect(() => { if (ai) setAiPollMs(ai.pending ? 1000 : 60000); }, [ai?.pending]);
  const closest = ai ? tightestWindow(ai.accounts) : undefined;
  const aiLabel = closest ? `${Math.round(100 - closest.window.usedPercent!)}%` : ai?.pending ? "…" : "—";
  const toggleAI = (value: boolean) => {
    setShowAI(value);
    void saveSettings({ islandAI: value }).catch(() => {});
  };

  // The panel only exists while open (plus its fade-out), so a collapsed island isn't re-rendering
  // and animating rings and bars nobody can see.
  const [panel, setPanel] = useState<"hidden" | "mounted" | "visible">("hidden");
  useEffect(() => {
    if (expanded) {
      setPanel("mounted");
      let inner = 0;
      const outer = requestAnimationFrame(() => (inner = requestAnimationFrame(() => setPanel("visible"))));
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setPanel((p) => (p === "hidden" ? p : "mounted"));
    const timer = setTimeout(() => setPanel("hidden"), 260);
    return () => clearTimeout(timer);
  }, [expanded]);
  const shown = panel === "visible";

  const { notchWidth, notchHeight } = geometry;
  const wing = 62;
  const collapsedWidth = notchWidth > 0 ? notchWidth + wing * 2 : 220;
  const expandedWidth = Math.min(geometry.width - 20, 440);
  const expandedHeight = notchHeight + ISLAND_PANEL_HEIGHT;
  const top = data?.entries[0];
  const cores = data?.totals.cores ?? 1;
  const ActiveIcon = useMemo(() => METRICS.find((m) => m.id === metric)!.icon, [metric]);

  return (
    <div
      className="pointer-events-none fixed inset-0 flex justify-center overflow-hidden select-none"
      style={geometry.floating ? { paddingTop: FLOAT_TOP } : undefined}
    >
      <style>{`html,body{background:transparent!important;color-scheme:dark}`}</style>
      <div
        className="pointer-events-auto relative text-white"
        {...dragEvents}
        onMouseEnter={() => !geometry.desktop && setExpanded(true)}
        onMouseLeave={() => !geometry.desktop && setExpanded(false)}
        style={{
          width: expanded ? expandedWidth : collapsedWidth,
          height: expanded ? expandedHeight : notchHeight,
          background: "#000",
          // Always black, whatever the theme: the logo cuts its gaps in --background.
          ["--background" as string]: "#000",
          ["--island-tint" as string]: data?.tint ?? "#fff",
          borderRadius: geometry.floating
            ? expanded
              ? "28px"
              : `${notchHeight / 2}px`
            : expanded
              ? "0 0 30px 30px"
              : `0 0 ${Math.min(14, notchHeight / 2.4)}px ${Math.min(14, notchHeight / 2.4)}px`,
          boxShadow: geometry.floating
            ? "0 0 0 0.5px rgba(255,255,255,0.12)"
            : expanded
              ? "0 18px 40px -12px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(255,255,255,0.06)"
              : "none",
          transitionProperty: "width, height, border-radius, box-shadow",
          transitionDuration: expanded ? "560ms" : "380ms",
          transitionTimingFunction: expanded ? "cubic-bezier(0.3, 1.32, 0.5, 1)" : "cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {!geometry.floating && (
          <>
            <span
              aria-hidden
              className="absolute top-0 -left-2 size-2"
              style={{ background: "radial-gradient(circle at 0 100%, transparent 7.5px, #000 8px)" }}
            />
            <span
              aria-hidden
              className="absolute top-0 -right-2 size-2"
              style={{ background: "radial-gradient(circle at 100% 100%, transparent 7.5px, #000 8px)" }}
            />
          </>
        )}

        {/* Collapsed: one wing either side of the notch. */}
        <div
          {...grip}
          className={cn("absolute inset-x-0 top-0 flex items-center justify-between px-3.5 transition-opacity", movable && "cursor-grab touch-none active:cursor-grabbing")}
          style={{ height: notchHeight, opacity: expanded ? 0 : 1, transitionDuration: expanded ? "120ms" : "260ms", transitionDelay: expanded ? "0ms" : "160ms" }}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {showAI ? <span className="text-[11px] font-semibold text-white/85">AI</span> : top ? (
              <AppIcon bundlePath={top.bundlePath} hasIcon={top.hasIcon} kind={top.kind} size={15} color={colorIcons} className="rounded-[4px] bg-white/10 text-white/80" />
            ) : (
              <Logo className="size-[15px] text-white" />
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[11.5px] font-medium tabular text-white/90">
            {showAI ? <span title={closest ? `${closest.usage.account.label} · ${closest.window.label} remaining` : "AI limits"}>{aiLabel} left</span> : <>
            {data && (metric === "cpu" || metric === "memory") ? (
              <Ring value={data.overview[metric]} size={14} stroke={2.2} />
            ) : (
              <ActiveIcon className="size-3 text-white/50" strokeWidth={2} />
            )}
            {data && metric === "network" ? (
              <span className="flex flex-col text-[9px] leading-[12px]">
                <span>↓ {compactRate(data.totals.netIn)}/s</span>
                <span>↑ {compactRate(data.totals.netOut)}/s</span>
              </span>
            ) : data ? totalLabel(data) : "–"}
            </>}
          </div>
        </div>

        {/* Expanded panel. */}
        {panel !== "hidden" && (
        <div
          className="absolute inset-0 flex flex-col px-4 pb-3.5 transition-[opacity,transform]"
          style={{
            opacity: shown ? 1 : 0,
            transform: shown ? "scale(1)" : "scale(0.96)",
            transformOrigin: "top center",
            transitionDuration: shown ? "260ms" : "120ms",
            transitionDelay: shown ? "140ms" : "0ms",
            pointerEvents: shown ? "auto" : "none",
          }}
        >
          <div {...grip} className={cn("flex shrink-0 items-center justify-between", movable && "cursor-grab touch-none active:cursor-grabbing")} style={{ height: notchHeight }}>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/60">
              <Logo className="size-3.5 text-white" />
              Systo
            </div>
            <div className="flex gap-1 rounded-full bg-white/10 p-0.5" aria-label="Island view">
              {[false, true].map(value => <button key={String(value)} type="button" aria-pressed={showAI === value} onClick={() => toggleAI(value)} className={cn("rounded-full px-2 py-0.5 text-[10px] focus-visible:outline focus-visible:outline-white", showAI === value ? "bg-white text-black" : "text-white/75 hover:text-white")}>
                {value ? "AI usage" : "System"}
              </button>)}
            </div>
          </div>

          {showAI ? <IslandAI report={ai} error={aiError} /> : <>
          <div className="mt-1.5 grid shrink-0 grid-cols-4 gap-1" role="tablist" aria-label="Top apps by">
            {METRICS.map(({ id }) => {
              const value = data?.overview[id] ?? 0;
              const selected = metric === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-label={id === "network" ? (data ? `Network: download ${formatRate(data.totals.netIn)}, upload ${formatRate(data.totals.netOut)}` : "Network: sampling") : `${METRIC_META[id].label} ${Math.round(value)}%`}
                  onClick={() => chooseMetric(id)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-2xl py-2 transition-colors",
                    selected ? "bg-white/[0.1] text-white" : "text-white/75 hover:bg-white/[0.05] hover:text-white",
                  )}
                >
                  {id === "network" ? (
                    <div className="flex h-[46px] w-full flex-col justify-center gap-1 text-[11px] font-semibold tabular">
                      <span title="Download">↓ {data ? formatRate(data.totals.netIn) : "–"}</span>
                      <span title="Upload" className="text-white/65">↑ {data ? formatRate(data.totals.netOut) : "–"}</span>
                    </div>
                  ) : <Ring value={data ? value : 0} size={46} stroke={4}>
                    <span className="text-[11.5px] font-semibold tabular text-white">{data ? `${Math.round(value)}%` : "–"}</span>
                  </Ring>}
                  <span className={cn("text-[10px] font-semibold tracking-[0.08em]", selected ? "text-white" : "text-white/55")}>{RING_LABEL[id]}</span>
                  <span className="max-w-full truncate px-1 text-[9.5px] tabular text-white/40">{id === "network" ? "↓ Down · ↑ Up" : data ? ringDetail(id, data) : "\u00a0"}</span>
                </button>
              );
            })}
          </div>

          <ol className="mt-2.5 min-h-0 flex-1 space-y-1.5">
            {(data?.entries ?? []).map((entry, index) => (
              <li key={entry.id} className="group/row flex h-[30px] items-center gap-2.5">
                <span className="w-3 shrink-0 text-center text-[10px] tabular text-white/35">{index + 1}</span>
                <AppIcon bundlePath={entry.bundlePath} hasIcon={entry.hasIcon} kind={entry.kind} size={20} color={colorIcons} className="rounded-[5px] bg-white/10 text-white/80" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] leading-tight text-white/95">{entry.name}</div>
                  <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-[color-mix(in_oklab,var(--island-tint)_80%,transparent)] transition-[width] duration-700 ease-out" style={{ width: `${Math.max(3, entry.share * 100)}%` }} />
                  </div>
                </div>
                <span className="w-[72px] shrink-0 text-right text-[12px] tabular text-white/90">{formatValue(metric, entry.value, cores)}</span>
              </li>
            ))}
            {data && data.entries.length === 0 && <li className="pt-4 text-center text-[12px] text-white/50">Nothing busy right now</li>}
            {!data && (
              <li className="space-y-2 pt-4" role="status" aria-label="Sampling processes">
                <Skeleton className="h-4 w-full bg-white/10" />
                <Skeleton className="h-4 w-4/5 bg-white/10" />
              </li>
            )}
          </ol>
          </>}

          <div className="flex shrink-0 items-center justify-between pt-1 text-[10.5px] text-white/40">
            <span className="tabular">
              {showAI && (ai?.pending ? "Checking accounts…" : "Limits follow provider reset windows")}
              {!showAI && <>
              {data && metric === "cpu" && `${cores} cores`}
              {data && metric === "memory" && `${formatBytes(data.totals.memoryUsed)} of ${formatBytes(data.totals.memoryTotal, 0)}`}
              {data && metric === "disk" && `R ${formatRate(data.totals.diskRead)} · W ${formatRate(data.totals.diskWrite)}`}
              {data && metric === "network" && `↓ ${formatRate(data.totals.netIn)} · ↑ ${formatRate(data.totals.netOut)}`}
              </>}
            </span>
            <button
              type="button"
              onClick={() => (geometry.desktop ? sendShellCommand({ type: "open-main" }) : window.open("/", "_blank"))}
              className="flex items-center gap-0.5 rounded-full px-2 py-0.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              Open Systo <ArrowUpRightIcon className="size-3" />
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
