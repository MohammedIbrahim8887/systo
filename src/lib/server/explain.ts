import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { KIND_META, SAFETY_META } from "../kinds";
import type { Explanation, ProcessGroup, ProcessRow } from "../types";
import { formatBytes } from "../format";
import { loadBundle, outermostBundle } from "./bundle";
import { isApplePath } from "./classify";
import { output, run } from "./exec";
import { lookupKnowledge, lookupPattern } from "./knowledge";

const LAUNCH_DIRS = [
  join(homedir(), "Library/LaunchAgents"),
  "/Library/LaunchAgents",
  "/Library/LaunchDaemons",
  "/System/Library/LaunchAgents",
  "/System/Library/LaunchDaemons",
];

interface Signature {
  vendor: string;
  team?: string;
  apple: boolean;
  signed: boolean;
}

async function signature(path: string): Promise<Signature> {
  const { stderr, code } = await run("/usr/bin/codesign", ["-dv", "--verbose=2", path], 4000);
  if (code !== 0 && !stderr.includes("Authority=")) {
    return { vendor: "Unsigned", apple: false, signed: false };
  }
  const authorities = [...stderr.matchAll(/^Authority=(.+)$/gm)].map((m) => m[1]);
  const team = /^TeamIdentifier=(.+)$/m.exec(stderr)?.[1];
  const apple = authorities.includes("Software Signing") || authorities.some((a) => a.startsWith("Apple Mac OS Application Signing"));
  if (apple) return { vendor: "Apple", apple: true, signed: true };
  const dev = authorities.find((a) => a.startsWith("Developer ID Application:") || a.startsWith("Apple Development:"));
  if (dev) {
    const vendor = dev.replace(/^(Developer ID Application|Apple Development):\s*/, "").replace(/\s*\([A-Z0-9]+\)$/, "");
    return { vendor, team: team && team !== "not set" ? team : undefined, apple: false, signed: true };
  }
  if (/Signature=adhoc/.test(stderr)) return { vendor: "Ad-hoc signed (no developer identity)", apple: false, signed: true };
  return { vendor: authorities[0] ?? "Unknown", apple: false, signed: true, team };
}

async function launchdLabel(pid: number): Promise<string | undefined> {
  const text = await output("/bin/launchctl", ["list"], 3000);
  for (const line of text.split("\n")) {
    const [p, , label] = line.split("\t");
    if (Number(p) === pid && label) return label.trim();
  }
  return undefined;
}

function launchPlist(label: string | undefined): string | undefined {
  if (!label) return undefined;
  for (const dir of LAUNCH_DIRS) {
    const file = join(dir, `${label}.plist`);
    if (existsSync(file)) return file;
  }
  return undefined;
}

async function keepsAlive(plist: string | undefined): Promise<boolean> {
  if (!plist) return false;
  const text = await output("/usr/bin/plutil", ["-extract", "KeepAlive", "raw", "-o", "-", plist], 2000);
  return text.trim() !== "" && text.trim() !== "false";
}

async function connections(pid: number): Promise<string[]> {
  const text = await output("/usr/sbin/lsof", ["-nP", "-a", "-p", String(pid), "-i"], 4000);
  const lines = text.split("\n").slice(1).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const cells = line.trim().split(/\s+/);
    const proto = cells[7];
    const name = cells.slice(8).join(" ");
    const item = `${proto} ${name}`;
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
    if (out.length >= 12) break;
  }
  return out;
}

async function manSummary(name: string): Promise<string | undefined> {
  if (!/^[\w.+-]+$/.test(name)) return undefined;
  const text = await output("/usr/bin/man", ["-f", name], 2500);
  const line = text
    .split("\n")
    .find((l) => l.toLowerCase().startsWith(name.toLowerCase()) && !l.includes("nothing appropriate"));
  const summary = line?.split(/\s+-\s+/).slice(1).join(" - ").trim();
  return summary || undefined;
}

async function processDetails(pid: number) {
  const text = await output("/bin/ps", ["-o", "lstart=,args=", "-p", String(pid)], 2000);
  const line = text.trim();
  const m = /^(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(line);
  return { started: m?.[1], args: m?.[2] ?? line };
}

function locationPhrase(path: string): string {
  if (path.startsWith("/System/Library/PrivateFrameworks/")) return "inside one of macOS's private system frameworks";
  if (path.startsWith("/System/Library/Frameworks/")) return "inside a macOS system framework";
  if (path.startsWith("/System/Library/CoreServices/")) return "in macOS Core Services";
  if (path.startsWith("/usr/libexec/") || path.startsWith("/usr/sbin/") || path.startsWith("/sbin/")) return "among macOS's built-in system programs";
  if (path.startsWith("/Library/PrivilegedHelperTools/")) return "in the folder where apps install privileged helpers";
  if (path.startsWith("/Library/Application Support/")) return "in an app's shared support folder";
  if (path.startsWith(join(homedir(), "Library"))) return "in your user Library folder";
  if (path.startsWith("/opt/homebrew/") || path.startsWith("/usr/local/")) return "in a Homebrew or locally installed tool";
  if (path.startsWith(homedir())) return "in your home folder";
  return `in ${dirname(path)}`;
}

export async function explain(group: ProcessGroup, pid?: number): Promise<Explanation> {
  const target: ProcessRow = (pid ? group.processes.find((p) => p.pid === pid) : undefined) ??
    group.processes.find((p) => p.pid === group.headPid) ??
    group.processes[0];
  const isGroupView = !pid || pid === group.headPid;
  const bundlePath = outermostBundle(target.path) ?? group.bundlePath;
  const bundle = bundlePath ? await loadBundle(bundlePath).catch(() => undefined) : undefined;
  const signPath = isGroupView && bundlePath ? bundlePath : target.path;

  const [sig, details, label, conns, man] = await Promise.all([
    target.path.startsWith("/") ? signature(signPath) : Promise.resolve<Signature>({ vendor: target.uid < 500 ? "Apple (system)" : "Unknown", apple: target.uid < 500, signed: false }),
    processDetails(target.pid),
    launchdLabel(target.pid),
    target.inspectable ? connections(target.pid).catch(() => []) : Promise.resolve([] as string[]),
    !bundlePath || !isGroupView ? manSummary(target.name).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const plist = launchPlist(label);
  const keepAlive = await keepsAlive(plist);

  const kind = isGroupView ? group.kind : target.kind;
  const safety = isGroupView ? group.safety : target.safety;
  const knowledge =
    lookupKnowledge(target.name, isGroupView ? bundle?.id : undefined) ??
    (isGroupView && bundle ? undefined : lookupPattern(target.name));

  const title = isGroupView ? group.name : target.name;
  let summary: string;
  let source: Explanation["source"] = "heuristic";
  if (knowledge) {
    summary = knowledge.summary;
    source = "knowledge";
  } else if (bundle && isGroupView) {
    const by = sig.apple ? "made by Apple" : sig.vendor && sig.signed ? `made by ${sig.vendor}` : "from an unidentified developer";
    const role = kind === "menu-bar" ? "a menu bar or background app" : kind === "user-service" ? "a macOS background agent" : "an app";
    summary = `${bundle.name} is ${role} ${by}.`;
    if (bundle.category) {
      summary += ` It's listed in the ${bundle.category.replace("public.app-category.", "").replace(/-/g, " ")} category.`;
    }
    source = "bundle";
  } else if (man) {
    summary = `${man.charAt(0).toUpperCase()}${man.slice(1)}.`;
  } else if (bundlePath && !isGroupView) {
    summary = `A helper process belonging to ${group.name}. Apps split work into helpers so a crash in one part doesn't take down the whole app.`;
  } else {
    const where = target.path.startsWith("/") ? locationPhrase(target.path) : "whose location macOS hides from other users";
    summary = `${KIND_META[kind].description} It runs from ${where}.`;
  }

  const lines: string[] = [];
  if (isGroupView && group.processes.length > 1) {
    const helperNames = [...new Set(group.processes.filter((p) => p.pid !== target.pid).map((p) => p.name))].slice(0, 4);
    lines.push(`Made of ${group.processes.length} processes, including ${helperNames.join(", ")}.`);
  }
  if (target.uid === 0) lines.push("Runs as root, with full access to the system.");
  else if (target.uid < 500) lines.push(`Runs as the system account “${target.user}”, not as you.`);
  if (label) lines.push(`Started by launchd as “${label}”${keepAlive ? ", which restarts it if it stops" : ""}.`);
  if (!target.inspectable) lines.push("Owned by another user, so macOS hides its exact memory and disk activity.");
  if (bundle?.agent && isGroupView) lines.push("Has no Dock icon; look for it in the menu bar.");
  if (conns.length) lines.push(`Has ${conns.length}${conns.length >= 12 ? "+" : ""} open network connection${conns.length === 1 ? "" : "s"}.`);
  if (man && source !== "heuristic") lines.push(`Manual page: ${man}.`);

  let quitEffect = knowledge?.quit ?? SAFETY_META[safety].description;
  if (!knowledge?.quit && keepAlive && safety !== "critical") quitEffect = "launchd restarts it right away, so ending it rarely helps for long.";
  if (group.self) quitEffect = "This is Systo itself. Ending it closes this window.";

  const facts: Explanation["facts"] = [];
  facts.push({ label: "Type", value: KIND_META[kind].label });
  facts.push({ label: "Developer", value: sig.vendor + (sig.team ? ` (${sig.team})` : "") });
  if (bundle?.id && isGroupView) facts.push({ label: "Bundle ID", value: bundle.id, mono: true });
  if (bundle?.version && isGroupView) facts.push({ label: "Version", value: bundle.version });
  facts.push({ label: isGroupView && group.processes.length > 1 ? "Main PID" : "PID", value: String(target.pid), mono: true });
  facts.push({ label: "User", value: target.user });
  facts.push({ label: "Memory", value: formatBytes(isGroupView ? group.memory : target.memory) });
  if (details.started) facts.push({ label: "Started", value: details.started });
  facts.push({ label: "Path", value: (isGroupView && bundlePath) || target.path || "Hidden by macOS", mono: true });
  if (details.args && details.args !== target.path) facts.push({ label: "Command", value: details.args, mono: true });
  if (plist) facts.push({ label: "Launch file", value: plist, mono: true });
  if (bundle?.copyright && isGroupView) facts.push({ label: "Copyright", value: bundle.copyright });

  const apple = sig.apple || isApplePath(target.path);
  return {
    title,
    kind,
    kindLabel: KIND_META[kind].label,
    safety,
    summary,
    details: lines,
    quitEffect,
    vendor: apple ? "Apple" : sig.vendor,
    source,
    facts,
    connections: conns,
    manSummary: man,
    searchQuery: `macOS "${isGroupView && bundle ? bundle.name : basename(target.name)}" process what is it`,
  };
}
