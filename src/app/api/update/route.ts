import type { UpdateState } from "@/lib/update-types";

interface Bridge {
  state: () => UpdateState;
  check: () => Promise<void>;
  install: () => Promise<void>;
}

/** The desktop shell owns the updater (src/shell/updater.ts); the dev server has none. */
const bridge = () => (globalThis as { __systoUpdater?: Bridge }).__systoUpdater;
const unavailable: UpdateState = { phase: "unavailable", version: process.env.npm_package_version ?? "" };

export async function GET() {
  return Response.json(bridge()?.state() ?? unavailable, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  const updater = bridge();
  if (!updater) return Response.json(unavailable);
  if (body.action === "check") await updater.check();
  else if (body.action === "install") void updater.install();
  else return Response.json({ error: "Unknown action." }, { status: 400 });
  return Response.json(updater.state());
}
