"use client";

import { IS_WINDOWS, OS, isModKey } from "@/lib/platform";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleHelpIcon,
  CopyIcon,
  FolderSearchIcon,
  GlobeIcon,
  PowerIcon,
  SearchIcon,
  ShieldAlertIcon,
  SkullIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSettings } from "@/lib/client/settings";
import { formatBytes, formatCount, formatDuration, formatPercent, formatRate } from "@/lib/format";
import { KIND_META, SAFETY_META, SECTION_META } from "@/lib/kinds";
import type { ProcessGroup, ProcessRow, Section, Snapshot, SystemTotals } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useActions, type Target } from "./actions";
import { AppIcon } from "./app-icon";

type SortKey = "name" | "kind" | "cpu" | "memory" | "disk" | "network";
type Filter = "all" | Section;

const SECTIONS: Section[] = ["apps", "background", "system"];
const GRID = "grid grid-cols-[minmax(240px,1fr)_120px_78px_96px_96px_96px]";

type Selection = { groupId: string; pid?: number } | null;

type Row =
  | { type: "section"; key: string; section: Section; count: number; collapsed: boolean }
  | { type: "group"; key: string; group: ProcessGroup; expanded: boolean }
  | { type: "process"; key: string; group: ProcessGroup; process: ProcessRow; last: boolean };

function heat(intensity: number) {
  if (!(intensity > 0.015)) return undefined;
  const pct = 4 + Math.sqrt(Math.min(1, intensity)) * 24;
  return { backgroundColor: `color-mix(in oklch, var(--heat) ${pct.toFixed(1)}%, transparent)` };
}

interface Scale {
  cpuDivisor: number;
  totals: SystemTotals;
  heatmap: boolean;
}

function metricCells(values: { cpu: number; memory: number; disk: number; network: number }, scale: Scale, dim = false) {
  const cpu = values.cpu / scale.cpuDivisor;
  const intensity = {
    cpu: (values.cpu / scale.totals.cores / 100) * 3.5,
    memory: values.memory / (scale.totals.memoryTotal * 0.12),
    disk: values.disk / (25 * 1024 * 1024),
    network: values.network / (2 * 1024 * 1024),
  };
  const cell = "tabular flex h-full items-center justify-end px-3 text-[12px]";
  const text = dim ? "text-muted-foreground" : "text-foreground";
  return (
    <>
      <div className={cn(cell, text)} style={scale.heatmap ? heat(intensity.cpu) : undefined}>
        {formatPercent(cpu)}
      </div>
      <div className={cn(cell, text)} style={scale.heatmap ? heat(intensity.memory) : undefined}>
        {formatBytes(values.memory)}
      </div>
      <div className={cn(cell, text, values.disk < 1 && "text-muted-foreground/70")} style={scale.heatmap ? heat(intensity.disk) : undefined}>
        {formatRate(values.disk)}
      </div>
      <div className={cn(cell, text, values.network < 1 && "text-muted-foreground/70")} style={scale.heatmap ? heat(intensity.network) : undefined}>
        {formatRate(values.network)}
      </div>
    </>
  );
}

const GroupRow = memo(function GroupRow({
  group,
  expanded,
  selected,
  scale,
  colorIcons,
}: {
  group: ProcessGroup;
  expanded: boolean;
  selected: boolean;
  scale: Scale;
  colorIcons: boolean;
}) {
  const multi = group.processes.length > 1;
  return (
    <div
      data-row
      data-group={group.id}
      aria-selected={selected}
      role="row"
      className={cn(
        GRID,
        "group/row h-9 cursor-default border-b border-border/50 transition-colors",
        selected ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      <div className="flex min-w-0 items-center gap-2 pr-3 pl-2">
        <span data-toggle className={cn("flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground", multi ? "hover:bg-foreground/10" : "invisible")}>
          {expanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
        </span>
        <AppIcon bundlePath={group.bundlePath} hasIcon={group.hasIcon} kind={group.kind} size={18} color={colorIcons} />
        <span className="truncate text-[13px] font-[450]">{group.name}</span>
        {multi && <span className="tabular shrink-0 text-[11px] text-muted-foreground">({group.processes.length})</span>}
        {group.self && (
          <Badge variant="secondary" className="h-4 shrink-0 rounded px-1.5 text-[10px]">
            This app
          </Badge>
        )}
        {group.safety === "critical" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <ShieldAlertIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent side="right">{SAFETY_META.critical.description}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex min-w-0 items-center px-3">
        <span className="truncate text-[11px] text-muted-foreground">{KIND_META[group.kind].label}</span>
      </div>
      {metricCells(group, scale)}
    </div>
  );
});

const ProcessLine = memo(function ProcessLine({
  process,
  selected,
  last,
  scale,
}: {
  process: ProcessRow;
  selected: boolean;
  last: boolean;
  scale: Scale;
}) {
  return (
    <div
      data-row
      data-pid={process.pid}
      aria-selected={selected}
      role="row"
      className={cn(GRID, "group/row h-8 cursor-default transition-colors", last ? "border-b border-border/50" : "", selected ? "bg-accent" : "hover:bg-accent/50")}
    >
      <div className="relative flex min-w-0 items-center gap-2 pr-3 pl-[38px]">
        <span className={cn("absolute top-0 left-[19px] w-px bg-border", last ? "h-1/2" : "h-full")} />
        <span className="absolute top-1/2 left-[19px] h-px w-3 bg-border" />
        <span className="truncate text-[12px] text-foreground/90">{process.name}</span>
        <span className="tabular shrink-0 font-mono text-[10.5px] text-muted-foreground">{process.pid}</span>
        {process.uid < 500 && process.user && <span className="shrink-0 truncate text-[10.5px] text-muted-foreground/80">{process.user}</span>}
        {process.self && (
          <Badge variant="secondary" className="h-4 shrink-0 rounded px-1.5 text-[10px]">
            Systo
          </Badge>
        )}
      </div>
      <div className="flex min-w-0 items-center px-3">
        <span className="truncate text-[11px] text-muted-foreground/80">{KIND_META[process.kind].label}</span>
      </div>
      {metricCells(
        { cpu: process.cpu, memory: process.memory, disk: process.diskRead + process.diskWrite, network: process.netIn + process.netOut },
        scale,
        true,
      )}
    </div>
  );
});

function SectionRow({ section, count, collapsed }: { section: Section; count: number; collapsed: boolean }) {
  return (
    <div data-section={section} className="flex h-8 cursor-default items-center gap-2 border-b border-border/50 bg-background px-3 pt-2 select-none">
      {collapsed ? <ChevronRightIcon className="size-3.5 text-muted-foreground" /> : <ChevronDownIcon className="size-3.5 text-muted-foreground" />}
      <span className="text-[12px] font-semibold">{SECTION_META[section].label}</span>
      <span className="tabular text-[11px] text-muted-foreground">({count})</span>
      <span className="ml-2 hidden truncate text-[11px] text-muted-foreground/70 lg:inline">{SECTION_META[section].hint}</span>
    </div>
  );
}

function HeaderCell({
  label,
  value,
  sub,
  sortKey,
  sort,
  onSort,
  align = "right",
}: {
  label: string;
  value?: string;
  sub?: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  const Arrow = sort.dir === -1 ? ArrowDownIcon : ArrowUpIcon;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        "flex h-full flex-col justify-end gap-0.5 px-3 pb-2 transition-colors hover:bg-accent/40",
        align === "right" ? "items-end text-right" : "items-start text-left",
      )}
    >
      {value !== undefined && <span className="tabular text-[15px] leading-none font-medium tracking-tight">{value}</span>}
      <span className={cn("flex items-center gap-1 text-[11px]", active ? "text-foreground" : "text-muted-foreground")}>
        {align === "right" && active && <Arrow className="size-3" />}
        {label}
        {sub && <span className="text-muted-foreground/70">{sub}</span>}
        {align === "left" && active && <Arrow className="size-3" />}
      </span>
    </button>
  );
}

function matches(group: ProcessGroup, q: string) {
  if (!q) return { group: true, processes: false };
  const groupHit =
    group.name.toLowerCase().includes(q) ||
    (group.bundleId?.toLowerCase().includes(q) ?? false) ||
    KIND_META[group.kind].label.toLowerCase().includes(q);
  const processHit = group.processes.some((p) => p.name.toLowerCase().includes(q) || String(p.pid) === q);
  return { group: groupHit || processHit, processes: processHit && !groupHit };
}

export function ProcessesView({ snapshot }: { snapshot: Snapshot | null }) {
  const { settings } = useSettings();
  const actions = useActions();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "cpu", dir: -1 });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<Section>>(() => new Set());
  const [selection, setSelection] = useState<Selection>(null);
  const [menuTarget, setMenuTarget] = useState<Target | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const totals = snapshot?.totals;
  const cpuDivisor = settings.cpuMode === "total" ? (totals?.cores ?? 1) : 1;
  const scale = useMemo<Scale | null>(() => (totals ? { cpuDivisor, totals, heatmap: settings.heatmap } : null), [totals, cpuDivisor, settings.heatmap]);

  const groupsById = useMemo(() => new Map(snapshot?.groups.map((g) => [g.id, g]) ?? []), [snapshot]);

  const sectionCounts = useMemo(() => {
    const counts: Record<Section, number> = { apps: 0, background: 0, system: 0 };
    for (const g of snapshot?.groups ?? []) counts[g.section]++;
    return counts;
  }, [snapshot]);

  const rows = useMemo<Row[]>(() => {
    if (!snapshot) return [];
    const q = query.trim().toLowerCase();
    const compare = (a: ProcessGroup, b: ProcessGroup) => {
      let d = 0;
      if (sort.key === "name") d = a.name.localeCompare(b.name);
      else if (sort.key === "kind") d = KIND_META[a.kind].label.localeCompare(KIND_META[b.kind].label) || a.name.localeCompare(b.name);
      else d = a[sort.key] - b[sort.key];
      return d * sort.dir || a.name.localeCompare(b.name);
    };
    const childCompare = (a: ProcessRow, b: ProcessRow) => {
      const value = (p: ProcessRow) =>
        sort.key === "cpu" ? p.cpu : sort.key === "memory" ? p.memory : sort.key === "disk" ? p.diskRead + p.diskWrite : sort.key === "network" ? p.netIn + p.netOut : 0;
      if (sort.key === "name" || sort.key === "kind") return a.name.localeCompare(b.name) * sort.dir;
      return (value(a) - value(b)) * sort.dir || a.pid - b.pid;
    };

    const out: Row[] = [];
    for (const section of SECTIONS) {
      if (filter !== "all" && filter !== section) continue;
      const list: Array<{ group: ProcessGroup; forceOpen: boolean }> = [];
      for (const group of snapshot.groups) {
        if (group.section !== section) continue;
        const m = matches(group, q);
        if (m.group) list.push({ group, forceOpen: m.processes });
      }
      if (list.length === 0) continue;
      list.sort((a, b) => compare(a.group, b.group));
      const collapsed = collapsedSections.has(section) && !q;
      out.push({ type: "section", key: `s:${section}`, section, count: list.length, collapsed });
      if (collapsed) continue;
      for (const { group, forceOpen } of list) {
        const open = group.processes.length > 1 && (expanded.has(group.id) || forceOpen);
        out.push({ type: "group", key: `g:${group.id}`, group, expanded: open });
        if (open) {
          const children = [...group.processes].sort(childCompare);
          children.forEach((process, i) =>
            out.push({ type: "process", key: `p:${process.pid}`, group, process, last: i === children.length - 1 }),
          );
        }
      }
    }
    return out;
  }, [snapshot, query, filter, sort, expanded, collapsedSections]);

  const selectable = useMemo(() => rows.filter((r): r is Exclude<Row, { type: "section" }> => r.type !== "section"), [rows]);

  const selectedTarget = useMemo<Target | null>(() => {
    if (!selection) return null;
    const group = groupsById.get(selection.groupId);
    if (!group) return null;
    if (selection.pid) {
      const process = group.processes.find((p) => p.pid === selection.pid);
      return process ? { group, process } : { group };
    }
    return { group };
  }, [selection, groupsById]);

  const toggleGroup = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onSort = useCallback((key: SortKey) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: key === "name" || key === "kind" ? 1 : -1 }));
  }, []);

  const targetFromEvent = (event: MouseEvent): Target | null => {
    const el = (event.target as HTMLElement).closest<HTMLElement>("[data-row]");
    if (!el) return null;
    if (el.dataset.group) {
      const group = groupsById.get(el.dataset.group);
      return group ? { group } : null;
    }
    const pid = Number(el.dataset.pid);
    for (const g of snapshot?.groups ?? []) {
      const process = g.processes.find((p) => p.pid === pid);
      if (process) return { group: g, process };
    }
    return null;
  };

  const onListClick = (event: MouseEvent) => {
    const sectionEl = (event.target as HTMLElement).closest<HTMLElement>("[data-section]");
    if (sectionEl) {
      const section = sectionEl.dataset.section as Section;
      setCollapsedSections((prev) => {
        const next = new Set(prev);
        if (next.has(section)) next.delete(section);
        else next.add(section);
        return next;
      });
      return;
    }
    const target = targetFromEvent(event);
    if (!target) return;
    setSelection({ groupId: target.group.id, pid: target.process?.pid });
    if (!target.process && (event.target as HTMLElement).closest("[data-toggle]")) toggleGroup(target.group.id);
  };

  const onListDoubleClick = (event: MouseEvent) => {
    const target = targetFromEvent(event);
    if (!target) return;
    if (!target.process && target.group.processes.length > 1) toggleGroup(target.group.id);
    else actions.explain(target);
  };

  const onContextMenu = (event: MouseEvent) => {
    const target = targetFromEvent(event);
    setMenuTarget(target);
    if (target) setSelection({ groupId: target.group.id, pid: target.process?.pid });
    else event.preventDefault();
  };

  const moveSelection = (delta: number) => {
    if (selectable.length === 0) return;
    const index = selectable.findIndex((r) =>
      r.type === "group" ? !selection?.pid && r.group.id === selection?.groupId : r.process.pid === selection?.pid,
    );
    const next = selectable[Math.max(0, Math.min(selectable.length - 1, index === -1 ? 0 : index + delta))];
    setSelection(next.type === "group" ? { groupId: next.group.id } : { groupId: next.group.id, pid: next.process.pid });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === "ArrowRight" && selectedTarget && !selectedTarget.process) {
      setExpanded((prev) => new Set(prev).add(selectedTarget.group.id));
    } else if (event.key === "ArrowLeft" && selectedTarget) {
      const id = selectedTarget.group.id;
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (selectedTarget.process) setSelection({ groupId: id });
    } else if (event.key === "Enter" && selectedTarget) {
      if (!selectedTarget.process && selectedTarget.group.processes.length > 1) toggleGroup(selectedTarget.group.id);
      else actions.explain(selectedTarget);
    } else if ((event.key === "Delete" || event.key === "Backspace") && selectedTarget) {
      event.preventDefault();
      actions.endTask(selectedTarget, event.altKey ? "force" : "terminate");
    } else if ((event.key === "i" && isModKey(event)) || event.key === "?") {
      event.preventDefault();
      if (selectedTarget) actions.explain(selectedTarget);
    } else if (event.key === "Escape") {
      setSelection(null);
    }
  };

  useEffect(() => {
    const onGlobalKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onGlobalKey);
    return () => window.removeEventListener("keydown", onGlobalKey);
  }, []);

  useEffect(() => {
    if (!selection || !listRef.current) return;
    const selector = selection.pid ? `[data-pid="${selection.pid}"]` : `[data-group="${CSS.escape(selection.groupId)}"]`;
    listRef.current.querySelector(selector)?.scrollIntoView({ block: "nearest" });
  }, [selection]);

  const memoryPercent = totals ? (totals.memoryUsed / totals.memoryTotal) * 100 : 0;
  const selectedIsApp = selectedTarget && !selectedTarget.process && ["app", "system-app", "menu-bar"].includes(selectedTarget.group.kind);
  const canEndSelected = selectedTarget ? actions.canEnd(selectedTarget) : false;
  const visibleGroups = rows.filter((r) => r.type === "group").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="mr-1 text-[15px] font-semibold tracking-tight">Processes</h1>
        <div className="relative w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                listRef.current?.focus();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                listRef.current?.focus();
                moveSelection(1);
              }
            }}
            placeholder="Search name or PID"
            className={cn("h-8 rounded-md pl-8 text-[13px] shadow-none", IS_WINDOWS ? "pr-[62px]" : "pr-12")}
            spellCheck={false}
          />
          {query ? (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <XIcon className="size-3.5" />
            </button>
          ) : (
            <Kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">{OS.mod}F</Kbd>
          )}
        </div>
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => v && setFilter(v as Filter)}
          variant="outline"
          size="sm"
          className="h-8"
        >
          <ToggleGroupItem value="all" className="h-8 px-3 text-[12px]">
            All
          </ToggleGroupItem>
          {SECTIONS.map((s) => (
            <ToggleGroupItem key={s} value={s} className="h-8 gap-1.5 px-3 text-[12px]">
              {SECTION_META[s].label}
              <span className="tabular text-[10.5px] text-muted-foreground">{sectionCounts[s]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="ml-auto flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-8" disabled={!selectedTarget} onClick={() => selectedTarget && actions.explain(selectedTarget)}>
                <CircleHelpIcon /> What is this?
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Explain the selected process <Kbd className="ml-1">{OS.mod}I</Kbd>
            </TooltipContent>
          </Tooltip>
          <div className="flex">
            <Button
              size="sm"
              className="h-8 rounded-r-none"
              disabled={!canEndSelected}
              onClick={() => selectedTarget && actions.endTask(selectedTarget)}
            >
              <XCircleIcon /> End task
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-8 rounded-l-none border-l border-primary-foreground/15 px-2" disabled={!canEndSelected} aria-label="More ways to end">
                  <ChevronDownIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {selectedIsApp && (
                  <DropdownMenuItem onSelect={() => selectedTarget && actions.endTask(selectedTarget, "quit")}>
                    <PowerIcon /> Quit app
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => selectedTarget && actions.endTask(selectedTarget, "terminate")}>
                  <XCircleIcon /> End task
                  <Kbd className="ml-auto">⌫</Kbd>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => selectedTarget && actions.endTask(selectedTarget, "force")}>
                  <SkullIcon /> Force quit
                  <Kbd className="ml-auto">⌥⌫</Kbd>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={listRef}
            tabIndex={0}
            role="grid"
            aria-label="Processes"
            onKeyDown={onKeyDown}
            onClick={onListClick}
            onDoubleClick={onListDoubleClick}
            onContextMenu={onContextMenu}
            className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto outline-none"
          >
            <div className={cn(GRID, "sticky top-0 z-10 h-[58px] border-b bg-background/95 backdrop-blur")}>
              <HeaderCell label="Name" sortKey="name" sort={sort} onSort={onSort} align="left" sub={totals ? `${formatCount(visibleGroups)} shown` : undefined} />
              <HeaderCell label="Type" sortKey="kind" sort={sort} onSort={onSort} align="left" />
              <HeaderCell label="CPU" value={totals ? formatPercent(totals.cpu, 0) : "–"} sortKey="cpu" sort={sort} onSort={onSort} />
              <HeaderCell label="Memory" value={totals ? `${Math.round(memoryPercent)}%` : "–"} sortKey="memory" sort={sort} onSort={onSort} />
              <HeaderCell label="Disk" value={totals ? formatRate(totals.diskRead + totals.diskWrite) : "–"} sortKey="disk" sort={sort} onSort={onSort} />
              <HeaderCell label="Network" value={totals ? formatRate(totals.netIn + totals.netOut) : "–"} sortKey="network" sort={sort} onSort={onSort} />
            </div>

            {!snapshot && <LoadingRows />}
            {snapshot && rows.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-1 py-24 text-center">
                <SearchIcon className="mb-2 size-5 text-muted-foreground" />
                <p className="text-sm font-medium">No matches for “{query}”</p>
                <p className="text-xs text-muted-foreground">Try an app name, a process name, or a PID.</p>
              </div>
            )}
            {scale &&
              rows.map((row) => {
                if (row.type === "section") return <SectionRow key={row.key} section={row.section} count={row.count} collapsed={row.collapsed} />;
                if (row.type === "group")
                  return (
                    <GroupRow
                      key={row.key}
                      group={row.group}
                      expanded={row.expanded}
                      selected={!selection?.pid && selection?.groupId === row.group.id}
                      scale={scale}
                      colorIcons={settings.colorIcons}
                    />
                  );
                return <ProcessLine key={row.key} process={row.process} last={row.last} selected={selection?.pid === row.process.pid} scale={scale} />;
              })}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {menuTarget && <RowMenu target={menuTarget} />}
        </ContextMenuContent>
      </ContextMenu>

      <footer className="flex h-8 shrink-0 items-center gap-4 border-t px-4 text-[11px] text-muted-foreground">
        {totals ? (
          <>
            <span className="tabular">{formatCount(totals.processCount)} processes</span>
            <span className="tabular">{sectionCounts.apps} apps</span>
            <span className="tabular">
              Memory {formatBytes(totals.memoryUsed)} of {formatBytes(totals.memoryTotal, 0)}
            </span>
            {totals.pressure !== "normal" && <span className="font-medium text-foreground">Memory pressure {totals.pressure}</span>}
            <span className="tabular">Up {formatDuration(totals.uptime)}</span>
            {!snapshot?.native && <span>Limited mode: install Bun for disk and footprint data</span>}
          </>
        ) : (
          <span>Reading processes…</span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full bg-foreground", settings.interval ? "animate-[systo-pulse_2s_ease-in-out_infinite]" : "opacity-30")} />
          {settings.interval ? `Live · every ${settings.interval / 1000}s` : "Paused"}
        </span>
      </footer>
    </div>
  );
}

function RowMenu({ target }: { target: Target }) {
  const actions = useActions();
  const isApp = !target.process && ["app", "system-app", "menu-bar"].includes(target.group.kind);
  const path = target.process?.path ?? target.group.bundlePath ?? target.group.processes[0]?.path;
  const pid = target.process?.pid ?? target.group.headPid;
  const canEnd = actions.canEnd(target);
  return (
    <>
      <ContextMenuLabel className="truncate text-xs text-muted-foreground">
        {target.process ? `${target.process.name} · ${target.process.pid}` : target.group.name}
      </ContextMenuLabel>
      <ContextMenuItem onSelect={() => actions.explain(target)}>
        <CircleHelpIcon /> What is this?
        <ContextMenuShortcut>{OS.mod}I</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      {isApp && (
        <ContextMenuItem disabled={!canEnd} onSelect={() => actions.endTask(target, "quit")}>
          <PowerIcon /> Quit app
        </ContextMenuItem>
      )}
      <ContextMenuItem disabled={!canEnd} onSelect={() => actions.endTask(target, "terminate")}>
        <XCircleIcon /> {target.process || target.group.processes.length === 1 ? "End process" : `End all ${target.group.processes.length}`}
        <ContextMenuShortcut>⌫</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem disabled={!canEnd} onSelect={() => actions.endTask(target, "force")}>
        <SkullIcon /> Force quit
        <ContextMenuShortcut>⌥⌫</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      {path?.startsWith("/") && (
        <ContextMenuItem onSelect={() => actions.reveal(path)}>
          <FolderSearchIcon /> {OS.reveal}
        </ContextMenuItem>
      )}
      <ContextMenuItem onSelect={() => void navigator.clipboard?.writeText(String(pid))}>
        <CopyIcon /> Copy PID
      </ContextMenuItem>
      {path && (
        <ContextMenuItem onSelect={() => void navigator.clipboard?.writeText(path)}>
          <CopyIcon /> Copy path
        </ContextMenuItem>
      )}
      <ContextMenuItem
        onSelect={() =>
          window.open(`https://duckduckgo.com/?q=${encodeURIComponent(`${OS.name} "${target.process?.name ?? target.group.name}" process`)}`, "_blank")
        }
      >
        <GlobeIcon /> Search the web
      </ContextMenuItem>
    </>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-px">
      {Array.from({ length: 14 }, (_, i) => (
        <div key={i} className={cn(GRID, "h-9 items-center border-b border-border/50")}>
          <div className="flex items-center gap-2 pl-9">
            <div className="size-[18px] animate-pulse rounded bg-muted" />
            <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${40 + ((i * 37) % 45)}%` }} />
          </div>
          {Array.from({ length: 5 }, (_, j) => (
            <div key={j} className="flex justify-end px-3">
              <div className="h-3 w-10 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
