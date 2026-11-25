import { loadSettings, patchSettings } from "@/lib/server/settings";

const NO_STORE = { "cache-control": "no-store" };

export async function GET() {
  return Response.json(loadSettings(), { headers: NO_STORE });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ message: "Bad request." }, { status: 400 });
  try {
    return Response.json(patchSettings(body), { headers: NO_STORE });
  } catch {
    return Response.json({ message: "Couldn't save your settings." }, { status: 500 });
  }
}
