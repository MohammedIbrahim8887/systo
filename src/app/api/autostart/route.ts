import { autostartState, setAutostart } from "@/lib/server/autostart";

export async function GET() {
  return Response.json(await autostartState(), { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") return Response.json({ ok: false, message: "Bad request." }, { status: 400 });
  return Response.json(await setAutostart(body.enabled));
}
