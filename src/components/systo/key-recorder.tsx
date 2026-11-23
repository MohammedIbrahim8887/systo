"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlertIcon, CircleCheckIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import {
  comboFromEvent,
  comboId,
  keyCap,
  modifierCap,
  modsFromEvent,
  MODIFIER_ORDER,
  type ComboCheck,
  type KeyCombo,
  type Modifier,
} from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { HOTKEY_OS, KeyCap, KeyCaps } from "./keycaps";

export interface Verdict {
  tone: "ok" | "warn" | "error";
  text: ReactNode;
}

const SLOT_ORDER: Modifier[] = HOTKEY_OS === "mac" ? MODIFIER_ORDER : ["meta", "ctrl", "alt", "shift"];

/** Tells the shell to stop listening while we record, so pressing an existing shortcut doesn't fire it. */
export function setListening(on: boolean) {
  void fetch("/api/hotkeys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: on ? "resume" : "pause" }),
    keepalive: true,
  }).catch(() => {});
}

/**
 * Records a key combination. While recording, every modifier gets a slot that lights up the moment
 * it's held, so people see exactly what Systo is reading; the key lands in the last slot and the
 * combo settles into place. Esc cancels, ⌫ clears.
 */
export function KeyRecorder({
  value,
  onChange,
  recording,
  onRecordingChange,
  validate,
  verdict,
}: {
  value: KeyCombo | null;
  onChange: (combo: KeyCombo | null) => void;
  recording: boolean;
  onRecordingChange: (recording: boolean) => void;
  validate: (combo: KeyCombo) => ComboCheck;
  verdict: Verdict | null;
}) {
  const [held, setHeld] = useState<Modifier[]>([]);
  const [rejected, setRejected] = useState<{ combo: KeyCombo | null; reason: string; at: number } | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const latest = useRef({ validate, onChange, onRecordingChange });
  latest.current = { validate, onChange, onRecordingChange };

  const stop = useCallback(() => {
    setHeld([]);
    setRejected(null);
    latest.current.onRecordingChange(false);
  }, []);

  useEffect(() => {
    if (!recording) return;
    setListening(false);

    const onKeyDown = (event: KeyboardEvent) => {
      // Capture phase on window: we see the key before the dialog (Esc) or the app (⌘1) does.
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      const combo = comboFromEvent(event);
      if (!combo.key) {
        const isModifier = /^(Shift|Control|Alt|Meta|OS)/.test(event.code);
        if (isModifier) {
          setHeld(combo.mods);
          setRejected(null);
        } else {
          setRejected({ combo: null, reason: "That key can't be part of a shortcut.", at: Date.now() });
        }
        return;
      }
      if (combo.mods.length === 0 && combo.key === "Escape") {
        stop();
        return;
      }
      if (combo.mods.length === 0 && (combo.key === "Backspace" || combo.key === "Delete")) {
        latest.current.onChange(null);
        setRejected(null);
        return;
      }
      const check = latest.current.validate(combo);
      if (!check.ok) {
        setRejected({ combo, reason: check.reason, at: Date.now() });
        return;
      }
      latest.current.onChange(combo);
      stop();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setHeld(modsFromEvent(event));
    };
    const onBlur = () => setHeld([]);
    const onPointerDown = (event: PointerEvent) => {
      if (surface.current && !surface.current.contains(event.target as Node)) stop();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerdown", onPointerDown, true);
      setListening(true);
    };
  }, [recording, stop]);

  const start = () => {
    setRejected(null);
    setHeld([]);
    onRecordingChange(true);
    surface.current?.focus();
  };

  return (
    <div className="space-y-2">
      <div
        ref={surface}
        role="button"
        tabIndex={0}
        aria-label={recording ? "Recording. Press the keys for your shortcut." : "Record a shortcut"}
        aria-live="polite"
        onClick={() => !recording && start()}
        onKeyDown={(event) => {
          if (!recording && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            start();
          }
        }}
        className={cn(
          "group/recorder relative flex h-[150px] cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border outline-none transition-colors",
          "focus-visible:ring-[3px] focus-visible:ring-ring/40",
          recording ? "cursor-default border-foreground/30 bg-background animate-[systo-listen_1.8s_ease-in-out_infinite]" : "bg-muted/40 hover:bg-muted/70",
        )}
      >
        {/* Dotted backdrop: quiet texture that says "keyboard surface" without color. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(color-mix(in_oklch,var(--foreground)_14%,transparent)_1px,transparent_1px)] [background-size:14px_14px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
        />

        {recording ? (
          <Recording held={held} rejected={rejected} />
        ) : value ? (
          <div key={comboId(value)} className="relative flex flex-col items-center gap-3">
            <span className="animate-[systo-key-in_220ms_ease-out]">
              <KeyCaps combo={value} size="lg" />
            </span>
            <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground opacity-0 transition-opacity group-hover/recorder:opacity-100 group-focus-visible/recorder:opacity-100">
              <RotateCcwIcon className="size-3" /> Click to record again
            </span>
          </div>
        ) : (
          <div className="relative flex flex-col items-center gap-3">
            <span className="flex items-center gap-2">
              {SLOT_ORDER.slice(-2).map((m) => (
                <KeyCap key={m} cap={modifierCap(m, HOTKEY_OS)} size="lg" state="ghost" />
              ))}
              <KeyCap cap={{ label: "K" }} size="lg" state="ghost" />
            </span>
            <span className="text-[12.5px] font-medium text-foreground/80">Click to record a shortcut</span>
          </div>
        )}
      </div>

      <div className="flex min-h-[20px] items-start gap-1.5 px-0.5 text-[12px] leading-snug">
        {recording ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <KeyCap cap={keyCap("Escape", HOTKEY_OS)} /> to cancel
            <span className="text-muted-foreground/40">·</span>
            <KeyCap cap={keyCap("Backspace", HOTKEY_OS)} /> to clear
          </span>
        ) : verdict ? (
          <VerdictLine verdict={verdict} />
        ) : null}
      </div>
    </div>
  );
}

function Recording({ held, rejected }: { held: Modifier[]; rejected: { combo: KeyCombo | null; reason: string; at: number } | null }) {
  return (
    <div className="relative flex flex-col items-center gap-3">
      {rejected?.combo ? (
        <span key={rejected.at} className="flex animate-[systo-shake_320ms_ease-in-out] items-center gap-2">
          {SLOT_ORDER.filter((m) => rejected.combo!.mods.includes(m)).map((m) => (
            <KeyCap key={m} cap={modifierCap(m, HOTKEY_OS)} size="lg" state="invalid" />
          ))}
          <KeyCap cap={keyCap(rejected.combo.key, HOTKEY_OS)} size="lg" state="invalid" />
        </span>
      ) : (
        <span key={rejected?.at} className={cn("flex items-center gap-2", rejected && "animate-[systo-shake_320ms_ease-in-out]")}>
          {SLOT_ORDER.map((m) => {
            const on = held.includes(m);
            return (
              <span key={m} className={cn("transition-opacity duration-100", on ? "opacity-100" : "opacity-60")}>
                <KeyCap cap={modifierCap(m, HOTKEY_OS)} size="lg" state={on ? "held" : "ghost"} />
              </span>
            );
          })}
          <span className="mx-0.5 h-8 w-px bg-border" aria-hidden />
          <KeyCap cap={{ label: held.length ? "…" : "?" }} size="lg" state="ghost" className={held.length ? "border-foreground/40" : ""} />
        </span>
      )}
      <span className={cn("text-[12.5px] font-medium", rejected ? "text-foreground" : "text-foreground/80")}>
        {rejected ? rejected.reason : held.length ? "Now press a key" : "Press your shortcut"}
      </span>
    </div>
  );
}

export function VerdictLine({ verdict }: { verdict: Verdict }) {
  const Icon = verdict.tone === "ok" ? CircleCheckIcon : verdict.tone === "warn" ? TriangleAlertIcon : CircleAlertIcon;
  return (
    <span className={cn("flex items-start gap-1.5 animate-in fade-in-0 duration-200", verdict.tone === "ok" ? "text-muted-foreground" : "text-foreground")}>
      <Icon className={cn("mt-[1.5px] size-3.5 shrink-0", verdict.tone === "error" && "fill-foreground text-background")} />
      <span>{verdict.text}</span>
    </span>
  );
}
