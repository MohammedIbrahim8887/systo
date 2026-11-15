import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import { KIND_META, SAFETY_META } from "../../kinds";
import { formatBytes } from "../../format";
import type { Explanation, ProcessGroup, ProcessRow } from "../../types";
import { output, run } from "../exec";
import { entryForFile } from "./apps";
import { isSystemPath } from "./classify";
import { commandLine, processStart, systemdUnit } from "./native";

/** Plain-language notes for the processes every Linux desktop (and Omarchy in particular) runs. */
const KNOWN: Record<string, { summary: string; quit?: string }> = {
  systemd: { summary: "The service manager. It starts everything else, keeps services running and manages your login session.", quit: "Ending it ends your session, or the whole system if it's the one running as root." },
  Hyprland: { summary: "The Wayland compositor: it draws every window, manages workspaces and handles your keyboard shortcuts.", quit: "Ending it closes every app and signs you out." },
  Xwayland: { summary: "Runs apps that still use the older X11 display protocol inside your Wayland session.", quit: "Every X11 app closes with it. The compositor starts it again when one is opened." },
  waybar: { summary: "The status bar at the top of the screen, with workspaces, the clock and the tray.", quit: "The bar disappears until it's started again." },
  walker: { summary: "The app launcher and menu.", quit: "The launcher stops opening until it's started again." },
  elephant: { summary: "The data provider behind the Walker launcher: it indexes apps, files and other things you can search.", quit: "The launcher shows no results until it's started again." },
  mako: { summary: "The notification daemon: it shows the pop-ups apps send.", quit: "Notifications stop appearing until it's started again." },
  hypridle: { summary: "Watches for inactivity to dim the screen, lock it and suspend.", quit: "The screen no longer locks or sleeps on its own." },
  hyprlock: { summary: "The lock screen.", quit: "Ending it while locked can leave the session stuck on a blank screen." },
  hyprpaper: { summary: "Draws the desktop wallpaper.", quit: "The wallpaper goes blank until it's started again." },
  swaybg: { summary: "Draws the desktop wallpaper.", quit: "The wallpaper goes blank until it's started again." },
  "swayosd-server": { summary: "Shows the on-screen indicator when you change volume or brightness.", quit: "Volume and brightness still change, but nothing is shown." },
  pipewire: { summary: "The audio and video server. Every sound and screen share goes through it.", quit: "Audio cuts out for a moment; systemd restarts it." },
  "pipewire-pulse": { summary: "Lets apps written for PulseAudio play sound through PipeWire.", quit: "Audio cuts out for a moment; systemd restarts it." },
  wireplumber: { summary: "Decides which speakers, microphones and cameras PipeWire uses.", quit: "Audio devices drop for a moment; systemd restarts it." },
  "dbus-broker": { summary: "The message bus apps and services use to talk to each other.", quit: "Most of the desktop stops working; ending it usually ends the session." },
  "dbus-daemon": { summary: "The message bus apps and services use to talk to each other.", quit: "Most of the desktop stops working; ending it usually ends the session." },
  NetworkManager: { summary: "Manages network connections: Wi-Fi, Ethernet and VPNs.", quit: "You go offline until it's started again." },
  iwd: { summary: "The Wi-Fi daemon: it scans for networks and handles authentication.", quit: "Wi-Fi disconnects until it's started again." },
  wpa_supplicant: { summary: "Handles Wi-Fi authentication.", quit: "Wi-Fi disconnects until it's started again." },
  bluetoothd: { summary: "The Bluetooth daemon.", quit: "Bluetooth devices disconnect until it's started again." },
  polkitd: { summary: "Decides when a program may do something as administrator, and asks for your password.", quit: "Password prompts stop appearing, so admin actions fail." },
  fcitx5: { summary: "The input method framework, for typing languages that need more than one keystroke per character.", quit: "Input methods stop working; plain typing still does." },
  "systemd-journald": { summary: "Collects log messages from the kernel and every service.", quit: "systemd restarts it; logging pauses for a moment." },
  "systemd-logind": { summary: "Tracks who is logged in and handles the power button, lid and suspend.", quit: "Your session can break; a restart is the reliable fix." },
  "systemd-udevd": { summary: "Reacts to hardware being plugged in and sets up device files.", quit: "New devices aren't recognized until it restarts." },
  upowerd: { summary: "Reports battery and power state to the desktop.", quit: "The battery indicator stops updating." },
  udisksd: { summary: "Mounts and manages disks and USB drives for the desktop.", quit: "Drives stop mounting automatically until it's started again." },
  dockerd: { summary: "The Docker daemon, which runs your containers.", quit: "Every running container stops." },
  sshd: { summary: "The SSH server, which lets you log in to this PC remotely.", quit: "Remote logins stop; existing sessions usually stay open." },
  uwsm: { summary: "Starts your Wayland session under systemd so apps and services are tracked properly.", quit: "Ending it ends your session." },
};

let packageTool: Promise<string | null> | null = null;

/** The distribution's package manager, to say which package a program belongs to. */
function packageManager(): Promise<string | null> {
  return (packageTool ??= (async () => {
    for (const tool of ["pacman", "dpkg", "rpm"]) {
      if ((await run("/bin/sh", ["-c", `command -v ${tool}`], 2000)).code === 0) return tool;
    }
    return null;
  })());
}

async function owningPackage(path: string): Promise<string | undefined> {
  if (!path.startsWith("/")) return undefined;
  const tool = await packageManager();
  if (tool === "pacman") {
    // "/usr/bin/foo is owned by foo 1.2-3"
    return / is owned by (.+)$/m.exec(await output("pacman", ["-Qo", path], 3000))?.[1]?.trim();
  }
  if (tool === "dpkg") return (await output("dpkg", ["-S", path], 3000)).split(":")[0]?.trim() || undefined;
  if (tool === "rpm") {
    const { stdout, code } = await run("rpm", ["-qf", path], 3000);
    return code === 0 ? stdout.trim() : undefined;
  }
  return undefined;
}

async function connections(pid: number): Promise<string[]> {
  const text = await output("ss", ["-H", "-tunp"], 4000);
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes(`pid=${pid},`)) continue;
    const cells = line.trim().split(/\s+/);
    // Netid State Recv-Q Send-Q Local Peer Process
    const [proto, state, , , local, peer] = cells;
    lines.push(state === "LISTEN" || peer?.endsWith(":*") ? `${proto} listening on ${local}` : `${proto} ${local} → ${peer}`);
    if (lines.length >= 12) break;
  }
  return lines;
}

async function manSummary(name: string): Promise<string | undefined> {
  if (!/^[\w.+-]+$/.test(name)) return undefined;
  const text = await output("whatis", [name], 2500);
  const m = /^\S+\s+\([18]\w*\)\s+-\s+(.+)$/m.exec(text);
  return m?.[1]?.trim() || undefined;
}

function locationPhrase(path: string): string {
  if (path.startsWith("/usr/lib/systemd/")) return "among systemd's own programs";
  if (isSystemPath(path)) return "among the programs your distribution installed";
  if (path.startsWith("/opt/")) return "in /opt, where apps from outside the distribution install themselves";
  if (path.startsWith("/usr/local/")) return "in /usr/local, where locally built software lives";
  if (path.startsWith("/var/lib/flatpak/") || path.includes("/.local/share/flatpak/")) return "inside a Flatpak app";
  if (path.startsWith(homedir())) return "in your home folder";
  return `in ${dirname(path)}`;
}

export async function explainLinux(group: ProcessGroup, pid?: number): Promise<Explanation> {
  const target: ProcessRow =
    (pid ? group.processes.find((p) => p.pid === pid) : undefined) ?? group.processes.find((p) => p.pid === group.headPid) ?? group.processes[0];
  const isGroupView = !pid || pid === group.headPid;
  const entry = isGroupView && group.bundlePath ? entryForFile(group.bundlePath) : undefined;
  const kind = isGroupView ? group.kind : target.kind;
  const safety = isGroupView ? group.safety : target.safety;
  const kernel = kind === "kernel";

  const [pkg, conns, man] = await Promise.all([
    kernel ? Promise.resolve(undefined) : owningPackage(target.path).catch(() => undefined),
    kernel ? Promise.resolve([] as string[]) : connections(target.pid).catch(() => [] as string[]),
    kernel || entry ? Promise.resolve(undefined) : manSummary(target.name).catch(() => undefined),
  ]);
  const unit = kernel ? null : systemdUnit(target.pid);
  const service = unit?.unit.endsWith(".service") ? unit : null;
  const started = processStart(target.pid);
  const command = commandLine(target.pid);
  const known = KNOWN[target.name];

  const title = isGroupView ? group.name : target.name;
  let summary: string;
  let source: Explanation["source"] = "heuristic";
  if (kernel) {
    summary = isGroupView
      ? "The Linux kernel's own worker threads. They handle disks, memory, networking and devices, and aren't programs you can end."
      : `A kernel thread. It does part of the kernel's work (${target.name}) and can't be ended.`;
    source = "knowledge";
  } else if (known) {
    summary = known.summary;
    source = "knowledge";
  } else if (entry) {
    summary = entry.comment ? `${entry.name}: ${entry.comment.replace(/\.$/, "")}.` : `${entry.name} is an app${pkg ? ` from the ${pkg.split(" ")[0]} package` : ""}.`;
    source = "bundle";
  } else if (man) {
    summary = `${man.charAt(0).toUpperCase()}${man.slice(1)}.`;
  } else if (!isGroupView && (group.kind === "app" || group.kind === "menu-bar")) {
    summary = `A process belonging to ${group.name}. Apps split work into helpers so a crash in one part doesn't take down the whole app.`;
  } else {
    const where = target.path.startsWith("/") ? locationPhrase(target.path) : "whose location is hidden because it belongs to another user";
    summary = `${KIND_META[kind].description} It runs from ${where}.`;
  }

  const lines: string[] = [];
  if (isGroupView && group.processes.length > 1) {
    const names = [...new Set(group.processes.filter((p) => p.pid !== target.pid).map((p) => p.name))].slice(0, 4);
    lines.push(kernel ? `Made of ${group.processes.length} kernel threads.` : `Made of ${group.processes.length} processes, including ${names.join(", ")}.`);
  }
  if (!kernel && target.uid === 0) lines.push("Runs as root, with full access to the system.");
  else if (!kernel && target.uid < 1000) lines.push(`Runs as the system account “${target.user}”, not as you.`);
  if (service) lines.push(`Managed by systemd as “${service.unit}”${service.user ? " in your user session" : ""}.`);
  if (!target.inspectable) lines.push("Owned by another user, so its disk activity and exact location are hidden.");
  if (conns.length) lines.push(`Has ${conns.length}${conns.length >= 12 ? "+" : ""} open network socket${conns.length === 1 ? "" : "s"}.`);
  if (man && source !== "heuristic") lines.push(`Manual page: ${man}.`);

  let quitEffect = known?.quit ?? SAFETY_META[safety].description;
  if (kernel) quitEffect = "Kernel threads can't be ended.";
  if (group.self) quitEffect = "This is Systo itself. Ending it closes this window.";

  const vendor = pkg ? `Package ${pkg}` : kernel ? "Linux kernel" : target.path.startsWith(homedir()) ? "Installed in your home folder" : "Not from a package";
  const facts: Explanation["facts"] = [];
  facts.push({ label: "Type", value: KIND_META[kind].label });
  if (!kernel) facts.push({ label: "Package", value: pkg ?? "None (not installed by the package manager)" });
  if (entry) facts.push({ label: "App ID", value: entry.id, mono: true });
  facts.push({ label: isGroupView && group.processes.length > 1 ? "Main PID" : "PID", value: String(target.pid), mono: true });
  facts.push({ label: "User", value: target.user });
  if (!kernel) facts.push({ label: "Memory", value: formatBytes(isGroupView ? group.memory : target.memory) });
  if (started) facts.push({ label: "Started", value: started.toLocaleString() });
  if (!kernel) facts.push({ label: "Path", value: target.path || "Hidden", mono: true });
  if (command && command !== target.path) facts.push({ label: "Command", value: command.length > 600 ? `${command.slice(0, 600)}…` : command, mono: true });
  if (unit) facts.push({ label: "systemd unit", value: unit.unit, mono: true });
  if (entry) facts.push({ label: "Launcher file", value: entry.file, mono: true });

  return {
    title,
    kind,
    kindLabel: KIND_META[kind].label,
    safety,
    summary,
    details: lines,
    quitEffect,
    vendor,
    source,
    facts,
    connections: conns,
    manSummary: man,
    searchQuery: `Linux "${entry ? entry.name : basename(target.name)}" process what is it`,
  };
}
