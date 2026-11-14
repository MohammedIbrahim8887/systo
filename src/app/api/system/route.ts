import { systemInfo } from "@/lib/server/system";

export async function GET() {
  return Response.json(await systemInfo(), { headers: { "cache-control": "no-store" } });
}
