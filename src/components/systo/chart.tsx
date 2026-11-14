"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

interface Series {
  values: number[];
  dashed?: boolean;
}

interface AreaChartProps {
  series: Series[];
  /** Fixed ceiling (100 for percentages). Omit to scale to the data. */
  max?: number;
  /** Number of samples the x axis spans; data is right-aligned like Task Manager. */
  capacity?: number;
  grid?: boolean;
  className?: string;
  strokeWidth?: number;
}

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * exp;
}

export function chartMax(series: Series[], fixed?: number) {
  if (fixed) return fixed;
  const peak = Math.max(0, ...series.flatMap((s) => s.values));
  return niceCeil(peak * 1.15);
}

export function AreaChart({ series, max, capacity = 60, grid = false, className, strokeWidth = 1.25 }: AreaChartProps) {
  const id = useId().replace(/:/g, "");
  const width = 600;
  const height = 200;
  const top = chartMax(series, max);
  const step = width / Math.max(1, capacity - 1);

  const pathFor = (values: number[]) => {
    const pts = values.slice(-capacity);
    const offset = capacity - pts.length;
    return pts.map((v, i) => {
      const x = (offset + i) * step;
      const y = height - (Math.min(v, top) / top) * (height - 2) - 1;
      return [x, y] as const;
    });
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={cn("block h-full w-full overflow-visible", className)}>
      <defs>
        <linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
        </linearGradient>
        <pattern id={`grid-${id}`} width={width / 12} height={height / 4} patternUnits="userSpaceOnUse">
          <path d={`M ${width / 12} 0 L 0 0 0 ${height / 4}`} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </pattern>
      </defs>
      {grid && <rect width={width} height={height} fill={`url(#grid-${id})`} />}
      {series.map((s, index) => {
        const pts = pathFor(s.values);
        if (pts.length < 2) return null;
        const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
        const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
        return (
          <g key={index}>
            {!s.dashed && <path d={area} fill={`url(#fill-${id})`} />}
            <path
              d={line}
              fill="none"
              stroke="currentColor"
              strokeOpacity={s.dashed ? 0.55 : 0.9}
              strokeWidth={strokeWidth}
              strokeDasharray={s.dashed ? "4 3" : undefined}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        );
      })}
    </svg>
  );
}
