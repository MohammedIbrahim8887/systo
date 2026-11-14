"use client";

import { OS, IS_WINDOWS } from "@/lib/platform";
import type { ReactNode } from "react";
import { useTheme } from "@farm.js/core/theme/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSettings } from "@/lib/client/settings";
import { sendShellCommand, useShellState } from "@/lib/client/shell";

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

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { settings, update } = useSettings();
  const { theme, setTheme } = useTheme();
  const shell = useShellState();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Saved on this {OS.device}.</DialogDescription>
        </DialogHeader>
        <div className="divide-y">
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
                ? shell.notch
                  ? "Hover the notch to see your top 3 apps."
                  : IS_WINDOWS ? "A floating pill at the top center of your main display. It hides while something is fullscreen." : "No notch on this display; the island sits at the top of the menu bar."
                : "Available in the desktop app."
            }
          >
            <Switch
              disabled={!shell?.desktop}
              checked={Boolean(shell?.island)}
              onCheckedChange={(enabled) => sendShellCommand({ type: "island", enabled })}
            />
          </Row>
        </div>
      </DialogContent>
    </Dialog>
  );
}
