import { sampler } from "@/lib/server/sampler";
import { USAGE_METRICS, USAGE_RANGES, usage } from "@/lib/server/usage";
import type { UsageMetric, UsageRange } from "@/lib/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const range = url.searchParams.get("range") as UsageRange | null;
  const metric = url.searchParams.get("metric") as UsageMetric | null;
  // Recording rides on the sampler; make sure it's running even if only this view is open.
  sampler().runInBackground();
  const report = await usage().report(
    range && USAGE_RANGES.includes(range) ? range : "1h",
    metric && USAGE_METRICS.includes(metric) ? metric : "cpu",
  );
  return Response.json(report, { headers: { "cache-control": "no-store" } });
}
