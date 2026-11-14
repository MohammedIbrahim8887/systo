import { cpus, hostname, totalmem, uptime } from "node:os";
import type { SystemInfo } from "../../types";
import { output } from "../exec";
import { diskSpace, systemDrive } from "./native";

/** Values from `reg query KEY`, keyed by value name. */
export async function regValues(key: string): Promise<Record<string, string>> {
  const text = await output("reg.exe", ["query", key], 4000);
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s{2,}(.+?)\s{2,}(REG_\w+)\s{2,}(.*)$/.exec(line);
    if (m) values[m[1]] = m[3].trim();
  }
  return values;
}

export async function systemInfoWindows(): Promise<SystemInfo> {
  const [bios, os, space] = await Promise.all([
    regValues("HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS"),
    regValues("HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion"),
    diskSpace(systemDrive()),
  ]);
  const build = Number(os.CurrentBuild || os.CurrentBuildNumber || 0);
  // Windows 11 still reports "Windows 10" in ProductName; the build number tells them apart.
  let osName = os.ProductName || "Windows";
  if (build >= 22000) osName = osName.replace("Windows 10", "Windows 11");
  const ubr = os.UBR ? Number.parseInt(os.UBR, 16) : NaN;
  const vendor = (bios.SystemManufacturer || "").replace(/\s+(Inc\.?|Corporation|Corp\.?|Co\.,? Ltd\.?)$/i, "");
  const product = bios.SystemProductName || "";
  const model = [vendor, product].filter((v) => v && !/to be filled|default string|system product name/i.test(v)).join(" ");
  return {
    model: model || "Windows PC",
    chip: (cpus()[0]?.model || "Unknown").replace(/\s+/g, " ").trim(),
    cores: cpus().length,
    performanceCores: null,
    efficiencyCores: null,
    memory: totalmem(),
    osName,
    osVersion: os.DisplayVersion || os.ReleaseId || "",
    osBuild: build ? `${build}${Number.isFinite(ubr) ? `.${ubr}` : ""}` : "",
    hostname: hostname(),
    bootTime: Date.now() - uptime() * 1000,
    diskTotal: space?.total ?? 0,
    diskFree: space?.free ?? 0,
    gpuCores: null,
  };
}

export async function storageWindows(): Promise<{ used: number; total: number }> {
  const space = await diskSpace(systemDrive());
  if (!space) return { used: 0, total: 0 };
  return { used: Math.max(0, space.total - space.free), total: space.total };
}
