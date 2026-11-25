"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from "../settings";

declare global {
  interface Window {
    /** Set by /api/appearance/boot before the first paint. */
    __systoSettings?: unknown;
  }
}

export function bootSettings(): Settings {
  return sanitizeSettings(window.__systoSettings);
}

let queue: Promise<unknown> = Promise.resolve();

/** Saves in order, so two quick changes to one setting can't land the wrong way round. */
export function saveSettings(patch: Partial<Settings>): Promise<void> {
  const result = queue.then(async () => {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      keepalive: true,
    });
    if (!response.ok) throw new Error(`Settings weren't saved (HTTP ${response.status})`);
  });
  queue = result.catch(() => {});
  return result;
}

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

const SettingsContext = createContext<SettingsContextValue>({ settings: DEFAULT_SETTINGS, update: () => {} });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(bootSettings);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    saveSettings(patch).catch(() => toast.error("Couldn't save your settings. They stay until you close Systo.", { id: "settings-save" }));
  }, []);

  const value = useMemo(() => ({ settings, update }), [settings, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  return useContext(SettingsContext);
}
