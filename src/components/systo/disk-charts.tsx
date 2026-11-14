"use client";

import { memo, useMemo } from "react";
import { formatBytes } from "@/lib/format";
import type { DiskViewNode } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Fill opacity per ring; siblings alternate so neighbors stay distinguishable without color. */
const RING_SHADES = [
  [0.86, 0.7],
  [0.52, 0.42],
  [0.3, 0.24],
  [0.18, 0.14],
];

const MIN_ANGLE = 0.006;

interface Arc {
  node: DiskViewNode;
  depth: number;
  start: number;
  end: number;
  index: number;
  ancestors: string[];
}

function arcPath(r0: number, r1: number, a0: number, a1: number) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => `${(r * Math.sin(a)).toFixed(2)},${(-r * Math.cos(a)).toFixed(2)}`;
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    // Full ring: two half arcs, since one arc can't start and end on the same point.
    const m = a0 + Math.PI;
    return `M${p(r1, a0)} A${r1},${r1} 0 1 1 ${p(r1, m)} A${r1},${r1} 0 1 1 ${p(r1, a0)} M${p(r0, a0)} A${r0},${r0} 0 1 0 ${p(r0, m)} A${r0},${r0} 0 1 0 ${p(r0, a0)} Z`;
  }
  return `M${p(r1, a0)} A${r1},${r1} 0 ${large} 1 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}

const RADII = [[66, 112], [114, 150], [152, 178], [180, 196]];

export const Sunburst = memo(function Sunburst({
  node,
  hovered,
  onHover,
  onOpen,
  onUp,
}: {
  node: DiskViewNode;
  hovered: DiskViewNode | null;
  onHover: (node: DiskViewNode | null) => void;
  onOpen: (node: DiskViewNode) => void;
  onUp?: () => void;
}) {
  const arcs = useMemo(() => {
    const out: Arc[] = [];
    const walk = (parent: DiskViewNode, depth: number, start: number, end: number, ancestors: string[]) => {
      if (depth >= RADII.length || !parent.children?.length || parent.size <= 0) return;
      let a = start;
      parent.children.forEach((child, index) => {
        const span = ((end - start) * child.size) / parent.size;
        if (span >= MIN_ANGLE) {
          out.push({ node: child, depth, start: a, end: a + span, index, ancestors });
          if (child.kind !== "file" && child.kind !== "rest") walk(child, depth + 1, a, a + span, [...ancestors, child.path ?? ""]);
        }
        a += span;
      });
    };
    walk(node, 0, 0, Math.PI * 2, []);
    return out;
  }, [node]);

  const focus = hovered?.path;
  const center = hovered ?? node;

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[440px]">
      <svg viewBox="-200 -200 400 400" className="block h-full w-full text-foreground" onMouseLeave={() => onHover(null)}>
        {arcs.map((arc) => {
          const [r0, r1] = RADII[arc.depth];
          const shade = RING_SHADES[arc.depth][arc.index % 2];
          const isRest = arc.node.kind === "rest";
          const onChain = focus ? arc.node.path === focus || (arc.node.path && focus.startsWith(arc.node.path + "/")) || arc.ancestors.includes(focus) : true;
          const opacity = isRest ? 0.07 : (arc.node.kind === "file" ? shade * 0.75 : shade) * (onChain ? 1 : 0.28);
          return (
            <path
              key={`${arc.depth}:${arc.node.path ?? `rest-${arc.ancestors.join("/")}`}`}
              d={arcPath(r0, r1, arc.start, arc.end)}
              fill="currentColor"
              fillOpacity={opacity}
              stroke="var(--background)"
              strokeWidth={0.9}
              className={cn("transition-[fill-opacity] duration-200", !isRest && "cursor-pointer")}
              onMouseEnter={() => onHover(arc.node)}
              onClick={() => !isRest && onOpen(arc.node)}
            />
          );
        })}
        <circle
          r={62}
          fill="var(--card)"
          stroke="currentColor"
          strokeOpacity={0.08}
          className={cn(onUp && "cursor-pointer")}
          onClick={onUp}
          onMouseEnter={() => onHover(null)}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="w-[26%] text-center">
          <div className="truncate text-[12px] font-medium" title={center.name}>{center.name}</div>
          <div className="tabular mt-0.5 text-[19px] leading-tight font-semibold tracking-tight">{formatBytes(center.size)}</div>
          <div className="tabular mt-0.5 truncate text-[10.5px] text-muted-foreground">
            {hovered && hovered !== node && node.size > 0 ? `${((hovered.size / node.size) * 100).toFixed(1)}% of ${node.name}` : `${center.files.toLocaleString()} files`}
          </div>
          {onUp && !hovered && <div className="mt-1 text-[10px] text-muted-foreground/70">Click to go up</div>}
        </div>
      </div>
    </div>
  );
});

// ── Treemap ──────────────────────────────────────────────────────────────────────────────

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Squarified treemap (Bruls et al.): lays out values into rects with aspect ratios near 1. */
function squarify(values: number[], box: Rect): Rect[] {
  const total = values.reduce((a, b) => a + b, 0);
  const rects: Rect[] = new Array(values.length);
  if (total <= 0 || box.w <= 0 || box.h <= 0) return values.map(() => ({ x: box.x, y: box.y, w: 0, h: 0 }));
  const scale = (box.w * box.h) / total;
  const areas = values.map((v) => v * scale);
  let { x, y, w, h } = box;
  let i = 0;
  const worst = (row: number[], side: number) => {
    const s = row.reduce((a, b) => a + b, 0);
    const max = Math.max(...row);
    const min = Math.min(...row);
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  while (i < areas.length) {
    const side = Math.min(w, h);
    const row = [areas[i]];
    let j = i + 1;
    while (j < areas.length && worst([...row, areas[j]], side) <= worst(row, side)) row.push(areas[j++]);
    const s = row.reduce((a, b) => a + b, 0);
    if (w >= h) {
      const colW = s / h;
      let yy = y;
      row.forEach((a, k) => {
        rects[i + k] = { x, y: yy, w: colW, h: a / colW };
        yy += a / colW;
      });
      x += colW;
      w -= colW;
    } else {
      const rowH = s / w;
      let xx = x;
      row.forEach((a, k) => {
        rects[i + k] = { x: xx, y, w: a / rowH, h: rowH };
        xx += a / rowH;
      });
      y += rowH;
      h -= rowH;
    }
    i = j;
  }
  return rects;
}

const TILE_SHADES = [0.22, 0.17, 0.13, 0.1, 0.08];

export const Treemap = memo(function Treemap({
  node,
  hovered,
  onHover,
  onOpen,
}: {
  node: DiskViewNode;
  hovered: DiskViewNode | null;
  onHover: (node: DiskViewNode | null) => void;
  onOpen: (node: DiskViewNode) => void;
}) {
  // Layout in a fixed coordinate space, rendered as percentages so it scales with the card.
  const W = 1000;
  const H = 640;
  const children = (node.children ?? []).filter((c) => c.size > 0);
  const rects = useMemo(() => squarify(children.map((c) => c.size), { x: 0, y: 0, w: W, h: H }), [children]);

  return (
    <div className="relative h-full min-h-[360px] w-full overflow-hidden rounded-lg" onMouseLeave={() => onHover(null)}>
      {children.map((child, i) => {
        const r = rects[i];
        if (!r || r.w < 1 || r.h < 1) return null;
        const isRest = child.kind === "rest";
        const big = r.w > 90 && r.h > 56;
        // The label band is ~34 layout units at typical sizes; children fill the inset container below it.
        const box = { x: 0, y: 0, w: r.w, h: Math.max(1, r.h - 34) };
        const inner = big && child.children?.length ? squarify(child.children.map((c) => c.size), box) : [];
        const active = hovered?.path && child.path && (hovered.path === child.path || hovered.path.startsWith(child.path + "/"));
        return (
          <div
            key={child.path ?? `rest-${i}`}
            className={cn(
              "absolute overflow-hidden border border-background transition-[background-color] duration-150",
              !isRest && "cursor-pointer",
              isRest && "bg-[repeating-linear-gradient(135deg,color-mix(in_oklch,var(--foreground)_6%,transparent)_0_4px,transparent_4px_8px)]",
            )}
            style={{
              left: `${(r.x / W) * 100}%`,
              top: `${(r.y / H) * 100}%`,
              width: `${(r.w / W) * 100}%`,
              height: `${(r.h / H) * 100}%`,
              backgroundColor: isRest ? undefined : `color-mix(in oklch, var(--foreground) ${(active ? 30 : TILE_SHADES[Math.min(i, TILE_SHADES.length - 1)] * 100).toFixed(0)}%, transparent)`,
            }}
            onMouseEnter={() => onHover(child)}
            onClick={() => !isRest && onOpen(child)}
          >
            {r.w > 54 && r.h > 22 && (
              <div className="flex items-baseline gap-1.5 px-1.5 pt-1 text-[11px] leading-tight">
                <span className="truncate font-medium">{child.name}</span>
                {r.w > 170 && <span className="tabular shrink-0 text-muted-foreground">{formatBytes(child.size)}</span>}
              </div>
            )}
            {inner.length > 0 && (
            <div className="absolute inset-x-[3px] top-[21px] bottom-[3px]">
            {inner.map((ir, k) => {
              const grand = child.children![k];
              if (!ir || ir.w < 2 || ir.h < 2) return null;
              return (
                <div
                  key={grand.path ?? `r${k}`}
                  className="absolute overflow-hidden rounded-[2px] border border-background/80"
                  style={{
                    left: `${(ir.x / box.w) * 100}%`,
                    top: `${(ir.y / box.h) * 100}%`,
                    width: `${(ir.w / box.w) * 100}%`,
                    height: `${(ir.h / box.h) * 100}%`,
                    backgroundColor: grand.kind === "rest" ? "transparent" : `color-mix(in oklch, var(--foreground) ${hovered?.path === grand.path ? 34 : 12}%, transparent)`,
                  }}
                  onMouseEnter={(e) => {
                    e.stopPropagation();
                    if (grand.kind !== "rest") onHover(grand);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (grand.kind !== "rest") onOpen(grand);
                  }}
                >
                  {ir.w > 70 && ir.h > 18 && <div className="truncate px-1 pt-0.5 text-[10px] text-foreground/80">{grand.name}</div>}
                </div>
              );
            })}
            </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
