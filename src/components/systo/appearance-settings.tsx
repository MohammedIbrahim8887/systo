"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAppearance } from "@/lib/client/appearance";
import { contrast, ensureContrast, withAlpha } from "@/lib/color";
import { OS } from "@/lib/platform";
import {
  applyPreset,
  BLUR_MAX,
  deriveTokens,
  exportTheme,
  GENERIC_FONTS,
  importTheme,
  isCustomized,
  OPACITY_MIN,
  presetSlot,
  sanitizeFont,
  slotBlur,
  type SlotTheme,
  type ThemeMode,
  type Variant,
} from "@/lib/theme";
import { findPreset, presetPalette, presetsFor, THEME_PRESETS } from "@/lib/theme-presets";
import { cn } from "@/lib/utils";
import { ColorField } from "./color-field";
import { MiniWindow, ThemeSwatch } from "./theme-preview";

const MODES: Array<{ id: ThemeMode; label: string }> = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];
const VARIANT_LABEL: Record<Variant, string> = { dark: "Dark theme", light: "Light theme" };
const ACCENTS = [...new Set(THEME_PRESETS.filter((t) => t.dark && t.id !== "systo").map((t) => t.dark!.accent))].slice(0, 18);

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="px-4 py-2.5">
      <div className="flex min-h-8 items-center justify-between gap-6">
        <span className="shrink-0 text-[13px]">{label}</span>
        <div className="flex min-w-0 items-center gap-2">{children}</div>
      </div>
      {hint && <div className="mt-1 text-right text-[11.5px] leading-snug text-muted-foreground">{hint}</div>}
    </div>
  );
}

function ModeCards() {
  const { appearance, shown, setMode } = useAppearance();
  return (
    <RadioGroup.Root aria-label="Theme mode" value={appearance.mode} onValueChange={(v) => setMode(v as ThemeMode)} className="grid grid-cols-3 gap-4">
      {MODES.map(({ id, label }) => (
        <RadioGroup.Item key={id} value={id} className="group text-center outline-none">
          <span className="block rounded-xl p-[3px] ring-1 ring-transparent transition-shadow group-hover:ring-foreground/20 group-focus-visible:ring-[3px] group-focus-visible:ring-ring/60 group-data-[state=checked]:ring-2 group-data-[state=checked]:ring-primary">
            <span className="relative block aspect-[4/2.7] overflow-hidden rounded-[9px] border">
              {id !== "dark" && <MiniWindow slot={shown.light} variant="light" />}
              {id !== "light" && <MiniWindow slot={shown.dark} variant="dark" style={id === "system" ? { clipPath: "polygon(50% 0, 100% 0, 100% 100%, 50% 100%)" } : undefined} />}
            </span>
          </span>
          <span className="mt-1.5 flex h-5 items-center justify-center gap-1 text-[12px] text-muted-foreground group-data-[state=checked]:font-medium group-data-[state=checked]:text-foreground">
            {appearance.mode === id && <CheckIcon className="size-3" strokeWidth={2.5} />}
            {label}
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

function PresetSelect({ variant }: { variant: Variant }) {
  const { appearance, patchSlot, preview } = useAppearance();
  const slot = appearance[variant];
  // Leaving Settings with the list open must not leave a preview behind.
  useEffect(() => () => preview(variant, null), [preview, variant]);
  return (
    <Select
      value={slot.preset}
      onValueChange={(id) => patchSlot(variant, applyPreset(slot, id, variant))}
      onOpenChange={(open) => !open && preview(variant, null)}
    >
      <SelectTrigger size="sm" className="w-44" aria-label={`${VARIANT_LABEL[variant]} preset`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="end" className="max-h-[min(26rem,var(--radix-select-content-available-height))] w-52">
        {presetsFor(variant).map((preset) => (
          <SelectItem key={preset.id} value={preset.id} className="text-[13px]" onFocus={() => preview(variant, preset.id === slot.preset ? null : preset.id)}>
            <ThemeSwatch palette={preset[variant]!} />
            {preset.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ImportButton({ variant, onImport }: { variant: Variant; onImport: (slot: SlotTheme) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const id = useId();
  const result = useMemo(() => (text.trim() ? importTheme(text, variant) : null), [text, variant]);
  const error = result && "error" in result ? result.error : null;
  const imported = result && !("error" in result) ? result : null;

  const apply = () => {
    if (!imported) return;
    onImport(imported.slot);
    setOpen(false);
    setText("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-[12px] text-muted-foreground">
          Import
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2.5">
        <label htmlFor={id} className="block text-[12.5px] font-medium">
          Paste a theme
        </label>
        <textarea
          id={id}
          value={text}
          spellCheck={false}
          autoFocus
          onChange={(event) => setText(event.target.value)}
          placeholder={'systo-theme-v1:{…} or {"accent":"#E6B450",…}'}
          aria-invalid={Boolean(error)}
          className="h-24 w-full resize-none rounded-md border border-input bg-transparent px-2.5 py-2 font-mono text-[11.5px] break-all outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
        />
        <div aria-live="polite">
          {error && <p className="text-[11.5px] leading-snug text-muted-foreground">{error}</p>}
          {imported && (
            <div className="flex items-center gap-2 text-[12px]">
              <ThemeSwatch palette={imported.slot} />
              <span className="min-w-0 truncate">{findPreset(imported.slot.preset)?.name} colors</span>
              {imported.variant && imported.variant !== variant && <span className="ml-auto shrink-0 text-muted-foreground">Copied from a {imported.variant} theme</span>}
            </div>
          )}
        </div>
        <Button size="sm" className="h-8 w-full text-[12px]" disabled={!imported} onClick={apply}>
          Use this theme
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** Whether a font draws differently from every fallback, which is how a page can tell it's installed. */
function fontInstalled(family: string): boolean {
  const name = family.replace(/"/g, "");
  if (GENERIC_FONTS.has(name) || /^geist/i.test(name)) return true;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return true;
  return ["monospace", "serif", "sans-serif"].some((fallback) => {
    const width = (font: string) => {
      context.font = `64px ${font}`;
      return context.measureText("mmMwWLli10O&@gQ").width;
    };
    return width(`"${name}", ${fallback}`) !== width(fallback);
  });
}

function FontField({ label, value, placeholder, fallback, onChange }: { label: string; value: string; placeholder: string; fallback: string; onChange: (value: string) => void }) {
  const plain = value.replace(/"/g, "");
  const [draft, setDraft] = useState<string | null>(null);
  const missing = useMemo(() => (value ? value.split(",").map((f) => f.trim()).every((f) => !fontInstalled(f)) : false), [value]);
  const commit = () => {
    if (draft === null) return;
    const next = sanitizeFont(draft);
    if (next !== value) onChange(next);
    setDraft(null);
  };
  return (
    <Row label={label} hint={missing ? `${plain.split(",")[0]} isn't installed on this ${OS.device}, so ${placeholder} is used instead.` : undefined}>
      <Input
        aria-label={label}
        className="h-8 w-52 text-[12.5px] md:text-[12.5px]"
        style={{ fontFamily: value ? `${value}, ${fallback}` : fallback }}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        value={draft ?? plain}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && commit()}
      />
    </Row>
  );
}

function SliderRow({ label, value, min, max, suffix = "", before, onChange }: { label: string; value: number; min: number; max: number; suffix?: string; before?: ReactNode; onChange: (value: number) => void }) {
  return (
    <Row label={label}>
      {before}
      <Slider aria-label={label} aria-valuetext={`${value}${suffix}`} className="w-44" value={[value]} min={min} max={max} onValueChange={([v]) => onChange(v)} />
      <span className="w-10 text-right font-mono text-[12px] tabular text-muted-foreground">
        {value}
        {suffix}
      </span>
    </Row>
  );
}

function slotStatus(mode: ThemeMode, active: Variant, variant: Variant): string {
  if (mode === "system") return active === variant ? `In use: your system is ${variant} right now.` : `Used when your system switches to ${variant}.`;
  return active === variant ? "In use." : `Used when you switch to ${variant}.`;
}

function PreviewStrip({ slot, variant }: { slot: SlotTheme; variant: Variant }) {
  const t = useMemo(() => deriveTokens(slot, variant), [slot, variant]);
  const chipText = ensureContrast(slot.accent, [t.background], 4.5, slot.foreground);
  return (
    <div
      className="mx-4 mb-3 flex items-center gap-3 rounded-lg border px-3.5 py-3"
      style={{ background: t.background, color: t.foreground, borderColor: t.border, fontFamily: slot.uiFont ? `${slot.uiFont}, var(--font-sans)` : undefined }}
    >
      <span className="text-[13px] font-medium">{findPreset(slot.preset)?.name}</span>
      <span className="truncate text-[12px]" style={{ color: t["muted-foreground"] }}>
        Secondary text
      </span>
      <span className="ml-auto rounded-[4px] px-2 py-1 font-mono text-[11px] tabular" style={{ background: withAlpha(t.heat, 0.2), fontFamily: slot.codeFont ? `${slot.codeFont}, var(--font-mono)` : undefined }}>
        48.2%
      </span>
      <span className="rounded-md px-2.5 py-1 text-[12px]" style={{ background: withAlpha(slot.accent, 0.14), color: chipText }}>
        Accent
      </span>
      <span className="rounded-md px-2.5 py-1 text-[12px] font-medium" style={{ background: t.primary, color: t["primary-foreground"] }}>
        Button
      </span>
    </div>
  );
}

function SlotPanel({ variant }: { variant: Variant }) {
  const { appearance, shown, active, setMode, patchSlot, translucency } = useAppearance();
  const slot = appearance[variant];
  const base = presetPalette(slot.preset, variant);
  const patch = (next: Partial<SlotTheme>) => patchSlot(variant, next);
  const customized = isCustomized(slot, variant);
  const ratio = contrast(slot.foreground, slot.background);
  const translucent = slot.window === "translucent" && translucency;

  // Reset and Import replace everything at once, so they can be undone until the next change.
  // (In the panel, not a toast: an open dialog keeps toasts from being clicked.)
  const [undo, setUndo] = useState<{ before: SlotTheme; after: SlotTheme } | null>(null);
  const canUndo = undo && (Object.keys(slot) as Array<keyof SlotTheme>).every((key) => slot[key] === undo.after[key]);
  const replace = (after: SlotTheme) => {
    setUndo({ before: slot, after });
    patch(after);
  };
  const copy = () =>
    navigator.clipboard
      .writeText(exportTheme(slot, variant))
      .then(() => toast.success("Copied theme"))
      .catch(() => toast.error("Couldn't copy the theme."));

  return (
    <section aria-label={VARIANT_LABEL[variant]} className="rounded-xl border bg-card">
      <div className="flex items-center gap-1 px-4 pt-3">
        <h3 className="text-[13.5px] font-medium">{VARIANT_LABEL[variant]}</h3>
        {customized && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px] text-muted-foreground" onClick={() => replace(presetSlot(slot.preset, variant))}>
            Reset
          </Button>
        )}
        {canUndo && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => patch(undo.before)}>
            Undo
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <ImportButton variant={variant} onImport={replace} />
          <Button variant="ghost" size="sm" className="mr-1 h-8 px-2 text-[12px] text-muted-foreground" onClick={() => void copy()}>
            Copy
          </Button>
          <PresetSelect variant={variant} />
        </div>
      </div>
      <div className="flex min-h-9 items-center justify-between gap-4 px-4 pb-1.5">
        <p className="text-[12px] text-muted-foreground">{slotStatus(appearance.mode, active, variant)}</p>
        {active !== variant && (
          <Button variant="outline" size="xs" onClick={() => setMode(variant)}>
            Use {variant} theme
          </Button>
        )}
      </div>
      <PreviewStrip slot={shown[variant]} variant={variant} />
      <div className="divide-y border-t">
        <Row label="Accent">
          <ColorField label="Accent" value={slot.accent} base={base.accent} suggestions={ACCENTS} onChange={(accent) => patch({ accent })} />
        </Row>
        <Row label="Background">
          <ColorField label="Background" value={slot.background} base={base.background} onChange={(background) => patch({ background })} />
        </Row>
        <Row
          label="Foreground"
          hint={
            ratio < 3 ? (
              <span role="status" className="inline-flex items-center gap-1.5">
                <TriangleAlertIcon className="size-3.5 text-foreground" />
                Text is hard to read on this background ({ratio.toFixed(1)}:1).
                <button
                  type="button"
                  className="font-medium text-foreground underline underline-offset-2"
                  onClick={() => patch({ foreground: ensureContrast(slot.foreground, [slot.background], 7, contrast("#ffffff", slot.background) > contrast("#000000", slot.background) ? "#ffffff" : "#000000") })}
                >
                  Fix
                </button>
              </span>
            ) : undefined
          }
        >
          <ColorField label="Foreground" value={slot.foreground} base={base.foreground} onChange={(foreground) => patch({ foreground })} />
        </Row>
        <FontField label="UI font" placeholder="Geist" fallback={'"Geist Variable", sans-serif'} value={slot.uiFont} onChange={(uiFont) => patch({ uiFont })} />
        <FontField label="Code font" placeholder="Geist Mono" fallback={'"Geist Mono Variable", monospace'} value={slot.codeFont} onChange={(codeFont) => patch({ codeFont })} />
        <Row label="Window" hint={translucency ? undefined : "Translucent windows work in the Systo app on macOS."}>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            disabled={!translucency}
            value={translucent ? "translucent" : "solid"}
            onValueChange={(v) => v && patch({ window: v as SlotTheme["window"] })}
          >
            <ToggleGroupItem value="solid" className="px-3 text-[12px]">
              Solid
            </ToggleGroupItem>
            <ToggleGroupItem value="translucent" className="px-3 text-[12px]">
              Translucent
            </ToggleGroupItem>
          </ToggleGroup>
        </Row>
        {translucent && (
          <>
            <Row label="Sidebar only">
              <Switch aria-label="Sidebar only" checked={slot.sidebarOnly} onCheckedChange={(sidebarOnly) => patch({ sidebarOnly })} />
            </Row>
            <SliderRow label="Opacity" suffix="%" min={OPACITY_MIN} max={100} value={slot.opacity} onChange={(opacity) => patch({ opacity })} />
            <SliderRow
              label="Blur"
              min={0}
              max={BLUR_MAX}
              value={slotBlur(slot)}
              onChange={(blur) => patch({ blur })}
              before={
                <button
                  type="button"
                  aria-pressed={slot.blur === null}
                  title="Pick the blur from the opacity"
                  onClick={() => patch({ blur: slot.blur === null ? slotBlur(slot) : null })}
                  className={cn(
                    "h-6 rounded-md border px-2 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    slot.blur === null ? "border-transparent bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  Auto
                </button>
              }
            />
          </>
        )}
        <SliderRow label="Contrast" min={0} max={100} value={slot.contrast} onChange={(value) => patch({ contrast: value })} />
      </div>
    </section>
  );
}

export function AppearanceSettings() {
  return (
    <div className="space-y-5">
      <ModeCards />
      <SlotPanel variant="dark" />
      <SlotPanel variant="light" />
    </div>
  );
}
