import { metricValue, sampler } from "@/lib/server/sampler";
import type { Metric, ProcessGroup, Snapshot } from "@/lib/types";

const METRICS: Metric[] = ["cpu", "memory", "disk", "network"];
/** Enough for the Performance view's top-consumer lists. */
const SUMMARY_TOP = 6;

/** Only the views' top consumers, without per-process rows: a few KB instead of a few hundred. */
function summarize(snapshot: Snapshot): Snapshot {
  const keep = new Map<string, ProcessGroup>();
  for (const metric of METRICS) {
    snapshot.groups
      .filter((g) => !(metric === "cpu" && g.kind === "kernel"))
      .sort((a, b) => metricValue(b, metric) - metricValue(a, metric))
      .slice(0, SUMMARY_TOP)
      .forEach((g) => keep.set(g.id, g));
  }
  return { ...snapshot, groups: [...keep.values()].map((g) => ({ ...g, processes: [] })) };
}

/** Two decimals is more precision than any column shows, and keeps the JSON small. */
const compact = (_key: string, value: unknown) =>
  typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 100) / 100 : value;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const interval = Number(url.searchParams.get("interval"));
  const s = sampler();
  if (interval) s.setInterval(interval);
  const snapshot = await s.current("full");
  const body = url.searchParams.get("scope") === "summary" ? summarize(snapshot) : snapshot;
  return new Response(JSON.stringify(body, compact), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
