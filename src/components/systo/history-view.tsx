"use client";

import { OS } from "@/lib/platform";
import { useMemo, useRef, useState } from "react";
import { HistoryIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { usePoll } from "@/lib/client/use-poll";
import { useSettings } from "@/lib/client/settings";
import { formatBytes, formatDuration, formatPercent } from "@/lib/format";
import { KIND_META } from "@/lib/kinds";
import type { UsageEntry, UsageMetric, UsageRange, UsageReport } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AppIcon } from "./app-icon";
import { AreaChart } from "./chart";

const RANGES: Array<{ id: UsageRange; label: string; long: string }> = [
  { id: "1h", label: "1H", long: "last hour" },
  { id: "3h", label: "3H", long: "last 3 hours" },
  { id: "1d", label: "1D", long: "last 24 hours" },
  { id: "7d", label: "7D", long: "last 7 days" },
  { id: "30d", label: "30D", long: "last 30 days" },
  { id: "90d", label: "90D", long: "last 90 days" },
];

const METRICS: Array<{ id: UsageMetric; label: string; title: string; noun: string }> = [
  { id: "cpu", label: "CPU", title: "CPU", noun: "CPU time" },
  { id: "memory", label: "Memory", title: "memory", noun: "average memory" },
  { id: "disk", label: "Disk", title: "disk", noun: "bytes read and written" },
  { id: "network", label: "Network", title: "network", noun: "bytes sent and received" },
  { id: "energy", label: "Energy", title: "energy", noun: "energy used" },
];

/** Darkest for the biggest user; "everything else" sits faintly on top. */
const SHADES = [0.92, 0.68, 0.5, 0.36, 0.26, 0.18];
const OTHERS_SHADE = 0.09;
const CHART_LAYERS = SHADES.length;

function formatEnergy(joules: number) {
  const wh = joules / 3600;
  if (wh >= 1000) return `${(wh / 1000).toFixed(2)} kWh`;
  if (wh >= 10) return `${Math.round(wh)} Wh`;
  if (wh >= 0.1) return `${wh.toFixed(1)} Wh`;
  return `${Math.round(joules)} J`;
}

function formatCpuTime(seconds: number) {
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return formatDuration(seconds);
}

/** The headline number for an app's whole range. */
function formatTotal(metric: UsageMetric, value: number) {
  switch (metric) {
    case "cpu":
      return formatCpuTime(value);
    case "memory":
      return formatBytes(value);
    case "disk":
    case "network":
      return formatBytes(value);
    case "energy":
      return formatEnergy(value);
  }
}

/** A single bucket's plotted value. */
function formatPoint(metric: UsageMetric, value: number) {
  switch (metric) {
    case "cpu":
      return formatPercent(value);
    case "memory":
      return formatBytes(value);
    case "disk":
    case "network":
      return formatBytes(value);
    case "energy":
      return `${value < 10 ? value.toFixed(1) : Math.round(value)} W`;
  }
}

function tickLabel(range: UsageRange, t: number) {
  const d = new Date(t);
  if (range === "1h" || range === "3h" || range === "1d") return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (range === "7d") return d.toLocaleDateString([], { weekday: "short", hour: "numeric" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function bucketLabel(range: UsageRange, t: number, step: number) {
  const start = new Date(t);
  const end = new Date(t + step);
  if (range === "90d") return start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const day = start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const time = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${day}, ${time(start)} – ${time(end)}`;
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / exp;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * exp;
}

function StackedBars({
  report,
  highlight,
  onHighlight,
}: {
  report: UsageReport;
  highlight: string | null;
  onHighlight: (id: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const layers = report.entries.slice(0, CHART_LAYERS);
  const count = report.buckets.length;
  const stacks = report.buckets.map((_, i) => {
    let base = 0;
    const segments = layers.map((e) => {
      const y0 = base;
      base += e.series[i];
      return { id: e.id, y0, y1: base };
    });
    const others = Math.max(0, report.system[i] - base);
    return { segments, others: { y0: base, y1: base + others }, total: base + others };
  });
  const peak = Math.max(...stacks.map((s) => s.total), 0);
  const max = report.metric === "cpu" ? Math.min(100, niceMax(peak * 1.1)) : niceMax(peak * 1.1);
  const W = count * 10;
  const H = 200;
  const y = (v: number) => H - (v / max) * H;
  const ticks = [0, Math.floor(count / 3), Math.floor((2 * count) / 3), count - 1];

  const onMove = (event: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const i = Math.floor(((event.clientX - rect.left) / rect.width) * count);
    setHover(i >= 0 && i < count ? i : null);
  };

  const hovered = hover !== null ? stacks[hover] : null;
  const tooltipLeft = hover !== null ? ((hover + 0.5) / count) * 100 : 0;

  return (
    <div className="relative">
      <div className="mb-1 flex justify-between text-[10.5px] text-muted-foreground">
        <span className="tabular">{formatPoint(report.metric, max)}</span>
        <span>{report.metric === "cpu" ? "Share of the whole chip" : report.metric === "memory" ? "Average in use" : report.metric === "energy" ? "Average power" : "Per interval"}</span>
      </div>
      <div ref={ref} className="relative h-56 cursor-crosshair text-data" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-full w-full">
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="currentColor" strokeOpacity={0.07} vectorEffect="non-scaling-stroke" />
          ))}
          {stacks.map((stack, i) => {
            const x = i * 10 + 1;
            const dim = hover !== null && hover !== i;
            return (
              <g key={i} opacity={dim ? 0.55 : 1}>
                {stack.segments.map((seg, layer) => {
                  if (seg.y1 - seg.y0 <= 0) return null;
                  const faded = highlight !== null && highlight !== seg.id;
                  return (
                    <rect
                      key={seg.id}
                      x={x}
                      width={8}
                      y={y(seg.y1)}
                      height={Math.max(0.5, y(seg.y0) - y(seg.y1))}
                      fill="currentColor"
                      fillOpacity={faded ? SHADES[layer] * 0.22 : SHADES[layer]}
                    />
                  );
                })}
                {stack.others.y1 - stack.others.y0 > 0 && (
                  <rect
                    x={x}
                    width={8}
                    y={y(stack.others.y1)}
                    height={Math.max(0.5, y(stack.others.y0) - y(stack.others.y1))}
                    fill="currentColor"
                    fillOpacity={highlight ? OTHERS_SHADE * 0.4 : OTHERS_SHADE}
                  />
                )}
              </g>
            );
          })}
          <line x1={0} x2={W} y1={H} y2={H} stroke="currentColor" strokeOpacity={0.18} vectorEffect="non-scaling-stroke" />
        </svg>

        {hovered && hover !== null && hovered.total <= 0 && (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-lg border bg-popover/95 px-2.5 py-2 text-[11.5px] text-muted-foreground shadow-lg backdrop-blur"
            style={{ left: `clamp(0px, calc(${tooltipLeft}% - 90px), calc(100% - 180px))` }}
          >
            {bucketLabel(report.range, report.buckets[hover], report.step)}
            <div className="mt-0.5">Systo wasn't recording</div>
          </div>
        )}
        {hovered && hover !== null && hovered.total > 0 && (
          <div
            className="pointer-events-none absolute top-2 z-10 w-60 rounded-lg border bg-popover/95 p-2.5 text-[11.5px] shadow-lg backdrop-blur"
            style={{ left: `clamp(0px, calc(${tooltipLeft}% - 120px), calc(100% - 240px))` }}
          >
            <div className="mb-1.5 text-[11px] text-muted-foreground">{bucketLabel(report.range, report.buckets[hover], report.step)}</div>
            {layers.map((e, layer) => {
              const value = e.series[hover];
              if (value <= 0) return null;
              return (
                <div key={e.id} className="flex items-center gap-2 py-0.5">
                  <span className="size-2 shrink-0 rounded-[2px] bg-data" style={{ opacity: SHADES[layer] }} />
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  <span className="tabular text-muted-foreground">{formatPoint(report.metric, value)}</span>
                </div>
              );
            })}
            {hovered.others.y1 - hovered.others.y0 > 0 && (
              <div className="flex items-center gap-2 py-0.5 text-muted-foreground">
                <span className="size-2 shrink-0 rounded-[2px] bg-data" style={{ opacity: OTHERS_SHADE * 2 }} />
                <span className="flex-1">Everything else</span>
                <span className="tabular">{formatPoint(report.metric, hovered.others.y1 - hovered.others.y0)}</span>
              </div>
            )}
            <div className="mt-1.5 flex justify-between border-t pt-1.5 font-medium">
              <span>{report.metric === "memory" ? "In use" : "Total"}</span>
              <span className="tabular">{formatPoint(report.metric, hovered.total)}</span>
            </div>
          </div>
        )}
      </div>
      <div className="relative mt-1.5 h-4 text-[10.5px] text-muted-foreground">
        {ticks.map((i, n) => (
          <span
            key={n}
            className="tabular absolute whitespace-nowrap"
            style={{
              left: `${((i + 0.5) / count) * 100}%`,
              transform: n === 0 ? "translateX(-10%)" : n === ticks.length - 1 ? "translateX(-90%)" : "translateX(-50%)",
            }}
          >
            {tickLabel(report.range, report.buckets[i])}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
        {layers.map((e, layer) => (
          <button
            key={e.id}
            type="button"
            onMouseEnter={() => onHighlight(e.id)}
            onMouseLeave={() => onHighlight(null)}
            className={cn("flex items-center gap-1.5 transition-opacity", highlight && highlight !== e.id && "opacity-40")}
          >
            <span className="size-2 rounded-[2px] bg-data" style={{ opacity: SHADES[layer] }} />
            <span className="max-w-36 truncate">{e.name}</span>
          </button>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-data" style={{ opacity: OTHERS_SHADE * 2 }} />
          Everything else
        </span>
      </div>
    </div>
  );
}

function Leaderboard({
  report,
  highlight,
  onHighlight,
  colorIcons,
}: {
  report: UsageReport;
  highlight: string | null;
  onHighlight: (id: string | null) => void;
  colorIcons: boolean;
}) {
  const peak = report.entries[0]?.total || 1;
  const avgCpu = (e: UsageEntry) => (report.coverage.recorded ? (e.total / (report.coverage.recorded * report.cores)) * 100 : 0);
  return (
    <div className="divide-y rounded-xl border">
      {report.entries.map((e, index) => (
        <div
          key={e.id}
          onMouseEnter={() => onHighlight(e.id)}
          onMouseLeave={() => onHighlight(null)}
          className={cn("group/row flex items-center gap-3 px-3 py-2 transition-colors", highlight === e.id && "bg-accent/60")}
        >
          <span className="tabular w-5 shrink-0 text-center text-[11px] text-muted-foreground">{index + 1}</span>
          <AppIcon bundlePath={e.bundlePath} hasIcon={e.hasIcon} kind={e.kind} size={22} color={colorIcons} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-[13px] font-medium">{e.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{KIND_META[e.kind]?.label}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-data/75 transition-[width] duration-500" style={{ width: `${Math.max(1.5, (e.total / peak) * 100)}%` }} />
              </div>
              <span className="tabular w-10 shrink-0 text-right text-[10.5px] text-muted-foreground">{formatPercent(e.share * 100, 0)}</span>
            </div>
          </div>
          <div className="hidden h-7 w-28 shrink-0 text-data/70 md:block">
            <AreaChart series={[{ values: e.series }]} capacity={e.series.length} strokeWidth={1} />
          </div>
          <div className="w-24 shrink-0 text-right">
            <div className="tabular text-[13px] font-medium">{formatTotal(report.metric, e.total)}</div>
            {report.metric === "cpu" && <div className="tabular text-[10.5px] text-muted-foreground">avg {formatPercent(avgCpu(e))}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="tabular mt-0.5 truncate text-[17px] leading-tight font-medium tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{hint}</div>}
    </div>
  );
}

export function HistoryView() {
  const [range, setRange] = useState<UsageRange>("1d");
  const [metric, setMetric] = useState<UsageMetric>("cpu");
  const [highlight, setHighlight] = useState<string | null>(null);
  const { settings } = useSettings();
  const { data: report, error } = usePoll<UsageReport>(`/api/usage?range=${range}&metric=${metric}`, 15000);
  const current = report && report.range === range && report.metric === metric ? report : null;
  const rangeMeta = RANGES.find((r) => r.id === range)!;
  const metricMeta = METRICS.find((m) => m.id === metric)!;

  const summary = useMemo(() => {
    if (!current) return null;
    const span = current.to - current.from + current.step;
    const recorded = current.coverage.recorded;
    const avgCpu = recorded ? (current.systemTotal / (recorded * current.cores)) * 100 : 0;
    return { span, recorded, avgCpu, partial: recorded < (span / 1000) * 0.85 };
  }, [current]);

  const empty = current && current.entries.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="mr-1 text-[15px] font-semibold tracking-tight">History</h1>
        <ToggleGroup type="single" variant="outline" size="sm" value={metric} onValueChange={(v) => v && setMetric(v as UsageMetric)}>
          {METRICS.map((m) => (
            <ToggleGroupItem key={m.id} value={m.id} className="h-8 px-3 text-[12px]">
              {m.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex-1" />
        <ToggleGroup type="single" variant="outline" size="sm" value={range} onValueChange={(v) => v && setRange(v as UsageRange)}>
          {RANGES.map((r) => (
            <ToggleGroupItem key={r.id} value={r.id} className="tabular h-8 px-2.5 text-[12px]">
              {r.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </header>

      <section className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-5">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight">Top {metricMeta.title} users</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Ranked by {metricMeta.noun} over the {rangeMeta.long}
              {summary?.partial && current?.coverage.since && ` · recorded ${formatDuration(summary.recorded)} so far`}
            </p>
          </div>
          {current && !empty && (
            <div className="tabular text-right text-[28px] leading-none font-semibold tracking-tight">{formatTotal(metric, current.systemTotal)}</div>
          )}
        </div>

        {!current && !error && (
          <div className="mt-5 space-y-3">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        )}
        {error && !current && <p className="mt-6 text-[13px] text-muted-foreground">Couldn't load history: {error}</p>}

        {current && empty && (
          <div className="mt-8 flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
            <HistoryIcon className="size-8 text-muted-foreground" strokeWidth={1.5} />
            <h3 className="mt-3 text-[15px] font-medium">Recording has started</h3>
            <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
              Systo records which apps use your {OS.device} while it runs, including from the {OS.menuBar} with this window closed. The
              first entries appear within a minute and build up to 90 days.
            </p>
          </div>
        )}

        {current && !empty && (
          <>
            <div className="mt-4 rounded-xl border bg-card p-3">
              <StackedBars report={current} highlight={highlight} onHighlight={setHighlight} />
            </div>

            <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
              <Stat
                label={metric === "memory" ? "Average in use" : `Whole ${OS.device}`}
                value={formatTotal(metric, current.systemTotal)}
                hint={metric === "cpu" && summary ? `avg ${formatPercent(summary.avgCpu)} of the chip` : undefined}
              />
              <Stat
                label="Top user"
                value={current.entries[0].name}
                hint={`${formatPercent(current.entries[0].share * 100, 0)} of the total`}
              />
              <Stat
                label="Top 3 combined"
                value={formatPercent(current.entries.slice(0, 3).reduce((s, e) => s + e.share, 0) * 100, 0)}
                hint={metric === "memory" ? "of memory in use" : "of the total"}
              />
              <Stat
                label="Recorded"
                value={summary ? formatDuration(summary.recorded) : "–"}
                hint={current.coverage.since ? `since ${new Date(current.coverage.since).toLocaleDateString([], { month: "short", day: "numeric" })}` : undefined}
              />
            </div>

            <div className="mt-8">
              <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Leaderboard</h3>
              <Leaderboard report={current} highlight={highlight} onHighlight={setHighlight} colorIcons={settings.colorIcons} />
              {summary?.partial && (
                <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
                  History only covers time Systo was running. Keep it in the {OS.menuBar} to fill in the {rangeMeta.long}.
                </p>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
