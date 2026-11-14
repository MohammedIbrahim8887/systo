"use client";

import { useEffect, useRef, useState } from "react";

/** Polls a JSON endpoint back-to-back (never overlapping), pausing while the page is hidden. */
export function usePoll<T>(url: string | null, interval: number, paused = false) {
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
      if (!cancelled && !paused) timer = setTimeout(tick, document.hidden ? interval * 4 : interval);
    };

    kick.current = () => void tick();
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [url, interval, paused]);

  return { data, error, refresh: () => kick.current() };
}
