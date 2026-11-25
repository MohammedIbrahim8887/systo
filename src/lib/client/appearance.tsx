"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTheme } from "@farm.js/core/theme/client";
import { toast } from "sonner";
import { appearanceCss, applyPreset, sanitizeAppearance, slotBlur, type Appearance, type SlotTheme, type ThemeMode, type Variant } from "../theme";
import { sendShellCommand, useShellState } from "./shell";

declare global {
  interface Window {
    /** Set by /api/appearance/boot before the first paint. */
    __systoAppearance?: unknown;
  }
}

const SAVE_DELAY_MS = 250;
/** Longer than sendShellCommand keeps its hash, so dragging a slider never overlaps two commands. */
const WINDOW_DELAY_MS = 80;

interface AppearanceContextValue {
  appearance: Appearance;
  /** What's on screen: the same, unless a preset is being previewed. */
  shown: Appearance;
  /** The slot on screen right now. */
  active: Variant;
  setMode: (mode: ThemeMode) => void;
  patchSlot: (variant: Variant, patch: Partial<SlotTheme>) => void;
  /** Shows a preset across the app without choosing it; null goes back. */
  preview: (variant: Variant, preset: string | null) => void;
  /** Whether this window can be see-through (the desktop app on macOS). */
  translucency: boolean;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function applyCss(css: string) {
  let style = document.getElementById("systo-theme");
  if (!style) {
    style = document.createElement("style");
    style.id = "systo-theme";
    document.head.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

function save(appearance: Appearance, keepalive = false) {
  return fetch("/api/appearance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(appearance),
    keepalive,
  });
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(() => sanitizeAppearance(window.__systoAppearance));
  const [previewing, setPreviewing] = useState<{ variant: Variant; preset: string } | null>(null);
  const { resolvedTheme, setTheme } = useTheme();
  const shell = useShellState();
  const translucency = Boolean(shell?.translucency);
  const active: Variant = resolvedTheme === "light" ? "light" : "dark";

  const shown = useMemo<Appearance>(
    () => (previewing ? { ...appearance, [previewing.variant]: applyPreset(appearance[previewing.variant], previewing.preset, previewing.variant) } : appearance),
    [appearance, previewing],
  );

  useEffect(() => applyCss(appearanceCss(shown)), [shown]);

  // Saved a moment after the last change, and straight away if the window closes first.
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; value: Appearance } | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (pending.current) clearTimeout(pending.current.timer);
    const timer = setTimeout(() => {
      pending.current = null;
      save(appearance)
        .then((response) => {
          if (!response.ok) throw new Error();
        })
        .catch(() => toast.error("Couldn't save your theme. It stays until you close Systo.", { id: "theme-save" }));
    }, SAVE_DELAY_MS);
    pending.current = { timer, value: appearance };
  }, [appearance]);
  useEffect(() => {
    const flush = () => {
      if (!pending.current) return;
      clearTimeout(pending.current.timer);
      void save(pending.current.value, true).catch(() => {});
      pending.current = null;
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  // The window itself: title bar color, and what shows through it.
  const slot = shown[active];
  const translucent = translucency && slot.window === "translucent";
  useEffect(() => {
    const root = document.documentElement;
    if (translucent) root.dataset.window = slot.sidebarOnly ? "sidebar" : "glass";
    else delete root.dataset.window;
    return () => {
      delete root.dataset.window;
    };
  }, [translucent, slot.sidebarOnly]);
  const desktop = Boolean(shell?.desktop);
  const blur = slotBlur(slot);
  useEffect(() => {
    if (!desktop) return;
    const timer = setTimeout(() => {
      sendShellCommand({ type: "window-theme", variant: active, background: slot.background, opacity: translucent ? slot.opacity : 100, blur: translucent ? blur : 0 });
    }, WINDOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [desktop, active, translucent, slot.background, slot.opacity, blur]);

  const setMode = useCallback(
    (mode: ThemeMode) => {
      setTheme(mode);
      setAppearance((prev) => ({ ...prev, mode }));
    },
    [setTheme],
  );
  const patchSlot = useCallback((variant: Variant, patch: Partial<SlotTheme>) => {
    setAppearance((prev) => ({ ...prev, [variant]: { ...prev[variant], ...patch } }));
  }, []);
  const preview = useCallback((variant: Variant, preset: string | null) => setPreviewing(preset ? { variant, preset } : null), []);

  const value = useMemo(
    () => ({ appearance, shown, active, setMode, patchSlot, preview, translucency }),
    [appearance, shown, active, setMode, patchSlot, preview, translucency],
  );
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("useAppearance needs an AppearanceProvider.");
  return value;
}
