"use client";

import { IS_LINUX, IS_WINDOWS } from "@/lib/platform";
import { comboCaps, comboSpoken, type HotkeyOS, type KeyCap as Cap, type KeyCombo } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";

export const HOTKEY_OS: HotkeyOS = IS_WINDOWS ? "windows" : IS_LINUX ? "linux" : "mac";

type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, { cap: string; label: string; caption: string; gap: string }> = {
  sm: { cap: "h-[22px] min-w-[22px] rounded-[5px] px-1.5 border-b-2", label: "text-[11.5px]", caption: "hidden", gap: "gap-1" },
  md: { cap: "h-8 min-w-8 rounded-[7px] px-2 border-b-[2.5px]", label: "text-[14px]", caption: "hidden", gap: "gap-1.5" },
  lg: { cap: "h-[52px] min-w-[52px] rounded-[10px] px-3 border-b-[3px]", label: "text-[20px]", caption: "text-[9px]", gap: "gap-2" },
};

/**
 * One key, drawn like a physical cap: a thicker bottom edge that flattens while it's held.
 * `ghost` is an empty slot waiting for a key.
 */
export function KeyCap({
  cap,
  size = "sm",
  state = "idle",
  className,
}: {
  cap: Pick<Cap, "label" | "caption">;
  size?: Size;
  state?: "idle" | "held" | "ghost" | "invalid";
  className?: string;
}) {
  const s = SIZES[size];
  const wordy = cap.label.length > 2;
  return (
    <kbd
      className={cn(
        "inline-flex shrink-0 flex-col items-center justify-center border font-sans leading-none font-medium transition-[transform,border-width,background-color,opacity,color] duration-100 select-none",
        s.cap,
        state === "ghost"
          ? "border-dashed border-foreground/20 bg-transparent text-muted-foreground/50"
          : state === "invalid"
            ? "border-foreground/20 bg-muted text-muted-foreground line-through decoration-foreground/40"
            : "border-foreground/[0.13] border-b-foreground/25 bg-background text-foreground shadow-[0_1px_1px_0_rgb(0_0_0/0.04)] dark:border-white/[0.09] dark:border-b-white/20 dark:bg-white/[0.06]",
        state === "held" && "translate-y-[1.5px] border-b-[1px] bg-accent",
        className,
      )}
    >
      <span className={cn(s.label, wordy && size !== "sm" && "text-[0.8em]", "tracking-tight")}>{cap.label}</span>
      {cap.caption && size === "lg" && <span className={cn(s.caption, "mt-1 font-normal tracking-wide text-muted-foreground")}>{cap.caption}</span>}
    </kbd>
  );
}

/** A whole combo as caps. On Windows and Linux the caps read "Ctrl + Alt + T" with quiet plus signs. */
export function KeyCaps({ combo, size = "sm", os = HOTKEY_OS, className }: { combo: KeyCombo; size?: Size; os?: HotkeyOS; className?: string }) {
  const caps = comboCaps(combo, os);
  return (
    <span className={cn("inline-flex items-center", SIZES[size].gap, className)} aria-label={comboSpoken(combo, os)} role="img">
      {caps.map((cap, i) => (
        <span key={`${cap.label}-${i}`} className={cn("inline-flex items-center", SIZES[size].gap)}>
          {os !== "mac" && i > 0 && <span className={cn("text-muted-foreground/60", size === "sm" ? "text-[10px]" : "text-[12px]")}>+</span>}
          <KeyCap cap={cap} size={size} />
        </span>
      ))}
    </span>
  );
}
