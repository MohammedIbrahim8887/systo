"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
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
import { SAFETY_META } from "@/lib/kinds";
import type { KillMode, KillResult, ProcessGroup, ProcessRow, Safety } from "@/lib/types";
import { ExplainSheet } from "./explain-sheet";

export interface Target {
  group: ProcessGroup;
  process?: ProcessRow;
}

interface ActionsValue {
  endTask: (target: Target, mode?: KillMode) => void;
  explain: (target: Target) => void;
  reveal: (path: string) => void;
  canEnd: (target: Target) => boolean;
}

const ActionsContext = createContext<ActionsValue | null>(null);

export function useActions() {
  const value = useContext(ActionsContext);
  if (!value) throw new Error("useActions outside ActionsProvider");
  return value;
}

interface PendingConfirm {
  target: Target;
  mode: KillMode;
  safety: Safety;
}

function describe(target: Target) {
  if (target.process) return { name: target.process.name, count: 1 };
  return { name: target.group.name, count: target.group.processes.length };
}

const MODE_LABEL: Record<KillMode, string> = { quit: "Quit", terminate: "End task", force: "Force quit" };

async function postEnd(body: Record<string, unknown>): Promise<KillResult> {
  const res = await fetch("/api/end", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as KillResult;
}

export function ActionsProvider({ children, onChanged }: { children: ReactNode; onChanged: () => void }) {
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [explainTarget, setExplainTarget] = useState<Target | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const canEnd = useCallback((target: Target) => {
    if (target.process) return !target.process.self && target.process.pid > 1;
    return !target.group.self && target.group.kind !== "kernel";
  }, []);

  const run = useCallback(async (target: Target, mode: KillMode, admin = false) => {
    const { name } = describe(target);
    const body = target.process
      ? { pids: [target.process.pid], mode, admin }
      : { groupId: target.group.id, mode, admin };
    const id = toast.loading(`${MODE_LABEL[mode]}: ${name}…`);
    try {
      const result = await postEnd(body);
      if (result.ok) {
        toast.success(result.message, { id, description: name });
      } else if (result.needsAdmin) {
        toast(`${name} belongs to the system`, {
          id,
          description: "macOS only lets an administrator end it.",
          action: { label: "End as admin", onClick: () => void run(target, mode, true) },
          duration: 10000,
        });
      } else {
        toast.error(result.message, { id, description: name });
      }
    } catch (error) {
      toast.error("Couldn't reach Systo's server", { id, description: String(error) });
    }
    setTimeout(() => changed.current(), 400);
  }, []);

  const endTask = useCallback(
    (target: Target, mode: KillMode = "terminate") => {
      if (!canEnd(target)) {
        toast("Systo can't end this", {
          description: target.group.self ? "That's Systo itself. Quit from the menu bar instead." : "macOS doesn't allow ending this process.",
        });
        return;
      }
      const safety = target.process?.safety ?? target.group.safety;
      const multi = !target.process && target.group.processes.length > 1;
      const needsConfirm = safety === "critical" || safety === "caution" || mode === "force" || (multi && target.group.section === "system");
      if (needsConfirm) setConfirm({ target, mode, safety });
      else void run(target, mode);
    },
    [canEnd, run],
  );

  const reveal = useCallback((path: string) => {
    void fetch("/api/reveal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    }).then(async (res) => {
      const { ok } = (await res.json()) as { ok: boolean };
      if (!ok) toast.error("Couldn't reveal that file");
    });
  }, []);

  const value = useMemo<ActionsValue>(
    () => ({ endTask, explain: setExplainTarget, reveal, canEnd }),
    [endTask, reveal, canEnd],
  );

  const info = confirm ? describe(confirm.target) : null;

  return (
    <ActionsContext.Provider value={value}>
      {children}
      <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent className="sm:max-w-[420px]">
          {confirm && info && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {MODE_LABEL[confirm.mode]} “{info.name}”?
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3">
                    <p>
                      {confirm.mode === "force"
                        ? "Force quitting stops it immediately. Anything unsaved is lost."
                        : "It will be asked to close."}
                      {info.count > 1 ? ` This ends all ${info.count} of its processes.` : ""}
                    </p>
                    {confirm.safety !== "safe" && (
                      <p className="rounded-md border bg-muted/50 px-3 py-2 text-foreground">
                        <span className="font-medium">{SAFETY_META[confirm.safety].label}.</span>{" "}
                        <span className="text-muted-foreground">{SAFETY_META[confirm.safety].description}</span>
                      </p>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const { target, mode } = confirm;
                    setConfirm(null);
                    void run(target, mode);
                  }}
                >
                  {MODE_LABEL[confirm.mode]}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
      <ExplainSheet target={explainTarget} onOpenChange={(open) => !open && setExplainTarget(null)} />
    </ActionsContext.Provider>
  );
}
