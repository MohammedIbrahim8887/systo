"use client";

import { OS, byOS } from "@/lib/platform";
import { useMemo, useState } from "react";
import { usePoll } from "@/lib/client/use-poll";
import { useSettings } from "@/lib/client/settings";
import { formatBytes, formatDuration, formatPercent, formatRate } from "@/lib/format";
import { KIND_META } from "@/lib/kinds";
import type { HistoryPoint, ProcessGroup, Snapshot, SystemInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AppIcon } from "./app-icon";
import { AreaChart, chartMax } from "./chart";

type PerfMetric = "cpu" | "memory" | "disk" | "network" | "gpu";

interface MetricDef {
  id: PerfMetric;
  label: string;
  summary: (s: Snapshot) => string;
  series: (h: HistoryPoint[]) => Array<{ values: number[]; dashed?: boolean }>;
  max?: (s: Snapshot) => number | undefined;
  axis: (v: number) => string;
}

const METRICS: MetricDef[] = [
  {
    id: "cpu",
    label: "CPU",
    summary: (s) => formatPercent(s.totals.cpu, 0),
    series: (h) => [{ values: h.map((p) => p.cpu) }],
    max: () => 100,
    axis: (v) => `${Math.round(v)}%`,
  },
  {
    id: "memory",
    label: "Memory",
    summary: (s) => `${formatBytes(s.totals.memoryUsed)} / ${formatBytes(s.totals.memoryTotal, 0)}`,
    series: (h) => [{ values: h.map((p) => p.memory) }],
    max: (s) => s.totals.memoryTotal,
    axis: (v) => formatBytes(v, 0),
  },
  {
    id: "disk",
    label: "Disk",
    summary: (s) => `R ${formatRate(s.totals.diskRead)} · W ${formatRate(s.totals.diskWrite)}`,
    series: (h) => [{ values: h.map((p) => p.diskRead) }, { values: h.map((p) => p.diskWrite), dashed: true }],
    axis: (v) => formatRate(v),
  },
  {
    id: "network",
    label: "Network",
    summary: (s) => `↓ ${formatRate(s.totals.netIn)} · ↑ ${formatRate(s.totals.netOut)}`,
    series: (h) => [{ values: h.map((p) => p.netIn) }, { values: h.map((p) => p.netOut), dashed: true }],
    axis: (v) => formatRate(v),
  },
  {
    id: "gpu",
    label: "GPU",
    summary: (s) => (s.totals.gpu === null ? "Unavailable" : `${s.totals.gpu}%`),
    series: (h) => [{ values: h.map((p) => p.gpu ?? 0) }],
    max: () => 100,
    axis: (v) => `${Math.round(v)}%`,
  },
];

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="tabular mt-0.5 truncate text-[17px] leading-tight font-medium tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{hint}</div>}
    </div>
  );
}

function groupValue(g: ProcessGroup, metric: PerfMetric) {
  if (metric === "memory") return g.memory;
  if (metric === "disk") return g.disk;
  if (metric === "network") return g.network;
  return g.cpu;
}

export function PerformanceView({ snapshot }: { snapshot: Snapshot | null }) {
  const [active, setActive] = useState<PerfMetric>("cpu");
  const { settings } = useSettings();
  const { data: info } = usePoll<SystemInfo>("/api/system", 60000);
  const def = METRICS.find((m) => m.id === active)!;
  const history = snapshot?.history ?? [];
  const capacity = 60;
  const series = def.series(history);
  const max = snapshot ? (def.max?.(snapshot) ?? chartMax(series)) : 1;

  const top = useMemo(() => {
    if (!snapshot || active === "gpu") return [];
    return [...snapshot.groups]
      .filter((g) => !(active === "cpu" && g.kind === "kernel"))
      .sort((a, b) => groupValue(b, active) - groupValue(a, active))
      .slice(0, 6);
  }, [snapshot, active]);

  const cpuDivisor = settings.cpuMode === "total" ? (snapshot?.totals.cores ?? 1) : 1;
  const t = snapshot?.totals;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center border-b px-4">
        <h1 className="text-[15px] font-semibold tracking-tight">Performance</h1>
        {info && (
          <span className="ml-3 truncate text-[12px] text-muted-foreground">
            {info.model} · {info.chip} · {info.osName} {info.osVersion}
          </span>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="scrollbar-thin w-[232px] shrink-0 space-y-1 overflow-y-auto border-r p-2">
          {METRICS.map((m) => {
            const s = snapshot ? m.series(snapshot.history) : [];
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setActive(m.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors",
                  active === m.id ? "border-border bg-accent" : "border-transparent hover:bg-accent/50",
                )}
              >
                <div className="h-9 w-14 shrink-0 overflow-hidden rounded border bg-background text-foreground">
                  <AreaChart series={s} max={snapshot ? m.max?.(snapshot) : undefined} capacity={30} strokeWidth={1} />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">{m.label}</div>
                  <div className="tabular truncate text-[11px] text-muted-foreground">{snapshot ? m.summary(snapshot) : "–"}</div>
                </div>
              </button>
            );
          })}
        </nav>

        <section className="scrollbar-thin min-w-0 flex-1 overflow-y-auto p-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">{def.label}</h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {active === "cpu" && info && `${info.chip} · ${info.cores} cores${info.performanceCores ? ` (${info.performanceCores} performance, ${info.efficiencyCores} efficiency)` : ""}`}
                {active === "memory" && info && `${formatBytes(info.memory, 0)} unified memory`}
                {active === "disk" && info && `${OS.volume} · ${formatBytes(info.diskFree)} free of ${formatBytes(info.diskTotal, 0)}`}
                {active === "network" && "Wi-Fi and Ethernet, all interfaces combined"}
                {active === "gpu" && info && `${info.chip} GPU${info.gpuCores ? ` · ${info.gpuCores} cores` : ""}`}
              </p>
            </div>
            <div className="tabular text-right text-[28px] leading-none font-semibold tracking-tight">{snapshot ? def.summary(snapshot).split(" · ")[0] : "–"}</div>
          </div>

          <div className="mt-4 rounded-xl border bg-card p-3">
            <div className="mb-1 flex justify-between text-[10.5px] text-muted-foreground">
              <span>{def.axis(max)}</span>
              <span>{Math.round((capacity * (snapshot?.interval ?? 1500)) / 1000)} seconds</span>
            </div>
            <div className="h-56 text-foreground">
              <AreaChart series={series} max={max} capacity={capacity} grid />
            </div>
            <div className="mt-1 flex justify-between text-[10.5px] text-muted-foreground">
              <span>
                {(active === "disk" || active === "network") && (
                  <span className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5">
                      <span className="h-px w-4 bg-foreground" /> {active === "disk" ? "Read" : "Received"}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-4 border-t border-dashed border-foreground/60" /> {active === "disk" ? "Write" : "Sent"}
                    </span>
                  </span>
                )}
              </span>
              <span>0</span>
            </div>
          </div>

          {t && (
            <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
              {active === "cpu" && (
                <>
                  <Stat label="Utilization" value={formatPercent(t.cpu)} />
                  <Stat label="Processes" value={String(t.processCount)} />
                  <Stat label="Cores" value={String(t.cores)} hint={info?.performanceCores ? `${info.performanceCores}P + ${info.efficiencyCores}E` : undefined} />
                  <Stat label="Up time" value={formatDuration(t.uptime)} />
                </>
              )}
              {active === "memory" && (
                <>
                  <Stat label="In use" value={formatBytes(t.memoryUsed)} hint={`${Math.round((t.memoryUsed / t.memoryTotal) * 100)}% of ${formatBytes(t.memoryTotal, 0)}`} />
                  <Stat label="App memory" value={formatBytes(t.memoryApp)} />
                  <Stat label={byOS("Wired", "Kernel", "Kernel")} value={formatBytes(t.memoryWired)} hint={`Kept in RAM by ${OS.name}`} />
                  <Stat label="Compressed" value={formatBytes(t.memoryCompressed)} />
                  <Stat label="Cached files" value={formatBytes(t.memoryCached)} hint="Freed when apps need it" />
                  <Stat label="Swap used" value={formatBytes(t.swapUsed)} />
                  <Stat label="Pressure" value={t.pressure[0].toUpperCase() + t.pressure.slice(1)} />
                </>
              )}
              {active === "disk" && (
                <>
                  <Stat label="Read" value={formatRate(t.diskRead)} />
                  <Stat label="Write" value={formatRate(t.diskWrite)} />
                  <Stat label="Capacity" value={info ? formatBytes(info.diskTotal, 0) : "–"} />
                  <Stat label="Available" value={info ? formatBytes(info.diskFree) : "–"} hint={info ? `${Math.round((info.diskFree / info.diskTotal) * 100)}% free` : undefined} />
                </>
              )}
              {active === "network" && (
                <>
                  <Stat label="Receive" value={formatRate(t.netIn)} />
                  <Stat label="Send" value={formatRate(t.netOut)} />
                  <Stat label="Host name" value={info?.hostname ?? "–"} />
                </>
              )}
              {active === "gpu" && (
                <>
                  <Stat label="Utilization" value={t.gpu === null ? "–" : `${t.gpu}%`} />
                  <Stat label="GPU cores" value={info?.gpuCores ? String(info.gpuCores) : "–"} />
                </>
              )}
            </div>
          )}

          {top.length > 0 && (
            <div className="mt-8">
              <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Top {def.label.toLowerCase()} users</h3>
              <div className="divide-y rounded-xl border">
                {top.map((g) => {
                  const value = groupValue(g, active);
                  const peak = groupValue(top[0], active) || 1;
                  const label =
                    active === "cpu" ? formatPercent(value / cpuDivisor) : active === "memory" ? formatBytes(value) : formatRate(value);
                  return (
                    <div key={g.id} className="group/row flex items-center gap-3 px-3 py-2">
                      <AppIcon bundlePath={g.bundlePath} hasIcon={g.hasIcon} kind={g.kind} size={18} color={settings.colorIcons} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate text-[13px]">{g.name}</span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{KIND_META[g.kind].label}</span>
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-foreground/70 transition-[width] duration-500" style={{ width: `${Math.max(2, (value / peak) * 100)}%` }} />
                        </div>
                      </div>
                      <span className="tabular w-20 shrink-0 text-right text-[12px]">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
