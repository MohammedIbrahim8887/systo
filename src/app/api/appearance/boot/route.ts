import { bootScript } from "@/lib/server/appearance";

/** Loaded by the root layout's <head> ahead of the first paint. */
export async function GET() {
  return new Response(bootScript(), { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
}
