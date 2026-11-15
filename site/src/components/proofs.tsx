import { HardDriveIcon, InfoIcon, LogInIcon, MoonIcon, PowerIcon, RefreshCwIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Glyph } from "../lib/demo";
import type { Platform } from "../lib/releases";
import CountUp from "./bits/CountUp";
import { GlyphTile } from "./glyph";

function Proof({ title, children, visual, flip }: { title: string; children: ReactNode; visual: ReactNode; flip?: boolean }) {
  return (
    <div className="grid items-center gap-10 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16">
      <div className={cn("max-w-[42ch]", flip && "md:order-2")}>
        <h3 className="text-[clamp(1.6rem,2.6vw,2.15rem)] leading-[1.1] font-medium tracking-[-0.025em] text-balance">{title}</h3>
        <div className="mt-4 space-y-3 text-[15.5px] leading-relaxed text-muted-foreground">{children}</div>
      </div>
      <div className={cn(flip && "md:order-1")}>{visual}</div>
    </div>
  );
}

const EXPLAIN: Record<Platform, { name: string; kind: string; path: string; text: string }> = {
  macos: {
    name: "mds_stores",
    kind: "macOS Service",
    path: "/System/Library/Frameworks/CoreServices.framework/…/mds_stores",
    text: "Spotlight's indexer. It reads new and changed files so search can find them, which is why it gets busy after you copy a lot of files.",
  },
  windows: {
    name: "SearchIndexer.exe",
    kind: "Windows Service",
    path: "C:\\Windows\\System32\\SearchIndexer.exe",
    text: "Windows Search's indexer. It reads new and changed files so Start and File Explorer can find them, which is why it gets busy after you copy a lot of files.",
  },
};

function ExplainCard({ platform }: { platform: Platform }) {
  const e = EXPLAIN[platform];
  return (
    <div className="rounded-xl border bg-background p-6 shadow-[0_30px_70px_-45px_rgb(0_0_0/0.45)]">
      <div className="flex items-center gap-3">
        <GlyphTile glyph="search" size={36} className="rounded-[9px]" />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium">{e.name}</div>
          <div className="text-[12px] text-muted-foreground">{e.kind}</div>
        </div>
        <span className="ml-auto rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium">Relaunches</span>
      </div>
      <p className="mt-5 text-[14px] leading-relaxed">{e.text}</p>
      <dl className="mt-5 grid grid-cols-[110px_1fr] gap-y-2 text-[12.5px]">
        <dt className="text-muted-foreground">Safe to end?</dt>
        <dd>Yes. {platform === "macos" ? "macOS" : "Windows"} starts it again when it's needed.</dd>
        <dt className="text-muted-foreground">Location</dt>
        <dd className="truncate font-mono text-[11.5px] text-muted-foreground">{e.path}</dd>
      </dl>
      <div className="mt-6 flex gap-2">
        <span className="inline-flex h-8 items-center rounded-md border px-3 text-[12.5px]">{platform === "macos" ? "Show in Finder" : "Show in File Explorer"}</span>
        <span className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12.5px] text-primary-foreground">End task</span>
      </div>
    </div>
  );
}

const RANGES = ["1h", "3h", "1d", "7d", "30d", "90d"] as const;
const HISTORY: Record<(typeof RANGES)[number], Array<{ name: string; glyph: Glyph; cpu: number }>> = {
  "1h": [{ name: "Chrome", glyph: "globe", cpu: 18 }, { name: "node", glyph: "terminal", cpu: 12 }, { name: "Figma", glyph: "pen", cpu: 7 }, { name: "Slack", glyph: "message", cpu: 2 }],
  "3h": [{ name: "Chrome", glyph: "globe", cpu: 51 }, { name: "Figma", glyph: "pen", cpu: 33 }, { name: "node", glyph: "terminal", cpu: 29 }, { name: "Spotify", glyph: "music", cpu: 6 }],
  "1d": [{ name: "Chrome", glyph: "globe", cpu: 214 }, { name: "Figma", glyph: "pen", cpu: 120 }, { name: "Docker Desktop", glyph: "code", cpu: 64 }, { name: "Slack", glyph: "message", cpu: 31 }],
  "7d": [{ name: "Chrome", glyph: "globe", cpu: 1290 }, { name: "Docker Desktop", glyph: "code", cpu: 610 }, { name: "Figma", glyph: "pen", cpu: 480 }, { name: "node", glyph: "terminal", cpu: 402 }],
  "30d": [{ name: "Chrome", glyph: "globe", cpu: 5120 }, { name: "Docker Desktop", glyph: "code", cpu: 2650 }, { name: "node", glyph: "terminal", cpu: 1904 }, { name: "Figma", glyph: "pen", cpu: 1720 }],
  "90d": [{ name: "Chrome", glyph: "globe", cpu: 14800 }, { name: "Docker Desktop", glyph: "code", cpu: 8100 }, { name: "node", glyph: "terminal", cpu: 6020 }, { name: "Figma", glyph: "pen", cpu: 4100 }],
};

function cpuTime(minutes: number) {
  return minutes >= 60 ? `${(minutes / 60).toFixed(minutes >= 600 ? 0 : 1)} h` : `${minutes} min`;
}

function HistoryCard() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("1d");
  const rows = HISTORY[range];
  const max = rows[0].cpu;
  return (
    <div className="rounded-xl border bg-background p-6 shadow-[0_30px_70px_-45px_rgb(0_0_0/0.45)]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium">Top CPU users</span>
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={r === range}
              onClick={() => setRange(r)}
              className={cn("h-6 rounded px-2 text-[11.5px] tnum transition-colors", r === range ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground")}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <ol className="mt-5 space-y-3.5">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center gap-3">
            <GlyphTile glyph={row.glyph} size={24} />
            <span className="min-w-0 flex-1">
              <span className="flex justify-between text-[13px]">
                <span className="truncate">{row.name}</span>
                <span className="text-muted-foreground tnum">{cpuTime(row.cpu)} of CPU</span>
              </span>
              <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-foreground/75 transition-[width] duration-500 ease-out" style={{ width: `${(row.cpu / max) * 100}%` }} />
              </span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-[11.5px] text-muted-foreground">Example data</p>
    </div>
  );
}

const EXTRAS = [
  { icon: PowerIcon, label: "Startup apps you can switch off" },
  { icon: HardDriveIcon, label: "A disk analyzer with cleanup ideas" },
  { icon: LogInIcon, label: "Open at login, if you like" },
  { icon: RefreshCwIcon, label: "Updates itself in the background" },
  { icon: MoonIcon, label: "Light and dark, following your system" },
  { icon: InfoIcon, label: "No account, no tracking" },
];

function Footprint() {
  return (
    <div className="rounded-xl border bg-background p-6 shadow-[0_30px_70px_-45px_rgb(0_0_0/0.45)]">
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="text-[clamp(2.4rem,5vw,3.4rem)] leading-none font-medium tracking-[-0.04em] tnum">
            <CountUp to={120} duration={1.4} prefix="≈" /> <span className="text-[0.45em] font-medium tracking-normal text-muted-foreground">MB</span>
          </div>
          <p className="mt-2 text-[13px] text-muted-foreground">memory with only the island running</p>
        </div>
        <div>
          <div className="text-[clamp(2.4rem,5vw,3.4rem)] leading-none font-medium tracking-[-0.04em] tnum">
            <CountUp from={9} to={3} direction="down" duration={1.4} /> <span className="text-[0.45em] font-medium tracking-normal text-muted-foreground">% CPU</span>
          </div>
          <p className="mt-2 text-[13px] text-muted-foreground">to sample every process while the window is closed</p>
        </div>
      </div>
      <ul className="mt-7 grid gap-x-6 gap-y-3 border-t pt-6 sm:grid-cols-2">
        {EXTRAS.map(({ icon: Icon, label }) => (
          <li key={label} className="flex items-center gap-2.5 text-[13.5px]">
            <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
            {label}
          </li>
        ))}
      </ul>
      <p className="mt-6 text-[11.5px] text-muted-foreground">Measured on an Apple silicon MacBook Pro in November 2026. {formatBytes(120 * 1024 * 1024)} includes Systo's web views.</p>
    </div>
  );
}

export function Proofs({ platform }: { platform: Platform }) {
  return (
    <section id="features" className="mx-auto max-w-[1120px] space-y-28 px-5 py-28 md:space-y-36 md:py-36">
      <Proof title="Know what's safe to end before you end it." visual={<ExplainCard platform={platform} />}>
        <p>Every process has a plain-English answer: what it is, who made it, and what happens if you stop it.</p>
        <p>Critical system processes are marked, and ending an app asks it to quit politely first.</p>
      </Proof>
      <Proof flip title="See who used your machine, not just who's using it now." visual={<HistoryCard />}>
        <p>Systo keeps a private record of CPU, memory, disk and network by app, from the last hour back to the last 90 days.</p>
        <p>It stays on your {platform === "macos" ? "Mac" : "PC"} in a small local database.</p>
      </Proof>
      <Proof title="Light enough to leave running." visual={<Footprint />}>
        <p>A monitor shouldn't be the thing slowing you down. Systo reads the system directly instead of spawning tools, and slows down when nobody's looking.</p>
      </Proof>
    </section>
  );
}
