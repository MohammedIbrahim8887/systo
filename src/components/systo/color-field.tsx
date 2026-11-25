"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { RotateCcwIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { hexToHsv, hsvToHex, normalizeHex, readableOn, withAlpha, type Hsv } from "@/lib/color";

const unit = (v: number) => Math.max(0, Math.min(1, v));

/** Follows the pointer inside an element as 0–1 on each axis. */
function useDrag(onMove: (x: number, y: number) => void) {
  const track = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onMove(unit((event.clientX - box.left) / box.width), unit((event.clientY - box.top) / box.height));
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      track(event);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) track(event);
    },
  };
}

function Picker({ value, onChange, suggestions }: { value: string; onChange: (hex: string) => void; suggestions: string[] }) {
  // Hue and saturation live here: black and gray hex values would forget them mid-drag.
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const last = useRef(value);
  useEffect(() => {
    if (value === last.current) return;
    last.current = value;
    setHsv((prev) => {
      const next = hexToHsv(value);
      return next.s === 0 ? { ...next, h: prev.h } : next;
    });
  }, [value]);

  const set = (patch: Partial<Hsv>) => {
    const next = { ...hsv, ...patch };
    const hex = hsvToHex(next);
    setHsv(next);
    last.current = hex;
    onChange(hex);
  };

  const area = useDrag((x, y) => set({ s: x, v: 1 - y }));
  const hue = useDrag((x) => set({ h: Math.min(359.9, x * 360) }));

  const areaKeys = (event: KeyboardEvent) => {
    const by = event.shiftKey ? 0.1 : 0.01;
    if (event.key === "ArrowLeft") set({ s: unit(hsv.s - by) });
    else if (event.key === "ArrowRight") set({ s: unit(hsv.s + by) });
    else if (event.key === "ArrowUp") set({ v: unit(hsv.v + by) });
    else if (event.key === "ArrowDown") set({ v: unit(hsv.v - by) });
    else return;
    event.preventDefault();
  };
  const hueKeys = (event: KeyboardEvent) => {
    const by = event.shiftKey ? 15 : 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") set({ h: (hsv.h - by + 360) % 360 });
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") set({ h: (hsv.h + by) % 360 });
    else return;
    event.preventDefault();
  };

  return (
    <div className="w-[216px] space-y-3">
      <div
        {...area}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        onKeyDown={areaKeys}
        className="relative h-36 touch-none rounded-md ring-1 ring-foreground/10 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
      >
        <span
          className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }}
        />
      </div>
      <div
        {...hue}
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onKeyDown={hueKeys}
        className="relative h-3 touch-none rounded-full ring-1 ring-foreground/10 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
      >
        <span
          className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
          style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="grid grid-cols-9 gap-1.5" aria-label="Colors from the themes">
          {suggestions.map((hex) => (
            <button
              key={hex}
              type="button"
              title={hex.toUpperCase()}
              aria-label={hex.toUpperCase()}
              onClick={() => onChange(hex)}
              className="aspect-square rounded-full ring-1 ring-foreground/15 outline-none transition-transform hover:scale-115 focus-visible:ring-2 focus-visible:ring-ring"
              style={{ background: hex }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A pill filled with its color: the circle opens the picker, the text takes a hex value. */
export function ColorField({
  label,
  value,
  base,
  suggestions = [],
  onChange,
}: {
  label: string;
  value: string;
  /** The theme's own color, offered as a reset once this one differs. */
  base: string;
  suggestions?: string[];
  onChange: (hex: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const ink = readableOn(value);
  const invalid = draft !== null && !normalizeHex(draft);

  const type = (text: string) => {
    setDraft(text);
    const hex = normalizeHex(text);
    // Three digits are also the start of six, so they wait for Enter or blur.
    if (hex && text.trim().replace("#", "").length === 6) onChange(hex);
  };
  const commit = () => {
    const hex = draft !== null && normalizeHex(draft);
    if (hex) onChange(hex);
    setDraft(null);
  };

  return (
    <div className="flex items-center gap-1.5">
      {value !== base && (
        <button
          type="button"
          title={`Reset to ${base.toUpperCase()}`}
          aria-label={`Reset ${label.toLowerCase()} to ${base.toUpperCase()}`}
          onClick={() => onChange(base)}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCcwIcon className="size-3.5" />
        </button>
      )}
      <div
        className="flex h-8 w-44 items-center gap-2 rounded-md border pr-2 pl-1.5 transition-shadow focus-within:ring-[3px] focus-within:ring-ring/40"
        style={{ background: value, color: ink, borderColor: withAlpha(ink, 0.22) }}
      >
        <Popover>
          <PopoverTrigger
            aria-label={`Pick the ${label.toLowerCase()} color`}
            className="size-5 shrink-0 rounded-full border outline-none transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current"
            style={{ borderColor: withAlpha(ink, 0.5), background: withAlpha(ink, 0.08) }}
          />
          <PopoverContent>
            <Picker value={value} onChange={onChange} suggestions={suggestions} />
          </PopoverContent>
        </Popover>
        <input
          aria-label={`${label} hex value`}
          aria-invalid={invalid}
          spellCheck={false}
          autoComplete="off"
          maxLength={9}
          value={draft ?? value.toUpperCase()}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => type(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            else if (event.key === "Escape" && draft !== null) {
              event.stopPropagation();
              setDraft(null);
            }
          }}
          className={`w-full min-w-0 bg-transparent font-mono text-[12px] outline-none ${invalid ? "underline decoration-wavy underline-offset-2" : ""}`}
        />
      </div>
    </div>
  );
}
