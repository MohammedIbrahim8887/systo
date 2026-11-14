"use client";

import { useEffect, useState } from "react";
import type { Metric } from "../types";

/** State the Electrobun shell pushes into the page with executeJavascript. */
export interface ShellState {
  desktop: boolean;
  island: boolean;
  notch: boolean;
}

declare global {
  interface Window {
    __systoShell?: ShellState;
  }
}

export type ShellCommand =
  | { type: "island"; enabled: boolean }
  | { type: "island-metric"; metric: Metric }
  | { type: "open-main" }
  | { type: "collapse-island" };

/**
 * Sandboxed pages have no RPC bridge, so commands travel as a same-document hash navigation the
 * shell observes (`did-navigate-in-page`). The hash is cleared right after.
 */
export function sendShellCommand(command: ShellCommand) {
  const payload = encodeURIComponent(JSON.stringify(command));
  const nonce = Math.random().toString(36).slice(2, 10);
  const base = location.pathname + location.search;
  location.hash = `systo=${payload}&n=${nonce}`;
  setTimeout(() => history.replaceState(history.state, "", base), 60);
  // Same command over HTTP; the shell ignores whichever copy arrives second.
  void fetch("/api/shell", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command, nonce }),
  }).catch(() => {});
}

export function useShellState(): ShellState | null {
  const [state, setState] = useState<ShellState | null>(null);
  useEffect(() => {
    const read = () => setState(window.__systoShell ? { ...window.__systoShell } : null);
    read();
    window.addEventListener("systo:shell", read);
    return () => window.removeEventListener("systo:shell", read);
  }, []);
  return state;
}
