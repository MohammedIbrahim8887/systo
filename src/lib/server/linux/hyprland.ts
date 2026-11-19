import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";

/**
 * Hyprland's control socket, which is what `hyprctl` talks to. One short-lived connection per
 * request: write the command, read the reply until the compositor closes it. The sampler asks it
 * which processes own windows; the shell drives the Dynamic Island's window through it.
 *
 * Hyprland 0.5x has two config front ends with different command sets. With a Lua config,
 * rules and dispatchers are Lua calls sent through `eval`; with a hyprlang config they are the
 * classic `keyword` and `dispatch` requests. Both are spoken here.
 */

export interface HyprMonitor {
  id: number;
  name: string;
  /** Position and size in device pixels; divide the size by `scale` for layout coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  transform?: number;
  /** Space taken by bars: left, top, right, bottom. */
  reserved: [number, number, number, number];
  focused: boolean;
  activeWorkspace: { id: number };
}

export interface HyprClient {
  address: string;
  pid: number;
  title: string;
  /** The app id (Wayland) or WM_CLASS (X11), which usually names the app's .desktop file. */
  class: string;
  initialClass: string;
  mapped: boolean;
  /** Top-left corner and size in layout coordinates. */
  at: [number, number];
  size: [number, number];
  xwayland: boolean;
}

function socketPath(): string | null {
  const signature = process.env.HYPRLAND_INSTANCE_SIGNATURE;
  if (!signature) return null;
  const path = join(process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 1000}`, "hypr", signature, ".socket.sock");
  return existsSync(path) ? path : null;
}

/** True when this session is running under Hyprland and its socket is reachable. */
export function hyprlandAvailable(): boolean {
  return process.platform === "linux" && socketPath() !== null;
}

function request(command: string, timeout = 1500): Promise<string> {
  return new Promise((resolve, reject) => {
    const path = socketPath();
    if (!path) return reject(new Error("Hyprland isn't running"));
    const socket = createConnection(path);
    const chunks: Buffer[] = [];
    socket.setTimeout(timeout, () => socket.destroy(new Error("Hyprland didn't answer")));
    socket.on("connect", () => socket.write(command));
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("error", reject);
    socket.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function json<T>(command: string): Promise<T | null> {
  try {
    return JSON.parse(await request(`j/${command}`)) as T;
  } catch {
    return null;
  }
}

let luaConfig: Promise<boolean> | null = null;

/** Whether the compositor runs a Lua config, decided once by asking it to evaluate Lua. */
function usesLua(): Promise<boolean> {
  return (luaConfig ??= request("/eval return 1").then(
    (reply) => reply.trim() === "ok",
    () => false,
  ));
}

const lua = (value: string) => JSON.stringify(value);

/** Runs a Lua snippet or a classic request, whichever the config speaks. True when accepted. */
async function send(forLua: string, classic: string): Promise<boolean> {
  try {
    const reply = await request((await usesLua()) ? `/eval ${forLua}` : `/${classic}`);
    return reply.trim() === "ok";
  } catch {
    return false;
  }
}

export function monitors(): Promise<HyprMonitor[]> {
  return json<HyprMonitor[]>("monitors").then((list) => list ?? []);
}

export function clients(): Promise<HyprClient[]> {
  return json<HyprClient[]>("clients").then((list) => list ?? []);
}

/** The pointer in layout coordinates. */
export function cursor(): Promise<{ x: number; y: number } | null> {
  return json<{ x: number; y: number }>("cursorpos");
}

/** True while a fullscreen window covers the workspace. */
export async function workspaceFullscreen(id: number): Promise<boolean> {
  const all = await json<Array<{ id: number; hasfullscreen: boolean }>>("workspaces");
  return Boolean(all?.find((w) => w.id === id)?.hasfullscreen);
}

/** XWayland windows draw in device pixels when the compositor doesn't scale them. */
export async function xwaylandUnscaled(): Promise<boolean> {
  const option = await json<{ int?: number; bool?: boolean }>("getoption xwayland:force_zero_scaling");
  return Boolean(option?.int ?? option?.bool);
}

/**
 * Makes windows with this exact title an overlay before they open: floating, pinned to every
 * workspace, undecorated, never focused, placed at (x, y). Declared under a name, so calling it
 * again replaces the rule instead of stacking another.
 */
export function overlayRule(name: string, title: string, x: number, y: number): Promise<boolean> {
  const pattern = `^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
  const position = `${Math.round(x)} ${Math.round(y)}`;
  return send(
    `hl.window_rule({ name = ${lua(name)}, match = { title = ${lua(pattern)} }, float = true, pin = true, no_initial_focus = true, no_focus = true, no_shadow = true, no_blur = true, no_anim = true, border_size = 0, rounding = 0, move = ${lua(position)} })`,
    `keyword windowrule match:title ${pattern}, float on, pin on, no_initial_focus on, no_focus on, no_shadow on, no_blur on, no_anim on, border_size 0, rounding 0, move ${position}`,
  );
}

/** Overrides one property of a window, e.g. `no_focus`, until it is set again. */
export function setProp(address: string, prop: string, value: boolean): Promise<boolean> {
  const flag = value ? "1" : "0";
  return send(
    `hl.dispatch(hl.dsp.window.set_prop({ prop = ${lua(prop)}, value = "${flag}", window = ${lua(`address:${address}`)} }))`,
    `dispatch setprop address:${address} ${prop} ${flag}`,
  );
}

/** Moves a floating window to layout coordinates. */
export function moveWindow(address: string, x: number, y: number): Promise<boolean> {
  return send(
    `hl.dispatch(hl.dsp.window.move({ x = ${Math.round(x)}, y = ${Math.round(y)}, window = ${lua(`address:${address}`)} }))`,
    `dispatch movewindowpixel exact ${Math.round(x)} ${Math.round(y)},address:${address}`,
  );
}

/** Puts a floating window above the other floating windows. */
export function raiseWindow(address: string): Promise<boolean> {
  return send(
    `hl.dispatch(hl.dsp.window.alter_zorder({ mode = "top", window = ${lua(`address:${address}`)} }))`,
    `dispatch alterzorder top,address:${address}`,
  );
}
