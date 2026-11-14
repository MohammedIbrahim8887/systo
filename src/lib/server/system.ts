import { cpus, hostname, totalmem } from "node:os";
import type { SystemInfo } from "../types";
import { output } from "./exec";

let cached: { at: number; info: SystemInfo } | null = null;

async function readOne(name: string): Promise<string> {
  return (await output("/usr/sbin/sysctl", ["-n", name])).trim();
}

export async function systemInfo(): Promise<SystemInfo> {
  if (cached && Date.now() - cached.at < 60_000) return cached.info;
  const [brand, model, perf0, perf1, boot, sw, df, gpu] = await Promise.all([
    readOne("machdep.cpu.brand_string"),
    readOne("hw.model"),
    readOne("hw.perflevel0.logicalcpu"),
    readOne("hw.perflevel1.logicalcpu"),
    readOne("kern.boottime"),
    output("/usr/bin/sw_vers", []),
    output("/bin/df", ["-k", "/System/Volumes/Data"]),
    output("/usr/sbin/ioreg", ["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"]),
  ]);
  const swField = (key: string) => new RegExp(`${key}:\\s*(.+)`).exec(sw)?.[1]?.trim() ?? "";
  const dfLine = df.trim().split("\n")[1]?.split(/\s+/) ?? [];
  const bootSec = Number(/sec = (\d+)/.exec(boot)?.[1] ?? 0);
  const gpuCores = /"gpu-core-count"\s*=\s*(\d+)/.exec(gpu)?.[1];
  const info: SystemInfo = {
    model: await friendlyModel(model),
    chip: brand || cpus()[0]?.model || "Unknown",
    cores: cpus().length,
    performanceCores: perf0 ? Number(perf0) : null,
    efficiencyCores: perf1 ? Number(perf1) : null,
    memory: totalmem(),
    osName: swField("ProductName") || "macOS",
    osVersion: swField("ProductVersion"),
    osBuild: swField("BuildVersion"),
    hostname: hostname().replace(/\.local$/, ""),
    bootTime: bootSec * 1000,
    diskTotal: Number(dfLine[1] ?? 0) * 1024,
    diskFree: Number(dfLine[3] ?? 0) * 1024,
    gpuCores: gpuCores ? Number(gpuCores) : null,
  };
  cached = { at: Date.now(), info };
  return info;
}

async function friendlyModel(identifier: string): Promise<string> {
  const text = await output("/usr/sbin/system_profiler", ["SPHardwareDataType", "-detailLevel", "mini"], 6000);
  const name = /Model Name:\s*(.+)/.exec(text)?.[1]?.trim();
  return name ? name : identifier;
}

let storageCache: { at: number; value: { used: number; total: number } } | null = null;

/** Space on the data volume, which is what Finder reports as used on Macintosh HD. */
export async function storageUsage(): Promise<{ used: number; total: number }> {
  if (storageCache && Date.now() - storageCache.at < 30_000) return storageCache.value;
  const df = await output("/bin/df", ["-k", "/System/Volumes/Data"]);
  const cells = df.trim().split("\n")[1]?.split(/\s+/) ?? [];
  const total = Number(cells[1] ?? 0) * 1024;
  const free = Number(cells[3] ?? 0) * 1024;
  const value = { used: Math.max(0, total - free), total };
  storageCache = { at: Date.now(), value };
  return value;
}
