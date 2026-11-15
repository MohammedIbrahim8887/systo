import { readFileSync, statfsSync } from "node:fs";
import { cpus, hostname, release, totalmem, uptime } from "node:os";
import type { SystemInfo } from "../../types";

function read(file: string): string {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

/** Logical CPUs in a sysfs list like "0-7,12". */
function countCpus(list: string): number | null {
  if (!list) return null;
  let count = 0;
  for (const part of list.split(",")) {
    const [from, to] = part.split("-").map(Number);
    if (!Number.isFinite(from)) return null;
    count += Number.isFinite(to) ? to - from + 1 : 1;
  }
  return count || null;
}

/** Space on the root filesystem, which on a typical install also holds /home. */
export function storageLinux(): { used: number; total: number; free: number } {
  try {
    const fs = statfsSync("/");
    const total = fs.blocks * fs.bsize;
    const free = fs.bavail * fs.bsize;
    return { used: Math.max(0, total - fs.bfree * fs.bsize), total, free };
  } catch {
    return { used: 0, total: 0, free: 0 };
  }
}

export function systemInfoLinux(): SystemInfo {
  const os = read("/etc/os-release");
  const field = (key: string) => new RegExp(`^${key}="?([^"\n]*)"?$`, "m").exec(os)?.[1] ?? "";
  const junk = /to be filled|default string|system product name|system manufacturer/i;
  const vendor = read("/sys/class/dmi/id/sys_vendor").replace(/\s+(Inc\.?|Corporation|Corp\.?|Co\.,? Ltd\.?)$/i, "");
  const product = read("/sys/class/dmi/id/product_name");
  const parts = [vendor, product].filter((v) => v && !junk.test(v));
  // "HP" + "HP EliteBook…" would repeat the maker.
  const model = parts.length === 2 && parts[1].toLowerCase().startsWith(parts[0].toLowerCase()) ? parts[1] : parts.join(" ");
  const space = storageLinux();
  return {
    model: model || "Linux PC",
    chip: (cpus()[0]?.model || "Unknown").replace(/\s+/g, " ").trim(),
    cores: cpus().length,
    // Hybrid Intel chips list their two core types separately.
    performanceCores: countCpus(read("/sys/devices/cpu_core/cpus")),
    efficiencyCores: countCpus(read("/sys/devices/cpu_atom/cpus")),
    memory: totalmem(),
    osName: field("NAME") || field("PRETTY_NAME") || "Linux",
    osVersion: field("VERSION_ID") || field("BUILD_ID") || field("VERSION"),
    osBuild: release(),
    hostname: hostname(),
    bootTime: Date.now() - uptime() * 1000,
    diskTotal: space.total,
    diskFree: space.free,
    gpuCores: null,
  };
}
