import { loadAppearance, saveAppearance } from "@/lib/server/appearance";

const NO_STORE = { "cache-control": "no-store" };

export async function GET() {
  return Response.json(loadAppearance(), { headers: NO_STORE });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object") return Response.json({ message: "Bad request." }, { status: 400 });
  try {
    return Response.json(saveAppearance(body), { headers: NO_STORE });
  } catch {
    return Response.json({ message: "Couldn't save the theme." }, { status: 500 });
  }
}
