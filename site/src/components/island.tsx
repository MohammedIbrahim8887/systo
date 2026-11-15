import { ArrowDownToLineIcon, CpuIcon, HardDriveIcon, MemoryStickIcon, WifiIcon, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/systo/logo";
import { formatBytes, formatRate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CORES, MEMORY_TOTAL, type DemoGroup, type DemoState } from "../lib/demo";
import type { Platform } from "../lib/releases";
import DotGrid from "./bits/DotGrid";
import { GlyphTile } from "./glyph";
import { ProcessesReplica } from "./processes";

type Metric = "cpu" | "memory" | "disk" | "network";

const METRICS: Array<{ id: Metric; label: string; icon: LucideIcon }> = [
  { id: "cpu", label: "CPU", icon: CpuIcon },
  { id: "memory", label: "RAM", icon: MemoryStickIcon },
  { id: "disk", label: "SSD", icon: HardDriveIcon },
  { id: "network", label: "NET", icon: WifiIcon },
];

/** Same proportions as the app's island (src/components/systo/island.tsx). */
const NOTCH_W = 188;
const PILL_H = 34;
const WING = 62;
const PANEL_W = 440;
const PANEL_H = 262;
const FLOAT_TOP = 10;
const MENU_BAR = 34;

function Ring({ value, size = 46, children }: { value: number; size?: number; children?: React.ReactNode }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgb(255 255 255 / 0.92)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(100, Math.max(0, value)) / 100)}
          style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.3, 0.9, 0.3, 1)" }}
        />
      </svg>
      {children && <span className="absolute inset-0 flex items-center justify-center">{children}</span>}
    </span>
  );
}

function valueOf(g: DemoGroup, metric: Metric) {
  return metric === "cpu" ? g.cpu : metric === "memory" ? g.memory : metric === "disk" ? g.disk : g.network;
}

function formatMetric(metric: Metric, value: number) {
  if (metric === "cpu") return `${(value / CORES).toFixed(1)}%`;
  if (metric === "memory") return formatBytes(value);
  return formatRate(value);
}

/**
 * The page's opening: a laptop screen's top edge with Systo's island on it. On macOS it hangs from
 * the notch under a menu bar; on Windows it floats as a pill. Hover, focus or tap opens the panel.
 */
export function IslandStage({ platform, demo }: { platform: Platform; demo: DemoState }) {
  const [expanded, setExpanded] = useState(false);
  const [metric, setMetric] = useState<Metric>("cpu");
  const touched = useRef(false);
  const floating = platform === "windows";

  // The one authored moment: the island opens by itself once, shows its panel, and settles.
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const open = setTimeout(() => !touched.current && setExpanded(true), 1100);
    const close = setTimeout(() => !touched.current && setExpanded(false), 4600);
    return () => {
      clearTimeout(open);
      clearTimeout(close);
    };
  }, []);

  const take = (next: boolean) => {
    touched.current = true;
    setExpanded(next);
  };

  const sorted = [...demo.groups].sort((a, b) => valueOf(b, metric) - valueOf(a, metric)).slice(0, 3);
  const top = sorted[0];
  const busy = metric === "memory" ? MEMORY_TOTAL : Math.max(1, sorted.reduce((s, g) => s + valueOf(g, metric), 0) * 1.4);
  const rings: Record<Metric, number> = {
    cpu: demo.cpu,
    memory: (demo.memoryUsed / MEMORY_TOTAL) * 100,
    disk: demo.storage,
    network: Math.min(100, ((demo.netIn + demo.netOut) / 1.2e6) * 100),
  };

  const collapsedW = floating ? 236 : NOTCH_W + WING * 2;
  const width = expanded ? PANEL_W : collapsedW;
  const height = expanded ? PILL_H + PANEL_H : PILL_H;

  return (
    <div className="relative mx-auto w-full max-w-[1120px] flex h-[500px] flex-col overflow-hidden sm:h-[560px] rounded-t-[22px] border border-b-0 border-white/10 bg-[oklch(0.13_0_0)] shadow-[0_30px_80px_-40px_rgb(0_0_0/0.5)]">
      <div className="absolute inset-0" aria-hidden>
        <DotGrid dotSize={2} gap={22} baseColor="#2b2b2b" activeColor="#d6d6d6" proximity={110} shockRadius={180} shockStrength={3} opacity={0.9} />
      </div>
      {/* The screen's own chrome: a menu bar on macOS, nothing on Windows. */}
      {!floating && (
        <div className="relative z-10 flex shrink-0 items-center justify-between px-5 text-[12.5px] text-white/70" style={{ height: MENU_BAR }}>
          <div className="flex items-center gap-5">
            <span className="font-medium text-white/90">Finder</span>
            <span>File</span>
            <span>Edit</span>
            <span className="hidden sm:inline">View</span>
            <span className="hidden sm:inline">Go</span>
          </div>
          <div className="flex items-center gap-4 tnum">
            <span className="hidden sm:inline">Wed 10:41</span>
          </div>
        </div>
      )}
      <div className="relative z-20 min-h-0 flex-1">
        {/* The app's own window, rising from the bottom edge of the screen and cropped by it. */}
        <div
          aria-hidden
          inert
          className="pointer-events-none absolute inset-x-0 top-[110px] bottom-0 overflow-hidden px-4 select-none sm:top-[120px] sm:px-12"
          style={{ maskImage: "linear-gradient(to bottom, #000 80%, transparent)" }}
        >
          <div className="mx-auto max-w-[960px]">
            <ProcessesReplica platform={platform} demo={demo} />
          </div>
        </div>
        <div className="absolute inset-x-0 flex justify-center" style={{ top: floating ? FLOAT_TOP : -MENU_BAR }}>
          <div
            className="relative max-w-[calc(100vw-32px)] text-white"
            onMouseEnter={() => take(true)}
            onMouseLeave={() => take(false)}
            style={{
              width,
              height,
              background: "#000",
              borderRadius: floating ? (expanded ? 28 : PILL_H / 2) : expanded ? "0 0 30px 30px" : "0 0 14px 14px",
              boxShadow: floating || expanded ? "0 0 0 0.5px rgb(255 255 255 / 0.14), 0 24px 60px -18px rgb(0 0 0 / 0.8)" : "none",
              transitionProperty: "width, height, border-radius, box-shadow",
              transitionDuration: expanded ? "560ms" : "380ms",
              transitionTimingFunction: expanded ? "cubic-bezier(0.3, 1.32, 0.5, 1)" : "cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={expanded ? "Close the island" : "Open the island"}
              onFocus={() => take(true)}
              onClick={() => take(!expanded)}
              className="absolute inset-x-0 top-0 z-10 flex items-center justify-between rounded-[inherit] px-3.5 outline-offset-2"
              style={{ height: PILL_H }}
            >
              <span className="flex items-center gap-1.5 transition-opacity" style={{ opacity: expanded ? 0 : 1 }}>
                {top ? <GlyphTile glyph={top.glyph} size={16} className="bg-white/12 text-white/85" /> : <Logo className="size-4 text-white" />}
              </span>
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-white/90 tnum transition-opacity" style={{ opacity: expanded ? 0 : 1 }}>
                <Ring value={demo.cpu} size={15} />
                {Math.round(demo.cpu)}%
              </span>
            </button>

            <div
              className="absolute inset-0 flex flex-col px-4 pb-3.5"
              style={{
                opacity: expanded ? 1 : 0,
                transform: expanded ? "scale(1)" : "scale(0.96)",
                transformOrigin: "top center",
                transition: `opacity ${expanded ? "260ms 140ms" : "120ms"}, transform ${expanded ? "260ms 140ms" : "120ms"}`,
                pointerEvents: expanded ? "auto" : "none",
              }}
              aria-hidden={!expanded}
            >
              <div className="flex shrink-0 items-center justify-between" style={{ height: PILL_H }}>
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-white/60">
                  <Logo className="size-3.5 text-white" /> Systo
                </span>
                <span className="text-[11px] text-white/60 tnum">CPU {Math.round(demo.cpu)}%</span>
              </div>
              <div className="mt-1.5 grid grid-cols-4 gap-1" role="tablist" aria-label="Top apps by">
                {METRICS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    tabIndex={expanded ? 0 : -1}
                    aria-selected={metric === id}
                    onClick={() => setMetric(id)}
                    className={cn("flex flex-col items-center gap-1 rounded-2xl py-2 transition-colors", metric === id ? "bg-white/10" : "hover:bg-white/5")}
                  >
                    {id === "network" ? (
                      <span className="flex h-[46px] flex-col justify-center gap-0.5 text-[10.5px] font-medium text-white/90 tnum">
                        <span>↓ {formatRate(demo.netIn)}</span>
                        <span className="text-white/60">↑ {formatRate(demo.netOut)}</span>
                      </span>
                    ) : (
                      <Ring value={rings[id]}>
                        <span className="text-[11px] font-medium tnum">{Math.round(rings[id])}%</span>
                      </Ring>
                    )}
                    <span className={cn("text-[10px] font-medium tracking-wider", metric === id ? "text-white" : "text-white/50")}>{label}</span>
                  </button>
                ))}
              </div>
              <ol className="mt-3 min-h-0 flex-1 space-y-2">
                {sorted.map((g, i) => (
                  <li key={g.id} className="flex h-[30px] items-center gap-2.5">
                    <span className="w-3 text-center text-[10px] text-white/35 tnum">{i + 1}</span>
                    <GlyphTile glyph={g.glyph} size={20} className="bg-white/10 text-white/80" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-white/95">{g.name}</span>
                      <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-white/10">
                        <span
                          className="block h-full rounded-full bg-white/80 transition-[width] duration-700 ease-out"
                          style={{ width: `${Math.max(3, Math.min(100, (valueOf(g, metric) / busy) * 100))}%` }}
                        />
                      </span>
                    </span>
                    <span className="w-[72px] text-right text-[12px] text-white/90 tnum">{formatMetric(metric, valueOf(g, metric))}</span>
                  </li>
                ))}
              </ol>
              <div className="flex shrink-0 items-center justify-between pt-1 text-[10.5px] text-white/40">
                <span className="tnum">{metric === "memory" ? `${formatBytes(demo.memoryUsed)} of ${formatBytes(MEMORY_TOTAL, 0)}` : `${CORES} cores`}</span>
                <a href="#download" tabIndex={expanded ? 0 : -1} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-white/65 transition-colors hover:bg-white/10 hover:text-white">
                  Get Systo <ArrowDownToLineIcon className="size-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
