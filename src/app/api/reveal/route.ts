import { reveal } from "@/lib/server/actions";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { path?: string };
  const ok = typeof body.path === "string" && (await reveal(body.path));
  return Response.json({ ok });
}
