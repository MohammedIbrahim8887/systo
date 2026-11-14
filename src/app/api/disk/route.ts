import { DISK_ROOTS, disk } from "@/lib/server/disk";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? undefined;
  const depth = Number(url.searchParams.get("depth")) || 3;
  return Response.json(await disk().report(path, depth), { headers: { "cache-control": "no-store" } });
}

interface DiskRequest {
  action?: "scan" | "cancel" | "trash" | "choose";
  root?: "home" | "volume" | string;
  path?: string;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as DiskRequest;
  const analyzer = disk();
  switch (body.action) {
    case "scan": {
      const root = body.root === "home" ? DISK_ROOTS.home : body.root === "volume" ? DISK_ROOTS.volume : body.root;
      if (typeof root !== "string" || !root.startsWith("/")) return Response.json({ ok: false, message: "Choose a folder to scan." }, { status: 400 });
      return Response.json({ ok: true, state: analyzer.start(root) });
    }
    case "cancel":
      analyzer.cancel();
      return Response.json({ ok: true, state: analyzer.state });
    case "trash":
      if (typeof body.path !== "string" || !body.path.startsWith("/")) return Response.json({ ok: false, message: "Bad path." }, { status: 400 });
      return Response.json(await analyzer.trash(body.path));
    case "choose": {
      const path = await analyzer.choose();
      return Response.json({ ok: Boolean(path), path });
    }
    default:
      return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
  }
}
