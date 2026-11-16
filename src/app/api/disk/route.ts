import { isAbsolutePath } from "@/lib/platform";
import { DISK_ROOTS, disk } from "@/lib/server/disk";

const slash = (p: string) => (process.platform === "win32" ? p.replace(/\\/g, "/") : p);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("path");
  const path = raw ? slash(raw) : undefined;
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
      if (typeof root !== "string" || !(root === "/" || isAbsolutePath(root))) return Response.json({ ok: false, message: "Choose a folder to scan." }, { status: 400 });
      return Response.json({ ok: true, state: analyzer.start(root) });
    }
    case "cancel":
      analyzer.cancel();
      return Response.json({ ok: true, state: analyzer.state });
    case "trash":
      if (typeof body.path !== "string" || !isAbsolutePath(body.path)) return Response.json({ ok: false, message: "Bad path." }, { status: 400 });
      return Response.json(await analyzer.trash(slash(body.path)));
    case "choose": {
      try {
        const path = await analyzer.choose();
        return Response.json({ ok: Boolean(path), path });
      } catch (error) {
        return Response.json({ ok: false, message: (error as Error).message });
      }
    }
    default:
      return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
  }
}
