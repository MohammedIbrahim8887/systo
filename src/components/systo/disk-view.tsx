"use client";

import { OS } from "@/lib/platform";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  FileIcon,
  FileTextIcon,
  FilmIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderSearchIcon,
  HardDriveIcon,
  HomeIcon,
  ImageIcon,
  MonitorIcon,
  MoreHorizontalIcon,
  MusicIcon,
  PackageIcon,
  RefreshCwIcon,
  ShieldIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePoll } from "@/lib/client/use-poll";
import { useSettings } from "@/lib/client/settings";
import { formatBytes, formatCount, formatDuration } from "@/lib/format";
import type { DiskReport, DiskSuggestion, DiskViewNode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AppIcon } from "./app-icon";
import { Sunburst, Treemap } from "./disk-charts";

type ChartMode = "sunburst" | "treemap";

const CATEGORY: Record<string, { label: string; icon: LucideIcon }> = {
  video: { label: "Video", icon: FilmIcon },
  images: { label: "Images", icon: ImageIcon },
  audio: { label: "Audio", icon: MusicIcon },
  archives: { label: "Archives and disk images", icon: ArchiveIcon },
  documents: { label: "Documents", icon: FileTextIcon },
  code: { label: "Code and dependencies", icon: CodeIcon },
  vm: { label: "Virtual machines", icon: MonitorIcon },
  other: { label: "Other files", icon: FileIcon },
};

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/disk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as T;
}

const reveal = (path: string) =>
  void fetch("/api/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });

const copyPath = (path: string) => void navigator.clipboard.writeText(path).then(() => toast.success("Copied path"));

const basename = (path: string) => path.split("/").filter(Boolean).pop() ?? path;
const dirname = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";

function ago(at: number) {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function NodeIcon({ node, size = 18, colorIcons }: { node: Pick<DiskViewNode, "kind" | "bundlePath" | "name">; size?: number; colorIcons: boolean }) {
  if (node.bundlePath) return <AppIcon bundlePath={node.bundlePath} hasIcon kind="app" size={size} color={colorIcons} />;
  const Icon = node.kind === "folder" ? FolderIcon : node.kind === "package" ? PackageIcon : node.kind === "rest" ? MoreHorizontalIcon : FileIcon;
  return (
    <span className="flex shrink-0 items-center justify-center text-muted-foreground" style={{ width: size, height: size }}>
      <Icon className="size-[15px]" strokeWidth={1.75} />
    </span>
  );
}

// ── Scan states ──────────────────────────────────────────────────────────────────────────

function EmptyState({ onScan, volume }: { onScan: (root: string) => void; volume: DiskReport["volume"] }) {
  const options = [
    { root: "home", icon: HomeIcon, title: "Home folder", hint: "Your documents, apps' data, caches and projects. Usually where the space goes." },
    { root: "volume", icon: HardDriveIcon, title: OS.volume, hint: "Everything on the startup disk you're allowed to read, including other users' and system data." },
    { root: "choose", icon: FolderSearchIcon, title: "Choose a folder…", hint: "Scan one folder, like an external drive or a project directory." },
  ];
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center pt-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl border bg-card">
        <HardDriveIcon className="size-6" strokeWidth={1.5} />
      </div>
      <h2 className="mt-4 text-[20px] font-semibold tracking-tight">See what's taking up space</h2>
      <p className="mt-1.5 max-w-md text-[13px] text-muted-foreground">
        <span className="tabular text-foreground">{formatBytes(volume.total - volume.used)}</span> free of {formatBytes(volume.total)}. Systo reads
        sizes only, never file contents, and nothing is deleted without asking.
      </p>
      <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
        {options.map((o) => (
          <button
            key={o.root}
            type="button"
            onClick={() => onScan(o.root)}
            className="group flex flex-col items-start rounded-xl border bg-card p-4 text-left transition-colors hover:border-foreground/30 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <o.icon className="size-5" strokeWidth={1.5} />
            <div className="mt-3 text-[13.5px] font-medium">{o.title}</div>
            <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{o.hint}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ScanProgress({ state, onCancel }: { state: DiskReport["state"]; onCancel: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const elapsed = state.startedAt ? (now - state.startedAt) / 1000 : 0;
  const { files, dirs, bytes, current } = state.progress;
  return (
    <div className="mx-auto max-w-2xl pt-12">
      <div className="text-[12px] text-muted-foreground">Scanning {state.label}</div>
      <div className="tabular mt-1 text-[44px] leading-none font-semibold tracking-tight">{formatBytes(bytes)}</div>
      <div className="relative mt-6 h-1 overflow-hidden rounded-full bg-data/10">
        <div className="absolute inset-y-0 w-1/4 rounded-full bg-data motion-safe:animate-[systo-sweep_1.6s_ease-in-out_infinite]" />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-6">
        {[
          { label: "Files", value: formatCount(files) },
          { label: "Folders", value: formatCount(dirs) },
          { label: "Elapsed", value: formatDuration(Math.round(elapsed)) },
        ].map((s) => (
          <div key={s.label}>
            <div className="text-[11px] text-muted-foreground">{s.label}</div>
            <div className="tabular mt-0.5 text-[18px] font-semibold tracking-tight">{s.value}</div>
          </div>
        ))}
      </div>
      <div className="mt-6 truncate rounded-lg border bg-card px-3 py-2 font-mono text-[11px] text-muted-foreground" title={current}>
        {current || "\u00a0"}
      </div>
      <div className="mt-6 flex items-center gap-3">
        <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={onCancel}>
          <XIcon className="size-3.5" /> Cancel
        </Button>
        <span className="text-[11.5px] text-muted-foreground">Several readers work in parallel; a full disk usually takes under a minute.</span>
      </div>
    </div>
  );
}

// ── Capacity ─────────────────────────────────────────────────────────────────────────────

function Capacity({ report }: { report: DiskReport }) {
  const { volume, state, view } = report;
  const scanned = state.stats?.bytes ?? 0;
  const shown = view?.node.size ?? 0;
  const otherUsed = Math.max(0, volume.used - scanned);
  // APFS clones and snapshots can make a folder add up to more than the disk reports as used.
  const showOther = state.label !== OS.volume && otherUsed > 1024 ** 3;
  const free = Math.max(0, volume.total - volume.used);
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / Math.max(1, volume.total)) * 100))}%`;
  const inner = shown < scanned ? shown : 0;
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span className="text-[12px] text-muted-foreground">{OS.volume}</span>
        <span className="tabular ml-auto text-[12px]">
          <span className="font-medium">{formatBytes(free)}</span> <span className="text-muted-foreground">free of {formatBytes(volume.total)}</span>
        </span>
      </div>
      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-data/[0.06]">
        <div className="relative h-full bg-data/80" style={{ width: pct(Math.min(scanned, volume.used)) }}>
          {inner > 0 && <div className="absolute inset-y-0 left-0 bg-data" style={{ width: `${(inner / Math.max(1, scanned)) * 100}%` }} />}
        </div>
        {showOther && <div className="h-full border-l border-background bg-data/30" style={{ width: pct(otherUsed) }} />}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-data/80" /> {state.label} <span className="tabular text-foreground">{formatBytes(scanned)}</span>
        </span>
        {inner > 0 && view && (
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-data" /> {view.node.name} <span className="tabular text-foreground">{formatBytes(inner)}</span>
          </span>
        )}
        {showOther && (
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-data/30" /> Apps, system and other users <span className="tabular text-foreground">{formatBytes(otherUsed)}</span>
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-data/[0.08] ring-1 ring-data/15 ring-inset" /> Free
        </span>
      </div>
    </div>
  );
}

// ── Lists ────────────────────────────────────────────────────────────────────────────────

function ItemMenu({ path, name, size, onTrash, onOpen }: { path: string; name: string; size: number; onTrash: (t: TrashTarget) => void; onOpen?: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          aria-label={`More for ${name}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
        {onOpen && (
          <DropdownMenuItem onSelect={onOpen}>
            <ChevronRightIcon /> Open
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => reveal(path)}>
          <FolderOpenIcon /> {OS.reveal}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copyPath(path)}>
          <CopyIcon /> Copy path
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onTrash({ path, name, size })}>
          <Trash2Icon /> Move to {OS.trash}…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface TrashTarget {
  path: string;
  name: string;
  size: number;
  /** Move what's inside the folder and keep the folder itself. */
  contents?: boolean;
}

type Selection = Map<string, TrashTarget>;

interface Selecting {
  selected: Selection;
  onSelect: (targets: TrashTarget[], on: boolean) => void;
}

function SelectBox({ target, selected, onSelect, label }: Selecting & { target: TrashTarget; label?: string }) {
  return (
    <span className="flex items-center" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Checkbox
        checked={selected.has(target.path)}
        onCheckedChange={(v) => onSelect([target], v === true)}
        aria-label={label ?? `Select ${target.name}`}
      />
    </span>
  );
}

function SelectionBar({ selected, onClear, onTrash }: { selected: Selection; onClear: () => void; onTrash: () => void }) {
  if (!selected.size) return null;
  const size = [...selected.values()].reduce((sum, t) => sum + t.size, 0);
  return (
    <div className="flex items-center gap-2 border-t bg-card px-3 py-2">
      <span className="text-[12px]">
        <span className="font-medium tabular">{formatCount(selected.size)}</span> selected
        <span className="tabular text-muted-foreground"> · {formatBytes(size)}</span>
      </span>
      <div className="flex-1" />
      <Button variant="ghost" size="sm" className="h-7 text-[11.5px]" onClick={onClear}>
        Clear
      </Button>
      <Button variant="destructive" size="sm" className="h-7 text-[11.5px]" onClick={onTrash}>
        <Trash2Icon className="size-3.5" /> Move to {OS.trash}…
      </Button>
    </div>
  );
}

function Contents({
  node,
  hovered,
  onHover,
  onOpen,
  onTrash,
  colorIcons,
  selected,
  onSelect,
}: Selecting & {
  node: DiskViewNode;
  hovered: DiskViewNode | null;
  onHover: (n: DiskViewNode | null) => void;
  onOpen: (n: DiskViewNode) => void;
  onTrash: (t: TrashTarget) => void;
  colorIcons: boolean;
}) {
  const children = node.children ?? [];
  const max = children.reduce((m, c) => Math.max(m, c.size), 1);
  if (!children.length) return <p className="px-3 py-10 text-center text-[12.5px] text-muted-foreground">This folder is empty.</p>;
  const selectable = children.filter((c) => c.path).map((c) => ({ path: c.path!, name: c.name, size: c.size }));
  const picked = selectable.filter((t) => selected.has(t.path)).length;
  return (
    <div className="divide-y" onMouseLeave={() => onHover(null)}>
      {selectable.length > 1 && (
        <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[11.5px] text-muted-foreground">
          <Checkbox
            checked={picked === selectable.length ? true : picked ? "indeterminate" : false}
            onCheckedChange={(v) => onSelect(selectable, v === true)}
            aria-label="Select everything in this folder"
          />
          Select all
        </label>
      )}
      {children.map((child) => {
        const openable = child.kind !== "file" && child.kind !== "rest" && child.hasChildren;
        const active = hovered && child.path && (hovered.path === child.path || hovered.path?.startsWith(child.path + "/"));
        return (
          <div
            key={child.path ?? "rest"}
            role={openable ? "button" : undefined}
            tabIndex={openable ? 0 : undefined}
            onMouseEnter={() => child.kind !== "rest" && onHover(child)}
            onClick={() => openable && onOpen(child)}
            onKeyDown={(e) => openable && e.key === "Enter" && onOpen(child)}
            className={cn(
              "group/row grid grid-cols-[16px_minmax(0,1fr)_76px_44px_28px] items-center gap-2.5 px-3 py-[7px] outline-none",
              openable && "cursor-pointer",
              active ? "bg-accent/60" : "hover:bg-accent/40 focus-visible:bg-accent/40",
            )}
          >
            {child.path ? <SelectBox target={{ path: child.path, name: child.name, size: child.size }} selected={selected} onSelect={onSelect} /> : <span />}
            <div className="flex min-w-0 items-center gap-2.5">
              <NodeIcon node={child} colorIcons={colorIcons} />
              <div className="min-w-0 flex-1">
                <div className={cn("flex items-center gap-1 truncate text-[12.5px]", child.kind === "rest" ? "text-muted-foreground" : "font-medium")}>
                  <span className="truncate">{child.name}</span>
                  {openable && <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground/60" />}
                </div>
                <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-data/[0.06]">
                  <div className="h-full rounded-full bg-data/60" style={{ width: `${(child.size / max) * 100}%` }} />
                </div>
              </div>
            </div>
            <div className="tabular text-right text-[12px]">{formatBytes(child.size)}</div>
            <div className="tabular text-right text-[11px] text-muted-foreground">
              {node.size > 0 ? `${Math.round((child.size / node.size) * 100)}%` : ""}
            </div>
            <div className="flex justify-end">
              {child.path && <ItemMenu path={child.path} name={child.name} size={child.size} onTrash={onTrash} onOpen={openable ? () => onOpen(child) : undefined} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LargestFiles({ files, onTrash, selected, onSelect }: Selecting & { files: NonNullable<DiskReport["topFiles"]>; onTrash: (t: TrashTarget) => void }) {
  if (!files.length) return <p className="px-3 py-10 text-center text-[12.5px] text-muted-foreground">No files here.</p>;
  const max = files[0].size || 1;
  const targets = files.map((f) => ({ path: f.path, name: basename(f.path), size: f.size }));
  const picked = targets.filter((t) => selected.has(t.path)).length;
  return (
    <div className="divide-y">
      <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[11.5px] text-muted-foreground">
        <Checkbox
          checked={picked === targets.length ? true : picked ? "indeterminate" : false}
          onCheckedChange={(v) => onSelect(targets, v === true)}
          aria-label="Select all files"
        />
        Select all
      </label>
      {files.map((f, i) => (
        <div key={f.path} className="group/row grid grid-cols-[16px_22px_minmax(0,1fr)_76px_28px] items-center gap-2.5 px-3 py-[7px] hover:bg-accent/40">
          <SelectBox target={targets[i]} selected={selected} onSelect={onSelect} />
          <span className="tabular text-right text-[11px] text-muted-foreground/70">{i + 1}</span>
          <div className="min-w-0">
            <div className="truncate text-[12.5px] font-medium" title={f.path}>{basename(f.path)}</div>
            <div className="flex items-center gap-2">
              <div className="truncate font-mono text-[10.5px] text-muted-foreground">{dirname(f.path)}</div>
              <div className="ml-auto h-[3px] w-16 shrink-0 overflow-hidden rounded-full bg-data/[0.06]">
                <div className="h-full bg-data/60" style={{ width: `${(f.size / max) * 100}%` }} />
              </div>
            </div>
          </div>
          <div className="tabular text-right text-[12px]">{formatBytes(f.size)}</div>
          <div className="flex justify-end">
            <ItemMenu path={f.path} name={basename(f.path)} size={f.size} onTrash={onTrash} />
          </div>
        </div>
      ))}
    </div>
  );
}

function FileTypes({ categories }: { categories: NonNullable<DiskReport["categories"]> }) {
  const total = categories.reduce((s, c) => s + c.size, 0) || 1;
  const shades = [0.9, 0.7, 0.55, 0.42, 0.32, 0.24, 0.17, 0.11];
  return (
    <div className="p-3">
      <div className="flex h-3 overflow-hidden rounded-full">
        {categories.map((c, i) => (
          <Tooltip key={c.id}>
            <TooltipTrigger asChild>
              <div
                className="h-full border-r border-background last:border-r-0"
                style={{ width: `${(c.size / total) * 100}%`, backgroundColor: `color-mix(in oklch, var(--data) ${shades[i] * 100}%, transparent)` }}
              />
            </TooltipTrigger>
            <TooltipContent>
              {CATEGORY[c.id]?.label ?? c.id} · {formatBytes(c.size)}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="mt-4 space-y-1">
        {categories.map((c, i) => {
          const meta = CATEGORY[c.id] ?? CATEGORY.other;
          return (
            <div key={c.id} className="grid grid-cols-[18px_minmax(0,1fr)_104px_72px] items-center gap-2.5 rounded-md px-1 py-1.5">
              <span className="flex items-center justify-center">
                <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: `color-mix(in oklch, var(--data) ${shades[i] * 100}%, transparent)` }} />
              </span>
              <div className="flex min-w-0 items-center gap-2 text-[12.5px]">
                <meta.icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <span className="truncate">{meta.label}</span>
              </div>
              <span className="tabular text-right text-[11px] text-muted-foreground">{formatCount(c.count)} files</span>
              <span className="tabular text-right text-[12px]">{formatBytes(c.size)}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 px-1 text-[11px] leading-relaxed text-muted-foreground">
        By file extension across the whole scan. App bundles count toward the files inside them.
      </p>
    </div>
  );
}

/** What cleaning up a suggestion moves: its listed folders, or everything inside its one folder. */
function suggestionTargets(s: DiskSuggestion): TrashTarget[] {
  if (s.id === "trash") return [];
  if (s.items?.length) return s.items.map((i) => ({ path: i.path, name: basename(i.path), size: i.size }));
  return s.path ? [{ path: s.path, name: s.title, size: s.size, contents: true }] : [];
}

function Suggestion({
  s,
  onTrash,
  onOpen,
  onEmptyTrash,
  selected,
  onSelect,
}: Selecting & { s: DiskSuggestion; onTrash: (t: TrashTarget | TrashTarget[]) => void; onOpen: (path: string) => void; onEmptyTrash: () => void }) {
  const [open, setOpen] = useState(false);
  const many = (s.items?.length ?? 0) > 1;
  const targets = suggestionTargets(s);
  const picked = targets.filter((t) => selected.has(t.path)).length;
  // Only safe suggestions can be cleaned in one go; the others need a look first.
  const cleanable = s.safe && targets.length > 0;
  return (
    <div className={cn("rounded-xl border bg-card", cleanable && picked > 0 && "border-foreground/30")}>
      <div className="flex items-start gap-3 p-3">
        {cleanable && (
          <span className="pt-0.5">
            <Checkbox
              checked={picked === targets.length ? true : picked ? "indeterminate" : false}
              onCheckedChange={(v) => onSelect(targets, v === true)}
              aria-label={`Select ${s.title}`}
            />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium">{s.title}</span>
            {s.safe && (
              <span className="rounded-full border px-1.5 py-px text-[10px] text-muted-foreground">Safe to remove</span>
            )}
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{s.description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {s.id === "trash" && (
              <Button variant="outline" size="sm" className="h-7 text-[11.5px]" onClick={onEmptyTrash}>
                <Trash2Icon className="size-3.5" /> Empty {OS.trash}…
              </Button>
            )}
            {cleanable && (
              <Button variant="outline" size="sm" className="h-7 text-[11.5px]" onClick={() => onTrash(targets)}>
                <SparklesIcon className="size-3.5" /> Clean up…
              </Button>
            )}
            {s.path && !many && (
              <>
                <Button variant="outline" size="sm" className="h-7 text-[11.5px]" onClick={() => onOpen(s.path!)}>
                  Open in chart
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-[11.5px]" onClick={() => reveal(s.path!)}>
                  {OS.reveal}
                </Button>
              </>
            )}
            {many && (
              <Button variant="outline" size="sm" className="h-7 text-[11.5px]" onClick={() => setOpen((v) => !v)}>
                <ChevronDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} />
                {open ? "Hide" : "Show"} {s.items!.length} {s.id === "dev-folders" ? "folders" : "locations"}
                {s.count && s.count > s.items!.length ? ` of ${formatCount(s.count)}` : ""}
              </Button>
            )}
          </div>
        </div>
        <div className="tabular shrink-0 text-right text-[15px] font-semibold tracking-tight">{formatBytes(s.size)}</div>
      </div>
      {many && open && (
        <div className="divide-y border-t">
          {s.items!.map((item) => (
            <div key={item.path} className="group/row grid grid-cols-[16px_minmax(0,1fr)_70px_28px] items-center gap-2 px-3 py-1.5 hover:bg-accent/40">
              <SelectBox target={{ path: item.path, name: basename(item.path), size: item.size }} selected={selected} onSelect={onSelect} />
              <div className="truncate font-mono text-[10.5px] text-muted-foreground" title={item.path}>{item.path}</div>
              <span className="tabular text-right text-[11.5px]">{formatBytes(item.size)}</span>
              <div className="flex justify-end">
                <ItemMenu path={item.path} name={basename(item.path)} size={item.size} onTrash={onTrash} onOpen={() => onOpen(item.path)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── View ─────────────────────────────────────────────────────────────────────────────────

export function DiskView() {
  const [path, setPath] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<ChartMode>("sunburst");
  const [hovered, setHovered] = useState<DiskViewNode | null>(null);
  const [tab, setTab] = useState("contents");
  const [trashTargets, setTrashTargets] = useState<TrashTarget[] | null>(null);
  const [selected, setSelected] = useState<Selection>(() => new Map());
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const askTrash = (t: TrashTarget | TrashTarget[]) => setTrashTargets(Array.isArray(t) ? t : [t]);
  const select = (targets: TrashTarget[], on: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      for (const t of targets) on ? next.set(t.path, t) : next.delete(t.path);
      return next;
    });
  const clearSelection = () => setSelected(new Map());
  const [scanningHint, setScanningHint] = useState(false);
  const { settings } = useSettings();

  const url = `/api/disk?depth=${mode === "sunburst" ? 4 : 2}${path ? `&path=${encodeURIComponent(path)}` : ""}`;
  const [interval, setIntervalMs] = useState(30000);
  const { data, error, refresh } = usePoll<DiskReport>(url, interval);
  const scanning = data?.state.status === "scanning" || scanningHint;

  useEffect(() => {
    setIntervalMs(scanning ? 450 : 30000);
  }, [scanning]);

  useEffect(() => setHovered(null), [path, mode]);
  // A selection belongs to the list it was made in.
  useEffect(() => setSelected(new Map()), [path, tab]);

  const startScan = async (root: string) => {
    let target = root;
    if (root === "choose") {
      const chosen = await post<{ ok: boolean; path?: string; message?: string }>({ action: "choose" });
      // No message means the dialog was cancelled.
      if (chosen.message) toast.error(chosen.message);
      if (!chosen.ok || !chosen.path) return;
      target = chosen.path;
    }
    setScanningHint(true);
    clearSelection();
    try {
      const res = await post<{ ok: boolean; message?: string }>({ action: "scan", root: target });
      if (!res.ok) {
        toast.error(res.message ?? "Couldn't start the scan");
        return;
      }
      setPath(undefined);
      await refresh();
    } catch (error) {
      toast.error("Couldn't start the scan", { description: (error as Error).message });
    } finally {
      setScanningHint(false);
    }
  };

  const cancel = async () => {
    await post({ action: "cancel" });
    setScanningHint(false);
    refresh();
  };

  const confirmTrash = async () => {
    if (!trashTargets?.length) return;
    const targets = trashTargets;
    setTrashTargets(null);
    setBusy(true);
    const pending = toast.loading(targets.length === 1 && !targets[0].contents ? `Moving ${targets[0].name} to the ${OS.trash}…` : `Cleaning up ${formatBytes(targets.reduce((sum, t) => sum + t.size, 0))}…`);
    try {
      const res = await post<{ ok: boolean; moved: number; freed: number; failed: Array<{ path: string; message: string }>; message: string }>({
        action: "trash-many",
        paths: targets.filter((t) => !t.contents).map((t) => t.path),
        contents: targets.filter((t) => t.contents).map((t) => t.path),
      });
      const description = `${formatBytes(res.freed ?? 0)} will be freed when you empty the ${OS.trash}.`;
      if (res.ok) toast.success(res.message, { id: pending, description });
      else if (res.moved) toast.warning(res.message, { id: pending, description: `${description} ${res.failed.length} couldn't be moved: ${res.failed[0]?.message}` });
      else toast.error("Nothing was moved", { id: pending, description: res.failed?.[0]?.message ?? res.message });
      const gone = targets.filter((t) => !t.contents && !res.failed?.some((f) => f.path === t.path));
      const hit = gone.find((t) => path && (path === t.path || path.startsWith(t.path + "/")));
      if (hit) setPath(dirname(hit.path));
      setSelected((prev) => {
        const next = new Map(prev);
        for (const t of targets) if (!res.failed?.some((f) => f.path === t.path)) next.delete(t.path);
        return next;
      });
    } catch (error) {
      toast.error("Couldn't move the items", { id: pending, description: (error as Error).message });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const emptyTrash = async () => {
    setConfirmEmpty(false);
    setBusy(true);
    const pending = toast.loading(`Emptying the ${OS.trash}…`);
    try {
      const res = await post<{ ok: boolean; freed: number; message: string }>({ action: "empty-trash" });
      if (res.ok) toast.success(res.message, { id: pending, description: res.freed ? `${formatBytes(res.freed)} freed.` : undefined });
      else toast.error(`Couldn't empty the ${OS.trash}`, { id: pending, description: res.message });
    } catch (error) {
      toast.error(`Couldn't empty the ${OS.trash}`, { id: pending, description: (error as Error).message });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const open = (node: DiskViewNode) => {
    if (!node.path || node.kind === "rest") return;
    if (node.kind === "file" || !node.hasChildren) {
      reveal(node.path);
      return;
    }
    setPath(node.path);
  };

  const view = data?.view;
  const state = data?.state;
  const crumbs = view?.crumbs ?? [];
  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2].path : undefined;
  const suggestions = data?.suggestions ?? [];
  const reclaimable = useMemo(() => suggestions.filter((s) => s.safe).reduce((sum, s) => sum + s.size, 0), [suggestions]);
  const safeTargets = useMemo(() => suggestions.filter((s) => s.safe).flatMap(suggestionTargets), [suggestions]);
  const trashSize = (trashTargets ?? []).reduce((sum, t) => sum + t.size, 0);
  const single = trashTargets?.length === 1 ? trashTargets[0] : null;
  const hoverInfo = hovered ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="mr-1 text-[15px] font-semibold tracking-tight">Disk</h1>
        {state?.status === "done" && state.finishedAt && (
          <span className="truncate text-[12px] text-muted-foreground">
            {state.label} · scanned {ago(state.finishedAt)}
            {state.stats && <span className="tabular"> in {(state.stats.ms / 1000).toFixed(1)}s</span>}
          </span>
        )}
        <div className="flex-1" />
        {view && !scanning && (
          <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => v && setMode(v as ChartMode)}>
            <ToggleGroupItem value="sunburst" className="h-8 px-3 text-[12px]">Sunburst</ToggleGroupItem>
            <ToggleGroupItem value="treemap" className="h-8 px-3 text-[12px]">Treemap</ToggleGroupItem>
          </ToggleGroup>
        )}
        {state?.root && !scanning && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" onClick={() => void startScan(state.root!)} aria-label="Scan again">
                <RefreshCwIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Scan {state.label} again</TooltipContent>
          </Tooltip>
        )}
        {data && !scanning && (state?.status === "done" || state?.status === "error") && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-[12px]">
                <FolderSearchIcon className="size-3.5" /> Scan <ChevronDownIcon className="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => void startScan("home")}>
                <HomeIcon /> Home folder
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void startScan("volume")}>
                <HardDriveIcon /> {OS.volume}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void startScan("choose")}>
                <FolderSearchIcon /> Choose folder…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <section className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-5">
        {!data && !error && (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <div className="grid grid-cols-2 gap-5">
              <Skeleton className="aspect-square" />
              <Skeleton className="aspect-square" />
            </div>
          </div>
        )}
        {error && !data && <p className="text-[13px] text-muted-foreground">Couldn't read the disk: {error}</p>}

        {data && scanning && state && <ScanProgress state={state} onCancel={() => void cancel()} />}

        {!scanning && state?.status === "error" && (
          <div role="alert" className="mx-auto mb-2 max-w-3xl rounded-lg border px-3 py-2 text-[12px] text-muted-foreground">{state.error}</div>
        )}

        {data && !scanning && !view && (
          <>
            <EmptyState onScan={(root) => void startScan(root)} volume={data.volume} />
          </>
        )}

        {data && !scanning && view && (
          <>
            <Capacity report={data} />

            {(state?.stats?.denied ?? 0) > 0 && (
              <div className="mt-4 flex items-start gap-2.5 rounded-lg border px-3 py-2 text-[11.5px] text-muted-foreground">
                <ShieldIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <span className="tabular text-foreground">{formatCount(state!.stats!.denied)}</span> folders couldn't be read, so they aren't counted. Give Systo
                  Full Disk Access in System Settings › Privacy & Security to include them.
                </span>
              </div>
            )}

            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col rounded-xl border bg-card">
                <nav className="flex min-w-0 items-center gap-0.5 border-b px-2 py-1.5 text-[12px]" aria-label="Folder path">
                  {crumbs.map((c, i) => {
                    const last = i === crumbs.length - 1;
                    return (
                      <span key={c.path} className={cn("flex min-w-0 items-center", last ? "shrink" : "shrink-[3]")}>
                        {i > 0 && <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground/50" />}
                        <button
                          type="button"
                          disabled={last}
                          onClick={() => setPath(i === 0 ? undefined : c.path)}
                          className={cn(
                            "truncate rounded px-1.5 py-0.5",
                            last ? "font-medium" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                        >
                          {c.name}
                        </button>
                      </span>
                    );
                  })}
                  <span className="tabular ml-auto shrink-0 pl-2 text-muted-foreground">{formatBytes(view.node.size)}</span>
                </nav>
                <div className={cn("flex-1 p-4", mode === "treemap" && "flex flex-col")}>
                  {mode === "sunburst" ? (
                    <Sunburst node={view.node} hovered={hovered} onHover={setHovered} onOpen={open} onUp={parent !== undefined ? () => setPath(crumbs.length > 2 ? parent : undefined) : undefined} />
                  ) : (
                    <div className="relative min-h-[380px] flex-1">
                      <div className="absolute inset-0">
                        <Treemap node={view.node} hovered={hovered} onHover={setHovered} onOpen={open} />
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex h-10 items-center gap-2 border-t px-3 text-[11.5px]">
                  {hoverInfo ? (
                    <>
                      <NodeIcon node={hoverInfo} size={16} colorIcons={settings.colorIcons} />
                      <span className="truncate font-medium">{hoverInfo.name}</span>
                      {hoverInfo.path && <span className="hidden truncate font-mono text-[10.5px] text-muted-foreground xl:inline">{hoverInfo.path}</span>}
                      <span className="tabular ml-auto shrink-0">{formatBytes(hoverInfo.size)}</span>
                      {hoverInfo.kind !== "file" && <span className="tabular shrink-0 text-muted-foreground">· {formatCount(hoverInfo.files)} files</span>}
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      Hover to inspect · click a {mode === "sunburst" ? "segment" : "tile"} to open it
                      {mode === "sunburst" && parent !== undefined ? " · click the center to go up" : ""}
                    </span>
                  )}
                </div>
              </div>

              <Tabs value={tab} onValueChange={setTab} className="flex min-w-0 flex-col gap-0 rounded-xl border bg-card">
                <div className="border-b px-2 py-1.5">
                  <TabsList className="h-8 w-full">
                    <TabsTrigger value="contents" className="text-[12px]">Contents</TabsTrigger>
                    <TabsTrigger value="files" className="text-[12px]">Largest files</TabsTrigger>
                    <TabsTrigger value="types" className="text-[12px]">File types</TabsTrigger>
                    <TabsTrigger value="cleanup" className="text-[12px]">
                      Cleanup
                      {reclaimable > 0 && <span className="tabular text-[10.5px] text-muted-foreground">{formatBytes(reclaimable, 0)}</span>}
                    </TabsTrigger>
                  </TabsList>
                </div>
                <div className="scrollbar-thin max-h-[560px] min-h-0 flex-1 overflow-y-auto">
                  <TabsContent value="contents" className="m-0">
                    <Contents node={view.node} hovered={hovered} onHover={setHovered} onOpen={open} onTrash={askTrash} colorIcons={settings.colorIcons} selected={selected} onSelect={select} />
                  </TabsContent>
                  <TabsContent value="files" className="m-0">
                    <LargestFiles files={data.topFiles ?? []} onTrash={askTrash} selected={selected} onSelect={select} />
                  </TabsContent>
                  <TabsContent value="types" className="m-0">
                    <FileTypes categories={data.categories ?? []} />
                  </TabsContent>
                  <TabsContent value="cleanup" className="m-0 space-y-2.5 p-3">
                    {suggestions.length === 0 ? (
                      <div className="flex flex-col items-center py-10 text-center">
                        <SparklesIcon className="size-5 text-muted-foreground" strokeWidth={1.5} />
                        <p className="mt-2 text-[12.5px] text-muted-foreground">Nothing big to clean up in {state?.label}.</p>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start gap-3 px-0.5">
                          <p className="flex-1 text-[11.5px] leading-relaxed text-muted-foreground">
                            Places that commonly grow large. Tick the ones you want gone and clean them up together; Systo only ever moves things to the {OS.trash}.
                          </p>
                          {safeTargets.length > 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 shrink-0 text-[11.5px]"
                              onClick={() => select(safeTargets, !safeTargets.every((t) => selected.has(t.path)))}
                            >
                              {safeTargets.every((t) => selected.has(t.path)) ? "Deselect safe" : "Select all safe"}
                            </Button>
                          )}
                        </div>
                        {suggestions.map((s) => (
                          <Suggestion
                            key={s.id}
                            s={s}
                            onTrash={askTrash}
                            onEmptyTrash={() => setConfirmEmpty(true)}
                            selected={selected}
                            onSelect={select}
                            onOpen={(p) => {
                              setPath(p);
                              setTab("contents");
                            }}
                          />
                        ))}
                      </>
                    )}
                  </TabsContent>
                </div>
                <SelectionBar selected={selected} onClear={clearSelection} onTrash={() => !busy && askTrash([...selected.values()])} />
              </Tabs>
            </div>
          </>
        )}
      </section>

      <AlertDialog open={trashTargets !== null} onOpenChange={(o) => !o && setTrashTargets(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {single && !single.contents
                ? `Move “${single.name}” to the ${OS.trash}?`
                : single
                ? `Clean up ${single.name}?`
                : `Move ${formatCount(trashTargets?.length ?? 0)} items to the ${OS.trash}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {single?.contents ? `Everything inside the folder goes to the ${OS.trash}; the folder itself stays. ` : ""}
              {formatBytes(trashSize)} will be freed once you empty the {OS.trash}. Until then you can put {trashTargets?.length === 1 && !single?.contents ? "it" : "them"} back from the {OS.trash}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="scrollbar-thin max-h-56 divide-y overflow-y-auto rounded-lg border">
            {trashTargets?.map((t) => (
              <div key={t.path} className="grid grid-cols-[minmax(0,1fr)_70px] items-center gap-2 px-2.5 py-1.5">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-medium">
                    {t.contents ? `Everything in ${t.name}` : t.name}
                  </div>
                  <div className="truncate font-mono text-[10.5px] text-muted-foreground" title={t.path}>{t.path}</div>
                </div>
                <span className="tabular text-right text-[11.5px]">{formatBytes(t.size)}</span>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmTrash()}>Move to {OS.trash}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmEmpty} onOpenChange={setConfirmEmpty}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty the {OS.trash}?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything in the {OS.trash} is deleted for good and can't be put back. This frees{" "}
              {formatBytes(suggestions.find((s) => s.id === "trash")?.size ?? 0)}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void emptyTrash()}>
              Empty {OS.trash}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
