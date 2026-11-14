import { endProcesses } from "@/lib/server/actions";
import { sampler } from "@/lib/server/sampler";
import type { KillMode } from "@/lib/types";

const MODES = new Set<KillMode>(["quit", "terminate", "force"]);

interface EndRequest {
  groupId?: string;
  pids?: number[];
  mode?: KillMode;
  admin?: boolean;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as EndRequest;
  const mode = body.mode && MODES.has(body.mode) ? body.mode : "terminate";
  const snapshot = await sampler().current();
  let pids = Array.isArray(body.pids) ? body.pids.map(Number) : [];
  let bundleId: string | undefined;
  if (body.groupId) {
    const group = snapshot.groups.find((g) => g.id === body.groupId);
    if (!group) return Response.json({ ok: true, killed: [], failed: [], needsAdmin: false, message: "Already gone." });
    pids = group.processes.filter((p) => !p.self).map((p) => p.pid);
    if (group.kind === "app" || group.kind === "system-app" || group.kind === "menu-bar") bundleId = group.bundleId;
  }
  const result = await endProcesses(pids, mode, { bundleId, admin: body.admin === true, windowPids: sampler().windowPids });
  setTimeout(() => void sampler().refresh(), 350);
  return Response.json(result);
}
