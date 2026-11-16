"use client";

import { OS, IS_WINDOWS, byOS } from "@/lib/platform";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useTheme } from "@farm.js/core/theme/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSettings } from "@/lib/client/settings";
import { sendShellCommand, sendUpdateAction, useShellState } from "@/lib/client/shell";
import { Button } from "@/components/ui/button";
import type { UpdateState } from "@/lib/update-types";

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{title}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

interface AutostartState {
  available: boolean;
  enabled: boolean;
  reason?: string;
}

/** Whether Systo opens when you log in, read fresh each time Settings opens. */
function useAutostart(open: boolean) {
  const [state, setState] = useState<AutostartState | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/autostart", { cache: "no-store" })
      .then((r) => r.json() as Promise<AutostartState>)
      .then((next) => !cancelled && setState(next))
      .catch(() => !cancelled && setState({ available: false, enabled: false, reason: "Couldn't read this setting." }));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const set = async (enabled: boolean) => {
    if (!state) return;
    setPending(true);
    setState({ ...state, enabled });
    try {
      const response = await fetch("/api/autostart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const next = (await response.json()) as AutostartState;
      setState(next);
      if (next.enabled !== enabled) toast.error(`Couldn't turn ${enabled ? "on" : "off"} opening at ${IS_WINDOWS ? "sign-in" : "login"}.`);
    } catch {
      setState({ ...state, enabled: !enabled });
      toast.error("Couldn't change this setting.");
    } finally {
      setPending(false);
    }
  };

  return { state, pending, set };
}

const CHANGELOG_URL = "https://systo.mohammedibrahim.dev/changelog";

function ago(at?: number) {
  if (!at) return "";
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

function updateHint(update: UpdateState | undefined, desktop: boolean): string {
  if (!desktop || !update) return "Available in the installed app.";
  if (update.phase === "unavailable") return update.error ?? "Available in the installed app.";
  const current = update.version ? `Systo ${update.version}` : "Systo";
  switch (update.phase) {
    case "checking":
      return `${current} · Checking for updates…`;
    case "downloading":
      return `Downloading ${update.latest ?? "the update"}${update.progress ? ` · ${update.progress}%` : "…"}`;
    case "ready":
      return `${update.latest ?? "A new version"} is ready. Restart Systo to finish updating.`;
    case "installing":
      return "Restarting into the new version…";
    case "up-to-date":
      return `${current} is up to date${update.checkedAt ? ` · checked ${ago(update.checkedAt)}` : ""}.`;
    case "error":
      return `${current} · ${update.error ?? "Couldn't check for updates."}`;
    default:
      return `${current} · Checks automatically and downloads in the background.`;
  }
}

/** Updates: status from the shell, a manual check, and restart-to-install once one is downloaded. */
function UpdatesRow({ update, desktop }: { update?: UpdateState; desktop: boolean }) {
  const [busy, setBusy] = useState(false);
  const usable = desktop && update && update.phase !== "unavailable";
  const working = update?.phase === "checking" || update?.phase === "downloading" || update?.phase === "installing";
  const act = async (action: "check" | "install") => {
    setBusy(true);
    const next = await sendUpdateAction(action);
    setBusy(false);
    if (!next) toast.error("Couldn't reach the updater.");
    else if (action === "check" && next.phase === "error") toast.error(next.error ?? "Couldn't check for updates.");
    else if (action === "check" && next.phase === "up-to-date") toast.success(`Systo ${next.version} is the latest version.`);
  };
  return (
    <Row title="Updates" hint={updateHint(update, desktop)}>
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" className="h-8 text-[12px]" onClick={() => window.open(CHANGELOG_URL, "_blank")}>
          What's new
        </Button>
        {update?.phase === "ready" ? (
          <Button size="sm" className="h-8 text-[12px]" disabled={busy} onClick={() => void act("install")}>
            Restart to update
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="h-8 text-[12px]" disabled={!usable || busy || working} onClick={() => void act("check")}>
            {update?.phase === "checking" || busy ? "Checking…" : "Check now"}
          </Button>
        )}
      </div>
    </Row>
  );
}

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { settings, update } = useSettings();
  const { theme, setTheme } = useTheme();
  const shell = useShellState();
  const autostart = useAutostart(open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Saved on this {OS.device}.</DialogDescription>
        </DialogHeader>
        <div className="divide-y">
          <UpdatesRow update={shell?.update} desktop={Boolean(shell?.desktop)} />
          <Row
            title={IS_WINDOWS ? "Open at sign-in" : "Open at login"}
            hint={
              autostart.state && !autostart.state.available
                ? autostart.state.reason
                : `Start Systo automatically when you ${byOS("log in to your Mac", "sign in to Windows", "log in")}.`
            }
          >
            <Switch
              aria-label={IS_WINDOWS ? "Open at sign-in" : "Open at login"}
              disabled={!autostart.state?.available || autostart.pending}
              checked={Boolean(autostart.state?.enabled)}
              onCheckedChange={(enabled) => void autostart.set(enabled)}
            />
          </Row>
          <Row title="Update speed" hint="How often Systo samples processes.">
            <Select value={String(settings.interval)} onValueChange={(v) => update({ interval: Number(v) })}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1000">Fast · 1s</SelectItem>
                <SelectItem value="1500">Normal · 1.5s</SelectItem>
                <SelectItem value="3000">Slow · 3s</SelectItem>
                <SelectItem value="5000">Slower · 5s</SelectItem>
                <SelectItem value="0">Paused</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row title="CPU percentages" hint="Task Manager shows share of the whole chip. Activity Monitor shows 100% per core.">
            <ToggleGroup type="single" variant="outline" size="sm" value={settings.cpuMode} onValueChange={(v) => v && update({ cpuMode: v as "total" | "core" })}>
              <ToggleGroupItem value="total" className="px-3 text-[12px]">
                Total
              </ToggleGroupItem>
              <ToggleGroupItem value="core" className="px-3 text-[12px]">
                Per core
              </ToggleGroupItem>
            </ToggleGroup>
          </Row>
          <Row title="Heatmap" hint="Shade busy cells, darker the more they use.">
            <Switch checked={settings.heatmap} onCheckedChange={(v) => update({ heatmap: v })} />
          </Row>
          <Row title="Colored app icons" hint="Off keeps the interface monochrome; icons color in on hover.">
            <Switch checked={settings.colorIcons} onCheckedChange={(v) => update({ colorIcons: v })} />
          </Row>
          <Row title="Appearance">
            <ToggleGroup type="single" variant="outline" size="sm" value={theme} onValueChange={(v) => v && setTheme(v as "light" | "dark" | "system")}>
              <ToggleGroupItem value="light" className="px-3 text-[12px]">
                Light
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" className="px-3 text-[12px]">
                Dark
              </ToggleGroupItem>
              <ToggleGroupItem value="system" className="px-3 text-[12px]">
                Auto
              </ToggleGroupItem>
            </ToggleGroup>
          </Row>
          <Row
            title="Dynamic Island"
            hint={
              shell?.desktop
                ? !shell.islandSupported
                  ? "Needs a compositor that can float it above your windows. Hyprland is supported today."
                  : shell.notch
                  ? "Hover the notch to see your top 3 apps."
                  : byOS(
                      "No notch on this display; the island sits at the top of the menu bar.",
                      "A floating pill at the top center of your main display. It hides while something is fullscreen.",
                      "A floating pill under the bar at the top center of your display. It hides while something is fullscreen.",
                    )
                : "Available in the desktop app."
            }
          >
            <Switch
              disabled={!shell?.desktop || !shell.islandSupported}
              checked={Boolean(shell?.island)}
              onCheckedChange={(enabled) => sendShellCommand({ type: "island", enabled })}
            />
          </Row>
        </div>
      </DialogContent>
    </Dialog>
  );
}
