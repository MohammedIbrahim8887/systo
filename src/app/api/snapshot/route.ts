import { sampler } from "@/lib/server/sampler";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const interval = Number(url.searchParams.get("interval"));
  const s = sampler();
  if (interval) s.setInterval(interval);
  const snapshot = await s.current();
  return Response.json(snapshot, { headers: { "cache-control": "no-store" } });
}
