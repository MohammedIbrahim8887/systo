"use client";

import { OS, byOS, isAbsolutePath } from "@/lib/platform";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppWindowIcon, CheckIcon, FolderOpenIcon, GlobeIcon, PlayIcon, SearchIcon, SquareTerminalIcon, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSettings } from "@/lib/client/settings";
import {
  actionTitle,
  checkCombo,
  comboLabel,
  findConflicts,
  normalizeUrl,
  SYSTO_COMMANDS,
  type Hotkey,
  type HotkeyAction,
  type HotkeyActionType,
  type KeyCombo,
  type LaunchableApp,
  type SystemBinding,
  type SystoCommand,
} from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { AppIcon } from "./app-icon";
import { HOTKEY_OS } from "./keycaps";
import { KeyRecorder, type Verdict } from "./key-recorder";
import { Logo } from "./logo";

export interface EditorSeed {
  id?: string;
  combo?: KeyCombo;
  action?: HotkeyAction;
  enabled?: boolean;
  /** Open straight into recording, e.g. after clicking a row's keys. */
  record?: boolean;
}

const TYPES: Array<{ type: HotkeyActionType; label: string; icon: LucideIcon | "logo" }> = [
  { type: "app", label: "App", icon: AppWindowIcon },
  { type: "url", label: "Website", icon: GlobeIcon },
  { type: "path", label: "File or folder", icon: FolderOpenIcon },
  { type: "command", label: "Command", icon: SquareTerminalIcon },
  { type: "systo", label: "Systo", icon: "logo" },
];

export async function postHotkeys<T = unknown>(body: Record<string, unknown>): Promise<{ ok: boolean; data: T; error?: string }> {
  try {
    const response = await fetch("/api/hotkeys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    return { ok: response.ok, data, error: data.error };
  } catch (error) {
    return { ok: false, data: {} as T, error: (error as Error).message };
  }
}

/** Runs an action once, from "Try it" in the editor or a row's menu. */
export async function tryAction(action: HotkeyAction) {
  const { data, error } = await postHotkeys<{ ok?: boolean; message?: string }>({ action: "run", do: action });
  if (data.ok) toast.success(`Opened ${actionTitle(action)}`);
  else toast.error(`Couldn't open ${actionTitle(action)}`, { description: data.message ?? error });
}

// ── Apps ─────────────────────────────────────────────────────────────────────────────────────

let appsRequest: Promise<LaunchableApp[]> | null = null;

function loadApps(): Promise<LaunchableApp[]> {
  appsRequest ??= fetch("/api/hotkeys?view=apps", { cache: "no-store" })
    .then((r) => r.json() as Promise<LaunchableApp[]>)
    .catch(() => {
      appsRequest = null;
      return [];
    });
  return appsRequest;
}

export function useApps() {
  const [apps, setApps] = useState<LaunchableApp[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadApps().then((list) => live && setApps(list));
    return () => {
      live = false;
    };
  }, []);
  return apps;
}

function rank(app: LaunchableApp, q: string): number {
  const name = app.name.toLowerCase();
  if (!q) return 1;
  if (name.startsWith(q)) return 3;
  if (name.split(/[\s\-_.]+/).some((word) => word.startsWith(q))) return 2;
  if (name.includes(q) || app.detail?.toLowerCase().includes(q)) return 1;
  return 0;
}

function AppPicker({
  value,
  onChange,
  canPick,
}: {
  value: { path: string; name: string } | null;
  onChange: (app: { path: string; name: string }) => void;
  canPick: boolean;
}) {
  const apps = useApps();
  const { settings } = useSettings();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = apps ?? [];
    const withChosen = value && !all.some((a) => a.path === value.path) ? [{ path: value.path, name: value.name, detail: "Chosen" }, ...all] : all;
    return withChosen
      .map((app) => ({ app, score: rank(app, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.app);
  }, [apps, query, value]);

  useEffect(() => setCursor(0), [query]);

  // Start with the chosen app in view when editing.
  useEffect(() => {
    if (!apps || !value) return;
    list.current?.querySelector<HTMLElement>("[data-chosen]")?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps]);

  const choose = (app: LaunchableApp) => onChange({ path: app.path, name: app.name });

  const pick = async () => {
    const { data } = await postHotkeys<{ path?: string | null }>({ action: "pick", kind: "app" });
    if (!data.path) return;
    const name = data.path.split(/[\\/]/).pop()?.replace(/\.(app|lnk|exe|desktop)$/i, "") ?? data.path;
    onChange({ path: data.path, name });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={apps ? `Search ${apps.length} apps` : "Search apps"}
            className="h-8 pl-8 text-[12.5px]"
            aria-label="Search apps"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const next = Math.max(0, Math.min(visible.length - 1, cursor + (event.key === "ArrowDown" ? 1 : -1)));
                setCursor(next);
                list.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
              } else if (event.key === "Enter" && visible[cursor] && !(event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                choose(visible[cursor]);
              }
            }}
          />
        </div>
        {canPick && (
          <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => void pick()}>
            Choose…
          </Button>
        )}
      </div>
      <div ref={list} role="listbox" aria-label="Apps" className="scrollbar-thin h-[188px] overflow-y-auto rounded-lg border p-1">
        {!apps && (
          <div className="space-y-1 p-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        )}
        {apps && visible.length === 0 && <p className="p-6 text-center text-[12px] text-muted-foreground">No apps match “{query}”.</p>}
        {visible.map((app, index) => {
          const chosen = value?.path === app.path;
          return (
            <button
              key={app.path}
              type="button"
              role="option"
              aria-selected={chosen}
              data-index={index}
              data-chosen={chosen || undefined}
              onClick={() => choose(app)}
              onMouseMove={() => setCursor(index)}
              className={cn(
                "group/row flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[12.5px] transition-colors",
                chosen ? "bg-accent font-medium" : index === cursor ? "bg-accent/60" : "",
              )}
            >
              <AppIcon bundlePath={app.path} kind="app" size={18} color={settings.colorIcons || chosen} />
              <span className="min-w-0 flex-1 truncate">{app.name}</span>
              {app.detail && <span className="max-w-[40%] truncate text-[11px] font-normal text-muted-foreground">{app.detail}</span>}
              {chosen && <CheckIcon className="size-3.5 shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────────────────────────

function conflictVerdict(combo: KeyCombo, hotkeys: Hotkey[], system: SystemBinding[], ignoreId?: string): Verdict {
  const label = comboLabel(combo, HOTKEY_OS);
  const { own, system: taken } = findConflicts(combo, hotkeys, system, ignoreId);
  if (own) return { tone: "error", text: <>Already opens <b className="font-medium">{actionTitle(own.action)}</b>. Pick other keys, or edit that shortcut.</> };
  if (taken.length) {
    const first = taken[0];
    const name = <b className="font-medium">“{first.name}”</b>;
    const more = taken.length > 1 ? ` and ${taken.length - 1} more` : "";
    if (first.kind === "claimed") {
      const named = first.owner === "Named by you" ? <> (you named it {name})</> : null;
      return { tone: "warn", text: <>Another app already holds {label}{named}, so Systo won't hear it while that app is running. Pick other keys.</> };
    }
    if (first.kind === "tool") return { tone: "warn", text: <>{first.owner} uses {label} for {name}{more}. Pressing it may do both.</> };
    if (first.owner === "Apps") return { tone: "warn", text: <>Most apps use {label} for {name}{more}. Your shortcut would run in every app instead.</> };
    if (HOTKEY_OS === "windows") return { tone: "warn", text: <>Windows uses {label} for {name}{more}, so it will probably refuse to share it.</> };
    if (HOTKEY_OS === "mac") return { tone: "warn", text: <>macOS uses {label} for {name}{more}. Both will happen when you press it.</> };
    return { tone: "warn", text: <>{first.owner} uses {label} for {name}{more}. Pressing it may do both.</> };
  }
  return { tone: "ok", text: <>{label} is free. Nothing else on your {OS.device} uses it.</> };
}

export function ShortcutEditor({
  seed,
  onClose,
  hotkeys,
  system,
  canPick,
  islandSupported,
  onSaved,
}: {
  seed: EditorSeed | null;
  onClose: () => void;
  hotkeys: Hotkey[];
  system: SystemBinding[];
  canPick: boolean;
  islandSupported: boolean;
  onSaved: () => void;
}) {
  const open = seed !== null;
  const editing = Boolean(seed?.id && hotkeys.some((h) => h.id === seed.id));
  const [combo, setCombo] = useState<KeyCombo | null>(null);
  const [recording, setRecording] = useState(false);
  const [type, setType] = useState<HotkeyActionType>("app");
  const [app, setApp] = useState<{ path: string; name: string } | null>(null);
  const [url, setUrl] = useState("");
  const [path, setPath] = useState("");
  const [command, setCommand] = useState("");
  const [systo, setSysto] = useState<SystoCommand>("open-main");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset from the seed each time the dialog opens.
  useEffect(() => {
    if (!seed) return;
    const action = seed.action;
    setCombo(seed.combo ?? null);
    setRecording(seed.record ?? !seed.combo);
    setType(action?.type ?? "app");
    setApp(action?.type === "app" ? { path: action.path, name: action.name } : null);
    setUrl(action?.type === "url" ? action.url : "");
    setPath(action?.type === "path" ? action.path : "");
    setCommand(action?.type === "command" ? action.command : "");
    setSysto(action?.type === "systo" ? action.command : "open-main");
    setError(null);
    setSaving(false);
  }, [seed]);

  const normalizedUrl = normalizeUrl(url);
  const action: HotkeyAction | null = useMemo(() => {
    switch (type) {
      case "app":
        return app ? { type: "app", path: app.path, name: app.name } : null;
      case "url":
        return normalizedUrl ? { type: "url", url: normalizedUrl } : null;
      case "path":
        return path.trim() && isAbsolutePath(path.trim()) ? { type: "path", path: path.trim() } : null;
      case "command":
        return command.trim() ? { type: "command", command: command.trim() } : null;
      case "systo":
        return { type: "systo", command: systo };
    }
  }, [type, app, normalizedUrl, path, command, systo]);

  const verdict = combo ? conflictVerdict(combo, hotkeys, system, seed?.id) : null;
  const blocked = verdict?.tone === "error";
  const canSave = Boolean(combo && action && !blocked && !saving && !recording);

  const save = async () => {
    if (!canSave || !combo || !action) return;
    setSaving(true);
    setError(null);
    const { ok, error: message } = await postHotkeys({ action: "save", hotkey: { id: seed?.id, combo, do: action, enabled: seed?.enabled ?? true } });
    setSaving(false);
    if (!ok) {
      setError(message ?? "Couldn't save the shortcut.");
      return;
    }
    toast.success(editing ? "Shortcut updated" : "Shortcut added", { description: `${comboLabel(combo, HOTKEY_OS)} → ${actionTitle(action)}` });
    onSaved();
    onClose();
  };

  const pickPath = async () => {
    const { data } = await postHotkeys<{ path?: string | null }>({ action: "pick", kind: "file" });
    if (data.path) setPath(data.path);
  };

  const shellName = HOTKEY_OS === "windows" ? "cmd" : "your login shell";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-[560px]"
        onEscapeKeyDown={(event) => recording && event.preventDefault()}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void save();
          }
        }}
      >
        <DialogHeader className="px-6 pt-5 pb-4">
          <DialogTitle className="text-[15px]">{editing ? "Edit shortcut" : "New shortcut"}</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Works in every app while Systo is running, even with its window closed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-6 pb-5">
          <section className="space-y-2">
            <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Keys</h3>
            <KeyRecorder
              value={combo}
              onChange={(next) => {
                setCombo(next);
                setError(null);
              }}
              recording={recording}
              onRecordingChange={setRecording}
              validate={(c) => checkCombo(c, HOTKEY_OS)}
              verdict={verdict}
            />
          </section>

          <section className="space-y-2.5">
            <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Opens</h3>
            <ToggleGroup type="single" variant="outline" size="sm" value={type} onValueChange={(v) => v && setType(v as HotkeyActionType)} className="w-full">
              {TYPES.map(({ type: t, label, icon: Icon }) => (
                <ToggleGroupItem key={t} value={t} className="h-8 flex-1 gap-1.5 px-2 text-[12px]">
                  {Icon === "logo" ? <Logo className="size-3.5" /> : <Icon className="size-3.5" />}
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <div className="min-h-[228px]">
              {type === "app" && <AppPicker value={app} onChange={setApp} canPick={canPick} />}

              {type === "url" && (
                <div className="space-y-2">
                  <div className="relative">
                    <GlobeIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      autoFocus
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="github.com/notifications"
                      className="h-9 pl-8 font-mono text-[12.5px]"
                      aria-label="Web address"
                      spellCheck={false}
                    />
                  </div>
                  <p className="px-0.5 text-[12px] text-muted-foreground">
                    {url.trim() && !normalizedUrl
                      ? "Enter a web address like github.com, or a mailto: link."
                      : normalizedUrl
                        ? <>Opens <span className="font-mono text-foreground/80">{normalizedUrl}</span> in your default browser.</>
                        : "Opens in your default browser."}
                  </p>
                </div>
              )}

              {type === "path" && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      autoFocus
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                      placeholder={byOS("/Users/you/Downloads", "C:\\Users\\you\\Downloads", "/home/you/Downloads")}
                      className="h-9 flex-1 font-mono text-[12.5px]"
                      aria-label="File or folder path"
                      spellCheck={false}
                    />
                    {canPick && (
                      <Button variant="outline" size="sm" className="h-9 text-[12px]" onClick={() => void pickPath()}>
                        Choose…
                      </Button>
                    )}
                  </div>
                  <p className="px-0.5 text-[12px] text-muted-foreground">
                    {path.trim() && !isAbsolutePath(path.trim())
                      ? `Use a full path, starting with ${byOS("/", "a drive like C:\\", "/")}.`
                      : `Folders open in ${OS.fileManager}; files open in their default app.`}
                  </p>
                </div>
              )}

              {type === "command" && (
                <div className="space-y-2">
                  <textarea
                    autoFocus
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder={byOS("open -a Terminal ~/code", "start powershell", "kitty --directory ~/code")}
                    rows={4}
                    spellCheck={false}
                    aria-label="Command"
                    className="w-full resize-none rounded-md border bg-transparent px-3 py-2 font-mono text-[12.5px] shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                  />
                  <p className="px-0.5 text-[12px] leading-snug text-muted-foreground">
                    Runs in the background with {shellName}, as you. Nothing is shown when it finishes, so open a window yourself if you want to see output.
                  </p>
                </div>
              )}

              {type === "systo" && (
                <div role="radiogroup" aria-label="Systo command" className="space-y-1.5">
                  {(Object.keys(SYSTO_COMMANDS) as SystoCommand[]).map((key) => {
                    const disabled = key === "toggle-island" && !islandSupported;
                    const chosen = systo === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={chosen}
                        disabled={disabled}
                        onClick={() => setSysto(key)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50",
                          chosen ? "border-foreground/40 bg-accent" : "hover:bg-accent/50",
                        )}
                      >
                        <span className={cn("flex size-4 items-center justify-center rounded-full border", chosen && "border-foreground")}>
                          {chosen && <span className="size-2 rounded-full bg-foreground" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium">{SYSTO_COMMANDS[key].title}</span>
                          <span className="block text-[12px] text-muted-foreground">
                            {disabled ? "The Dynamic Island isn't available on this desktop." : SYSTO_COMMANDS[key].hint}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
          {error && <p className="-mt-2 text-[12px] font-medium text-foreground">{error}</p>}
        </div>

        <DialogFooter className="items-center border-t px-6 py-3.5 sm:justify-between">
          <Button variant="ghost" size="sm" className="h-8 text-[12px]" disabled={!action} onClick={() => action && void tryAction(action)}>
            <PlayIcon className="size-3.5" /> Try it
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" className="h-8 gap-2 text-[12px]" disabled={!canSave} onClick={() => void save()}>
              {saving ? "Saving…" : editing ? "Save changes" : "Add shortcut"}
              <Kbd className="h-4 bg-primary-foreground/15 px-1 text-[10px] text-primary-foreground/80">{HOTKEY_OS === "mac" ? "⌘↩" : "Ctrl+↩"}</Kbd>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
