"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Polls a JSON endpoint back-to-back (never overlapping). Polling stops while the page is hidden
 * (minimized, another Space, island hidden) and resumes with a fresh read when it's visible again.
 */
export function usePoll<T>(url: string | null, interval: number, paused = false, options: { whenHidden?: boolean } = {}) {
  // The island overlay can read as hidden to WebKit (it sits over the notch), but it's on screen.
  const pauseHidden = !options.whenHidden;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const tick = async () => {
      clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      try {
        const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const json = (await res.json()) as T;
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (cancelled || (err as Error).name === "AbortError") return;
        setError((err as Error).message);
      }
      if (!cancelled && !paused && !(pauseHidden && document.hidden)) timer = setTimeout(tick, interval);
    };

    const onVisibility = () => {
      if (!pauseHidden) return;
      if (document.hidden) clearTimeout(timer);
      else if (!paused) void tick();
    };

    kick.current = () => void tick();
    void tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [url, interval, paused, pauseHidden]);

  return { data, error, refresh: () => kick.current() };
}
