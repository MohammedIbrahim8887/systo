import { useEffect, useState } from "react";
import type { Platform } from "./releases";

/**
 * Example data for the live replicas of the island and the Processes table. The values move the
 * way a real machine's do (a browser spikes, a build runs, memory barely moves) so the page shows
 * Systo working; it is labeled as example data wherever it appears.
 */

export type Section = "apps" | "background" | "system";
export type Glyph = "globe" | "message" | "pen" | "music" | "code" | "terminal" | "cloud" | "search" | "shield" | "cpu" | "folder" | "mail";

export interface DemoProcess {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
}

export interface DemoGroup {
  id: string;
  name: string;
  kind: string;
  section: Section;
  glyph: Glyph;
  cpu: number;
  memory: number;
  disk: number;
  network: number;
  processes: DemoProcess[];
}

interface Seed {
  name: Record<Platform, string>;
  kind: Record<Platform, string>;
  section: Section;
  glyph: Glyph;
  cpu: number;
  memory: number;
  disk: number;
  network: number;
  spiky?: number;
  helpers?: Record<Platform, string>;
  count?: number;
}

const same = (s: string) => ({ macos: s, windows: s });

const SEEDS: Seed[] = [
  { name: same("Chrome"), kind: same("App"), section: "apps", glyph: "globe", cpu: 9, memory: 1.9e9, disk: 2e5, network: 3.1e5, spiky: 14, helpers: { macos: "Google Chrome Helper (Renderer)", windows: "chrome.exe" }, count: 14 },
  { name: same("Figma"), kind: same("App"), section: "apps", glyph: "pen", cpu: 6, memory: 1.1e9, disk: 4e4, network: 6e4, spiky: 8, helpers: { macos: "Figma Helper (GPU)", windows: "Figma.exe" }, count: 5 },
  { name: same("Slack"), kind: same("App"), section: "apps", glyph: "message", cpu: 1.2, memory: 6.4e8, disk: 1e4, network: 2.2e4, helpers: { macos: "Slack Helper", windows: "slack.exe" }, count: 4 },
  { name: same("Spotify"), kind: same("App"), section: "apps", glyph: "music", cpu: 2.1, memory: 3.9e8, disk: 6e4, network: 1.6e5, helpers: { macos: "Spotify Helper", windows: "Spotify.exe" }, count: 3 },
  { name: { macos: "Mail", windows: "Outlook" }, kind: { macos: "macOS App", windows: "App" }, section: "apps", glyph: "mail", cpu: 0.3, memory: 2.1e8, disk: 0, network: 4e3 },
  { name: same("node"), kind: same("Dev Tool"), section: "background", glyph: "terminal", cpu: 11, memory: 7.6e8, disk: 1.4e6, network: 0, spiky: 22, helpers: same("node"), count: 3 },
  { name: { macos: "Dropbox", windows: "OneDrive" }, kind: { macos: "Menu Bar App", windows: "Background App" }, section: "background", glyph: "cloud", cpu: 0.6, memory: 2.4e8, disk: 3e5, network: 9e4 },
  { name: { macos: "Docker Desktop", windows: "Docker Desktop" }, kind: same("3rd-party Service"), section: "background", glyph: "code", cpu: 1.8, memory: 1.3e9, disk: 2e4, network: 0 },
  { name: { macos: "Spotlight", windows: "Windows Search" }, kind: { macos: "macOS Service", windows: "Windows Service" }, section: "system", glyph: "search", cpu: 3.4, memory: 4.7e8, disk: 2.6e6, network: 0, spiky: 9 },
  { name: { macos: "WindowServer", windows: "Desktop Window Manager" }, kind: { macos: "macOS Service", windows: "Windows Service" }, section: "system", glyph: "cpu", cpu: 7.5, memory: 3.2e8, disk: 0, network: 0, spiky: 4 },
  { name: { macos: "Finder", windows: "File Explorer" }, kind: { macos: "macOS App", windows: "Windows App" }, section: "system", glyph: "folder", cpu: 0.2, memory: 1.4e8, disk: 1e3, network: 0 },
  { name: { macos: "XProtect", windows: "Microsoft Defender" }, kind: { macos: "macOS Service", windows: "Windows Service" }, section: "system", glyph: "shield", cpu: 0.4, memory: 1.9e8, disk: 8e4, network: 0 },
];

export const CORES = 10;
export const MEMORY_TOTAL = 24e9;

function jitter(base: number, spread: number, spiky = 0) {
  const burst = spiky && Math.random() < 0.18 ? Math.random() * spiky : 0;
  return Math.max(0, base + (Math.random() - 0.5) * spread + burst);
}

function sample(platform: Platform): DemoGroup[] {
  let pid = platform === "macos" ? 412 : 1180;
  return SEEDS.map((s) => {
    const cpu = jitter(s.cpu, s.cpu * 0.6, s.spiky);
    const memory = s.memory * (0.97 + Math.random() * 0.06);
    const count = s.count ?? 1;
    const processes: DemoProcess[] = Array.from({ length: count }, (_, i) => {
      pid += 37 + ((i * 53) % 91);
      return {
        pid,
        name: i === 0 ? s.name[platform] : (s.helpers?.[platform] ?? s.name[platform]),
        cpu: i === 0 ? cpu * 0.45 : (cpu * 0.55) / Math.max(1, count - 1),
        memory: i === 0 ? memory * 0.4 : (memory * 0.6) / Math.max(1, count - 1),
      };
    });
    return {
      id: s.name.macos,
      name: s.name[platform],
      kind: s.kind[platform],
      section: s.section,
      glyph: s.glyph,
      cpu,
      memory,
      disk: jitter(s.disk, s.disk, s.disk ? 1 : 0),
      network: jitter(s.network, s.network * 0.8),
      processes,
    };
  });
}

export interface DemoState {
  groups: DemoGroup[];
  cpu: number;
  memoryUsed: number;
  storage: number;
  netIn: number;
  netOut: number;
}

/** One shared clock for every replica on the page, ticking like Systo's default 1.5s. */
export function useDemo(platform: Platform, paused = false): DemoState {
  const [groups, setGroups] = useState(() => sample(platform));
  useEffect(() => {
    setGroups(sample(platform));
    if (paused) return;
    const timer = setInterval(() => {
      if (!document.hidden) setGroups(sample(platform));
    }, 1500);
    return () => clearInterval(timer);
  }, [platform, paused]);
  const cpu = Math.min(100, groups.reduce((s, g) => s + g.cpu, 0) / CORES + 4);
  const memoryUsed = groups.reduce((s, g) => s + g.memory, 0) + 6.1e9;
  const net = groups.reduce((s, g) => s + g.network, 0);
  return { groups, cpu, memoryUsed, storage: 61, netIn: net * 0.82, netOut: net * 0.18 };
}
