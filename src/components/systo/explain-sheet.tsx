"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon, FolderSearchIcon, GlobeIcon, ShieldAlertIcon, ShieldCheckIcon, ShieldIcon, RotateCwIcon, XCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useSettings } from "@/lib/client/settings";
import { SAFETY_META } from "@/lib/kinds";
import type { Explanation, Safety } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useActions, type Target } from "./actions";
import { AppIcon } from "./app-icon";

const SAFETY_ICON: Record<Safety, typeof ShieldIcon> = {
  safe: ShieldCheckIcon,
  relaunches: RotateCwIcon,
  caution: ShieldIcon,
  critical: ShieldAlertIcon,
};

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group/fact grid grid-cols-[96px_1fr_auto] items-start gap-3 py-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd data-selectable className={cn("min-w-0 text-xs break-words text-foreground", mono && "font-mono text-[11px] leading-relaxed")}>
        {value}
      </dd>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        className="opacity-0 transition-opacity group-hover/fact:opacity-100 focus-visible:opacity-100"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? <CheckIcon className="size-3.5 text-foreground" /> : <CopyIcon className="size-3.5 text-muted-foreground" />}
      </button>
    </div>
  );
}

export function ExplainSheet({ target, onOpenChange }: { target: Target | null; onOpenChange: (open: boolean) => void }) {
  const [data, setData] = useState<Explanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { endTask, reveal, canEnd } = useActions();
  const { settings } = useSettings();

  const groupId = target?.group.id;
  const pid = target?.process?.pid;

  useEffect(() => {
    if (!groupId) return;
    const controller = new AbortController();
    setData(null);
    setError(null);
    const params = new URLSearchParams({ group: groupId });
    if (pid) params.set("pid", String(pid));
    fetch(`/api/explain?${params}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Couldn't look this up");
        setData(json as Explanation);
      })
      .catch((err: Error) => err.name !== "AbortError" && setError(err.message));
    return () => controller.abort();
  }, [groupId, pid]);

  const SafetyIcon = data ? SAFETY_ICON[data.safety] : ShieldIcon;
  const path = target?.process?.path ?? target?.group.bundlePath ?? target?.group.processes[0]?.path;

  return (
    <Sheet open={Boolean(target)} onOpenChange={onOpenChange}>
      <SheetContent className="w-[440px] gap-0 p-0 sm:max-w-[440px]">
        <SheetHeader className="gap-3 border-b p-5">
          <div className="flex items-center gap-3">
            {target && (
              <AppIcon
                bundlePath={target.process ? undefined : target.group.bundlePath}
                hasIcon={target.group.hasIcon}
                kind={target.process?.kind ?? target.group.kind}
                size={40}
                color={settings.colorIcons}
                className="rounded-lg"
              />
            )}
            <div className="min-w-0">
              <SheetTitle className="truncate text-base">{target?.process?.name ?? target?.group.name}</SheetTitle>
              <SheetDescription className="mt-0.5 flex items-center gap-1.5 text-xs">
                {data ? (
                  <>
                    <span>{data.kindLabel}</span>
                    <span aria-hidden>·</span>
                    <span className="truncate">{data.vendor}</span>
                  </>
                ) : (
                  <span>What is this?</span>
                )}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 p-5">
            {error && <p className="text-sm text-muted-foreground">{error}</p>}
            {!data && !error && (
              <div className="space-y-2.5">
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="mt-6 h-16 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            )}
            {data && (
              <>
                <section className="space-y-2">
                  <p className="text-[13px] leading-relaxed text-foreground">{data.summary}</p>
                  {data.details.length > 0 && (
                    <ul className="space-y-1.5 pt-1">
                      {data.details.map((line) => (
                        <li key={line} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                          <span className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/60" />
                          {line}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-lg border bg-muted/40 p-3.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <SafetyIcon className="size-4" />
                    <span className="text-xs font-medium">If you end it</span>
                    <Badge variant="outline" className="ml-auto h-5 rounded-full px-2 text-[10px] font-medium">
                      {SAFETY_META[data.safety].label}
                    </Badge>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{data.quitEffect}</p>
                </section>

                <section>
                  <h3 className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Details</h3>
                  <dl className="divide-y divide-border/60">
                    {data.facts.map((fact) => (
                      <Fact key={fact.label} {...fact} />
                    ))}
                  </dl>
                </section>

                {data.connections.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Network connections</h3>
                    <ul data-selectable className="space-y-1 rounded-md border bg-muted/30 p-2.5 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                      {data.connections.map((c) => (
                        <li key={c} className="truncate">
                          {c}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {data.source === "heuristic" && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Systo doesn't recognise this one, so this description is based on where it lives and who signed it.
                  </p>
                )}
              </>
            )}
          </div>
        </ScrollArea>

        <Separator />
        <div className="flex items-center gap-2 p-3">
          <Button variant="outline" size="sm" asChild>
            <a href={`https://duckduckgo.com/?q=${encodeURIComponent(data?.searchQuery ?? target?.group.name ?? "")}`} target="_blank" rel="noreferrer">
              <GlobeIcon /> Search the web
            </a>
          </Button>
          {path?.startsWith("/") && (
            <Button variant="ghost" size="sm" onClick={() => reveal(path)}>
              <FolderSearchIcon /> Reveal
            </Button>
          )}
          {target && canEnd(target) && (
            <Button
              size="sm"
              className="ml-auto"
              onClick={() => {
                endTask(target);
                onOpenChange(false);
              }}
            >
              <XCircleIcon /> End task
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
