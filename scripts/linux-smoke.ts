// Exercises the Linux data layer on a real Linux machine (CI): run with `bun scripts/linux-smoke.ts`.
import { readLinux } from "../src/lib/server/linux/native";
import { sampler, islandData } from "../src/lib/server/sampler";
import { systemInfo, storageUsage } from "../src/lib/server/system";
import { startupReport } from "../src/lib/server/startup";
import { explain } from "../src/lib/server/explain";

let failed = false;
const check = (label: string, ok: boolean, detail: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`, typeof detail === "string" ? detail : JSON.stringify(detail));
  if (!ok) failed = true;
};

const raw = readLinux();
// Counts are kept low on purpose: a CI container may run little more than this script.
check("/proc reader", Boolean(raw && raw.procs.some((p) => p.pid === process.pid)), { procs: raw?.procs.length, readable: raw?.procs.filter((p) => p.readable).length, kernel: raw?.procs.filter((p) => p.kthread).length });
check("process paths", Boolean(raw?.procs.some((p) => p.path.startsWith("/") && p.readable)), raw?.procs.filter((p) => p.path).slice(0, 5).map((p) => [p.pid, p.comm, p.path, p.memory]));
check("init is pid 1", raw?.procs.find((p) => p.pid === 1)?.ppid === 0, raw?.procs.find((p) => p.pid === 1));
check("memory", Boolean(raw && raw.memory.total > 1e8 && raw.memory.available > 0), raw?.memory);
check("cpu counters", Boolean(raw && raw.cpu.busy + raw.cpu.idle > 0), raw?.cpu);
check("disks and network interfaces", Boolean(raw), { disk: raw?.disk, net: raw?.net, gpu: raw?.gpu });

const s = sampler();
await s.current("full");
await new Promise((r) => setTimeout(r, 1500));
const snap = await s.refresh();
check("snapshot totals", snap.totals.memoryUsed > 0 && snap.totals.cpu >= 0 && snap.totals.cpu <= 100, snap.totals);
check("groups", snap.groups.length > 0 && snap.groups.every((g) => g.processes.length > 0), [...snap.groups].sort((a, b) => b.memory - a.memory).slice(0, 8).map((g) => [g.name, g.kind, g.section, g.processes.length, Math.round(g.memory / 1e6) + "MB", g.cpu.toFixed(1)]));
check("one kernel group", snap.groups.filter((g) => g.kind === "kernel").length <= 1, snap.groups.filter((g) => g.kind === "kernel").map((g) => [g.name, g.processes.length]));
check("this process is Systo", Boolean(snap.groups.find((g) => g.self)?.processes.some((p) => p.pid === process.pid)), snap.groups.find((g) => g.self)?.name);
const storage = await storageUsage();
check("storage", storage.total > 1e9 && storage.used > 0, storage);
const island = islandData(snap, "memory", storage);
check("island", island.entries.length > 0, island.entries.map((e) => [e.name, e.share.toFixed(2)]));
const info = await systemInfo();
check("system info", Boolean(info.osName && info.cores > 0 && info.memory > 0), info);
const startup = await startupReport(true);
check("startup", Array.isArray(startup.items), startup.items.map((i) => [i.name, i.kind, i.enabled, i.label ?? i.program]));
const self = snap.groups.find((g) => g.self);
const explained = self ? await explain(self) : null;
check("explain", Boolean(explained?.summary && explained.facts.length > 3), explained && { title: explained.title, summary: explained.summary, facts: explained.facts.length });

process.exit(failed ? 1 : 0);
