// Exercises the Windows data layer on a real Windows machine (CI): run with `bun scripts/win-smoke.ts`.
import { readWindows } from "../src/lib/server/win/native";
import { sampler, islandData } from "../src/lib/server/sampler";
import { systemInfo, storageUsage } from "../src/lib/server/system";
import { startupReport } from "../src/lib/server/startup";

let failed = false;
const check = (label: string, ok: boolean, detail: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`, typeof detail === "string" ? detail : JSON.stringify(detail));
  if (!ok) failed = true;
};

const raw = await readWindows();
check("Win32 reader", Boolean(raw && raw.procs.length > 20), { procs: raw?.procs.length, readable: raw?.procs.filter((p) => p.readable).length });
check("process paths", Boolean(raw?.procs.some((p) => /\\explorer\.exe$/i.test(p.path) || /\\svchost\.exe$/i.test(p.path))), raw?.procs.slice(0, 5).map((p) => [p.pid, p.exe, p.path, p.memory]));
check("memory", Boolean(raw && raw.memory.total > 1e9 && raw.memory.available > 0), raw?.memory);
check("network interfaces", Boolean(raw), raw?.net);
check("app windows", true, raw ? [...raw.windows.entries()].slice(0, 5) : []);

const s = sampler();
await s.current();
await new Promise((r) => setTimeout(r, 1500));
const snap = await s.refresh();
check("snapshot totals", snap.totals.memoryUsed > 0 && snap.totals.cpu >= 0 && snap.totals.cpu <= 100, snap.totals);
check("groups", snap.groups.length > 5, snap.groups.sort((a, b) => b.memory - a.memory).slice(0, 8).map((g) => [g.name, g.kind, g.section, g.processes.length, Math.round(g.memory / 1e6) + "MB", g.cpu.toFixed(1)]));
const storage = await storageUsage();
check("storage", storage.total > 1e9, storage);
const island = islandData(snap, "memory", storage);
check("island", island.entries.length > 0, island.entries.map((e) => [e.name, e.share.toFixed(2)]));
const info = await systemInfo();
check("system info", Boolean(info.osName.startsWith("Windows") && info.cores > 0), info);
const startup = await startupReport(true);
check("startup", Array.isArray(startup.items), startup.items.map((i) => [i.name, i.kind, i.enabled, i.program]));

process.exit(failed ? 1 : 0);
