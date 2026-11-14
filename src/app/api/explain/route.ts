import { explain } from "@/lib/server/explain";
import { sampler } from "@/lib/server/sampler";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const groupId = url.searchParams.get("group");
  const pid = Number(url.searchParams.get("pid")) || undefined;
  const snapshot = await sampler().current();
  const group =
    snapshot.groups.find((g) => g.id === groupId) ??
    (pid ? snapshot.groups.find((g) => g.processes.some((p) => p.pid === pid)) : undefined);
  if (!group) return Response.json({ error: "That process is no longer running." }, { status: 404 });
  return Response.json(await explain(group, pid));
}
