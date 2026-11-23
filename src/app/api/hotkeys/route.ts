import { run } from "@/lib/server/exec";
import { launchableApps } from "@/lib/server/hotkeys/apps";
import { runHotkeyAction } from "@/lib/server/hotkeys/launch";
import { hotkeyBridge, loadHotkeys, loadLabels, loadStats, newHotkey, saveHotkeys, saveLabels } from "@/lib/server/hotkeys/store";
import { systemBindings } from "@/lib/server/hotkeys/system";
import { toolBindings } from "@/lib/server/hotkeys/tools";
import {
  actionTitle,
  checkCombo,
  comboId,
  comboLabel,
  findConflicts,
  sanitizeAction,
  sanitizeCombo,
  type HotkeyOS,
  type HotkeysReport,
  type SystemBinding,
  type SystemBindingsReport,
} from "@/lib/hotkeys";

const OS: HotkeyOS = process.platform === "win32" ? "windows" : process.platform === "linux" ? "linux" : "mac";
const NO_STORE = { "cache-control": "no-store" };

function report(): HotkeysReport {
  const bridge = hotkeyBridge();
  const hotkeys = loadHotkeys();
  const state = bridge?.status();
  const stats = loadStats();
  return {
    available: Boolean(bridge),
    permission: state?.permission ?? "not-required",
    paused: state?.paused ?? false,
    canPick: Boolean(bridge),
    islandSupported: state?.islandSupported ?? false,
    hotkeys: hotkeys.map((h) => ({
      ...h,
      status: state?.statuses[h.id] ?? {
        active: false,
        // Outside the desktop app the page explains it once in a banner, not on every row.
        problem: h.enabled && bridge ? "Not registered yet." : undefined,
        uses: stats[h.id]?.uses ?? 0,
        lastUsedAt: stats[h.id]?.lastUsedAt,
      },
    })),
  };
}

function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

/**
 * Everything already bound: the OS's own list, hotkey tools' config files, and keys found held
 * by other programs. Probed keys that a named source already explains aren't listed twice.
 */
async function everythingInUse(force: boolean): Promise<SystemBindingsReport> {
  const [base, tools] = await Promise.all([systemBindings(), toolBindings(force)]);
  const claimed = hotkeyBridge()?.claimed(force) ?? null;
  const labels = loadLabels();
  const named = new Set([...base.bindings, ...tools.bindings].filter((b) => b.kind !== "app").map((b) => comboId(b.combo)));
  const held: SystemBinding[] = (claimed ?? [])
    .filter((combo) => !named.has(comboId(combo)))
    .map((combo) => {
      const label = labels[comboId(combo)];
      return {
        id: `claimed-${comboId(combo)}`,
        name: label ?? "Held by another app",
        group: "Held by other apps",
        owner: label ? "Named by you" : OS === "windows" ? "Windows or another app" : "Unknown app",
        kind: "claimed",
        combo,
        nameable: true,
        detail: label ? undefined : "Found by trying the keys; the app holding them doesn't say who it is",
      };
    });
  return {
    bindings: [...base.bindings, ...tools.bindings, ...held],
    sources: [...base.sources, ...tools.sources, ...(claimed ? ["keys held by running apps"] : [])],
    probed: claimed !== null,
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const view = params.get("view");
  if (view === "system") return Response.json(await everythingInUse(params.get("refresh") === "1"), { headers: NO_STORE });
  if (view === "apps") return Response.json(launchableApps(), { headers: NO_STORE });
  return Response.json(report(), { headers: NO_STORE });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const bridge = hotkeyBridge();

  switch (body.action) {
    case "save": {
      const input = (body.hotkey ?? {}) as Record<string, unknown>;
      const combo = sanitizeCombo(input.combo);
      const action = sanitizeAction(input.do);
      if (!combo) return fail("Those keys can't be used as a shortcut.");
      if (!action) return fail("Choose what the shortcut should open.");
      const check = checkCombo(combo, OS);
      if (!check.ok) return fail(check.reason);
      const hotkeys = loadHotkeys();
      const id = typeof input.id === "string" ? input.id : undefined;
      const { own } = findConflicts(combo, hotkeys, [], id);
      if (own) return fail(`${comboLabel(combo, OS)} already opens ${actionTitle(own.action)}.`, 409);
      const existing = id ? hotkeys.find((h) => h.id === id) : undefined;
      if (existing) {
        Object.assign(existing, { combo, action, enabled: input.enabled !== false });
      } else {
        const created = newHotkey({ combo, action, enabled: input.enabled !== false });
        // Undoing a delete puts the shortcut back as it was, id and all.
        if (id) Object.assign(created, { id, createdAt: typeof input.createdAt === "number" ? input.createdAt : created.createdAt });
        hotkeys.push(created);
      }
      saveHotkeys(hotkeys);
      bridge?.sync(hotkeys);
      return Response.json(report(), { headers: NO_STORE });
    }

    case "delete": {
      const hotkeys = loadHotkeys().filter((h) => h.id !== body.id);
      saveHotkeys(hotkeys);
      bridge?.sync(hotkeys);
      return Response.json(report(), { headers: NO_STORE });
    }

    case "toggle": {
      const hotkeys = loadHotkeys();
      const target = hotkeys.find((h) => h.id === body.id);
      if (!target) return fail("That shortcut doesn't exist anymore.", 404);
      target.enabled = body.enabled === true;
      saveHotkeys(hotkeys);
      bridge?.sync(hotkeys);
      return Response.json(report(), { headers: NO_STORE });
    }

    case "run": {
      const action = sanitizeAction(body.do);
      if (!action) return fail("Nothing to run.");
      const result = bridge ? await bridge.run(action) : await runHotkeyAction(action);
      return Response.json(result, { headers: NO_STORE });
    }

    // The editor pauses listening while it records, so pressing an existing shortcut doesn't fire it.
    case "pause":
      bridge?.pause();
      return Response.json({ ok: true }, { headers: NO_STORE });
    case "resume":
      bridge?.resume();
      return Response.json({ ok: true }, { headers: NO_STORE });

    case "pick": {
      const kind = body.kind === "app" || body.kind === "folder" ? body.kind : "file";
      const path = bridge ? await bridge.pick(kind) : null;
      return Response.json({ path }, { headers: NO_STORE });
    }

    case "label": {
      const combo = sanitizeCombo(body.combo);
      if (!combo) return fail("Those keys can't be named.");
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
      const labels = loadLabels();
      if (name) labels[comboId(combo)] = name;
      else delete labels[comboId(combo)];
      saveLabels(labels);
      return Response.json({ ok: true }, { headers: NO_STORE });
    }

    case "open-permission": {
      if (OS === "mac") await run("/usr/bin/open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"], 4000);
      return Response.json({ ok: true }, { headers: NO_STORE });
    }

    default:
      return fail("Unknown action.");
  }
}
