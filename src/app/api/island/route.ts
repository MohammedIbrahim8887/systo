import { currentIslandTint } from "@/lib/server/appearance";
import { islandData, sampler } from "@/lib/server/sampler";
import { loadSettings } from "@/lib/server/settings";
import { storageUsage } from "@/lib/server/system";
import type { Metric } from "@/lib/types";

const METRICS = new Set<Metric>(["cpu", "memory", "disk", "network"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("metric") as Metric | null;
  const metric = requested && METRICS.has(requested) ? requested : "cpu";
  const [snapshot, storage] = await Promise.all([sampler().current("light", { network: metric === "network" }), storageUsage()]);
  return Response.json({ ...islandData(snapshot, metric, storage), tint: currentIslandTint(), colorIcons: loadSettings().colorIcons }, { headers: { "cache-control": "no-store" } });
}
