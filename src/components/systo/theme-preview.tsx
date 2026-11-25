"use client";

import { useMemo, type CSSProperties } from "react";
import { deriveTokens, type SlotTheme, type Variant } from "@/lib/theme";
import type { Palette } from "@/lib/theme-presets";
import { withAlpha } from "@/lib/color";
import { cn } from "@/lib/utils";

/** "Aa" in a theme's accent on its background. */
export function ThemeSwatch({ palette, className }: { palette: Pick<Palette, "accent" | "background" | "foreground">; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-[6px] border text-[10px] leading-none font-bold", className)}
      style={{ background: palette.background, color: palette.accent, borderColor: withAlpha(palette.foreground, 0.18) }}
    >
      Aa
    </span>
  );
}

const ROWS = [0.92, 0.6, 0.38, 0.2];
const LINE = "M0,26 L8,22 L16,24 L24,14 L32,18 L40,9 L48,13 L56,5 L64,11 L72,8 L80,15 L88,10 L100,12";

/** Systo's own window, drawn small in a slot's real colors. */
export function MiniWindow({ slot, variant, style }: { slot: SlotTheme; variant: Variant; style?: CSSProperties }) {
  const t = useMemo(() => deriveTokens(slot, variant), [slot, variant]);
  const bar = (color: string, width: string, height = 3) => <span className="block rounded-full" style={{ background: color, width, height }} />;
  return (
    <div aria-hidden className="absolute inset-0 flex" style={{ background: t.background, ...style }}>
      <div className="flex w-[27%] flex-col gap-[6px] p-2.5" style={{ background: t.sidebar, borderRight: `1px solid ${t.border}` }}>
        {bar(t.foreground, "58%", 4)}
        <span className="h-px" />
        <span className="-mx-1 rounded-[3px] px-1 py-[3px]" style={{ background: t.accent }}>
          {bar(t.data, "72%")}
        </span>
        {bar(t["muted-foreground"], "60%")}
        {bar(t["muted-foreground"], "74%")}
        {bar(t["muted-foreground"], "48%")}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-2.5">
        <div className="flex items-center justify-between">
          {bar(t.foreground, "34%", 4)}
          <span className="h-[9px] w-6 rounded-[3px]" style={{ background: t.primary }} />
        </div>
        <div className="overflow-hidden rounded-[4px]" style={{ background: t.card, border: `1px solid ${t.border}` }}>
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="block h-7 w-full">
            <path d={`${LINE} L100,30 L0,30 Z`} fill={t.data} fillOpacity={0.16} />
            <path d={LINE} fill="none" stroke={t.data} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        <div className="space-y-[5px]">
          {ROWS.map((share, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="size-[6px] shrink-0 rounded-[2px]" style={{ background: t["muted-foreground"] }} />
              {bar(withAlpha(t.foreground, 0.75), `${44 - i * 6}%`)}
              <span className="ml-auto h-[7px] w-6 rounded-[2px]" style={{ background: withAlpha(t.heat, 0.06 + share * 0.4) }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
