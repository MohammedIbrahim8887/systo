import { openLoginItemsSettings, setStartupItem, startupReport } from "@/lib/server/startup";

export async function GET() {
  return Response.json(await startupReport(), { headers: { "cache-control": "no-store" } });
}

interface ToggleRequest {
  id?: string;
  enabled?: boolean;
  admin?: boolean;
  action?: "open-settings" | "rescan";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ToggleRequest;
  if (body.action === "rescan") {
    return Response.json(await startupReport(true));
  }
  if (body.action === "open-settings") {
    await openLoginItemsSettings();
    return Response.json({ ok: true, needsAdmin: false, message: "" });
  }
  if (typeof body.id !== "string" || typeof body.enabled !== "boolean") {
    return Response.json({ ok: false, needsAdmin: false, message: "Bad request." }, { status: 400 });
  }
  return Response.json(await setStartupItem(body.id, body.enabled, body.admin === true));
}
