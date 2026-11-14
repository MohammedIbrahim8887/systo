import { mkdirSync } from "node:fs";
import { cpus, homedir } from "node:os";
import { join } from "node:path";
import type { ProcessGroup, SystemTotals, UsageEntry, UsageMetric, UsageRange, UsageReport } from "../types";
import { openDb, type Db } from "./sqlite";

/**
 * Records how much each app used over time so the History view can rank them across hours or
 * months. Samples accumulate in memory and flush once a minute into two tables: 5-minute buckets
 * kept for a few days and hourly buckets kept for a year.
 */

const FINE_MS = 5 * 60_000;
const HOUR_MS = 3_600_000;
const FLUSH_MS = 60_000;
const FINE_KEEP_MS = 3 * 86_400_000;
const HOURLY_KEEP_MS = 400 * 86_400_000;
const LEASE_MS = 3 * 60_000;
/** Longer gaps mean the Mac slept; don't count memory as held through it. */
const MAX_STEP_S = 30;

const RANGES: Record<UsageRange, { span: number; step: number; table: "fine" | "hourly" }> = {
  "1h": { span: HOUR_MS, step: FINE_MS, table: "fine" },
  "3h": { span: 3 * HOUR_MS, step: FINE_MS, table: "fine" },
  "1d": { span: 24 * HOUR_MS, step: 3 * FINE_MS, table: "fine" },
  "7d": { span: 7 * 86_400_000, step: HOUR_MS, table: "hourly" },
  "30d": { span: 30 * 86_400_000, step: 6 * HOUR_MS, table: "hourly" },
  "90d": { span: 90 * 86_400_000, step: 24 * HOUR_MS, table: "hourly" },
};

export const USAGE_RANGES = Object.keys(RANGES) as UsageRange[];
export const USAGE_METRICS: UsageMetric[] = ["cpu", "memory", "disk", "network", "energy"];

interface Acc {
  cpu: number;
  mem: number;
  disk: number;
  net: number;
  energy: number;
}

interface Meta {
  name: string;
  kind: ProcessGroup["kind"];
  bundlePath?: string;
  hasIcon: boolean;
}

const empty = (): Acc => ({ cpu: 0, mem: 0, disk: 0, net: 0, energy: 0 });

const COLUMNS: Record<UsageMetric, keyof Acc> = { cpu: "cpu", memory: "mem", disk: "disk", network: "net", energy: "energy" };

export function usageDbPath() {
  return join(homedir(), "Library", "Application Support", "Systo", "usage.sqlite");
}

class UsageStore {
  private db: Promise<Db | null> | null = null;
  private groups = new Map<string, Acc>();
  private system = { ...empty(), seconds: 0 };
  private meta = new Map<string, Meta>();
  private bucket = 0;
  private lastFlush = Date.now();
  private lastPrune = 0;
  private flushing: Promise<void> | null = null;
  private cores = cpus().length || 1;

  private open(): Promise<Db | null> {
    return (this.db ??= (async () => {
      try {
        mkdirSync(join(usageDbPath(), ".."), { recursive: true });
        const db = await openDb(usageDbPath());
        db.exec(`
          PRAGMA journal_mode = WAL;
          PRAGMA synchronous = NORMAL;
          CREATE TABLE IF NOT EXISTS meta (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, bundle_path TEXT, has_icon INTEGER NOT NULL, last_seen INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS fine (bucket INTEGER NOT NULL, gid TEXT NOT NULL, cpu REAL, mem REAL, disk REAL, net REAL, energy REAL, PRIMARY KEY (bucket, gid));
          CREATE TABLE IF NOT EXISTS hourly (bucket INTEGER NOT NULL, gid TEXT NOT NULL, cpu REAL, mem REAL, disk REAL, net REAL, energy REAL, PRIMARY KEY (bucket, gid));
          CREATE TABLE IF NOT EXISTS sys_fine (bucket INTEGER PRIMARY KEY, seconds REAL, cpu REAL, mem REAL, disk REAL, net REAL, energy REAL);
          CREATE TABLE IF NOT EXISTS sys_hourly (bucket INTEGER PRIMARY KEY, seconds REAL, cpu REAL, mem REAL, disk REAL, net REAL, energy REAL);
          CREATE TABLE IF NOT EXISTS lease (k INTEGER PRIMARY KEY CHECK (k = 1), pid INTEGER NOT NULL, at INTEGER NOT NULL);
        `);
        return db;
      } catch (error) {
        console.error("[systo] usage history unavailable", error);
        return null;
      }
    })());
  }

  /** Called by the sampler after every sample with the time elapsed since the previous one. */
  record(groups: ProcessGroup[], totals: SystemTotals, dt: number, at: number) {
    if (dt <= 0) return;
    const bucket = Math.floor(at / FINE_MS);
    if (this.bucket && bucket !== this.bucket) void this.flush();
    this.bucket = bucket;
    const held = Math.min(dt, MAX_STEP_S);
    let energy = 0;
    for (const g of groups) {
      let acc = this.groups.get(g.id);
      if (!acc) this.groups.set(g.id, (acc = empty()));
      const power = g.processes.reduce((sum, p) => sum + p.power, 0);
      acc.cpu += (g.cpu / 100) * dt;
      acc.mem += g.memory * held;
      acc.disk += g.disk * dt;
      acc.net += g.network * dt;
      acc.energy += power * dt;
      energy += power * dt;
      this.meta.set(g.id, { name: g.name, kind: g.kind, bundlePath: g.bundlePath, hasIcon: g.hasIcon });
    }
    const s = this.system;
    s.seconds += held;
    s.cpu += (totals.cpu / 100) * totals.cores * dt;
    s.mem += totals.memoryUsed * held;
    s.disk += (totals.diskRead + totals.diskWrite) * dt;
    s.net += (totals.netIn + totals.netOut) * dt;
    s.energy += energy;
    if (at - this.lastFlush >= FLUSH_MS) void this.flush();
  }

  /** Another running copy of Systo (say, a dev build) may already be recording this Mac. */
  private holdsLease(db: Db, now: number) {
    const [row] = db.all<{ pid: number; at: number }>("SELECT pid, at FROM lease WHERE k = 1");
    if (row && row.pid !== process.pid && now - row.at < LEASE_MS) {
      try {
        process.kill(row.pid, 0);
        return false;
      } catch {
        // stale lease
      }
    }
    db.run("INSERT INTO lease (k, pid, at) VALUES (1, ?, ?) ON CONFLICT(k) DO UPDATE SET pid = excluded.pid, at = excluded.at", [process.pid, now]);
    return true;
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const groups = this.groups;
    const system = this.system;
    const bucket = this.bucket;
    const meta = this.meta;
    this.groups = new Map();
    this.system = { ...empty(), seconds: 0 };
    this.meta = new Map();
    this.lastFlush = Date.now();
    if (!bucket || system.seconds === 0) return Promise.resolve();
    this.flushing = (async () => {
      const db = await this.open();
      if (!db) return;
      const now = Date.now();
      if (!this.holdsLease(db, now)) return;
      const fine = bucket;
      const hour = Math.floor((bucket * FINE_MS) / HOUR_MS);
      const minMem = 24 * 1024 * 1024 * system.seconds;
      db.transaction(() => {
        for (const [gid, acc] of groups) {
          // Idle background processes would bloat the tables without ever ranking.
          if (acc.cpu < 0.05 && acc.disk < 65536 && acc.net < 65536 && acc.mem < minMem && acc.energy < 0.5) continue;
          const m = meta.get(gid);
          if (m) {
            db.run(
              "INSERT INTO meta (id, name, kind, bundle_path, has_icon, last_seen) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, bundle_path = excluded.bundle_path, has_icon = excluded.has_icon, last_seen = excluded.last_seen",
              [gid, m.name, m.kind, m.bundlePath ?? null, m.hasIcon ? 1 : 0, now],
            );
          }
          for (const [table, b] of [["fine", fine], ["hourly", hour]] as const) {
            db.run(
              `INSERT INTO ${table} (bucket, gid, cpu, mem, disk, net, energy) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(bucket, gid) DO UPDATE SET cpu = cpu + excluded.cpu, mem = mem + excluded.mem, disk = disk + excluded.disk, net = net + excluded.net, energy = energy + excluded.energy`,
              [b, gid, acc.cpu, acc.mem, acc.disk, acc.net, acc.energy],
            );
          }
        }
        for (const [table, b] of [["sys_fine", fine], ["sys_hourly", hour]] as const) {
          db.run(
            `INSERT INTO ${table} (bucket, seconds, cpu, mem, disk, net, energy) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(bucket) DO UPDATE SET seconds = seconds + excluded.seconds, cpu = cpu + excluded.cpu, mem = mem + excluded.mem, disk = disk + excluded.disk, net = net + excluded.net, energy = energy + excluded.energy`,
            [b, system.seconds, system.cpu, system.mem, system.disk, system.net, system.energy],
          );
        }
        if (now - this.lastPrune > HOUR_MS) {
          this.lastPrune = now;
          db.run("DELETE FROM fine WHERE bucket < ?", [Math.floor((now - FINE_KEEP_MS) / FINE_MS)]);
          db.run("DELETE FROM sys_fine WHERE bucket < ?", [Math.floor((now - FINE_KEEP_MS) / FINE_MS)]);
          db.run("DELETE FROM hourly WHERE bucket < ?", [Math.floor((now - HOURLY_KEEP_MS) / HOUR_MS)]);
          db.run("DELETE FROM sys_hourly WHERE bucket < ?", [Math.floor((now - HOURLY_KEEP_MS) / HOUR_MS)]);
        }
      });
    })()
      .catch((error) => console.error("[systo] usage flush failed", error))
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }

  async report(range: UsageRange, metric: UsageMetric, limit = 12): Promise<UsageReport> {
    const { span, step, table } = RANGES[range];
    const unit = table === "fine" ? FINE_MS : HOUR_MS;
    const sysTable = table === "fine" ? "sys_fine" : "sys_hourly";
    const to = Date.now();
    const from = Math.floor((to - span) / step) * step + step;
    const count = Math.round(span / step);
    const buckets = Array.from({ length: count }, (_, i) => from + i * step);
    const col = COLUMNS[metric];
    const indexOf = (bucket: number) => Math.floor((bucket * unit - from) / step);
    const lo = Math.floor(from / unit);

    const seconds = new Array<number>(count).fill(0);
    const system = new Array<number>(count).fill(0);
    let since: number | null = null;

    // Fold in what hasn't been flushed yet so the last minute shows up immediately.
    const pending = this.bucket && this.system.seconds > 0 ? this.bucket : 0;
    const pendingIndex = pending ? Math.floor((pending * FINE_MS - from) / step) : -1;

    const db = await this.open();
    const sysRows = db ? db.all<{ bucket: number; seconds: number; v: number }>(`SELECT bucket, seconds, ${col} AS v FROM ${sysTable} WHERE bucket >= ?`, [lo]) : [];
    for (const row of sysRows) {
      const i = indexOf(row.bucket);
      if (i < 0 || i >= count) continue;
      seconds[i] += row.seconds;
      system[i] += row.v;
    }
    if (pendingIndex >= 0 && pendingIndex < count) {
      seconds[pendingIndex] += this.system.seconds;
      system[pendingIndex] += this.system[col];
    }
    if (db) {
      const [first] = db.all<{ b: number | null }>("SELECT MIN(bucket) AS b FROM sys_hourly");
      if (first?.b != null) since = first.b * HOUR_MS;
    }
    if (since === null && pending) since = pending * FINE_MS;

    const totals = new Map<string, number>();
    const rows = db ? db.all<{ gid: string; total: number }>(`SELECT gid, SUM(${col}) AS total FROM ${table} WHERE bucket >= ? GROUP BY gid`, [lo]) : [];
    for (const row of rows) totals.set(row.gid, row.total);
    if (pendingIndex >= 0) for (const [gid, acc] of this.groups) totals.set(gid, (totals.get(gid) ?? 0) + acc[col]);

    const top = [...totals]
      .filter(([gid, total]) => total > 0 && !(metric === "cpu" && gid.endsWith("kernel_task")))
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
    const ids = top.map(([gid]) => gid);

    const series = new Map<string, number[]>(ids.map((id) => [id, new Array<number>(count).fill(0)]));
    if (db && ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      for (const row of db.all<{ bucket: number; gid: string; v: number }>(
        `SELECT bucket, gid, ${col} AS v FROM ${table} WHERE bucket >= ? AND gid IN (${placeholders})`,
        [lo, ...ids],
      )) {
        const i = indexOf(row.bucket);
        const s = series.get(row.gid);
        if (s && i >= 0 && i < count) s[i] += row.v;
      }
    }
    if (pendingIndex >= 0 && pendingIndex < count) {
      for (const id of ids) {
        const acc = this.groups.get(id);
        if (acc) series.get(id)![pendingIndex] += acc[col];
      }
    }

    const metaRows = db && ids.length ? db.all<{ id: string; name: string; kind: string; bundle_path: string | null; has_icon: number; last_seen: number }>(
      `SELECT * FROM meta WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    ) : [];
    const metaById = new Map(metaRows.map((m) => [m.id, m]));

    const recorded = seconds.reduce((a, b) => a + b, 0);
    const rawSystemTotal = system.reduce((a, b) => a + b, 0);

    /** Converts a per-bucket sum into the unit the chart plots. */
    const normalize = (value: number, i: number) => {
      const s = seconds[i];
      if (!s) return 0;
      if (metric === "cpu") return Math.min(100, (value / (s * this.cores)) * 100);
      if (metric === "memory" || metric === "energy") return value / s;
      return value;
    };
    const normalizeTotal = (value: number) => (metric === "memory" ? (recorded ? value / recorded : 0) : value);

    const systemSeries = system.map(normalize);
    const systemTotal = normalizeTotal(rawSystemTotal);
    // App footprints count shared memory more than once, so their sum can exceed what's in use.
    const allApps = normalizeTotal([...totals.values()].reduce((a, b) => a + b, 0));
    const shareBase = metric === "memory" ? Math.max(systemTotal, allApps) : systemTotal;
    const entries: UsageEntry[] = top.map(([id, total]) => {
      const m = metaById.get(id);
      const live = this.meta.get(id);
      const kind = (m?.kind ?? live?.kind ?? "user-service") as UsageEntry["kind"];
      const value = normalizeTotal(total);
      return {
        id,
        name: m?.name ?? live?.name ?? id.replace(/^\w+:(?:\w+:)?/, "").split("/").pop() ?? id,
        kind,
        bundlePath: m?.bundle_path ?? live?.bundlePath ?? undefined,
        hasIcon: m ? m.has_icon === 1 : Boolean(live?.hasIcon),
        total: value,
        share: shareBase > 0 ? Math.min(1, value / shareBase) : 0,
        series: series.get(id)!.map(normalize),
        lastSeen: live ? to : (m?.last_seen ?? to),
      };
    });
    const others = systemSeries.map((v, i) => Math.max(0, v - entries.reduce((sum, e) => sum + e.series[i], 0)));

    return { range, metric, from, to, step, buckets, cores: this.cores, system: systemSeries, systemTotal, others, entries, coverage: { recorded, since } };
  }
}

const KEY = "__systoUsage";
const store = globalThis as unknown as Record<string, UsageStore | undefined>;

export function usage(): UsageStore {
  return (store[KEY] ??= new UsageStore());
}
