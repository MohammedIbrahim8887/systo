"use client";

import { OS, byOS, isModKey } from "@/lib/platform";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AppWindowIcon,
  CheckIcon,
  CopyIcon,
  FileIcon,
  FolderOpenIcon,
  GlobeIcon,
  KeyboardIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  ScanSearchIcon,
  SearchIcon,
  ShieldIcon,
  SquareTerminalIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePoll } from "@/lib/client/use-poll";
import { useSettings } from "@/lib/client/settings";
import {
  actionTitle,
  actionVerb,
  comboFromEvent,
  comboId,
  comboLabel,
  comboSpoken,
  findConflicts,
  type BindingKind,
  type HotkeyAction,
  type HotkeyEntry,
  type HotkeysReport,
  type KeyCombo,
  type Modifier,
  type SystemBinding,
  type SystemBindingsReport,
} from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { AppIcon } from "./app-icon";
import { setListening } from "./key-recorder";
import { HOTKEY_OS, KeyCaps } from "./keycaps";
import { Logo } from "./logo";
import { ShortcutEditor, postHotkeys, tryAction, useApps, type EditorSeed } from "./shortcut-editor";

type Tab = "yours" | "os" | "apps" | "everyday";

const k = (mods: Modifier[], key: string): KeyCombo => ({ mods, key });
const MOD: Modifier = HOTKEY_OS === "mac" ? "meta" : "ctrl";
const OS_TAB = byOS("macOS", "Windows", "Desktop");

/** Which tab each kind of binding lives in. */
const TAB_OF: Record<BindingKind, Tab> = { os: "os", tool: "apps", claimed: "apps", app: "everyday", systo: "everyday" };

/** When one combo has several owners, the one that decides what happens wins the headline. */
const KIND_PRIORITY: BindingKind[] = ["claimed", "tool", "os", "app", "systo"];
const byPriority = (a: SystemBinding, b: SystemBinding) => KIND_PRIORITY.indexOf(a.kind ?? "os") - KIND_PRIORITY.indexOf(b.kind ?? "os");

/** Systo's own keys, which only apply while its window is in front. Mirrors systo-app.tsx. */
const INSIDE_SYSTO: SystemBinding[] = [
  ["Processes", "1"],
  ["Performance", "2"],
  ["History", "3"],
  ["Startup", "4"],
  ["Disk", "5"],
  ["AI usage", "6"],
  ["Shortcuts", "7"],
  ["Settings", ","],
  ["New shortcut (in Shortcuts)", "N"],
  ["Search shortcuts (in Shortcuts)", "F"],
].map(([name, key]) => ({ id: `systo-${key}`, name, group: "Inside Systo", owner: "Systo", kind: "systo" as const, combo: k([MOD], key) }));

const SEARCH_ALIASES: Record<Modifier, string> = {
  meta: byOS("cmd command ⌘", "win windows", "super meta"),
  ctrl: "ctrl control ⌃",
  alt: byOS("opt option alt ⌥", "alt", "alt"),
  shift: "shift ⇧",
};

function comboSearchText(combo: KeyCombo) {
  return [comboLabel(combo, HOTKEY_OS), comboSpoken(combo, HOTKEY_OS), ...combo.mods.map((m) => SEARCH_ALIASES[m]), combo.key].join(" ").toLowerCase();
}

function matches(query: string, ...fields: Array<string | undefined>) {
  if (!query) return true;
  const haystack = fields.filter(Boolean).join(" ").toLowerCase();
  return query.split(/\s+/).every((word) => haystack.includes(word));
}

function ago(at?: number) {
  if (!at) return "";
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 45) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days} d ago`;
}

function ActionIcon({ action, colorIcons }: { action: HotkeyAction; colorIcons: boolean }) {
  if (action.type === "app") return <AppIcon bundlePath={action.path} kind="app" size={26} color={colorIcons} />;
  const Icon =
    action.type === "url" ? GlobeIcon : action.type === "command" ? SquareTerminalIcon : action.type === "path" ? (/\.[a-z0-9]{1,6}$/i.test(action.path) ? FileIcon : FolderOpenIcon) : null;
  return (
    <span className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px] border bg-muted/60 text-muted-foreground">
      {Icon ? <Icon className="size-3.5" strokeWidth={1.75} /> : <Logo className="size-3.5 text-foreground" />}
    </span>
  );
}

function actionDetail(action: HotkeyAction): string {
  switch (action.type) {
    case "url":
      return action.url;
    case "path":
      return action.path;
    case "command":
      return "Runs in the background";
    default:
      return actionVerb(action);
  }
}

/** One sentence on who else answers to a combo. */
function ownerSentence(b: SystemBinding): string {
  if (b.kind === "claimed") return b.nameable && b.owner === "Named by you" ? `Held by another app (“${b.name}”)` : "Held by another app";
  if (b.kind === "app") return `Most apps: ${b.name}`;
  if (b.kind === "systo") return `Inside Systo: ${b.name}`;
  return `${b.owner}: ${b.name}`;
}

function SectionTitle({ title, count, hint, children }: { title: string; count?: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {count !== undefined && <span className="tabular text-[11px] text-muted-foreground/70">{count}</span>}
      {hint && <span className="ml-auto truncate text-[11px] text-muted-foreground/70">{hint}</span>}
      {children}
    </div>
  );
}

// ── Your shortcuts ───────────────────────────────────────────────────────────────────────────

const ROW_GRID = "grid grid-cols-[minmax(132px,188px)_minmax(0,1fr)_116px_84px] items-center gap-3";

function HotkeyRow({
  hotkey,
  flashing,
  clash,
  pending,
  colorIcons,
  onToggle,
  onEdit,
  onDelete,
}: {
  hotkey: HotkeyEntry;
  flashing: boolean;
  clash?: SystemBinding;
  pending: boolean;
  colorIcons: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: (record: boolean) => void;
  onDelete: () => void;
}) {
  const { action, status } = hotkey;
  const off = !hotkey.enabled;
  const problem = hotkey.enabled ? status.problem : undefined;
  const blocked = clash?.kind === "claimed";
  return (
    <div
      onDoubleClick={() => onEdit(false)}
      className={cn("group/row px-3 py-2.5", ROW_GRID, flashing && "animate-[systo-flash_1.4s_ease-out]", off && "text-muted-foreground")}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onEdit(true)}
            className={cn("-mx-1 w-fit rounded-md px-1 py-1 transition-opacity hover:bg-accent/70", off && "opacity-50")}
            aria-label={`Change keys for ${actionTitle(action)}: ${comboSpoken(hotkey.combo, HOTKEY_OS)}`}
          >
            <KeyCaps combo={hotkey.combo} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Record new keys</TooltipContent>
      </Tooltip>

      <div className="flex min-w-0 items-center gap-3">
        <span className={cn(off && "opacity-50")}>
          <ActionIcon action={action} colorIcons={colorIcons} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={cn("truncate text-[13px] font-medium", off ? "text-foreground/60" : "text-foreground", action.type === "command" && "font-mono text-[12.5px]")}>
              {actionTitle(action)}
            </span>
            {problem && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <TriangleAlertIcon className="size-3.5 shrink-0 text-foreground" aria-label={problem} />
                </TooltipTrigger>
                <TooltipContent className="max-w-60">{problem}</TooltipContent>
              </Tooltip>
            )}
            {clash && !problem && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn("shrink-0 rounded-[4px] px-1 text-[10px] leading-[15px]", blocked ? "bg-foreground font-medium text-background" : "border text-muted-foreground")}>
                    {blocked ? "Blocked" : "Shared"}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">
                  {blocked
                    ? `Another app holds these keys${clash.owner === "Named by you" ? ` (“${clash.name}”)` : ""}, so this shortcut won't fire while it runs. Record different keys.`
                    : `${ownerSentence(clash)}. Both respond when you press these keys.`}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className={cn("truncate text-[11.5px] text-muted-foreground", (action.type === "url" || action.type === "path") && "font-mono text-[10.5px]")}>
            {actionDetail(action)}
          </div>
        </div>
      </div>

      <div className="min-w-0 text-[12px]">
        {status.lastUsedAt ? (
          <>
            <div className="truncate">{ago(status.lastUsedAt)}</div>
            <div className="tabular truncate text-[11px] text-muted-foreground">
              {status.uses} press{status.uses === 1 ? "" : "es"}
            </div>
          </>
        ) : (
          <span className="text-muted-foreground">Not used yet</span>
        )}
      </div>

      <div className="flex items-center justify-end gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" aria-label={`More for ${actionTitle(action)}`}>
              <MoreHorizontalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => onEdit(false)}>
              <PencilIcon /> Edit…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void tryAction(action)}>
              <PlayIcon /> Try it now
            </DropdownMenuItem>
            {(action.type === "app" || action.type === "path") && (
              <DropdownMenuItem
                onSelect={() => void fetch("/api/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: action.path }) })}
              >
                <FolderOpenIcon /> {OS.reveal}
              </DropdownMenuItem>
            )}
            {action.type === "command" && (
              <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(action.command).then(() => toast.success("Copied command"))}>
                <CopyIcon /> Copy command
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete}>
              <Trash2Icon /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Switch checked={hotkey.enabled} disabled={pending} onCheckedChange={onToggle} aria-label={`Turn ${comboLabel(hotkey.combo, HOTKEY_OS)} on or off`} />
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: (seed: EditorSeed) => void }) {
  const apps = useApps();
  const suggestion = useMemo(() => {
    const wanted = byOS(["Terminal", "Safari", "Notes"], ["Windows Terminal", "Command Prompt", "Notepad"], ["Terminal", "Files", "Firefox"]);
    for (const name of wanted) {
      const hit = apps?.find((a) => a.name.toLowerCase() === name.toLowerCase());
      if (hit) return hit;
    }
    return null;
  }, [apps]);

  const demo: KeyCombo = HOTKEY_OS === "mac" ? k(["alt", "meta"], "T") : k(["ctrl", "alt"], "T");
  return (
    <div className="relative overflow-hidden rounded-xl border border-dashed px-6 py-10 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(color-mix(in_oklch,var(--foreground)_12%,transparent)_1px,transparent_1px)] [background-size:14px_14px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"
      />
      <div className="relative flex flex-col items-center">
        <KeyCaps combo={demo} size="md" className="opacity-90" />
        <h3 className="mt-5 text-[14px] font-semibold tracking-tight">Open anything with a keystroke</h3>
        <p className="mt-1.5 max-w-[420px] text-[12.5px] leading-relaxed text-muted-foreground">
          Pick a few keys and what they open: an app, a website, a folder, or a command. They work in every app on your {OS.device} while Systo is running.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" className="h-8 text-[12px]" onClick={() => onCreate({})}>
            <PlusIcon className="size-3.5" /> New shortcut
          </Button>
          {suggestion && (
            <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => onCreate({ action: { type: "app", path: suggestion.path, name: suggestion.name } })}>
              <AppWindowIcon className="size-3.5" /> Open {suggestion.name}
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => onCreate({ action: { type: "systo", command: "open-main" } })}>
            <Logo className="size-3.5" /> Show Systo
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Other people's shortcuts ─────────────────────────────────────────────────────────────────

/** A name the user can set inline, for keys Systo found held but couldn't identify. */
function NameField({ binding, onSaved }: { binding: SystemBinding; onSaved: () => void }) {
  const named = binding.owner === "Named by you";
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(named ? binding.name : "");
  const saving = useRef(false);

  const cancelled = useRef(false);

  const save = async (next: string) => {
    // Esc unmounts the input, which blurs it; that blur mustn't save what was thrown away.
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (saving.current) return;
    saving.current = true;
    setEditing(false);
    if (next.trim() !== (named ? binding.name : "")) {
      const { ok } = await postHotkeys({ action: "label", combo: binding.combo, name: next });
      if (ok) {
        if (next.trim()) toast.success(`Named ${comboLabel(binding.combo, HOTKEY_OS)}`, { description: next.trim() });
        onSaved();
      } else toast.error("Couldn't save the name");
    }
    saving.current = false;
  };

  if (editing) {
    return (
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save(value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save(value);
          else if (e.key === "Escape") {
            e.stopPropagation();
            cancelled.current = true;
            setValue(named ? binding.name : "");
            setEditing(false);
          }
        }}
        placeholder="What do these keys do? e.g. New Alacritty window"
        className="h-7 min-w-0 flex-1 text-[12.5px]"
        maxLength={80}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        cancelled.current = false;
        setEditing(true);
      }} className="group/name flex min-w-0 flex-1 items-center gap-1.5 text-left">
      <span className={cn("truncate text-[12.5px]", !named && "text-muted-foreground italic")}>{named ? binding.name : "Unidentified app"}</span>
      <span
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-[4px] px-1 text-[10.5px] text-muted-foreground transition-opacity",
          named ? "opacity-0 group-hover/name:opacity-100 group-focus-visible/name:opacity-100" : "border",
        )}
      >
        <PencilIcon className="size-2.5" /> {named ? "Rename" : "Name it"}
      </span>
    </button>
  );
}

function BindingGroup({
  title,
  rows,
  ownByCombo,
  onNamed,
  lookup,
}: {
  title: string;
  rows: SystemBinding[];
  ownByCombo: Map<string, HotkeyEntry>;
  onNamed: () => void;
  lookup: KeyCombo | null;
}) {
  const owners = [...new Set(rows.map((r) => r.owner))].filter((o) => o !== "Named by you");
  return (
    <div className="flex flex-col rounded-xl border">
      <div className="flex items-baseline gap-2 border-b px-3 py-2">
        <h4 className="text-[12px] font-medium">{title}</h4>
        <span className="tabular text-[11px] text-muted-foreground/70">{rows.length}</span>
        <span className="ml-auto truncate text-[11px] text-muted-foreground/70">{owners.join(", ")}</span>
      </div>
      <div className="divide-y">
        {rows.map((row) => {
          const yours = ownByCombo.get(comboId(row.combo));
          const hit = lookup && comboId(lookup) === comboId(row.combo);
          return (
            <div key={row.id} className={cn("flex min-h-9 items-center gap-3 px-3 py-1.5", hit && "bg-accent/60")}>
              {row.nameable ? (
                <NameField binding={row} onSaved={onNamed} />
              ) : (
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px]">{row.name}</div>
                  {row.detail && <div className="truncate font-mono text-[10.5px] text-muted-foreground">{row.detail}</div>}
                </div>
              )}
              {yours && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="shrink-0 rounded-[4px] bg-foreground px-1 text-[10px] leading-[15px] font-medium text-background">Yours too</span>
                  </TooltipTrigger>
                  <TooltipContent>Your shortcut for {actionTitle(yours.action)} uses the same keys.</TooltipContent>
                </Tooltip>
              )}
              <KeyCaps combo={row.combo} className="shrink-0" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function groupRows(rows: SystemBinding[]): Array<[string, SystemBinding[]]> {
  const map = new Map<string, SystemBinding[]>();
  for (const b of rows) map.set(b.group, [...(map.get(b.group) ?? []), b]);
  return [...map.entries()];
}

function GroupGrid({ rows, ownByCombo, onNamed, lookup }: { rows: SystemBinding[]; ownByCombo: Map<string, HotkeyEntry>; onNamed: () => void; lookup: KeyCombo | null }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {groupRows(rows).map(([group, items]) => (
        <BindingGroup key={group} title={group} rows={items} ownByCombo={ownByCombo} onNamed={onNamed} lookup={lookup} />
      ))}
    </div>
  );
}

function Notice({ icon: Icon, children, action }: { icon: typeof ShieldIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-[12px] text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      <span className="flex-1 leading-snug">{children}</span>
      {action}
    </div>
  );
}

function NoMatches({ elsewhere, onJump, text, hidden }: { elsewhere: Array<{ tab: Tab; label: string; count: number }>; onJump: (tab: Tab) => void; text: string; hidden?: boolean }) {
  // A looked-up combo nothing uses already says "free" above; an empty card would repeat it.
  if (hidden) return null;
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border px-6 py-10 text-center">
      <p className="text-[12.5px] text-muted-foreground">{text}</p>
      {elsewhere.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {elsewhere.map((e) => (
            <Button key={e.tab} variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => onJump(e.tab)}>
              {e.count} in {e.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Key lookup ───────────────────────────────────────────────────────────────────────────────

/**
 * Search by pressing keys: the box turns into a listener, and the next combo becomes a filter
 * across every tab. Systo's own shortcuts pause meanwhile so the press doesn't launch anything.
 */
function useKeyLookup() {
  const [listening, setLookupListening] = useState(false);
  const [combo, setCombo] = useState<KeyCombo | null>(null);
  const [held, setHeld] = useState<Modifier[]>([]);

  useEffect(() => {
    if (!listening) return;
    setListening(false);
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      const next = comboFromEvent(event);
      if (!next.key) {
        setHeld(next.mods);
        return;
      }
      if (next.key === "Escape" && next.mods.length === 0) {
        setLookupListening(false);
        return;
      }
      setCombo(next);
      setLookupListening(false);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setHeld(comboFromEvent(event).mods);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest("[data-lookup]")) setLookupListening(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      setHeld([]);
      setListening(true);
    };
  }, [listening]);

  return { listening, start: () => setLookupListening(true), stop: () => setLookupListening(false), combo, clear: () => setCombo(null), held };
}

/** What a looked-up combo is used for, everywhere, in one line, with a way to claim it if free. */
function LookupResult({ combo, uses, yours, onCreate }: { combo: KeyCombo; uses: SystemBinding[]; yours?: HotkeyEntry; onCreate: () => void }) {
  const label = comboLabel(combo, HOTKEY_OS);
  const free = uses.length === 0 && !yours;
  return (
    <div className="mb-5 flex items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3 animate-in fade-in-0 slide-in-from-top-1 duration-200">
      <KeyCaps combo={combo} size="md" />
      <div className="min-w-0 flex-1 text-[12.5px] leading-snug">
        {free ? (
          <>
            <div className="flex items-center gap-1.5 font-medium">
              <CheckIcon className="size-3.5" /> {label} is free
            </div>
            <div className="text-muted-foreground">Nothing Systo can see on this {OS.device} uses it.</div>
          </>
        ) : (
          <>
            <div className="font-medium">
              {label} is used {uses.length + (yours ? 1 : 0) === 1 ? "once" : `${uses.length + (yours ? 1 : 0)} times`}
            </div>
            <div className="truncate text-muted-foreground">
              {[yours ? `Yours: opens ${actionTitle(yours.action)}` : null, ...uses.map(ownerSentence)].filter(Boolean).join(" · ")}
            </div>
          </>
        )}
      </div>
      {free && (
        <Button size="sm" className="h-8 text-[12px]" onClick={onCreate}>
          <PlusIcon className="size-3.5" /> Use for a shortcut
        </Button>
      )}
    </div>
  );
}

// ── View ─────────────────────────────────────────────────────────────────────────────────────

let rememberedTab: Tab = "yours";

export function ShortcutsView() {
  const [tab, setTabState] = useState<Tab>(rememberedTab);
  const setTab = (next: Tab) => {
    rememberedTab = next;
    setTabState(next);
  };
  const [query, setQuery] = useState("");
  const [seed, setSeed] = useState<EditorSeed | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  const [rechecking, setRechecking] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const lookup = useKeyLookup();
  const { settings } = useSettings();
  // Paused while the editor is open; saving refreshes it.
  const { data, error, refresh } = usePoll<HotkeysReport>("/api/hotkeys", 1500, seed !== null);
  const { data: inUse, refresh: refreshInUse } = usePoll<SystemBindingsReport>("/api/hotkeys?view=system", 30_000);

  const hotkeys = useMemo(
    () => (data?.hotkeys ?? []).map((h) => (h.id in overrides ? { ...h, enabled: overrides[h.id] } : h)).sort((a, b) => a.createdAt - b.createdAt),
    [data, overrides],
  );
  const bindings = useMemo(() => [...(inUse?.bindings ?? []), ...INSIDE_SYSTO], [inUse]);
  // Systo's in-window keys can't clash with a global shortcut in a way that matters.
  const outside = useMemo(() => (inUse?.bindings ?? []).slice().sort(byPriority), [inUse]);
  const ownByCombo = useMemo(() => new Map(hotkeys.map((h) => [comboId(h.combo), h])), [hotkeys]);

  // Flash a row when its shortcut is pressed, so people can see Systo heard it.
  const lastSeen = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!data) return;
    const fired: string[] = [];
    for (const h of data.hotkeys) {
      const at = h.status.lastUsedAt ?? 0;
      const before = lastSeen.current.get(h.id);
      if (before !== undefined && at > before) fired.push(h.id);
      lastSeen.current.set(h.id, at);
    }
    if (!fired.length) return;
    setFlashing((s) => new Set([...s, ...fired]));
    const timer = setTimeout(() => setFlashing((s) => new Set([...s].filter((id) => !fired.includes(id)))), 1500);
    return () => clearTimeout(timer);
  }, [data]);

  // Say so once macOS access arrives, since nothing else visibly changes.
  const permission = data?.permission;
  const previousPermission = useRef(permission);
  useEffect(() => {
    if (previousPermission.current === "needed" && permission === "granted") toast.success("Shortcuts are on", { description: "Systo can now hear them in every app." });
    previousPermission.current = permission;
  }, [permission]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (seed !== null || lookup.listening || !isModKey(event)) return;
      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        setSeed({});
      } else if (key === "f") {
        event.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seed, lookup.listening]);

  // Filtering: typed words, or an exact combo from the key lookup.
  const q = query.trim().toLowerCase();
  const lookupId = lookup.combo ? comboId(lookup.combo) : null;
  const hotkeyMatches = (h: HotkeyEntry) => (lookupId ? comboId(h.combo) === lookupId : matches(q, actionTitle(h.action), actionDetail(h.action), actionVerb(h.action), comboSearchText(h.combo)));
  const bindingMatches = (b: SystemBinding) => (lookupId ? comboId(b.combo) === lookupId : matches(q, b.name, b.group, b.owner, b.detail, comboSearchText(b.combo)));
  const visibleHotkeys = hotkeys.filter(hotkeyMatches);
  const visibleBindings = bindings.filter(bindingMatches);
  const inTab = (t: Tab) => visibleBindings.filter((b) => TAB_OF[b.kind ?? "os"] === t);
  const filtering = Boolean(q || lookupId);

  const counts: Record<Tab, number> = {
    yours: filtering ? visibleHotkeys.length : hotkeys.length,
    os: inTab("os").length,
    apps: inTab("apps").length,
    everyday: inTab("everyday").length,
  };
  const TABS: Array<{ tab: Tab; label: string }> = [
    { tab: "yours", label: "Yours" },
    { tab: "os", label: OS_TAB },
    { tab: "apps", label: "Other apps" },
    { tab: "everyday", label: "Everyday keys" },
  ];
  const elsewhere = (current: Tab) => TABS.filter((t) => t.tab !== current && counts[t.tab] > 0).map((t) => ({ ...t, count: counts[t.tab] }));
  const unnamed = (inUse?.bindings ?? []).filter((b) => b.kind === "claimed" && b.owner !== "Named by you").length;

  // A combo looked up while sitting on an empty tab jumps to where it's used.
  useEffect(() => {
    if (!lookupId || counts[tab] > 0) return;
    const first = TABS.find((t) => counts[t.tab] > 0);
    if (first) setTab(first.tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupId]);

  const toggle = async (hotkey: HotkeyEntry, enabled: boolean) => {
    setPending((p) => new Set(p).add(hotkey.id));
    setOverrides((o) => ({ ...o, [hotkey.id]: enabled }));
    const { ok, error: message } = await postHotkeys({ action: "toggle", id: hotkey.id, enabled });
    if (!ok) toast.error("Couldn't change the shortcut", { description: message });
    await refresh();
    setOverrides(({ [hotkey.id]: _, ...rest }) => rest);
    setPending((p) => {
      const next = new Set(p);
      next.delete(hotkey.id);
      return next;
    });
  };

  const remove = async (hotkey: HotkeyEntry) => {
    const { ok, error: message } = await postHotkeys({ action: "delete", id: hotkey.id });
    if (!ok) {
      toast.error("Couldn't delete the shortcut", { description: message });
      return;
    }
    void refresh();
    toast(`Deleted ${comboLabel(hotkey.combo, HOTKEY_OS)}`, {
      description: actionTitle(hotkey.action),
      action: {
        label: "Undo",
        onClick: async () => {
          await postHotkeys({ action: "save", hotkey: { id: hotkey.id, createdAt: hotkey.createdAt, combo: hotkey.combo, do: hotkey.action, enabled: hotkey.enabled } });
          void refresh();
        },
      },
    });
  };

  const recheck = async () => {
    setRechecking(true);
    await fetch("/api/hotkeys?view=system&refresh=1", { cache: "no-store" }).catch(() => {});
    await refreshInUse();
    setRechecking(false);
  };

  const enabled = hotkeys.filter((h) => h.enabled);
  const listening = hotkeys.filter((h) => h.enabled && h.status.active);
  const presses = hotkeys.reduce((sum, h) => sum + h.status.uses, 0);
  const lastUsed = [...hotkeys].sort((a, b) => (b.status.lastUsedAt ?? 0) - (a.status.lastUsedAt ?? 0))[0];
  const listeningState = !data ? null : !data.available ? "Desktop app only" : data.paused ? "Paused" : data.permission === "needed" ? "Needs access" : listening.length ? "Listening" : null;
  const clashFor = (h: HotkeyEntry) => findConflicts(h.combo, [], outside).system[0];

  const lookupUses = lookup.combo ? outside.filter((b) => comboId(b.combo) === lookupId) : [];
  const lookupFree = Boolean(lookup.combo && lookupUses.length === 0 && !ownByCombo.has(lookupId!));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="mr-1 text-[15px] font-semibold tracking-tight">Shortcuts</h1>

        {/* Search by words, or press the keyboard button and search by pressing keys. */}
        <div data-lookup className="relative w-64">
          {lookup.listening ? (
            <div className="flex h-8 items-center gap-2 rounded-md border border-foreground/30 bg-background px-2.5 text-[12.5px] animate-[systo-listen_1.8s_ease-in-out_infinite]">
              <KeyboardIcon className="size-3.5 shrink-0 text-muted-foreground" />
              {lookup.held.length ? <KeyCaps combo={{ mods: lookup.held, key: "" }} /> : <span className="text-muted-foreground">Press keys to look up…</span>}
              <span className="ml-auto text-[11px] text-muted-foreground/70">esc</span>
            </div>
          ) : lookup.combo ? (
            <div className="flex h-8 items-center gap-2 rounded-md border bg-accent/50 pr-1 pl-2.5">
              <KeyboardIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <KeyCaps combo={lookup.combo} />
              <button type="button" onClick={lookup.start} className="text-[11.5px] text-muted-foreground hover:text-foreground">
                Change
              </button>
              <Button variant="ghost" size="icon" className="ml-auto size-6" onClick={lookup.clear} aria-label="Clear key lookup">
                <XIcon className="size-3.5" />
              </Button>
            </div>
          ) : (
            <>
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search names or keys" className="h-8 pr-9 pl-8 text-[12.5px]" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="absolute top-1/2 right-1 size-6 -translate-y-1/2" onClick={lookup.start} aria-label="Look up by pressing keys">
                    <ScanSearchIcon className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Look up by pressing keys</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>

        <div className="flex-1" />
        {listeningState && (
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", listeningState === "Listening" ? "animate-[systo-pulse_2.4s_ease-in-out_infinite] bg-foreground" : "border border-foreground/40")} />
            {listeningState}
          </span>
        )}
        <Button size="sm" className="h-8 gap-2 text-[12px]" onClick={() => setSeed({})}>
          <PlusIcon className="size-3.5" /> New shortcut
          <Kbd className="h-4 bg-primary-foreground/15 px-1 text-[10px] text-primary-foreground/80">{OS.mod}N</Kbd>
        </Button>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="min-h-0 flex-1 gap-0">
        <div className="flex h-11 shrink-0 items-end border-b px-4">
          <TabsList variant="line" className="h-10 gap-4 p-0">
            {TABS.map(({ tab: t, label }) => (
              <TabsTrigger key={t} value={t} className="h-full flex-none gap-1.5 px-0.5 text-[12.5px] after:bottom-[-1px]!">
                {label}
                <span
                  className={cn(
                    "tabular min-w-[18px] rounded-full px-1.5 text-[10.5px] leading-[16px] font-medium transition-colors",
                    filtering && counts[t] > 0 ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
                    filtering && counts[t] === 0 && "opacity-50",
                  )}
                >
                  {counts[t]}
                </span>
                {t === "apps" && unnamed > 0 && !filtering && (
                  <span className="size-1.5 rounded-full bg-foreground" aria-label={`${unnamed} unnamed`} />
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-5">
          {lookup.combo && <LookupResult combo={lookup.combo} uses={lookupUses} yours={ownByCombo.get(lookupId!)} onCreate={() => setSeed({ combo: lookup.combo!, record: false })} />}

          {/* ── Yours ── */}
          <TabsContent value="yours" className="m-0 space-y-5">
            {!data && !error && (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-6">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            )}
            {error && !data && <p className="text-[13px] text-muted-foreground">Couldn't read your shortcuts: {error}</p>}
            {data && (
              <>
                {!filtering && (
                  <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
                    {[
                      { label: "Your shortcuts", value: hotkeys.length, hint: hotkeys.length ? `${enabled.length} turned on` : "None yet" },
                      {
                        label: "Listening",
                        value: listening.length,
                        hint: !data.available ? "In the desktop app" : data.paused ? "Paused while recording" : data.permission === "needed" ? "Needs Accessibility access" : "In every app",
                      },
                      { label: "Presses", value: presses, hint: lastUsed?.status.lastUsedAt ? `${actionTitle(lastUsed.action)} · ${ago(lastUsed.status.lastUsedAt).toLowerCase()}` : "None yet" },
                      { label: "Keys already taken", value: outside.filter((b) => b.kind !== "app").length, hint: `See the ${OS_TAB} and Other apps tabs` },
                    ].map((s) => (
                      <div key={s.label} className="min-w-0">
                        <div className="text-[11px] text-muted-foreground">{s.label}</div>
                        <div className="tabular mt-0.5 text-[22px] leading-tight font-semibold tracking-tight">{s.value}</div>
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{s.hint}</div>
                      </div>
                    ))}
                  </div>
                )}

                {data.permission === "needed" && (
                  <Notice
                    icon={ShieldIcon}
                    action={
                      <Button variant="outline" size="sm" className="h-7 shrink-0 text-[12px]" onClick={() => void postHotkeys({ action: "open-permission" })}>
                        Open Accessibility Settings
                      </Button>
                    }
                  >
                    macOS only lets Systo hear keys pressed in other apps once you turn it on in Privacy & Security › Accessibility. Your shortcuts start working as soon as you do.
                  </Notice>
                )}
                {!data.available && <Notice icon={KeyboardIcon}>You can set shortcuts up here, but only the Systo desktop app can listen for them.</Notice>}

                <div>
                  <SectionTitle
                    title="Your shortcuts"
                    count={hotkeys.length > 0 ? `${enabled.length} of ${hotkeys.length} on` : undefined}
                    hint="Click the keys to record new ones · double-click a row to edit"
                  />
                  {hotkeys.length === 0 ? (
                    <EmptyState onCreate={setSeed} />
                  ) : visibleHotkeys.length === 0 ? (
                    <NoMatches hidden={lookupFree} text={lookup.combo ? `None of your shortcuts use ${comboLabel(lookup.combo, HOTKEY_OS)}.` : `None of your shortcuts match “${query}”.`} elsewhere={elsewhere("yours")} onJump={setTab} />
                  ) : (
                    <div className="rounded-xl border">
                      <div className={cn("border-b px-3 py-1.5 text-[11px] text-muted-foreground", ROW_GRID)}>
                        <span>Keys</span>
                        <span>Opens</span>
                        <span>Last used</span>
                        <span className="text-right">Enabled</span>
                      </div>
                      <div className="divide-y">
                        {visibleHotkeys.map((h) => (
                          <HotkeyRow
                            key={h.id}
                            hotkey={h}
                            flashing={flashing.has(h.id)}
                            clash={clashFor(h)}
                            pending={pending.has(h.id)}
                            colorIcons={settings.colorIcons}
                            onToggle={(v) => void toggle(h, v)}
                            onEdit={(record) => setSeed({ id: h.id, combo: h.combo, action: h.action, enabled: h.enabled, record })}
                            onDelete={() => void remove(h)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </TabsContent>

          {/* ── The OS ── */}
          <TabsContent value="os" className="m-0 space-y-4">
            {!inUse ? (
              <div className="grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40" />)}</div>
            ) : inTab("os").length === 0 ? (
              <NoMatches hidden={lookupFree} text={filtering ? `${OS_TAB} doesn't use ${lookup.combo ? comboLabel(lookup.combo, HOTKEY_OS) : `anything matching “${query}”`}.` : "Nothing found."} elsewhere={elsewhere("os")} onJump={setTab} />
            ) : (
              <>
                <SectionTitle title={`Built into ${OS_TAB}`} count={inTab("os").length} hint={byOS("From System Settings › Keyboard › Keyboard Shortcuts, so changes you made there show up here", "Windows keeps most of these for itself", "From your compositor and desktop settings")} />
                <GroupGrid rows={inTab("os")} ownByCombo={ownByCombo} onNamed={() => void refreshInUse()} lookup={lookup.combo} />
              </>
            )}
          </TabsContent>

          {/* ── Other apps ── */}
          <TabsContent value="apps" className="m-0 space-y-6">
            {!inUse ? (
              <div className="grid gap-4 lg:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-40" />)}</div>
            ) : (
              <>
                {(() => {
                  const held = inTab("apps").filter((b) => b.kind === "claimed");
                  const tools = inTab("apps").filter((b) => b.kind === "tool");
                  if (!held.length && !tools.length)
                    return filtering ? (
                      <NoMatches hidden={lookupFree} text={`No other app uses ${lookup.combo ? comboLabel(lookup.combo, HOTKEY_OS) : `anything matching “${query}”`}.`} elsewhere={elsewhere("apps")} onJump={setTab} />
                    ) : (
                      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
                        <KeyboardIcon className="size-5 text-muted-foreground" />
                        <p className="max-w-[460px] text-[12.5px] leading-relaxed text-muted-foreground">
                          No other app's shortcuts found. Systo checks which keys running apps hold, and reads{" "}
                          {byOS("skhd, AeroSpace, Hammerspoon, Rectangle, Services and App Shortcuts", "Start menu shortcut keys and AutoHotkey scripts", "your desktop's settings")}.
                        </p>
                      </div>
                    );
                  return (
                    <>
                      {held.length > 0 && (
                        <div>
                          <SectionTitle title="Held by other apps" count={held.length} hint={unnamed ? `${unnamed} without a name yet` : "All named"} />
                          <p className="mb-3 max-w-[720px] text-[12px] leading-relaxed text-muted-foreground">
                            Systo found these by trying every combination: a program running on this {OS.device} keeps each one for itself
                            {byOS(", such as a hotkey helper or a launcher.", ", such as Windows itself or a background tool.", ".")} Apps don't say who they are, so name them to remember what they do.
                          </p>
                          <GroupGrid rows={held} ownByCombo={ownByCombo} onNamed={() => void refreshInUse()} lookup={lookup.combo} />
                        </div>
                      )}
                      {tools.length > 0 && (
                        <div>
                          <SectionTitle title="From app settings and config files" count={tools.length} />
                          <GroupGrid rows={tools} ownByCombo={ownByCombo} onNamed={() => void refreshInUse()} lookup={lookup.combo} />
                        </div>
                      )}
                    </>
                  );
                })()}
                <div className="flex items-center gap-3 text-[11.5px] leading-relaxed text-muted-foreground">
                  <span className="flex-1">
                    {inUse.probed
                      ? byOS(
                          "Apps that listen without reserving their keys, like Raycast, can't be detected this way.",
                          "Keys Windows reserves for itself show up here too.",
                          "",
                        )
                      : "Checking which keys running apps hold needs the Systo desktop app."}{" "}
                    {inUse.sources.length ? `Read from ${inUse.sources.join(", ")}.` : ""}
                  </span>
                  {inUse.probed && (
                    <Button variant="outline" size="sm" className="h-7 shrink-0 text-[12px]" disabled={rechecking} onClick={() => void recheck()}>
                      <RefreshCwIcon className={cn("size-3.5", rechecking && "animate-spin")} /> {rechecking ? "Checking…" : "Check again"}
                    </Button>
                  )}
                </div>
              </>
            )}
          </TabsContent>

          {/* ── Everyday keys ── */}
          <TabsContent value="everyday" className="m-0 space-y-4">
            {inTab("everyday").length === 0 ? (
              <NoMatches hidden={lookupFree} text="No everyday keys match." elsewhere={elsewhere("everyday")} onJump={setTab} />
            ) : (
              <>
                <SectionTitle title="Keys apps expect" count={inTab("everyday").length} hint="A shortcut on these would run in every app instead of what people are used to" />
                <GroupGrid rows={inTab("everyday")} ownByCombo={ownByCombo} onNamed={() => void refreshInUse()} lookup={lookup.combo} />
              </>
            )}
          </TabsContent>
        </div>
      </Tabs>

      <ShortcutEditor
        seed={seed}
        onClose={() => setSeed(null)}
        hotkeys={hotkeys}
        system={outside}
        canPick={Boolean(data?.canPick)}
        islandSupported={Boolean(data?.islandSupported)}
        onSaved={() => void refresh()}
      />
    </div>
  );
}
