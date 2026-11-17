"use client";
import { useEffect, useId, useState, type ReactNode } from "react";
import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, FileJsonIcon, FolderIcon, MonitorIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AI_NAMES, AI_PROVIDERS, type AIAccount, type AIDiscoveredLogin, type AIProvider } from "@/lib/ai-types";
import { PROVIDER_LOGIN, folderForAccount, pathsForFolder } from "@/lib/ai-display";
import { cn } from "@/lib/utils";
import { ProviderMark } from "./ai-provider-mark";

type Choice = { kind: "default" } | { kind: "found"; login: AIDiscoveredLogin } | { kind: "folder" } | { kind: "file" } | { kind: "snapshot" };

export interface ConnectRequest {
  /** Existing account to edit. */
  account?: AIAccount;
  provider?: AIProvider;
  /** Pre-selects a detected login. */
  login?: AIDiscoveredLogin;
}

const PROVIDER_HINT: Record<AIProvider, string> = {
  claude: "Pro and Max limits",
  codex: "ChatGPT plan limits",
  opencode: "OpenCode Go and Zen",
  pi: "Local tokens and cost",
  cursor: "Plan and on-demand",
  antigravity: "Model quotas",
  grok: "SuperGrok limits",
  custom: "Any tool, via a JSON file",
};

export async function saveAccount(account: Partial<AIAccount>, action: "save" | "remove" = "save") {
  const res = await fetch("/api/ai-usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, account, id: account.id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not save the account.");
}

export function accountFromLogin(login: AIDiscoveredLogin): Partial<AIAccount> {
  return {
    provider: login.provider,
    label: login.label,
    source: "local",
    credentialPath: login.credentialPath,
    sessionsPath: login.sessionsPath,
  };
}

function initialChoice(request: ConnectRequest, logins: AIDiscoveredLogin[]): Choice | null {
  if (request.login) return { kind: "found", login: request.login };
  const a = request.account;
  if (!a) return null;
  if (a.source === "snapshot") return { kind: "snapshot" };
  if (!a.credentialPath) return { kind: "default" };
  const found = logins.find((l) => l.provider === a.provider && l.credentialPath === a.credentialPath);
  if (found) return { kind: "found", login: found };
  return folderForAccount(a) ? { kind: "folder" } : { kind: "file" };
}

function OptionCard({
  selected,
  disabled,
  onSelect,
  icon,
  title,
  detail,
  badge,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "border-foreground bg-accent/60" : "hover:bg-accent/40",
      )}
    >
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[13px] font-medium">
          <span className="truncate">{title}</span>
          {badge}
        </span>
        {detail && <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">{detail}</span>}
      </span>
      <span
        className={cn(
          "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
          selected ? "border-foreground bg-foreground text-background" : "border-input",
        )}
        aria-hidden
      >
        {selected && <CheckIcon className="size-2.5" strokeWidth={3} />}
      </span>
    </button>
  );
}

export function ConnectDialog({
  request,
  logins,
  accounts,
  onClose,
  onSaved,
}: {
  request: ConnectRequest | null;
  logins: AIDiscoveredLogin[];
  accounts: AIAccount[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const open = request !== null;
  const editing = request?.account;
  const formId = useId();
  const [provider, setProvider] = useState<AIProvider | null>(null);
  const [label, setLabel] = useState("");
  const [labelTouched, setLabelTouched] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [folder, setFolder] = useState("");
  const [credentialPath, setCredentialPath] = useState("");
  const [sessionsPath, setSessionsPath] = useState("");
  const [usagePath, setUsagePath] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!request) return;
    const a = request.account;
    const p = a?.provider ?? request.login?.provider ?? request.provider ?? null;
    setProvider(p);
    setLabel(a?.label ?? request.login?.label ?? "");
    setLabelTouched(Boolean(a || request.login));
    setChoice(initialChoice(request, logins));
    setFolder(a ? (folderForAccount(a) ?? "") : "");
    setCredentialPath(a?.credentialPath ?? "");
    setSessionsPath(a?.sessionsPath ?? "");
    setUsagePath(a?.usagePath ?? "");
    setAdvanced(Boolean(a?.sessionsPath));
    setError("");
    // Only when a new request opens; later discovery refreshes must not reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const providerLogins = provider ? logins.filter((l) => l.provider === provider && !l.isDefault) : [];
  const defaultLogin = provider ? logins.find((l) => l.provider === provider && l.isDefault) : undefined;
  const others = accounts.filter((a) => a.id !== editing?.id);
  const defaultTaken = others.some((a) => a.provider === provider && a.source === "local" && !a.credentialPath);
  const takenPath = (path?: string) => Boolean(path) && others.some((a) => a.provider === provider && a.credentialPath === path);
  const spec = provider ? PROVIDER_LOGIN[provider] : undefined;

  function pickProvider(p: AIProvider) {
    setProvider(p);
    const taken = others.some((a) => a.provider === p && a.source === "local" && !a.credentialPath);
    const firstFound = logins.find((l) => l.provider === p && !l.isDefault && !l.tracked);
    setChoice(p === "custom" ? { kind: "snapshot" } : !taken ? { kind: "default" } : firstFound ? { kind: "found", login: firstFound } : null);
    if (!labelTouched) setLabel(taken ? (firstFound?.label ?? `${AI_NAMES[p]} · Work`) : `My ${AI_NAMES[p]}`);
  }

  function draft(): Partial<AIAccount> {
    const base = { id: editing?.id, provider: provider!, label: label.trim() };
    switch (choice?.kind) {
      case "default":
        return { ...base, source: "local", sessionsPath: advanced && sessionsPath ? sessionsPath : undefined };
      case "found":
        return { ...base, source: "local", credentialPath: choice.login.credentialPath, sessionsPath: choice.login.sessionsPath };
      case "folder": {
        const paths = pathsForFolder(provider!, folder);
        return { ...base, source: "local", ...paths, ...(advanced && sessionsPath ? { sessionsPath } : {}) };
      }
      case "file":
        return { ...base, source: "local", credentialPath, sessionsPath: sessionsPath || undefined };
      case "snapshot":
        return { ...base, source: "snapshot", usagePath };
      default:
        return base;
    }
  }

  async function submit(action: "save" | "remove") {
    if (action === "save" && !choice) return setError("Choose where Systo should read this account from.");
    setBusy(true);
    setError("");
    try {
      await saveAccount(action === "remove" ? { id: editing?.id } : draft(), action);
      onSaved(action === "remove" ? `Removed ${editing?.label}` : editing ? `Saved ${label.trim()}` : `Connected ${label.trim()}`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const step = provider ? "details" : "provider";
  const untracked = logins.filter((l) => !l.tracked);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="flex max-h-[min(720px,calc(100vh-3rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]">
        <DialogHeader className="shrink-0 border-b px-5 pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            {step === "details" && !editing && (
              <Button variant="ghost" size="icon-xs" aria-label="Choose another provider" onClick={() => setProvider(null)}>
                <ArrowLeftIcon />
              </Button>
            )}
            {provider && <ProviderMark provider={provider} size="sm" />}
            <DialogTitle className="text-[15px]">
              {editing ? `Edit ${editing.label}` : provider ? `Connect ${AI_NAMES[provider]}` : "Connect an AI account"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-[12px]">
            {step === "provider"
              ? "Pick a provider. Each account reads its own login, so work and personal subscriptions stay separate."
              : "Systo reads the login without changing it and uses it only to check usage with that provider."}
          </DialogDescription>
        </DialogHeader>

        <div className="scrollbar-thin min-h-0 overflow-y-auto px-5 py-4">
          {step === "provider" ? (
            <div className="space-y-5">
              {untracked.length > 0 && (
                <section>
                  <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Found on this Mac</h3>
                  <div className="space-y-1.5">
                    {untracked.map((login) => (
                      <div key={login.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                        <ProviderMark provider={login.provider} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium">{login.label}</p>
                          <p className="truncate text-[11.5px] text-muted-foreground">
                            {[login.email, login.via ? `from ${login.via}` : undefined, login.folder].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await saveAccount(accountFromLogin(login));
                              onSaved(`Connected ${login.label}`);
                              onClose();
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Connect
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <section>
                {untracked.length > 0 && (
                  <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Or choose a provider</h3>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {AI_PROVIDERS.map((p) => {
                    const count = accounts.filter((a) => a.provider === p).length;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => pickProvider(p)}
                        className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ProviderMark provider={p} />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium">{AI_NAMES[p]}</span>
                          <span className="block truncate text-[11.5px] text-muted-foreground">
                            {count ? `${count} connected · add another` : PROVIDER_HINT[p]}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
              {error && <p className="text-[12px]" role="alert">{error}</p>}
            </div>
          ) : (
            <form
              id={formId}
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                void submit("save");
              }}
            >
              <label className="block space-y-1.5">
                <span className="text-[12px] font-medium">Name</span>
                <Input
                  autoFocus
                  required
                  maxLength={100}
                  value={label}
                  placeholder={`${AI_NAMES[provider!]} · Work`}
                  onChange={(e) => {
                    setLabel(e.target.value);
                    setLabelTouched(true);
                  }}
                />
              </label>

              <fieldset className="space-y-1.5">
                <legend className="mb-1.5 text-[12px] font-medium">Read usage from</legend>
                <div role="radiogroup" aria-label="Read usage from" className="space-y-1.5">
                  {provider !== "custom" && (
                    <OptionCard
                      selected={choice?.kind === "default"}
                      disabled={defaultTaken}
                      onSelect={() => setChoice({ kind: "default" })}
                      icon={<MonitorIcon className="size-4" />}
                      title="This Mac's default login"
                      detail={
                        defaultTaken
                          ? "Already connected as another account"
                          : [defaultLogin?.email, spec?.folder ?? "The provider app's own sign-in"].filter(Boolean).join(" · ")
                      }
                    />
                  )}
                  {providerLogins.map((login) => (
                    <OptionCard
                      key={login.id}
                      selected={choice?.kind === "found" && choice.login.id === login.id}
                      disabled={takenPath(login.credentialPath)}
                      onSelect={() => {
                        setChoice({ kind: "found", login });
                        if (!labelTouched) setLabel(login.label);
                      }}
                      icon={<FolderIcon className="size-4" />}
                      title={login.email ?? login.label}
                      badge={
                        login.via ? (
                          <span className="rounded border px-1 text-[10px] font-normal text-muted-foreground">{login.via}</span>
                        ) : undefined
                      }
                      detail={takenPath(login.credentialPath) ? "Already connected" : login.folder}
                    />
                  ))}
                  {spec?.credential && (
                    <OptionCard
                      selected={choice?.kind === "folder"}
                      onSelect={() => setChoice({ kind: "folder" })}
                      icon={<FolderIcon className="size-4" />}
                      title="Another login folder"
                      detail={`A separate ${AI_NAMES[provider!]} config folder, e.g. ${spec.folder}-work`}
                    />
                  )}
                  {provider !== "custom" && provider !== "cursor" && (
                    <OptionCard
                      selected={choice?.kind === "file"}
                      onSelect={() => setChoice({ kind: "file" })}
                      icon={<FileJsonIcon className="size-4" />}
                      title="A credential file"
                      detail="Point at the login JSON directly"
                    />
                  )}
                  <OptionCard
                    selected={choice?.kind === "snapshot"}
                    onSelect={() => setChoice({ kind: "snapshot" })}
                    icon={<FileJsonIcon className="size-4" />}
                    title="A usage snapshot file"
                    detail="A JSON file another tool keeps up to date"
                  />
                </div>
              </fieldset>

              {choice?.kind === "folder" && (
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium">Login folder</span>
                  <Input
                    required
                    className="font-mono text-[12px]"
                    value={folder}
                    placeholder={`${spec?.folder}-work`}
                    onChange={(e) => setFolder(e.target.value)}
                  />
                  <span className="block text-[11.5px] leading-relaxed text-muted-foreground">
                    Systo reads <code className="font-mono">{spec?.credential}</code>
                    {spec?.sessions ? (
                      <>
                        {" "}and token history from <code className="font-mono">{spec.sessions}/</code>
                      </>
                    ) : null}{" "}
                    inside it. Not signed in there yet? {spec?.signIn}
                  </span>
                </label>
              )}
              {choice?.kind === "file" && (
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium">Credential file</span>
                  <Input
                    required
                    className="font-mono text-[12px]"
                    value={credentialPath}
                    placeholder="~/accounts/work/auth.json"
                    onChange={(e) => setCredentialPath(e.target.value)}
                  />
                </label>
              )}
              {choice?.kind === "snapshot" && (
                <div className="space-y-1.5">
                  <label className="block space-y-1.5">
                    <span className="text-[12px] font-medium">Usage file</span>
                    <Input
                      required
                      className="font-mono text-[12px]"
                      value={usagePath}
                      placeholder="~/usage/provider.json"
                      onChange={(e) => setUsagePath(e.target.value)}
                    />
                  </label>
                  <details className="text-[11.5px] text-muted-foreground">
                    <summary className="cursor-pointer select-none">File format</summary>
                    <pre data-selectable className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-[11px] text-foreground">
                      {JSON.stringify(
                        {
                          version: 1,
                          updatedAt: "2026-11-17T10:00:00Z",
                          plan: "My plan",
                          windows: [{ label: "5 hours", usedPercent: 25, resetsAt: "2026-11-17T15:00:00Z" }],
                          totals: { inputTokens: 12000, outputTokens: 3000, cachedTokens: 2000, costUsd: 0.12, records: 4 },
                        },
                        null,
                        2,
                      )}
                    </pre>
                    <p className="mt-1.5">Read every two minutes; values older than 15 minutes are marked as saved.</p>
                  </details>
                </div>
              )}

              {choice && choice.kind !== "snapshot" && choice.kind !== "found" && spec?.sessions && (
                <div>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
                    aria-expanded={advanced || choice.kind === "file"}
                    onClick={() => setAdvanced((v) => !v)}
                  >
                    <ChevronDownIcon className={cn("size-3.5 transition-transform", !(advanced || choice.kind === "file") && "-rotate-90")} />
                    Token history folder
                  </button>
                  {(advanced || choice.kind === "file") && (
                    <label className="mt-2 block space-y-1.5">
                      <Input
                        className="font-mono text-[12px]"
                        value={sessionsPath}
                        placeholder={choice.kind === "folder" && folder ? `${folder.replace(/\/+$/, "")}/${spec.sessions}` : `${spec.folder}/${spec.sessions}`}
                        onChange={(e) => setSessionsPath(e.target.value)}
                      />
                      <span className="block text-[11.5px] text-muted-foreground">
                        Where this account&apos;s local sessions are written. Used for token and USD totals.
                      </span>
                    </label>
                  )}
                </div>
              )}
              {error && (
                <p className="rounded-md border px-3 py-2 text-[12px]" role="alert">
                  {error}
                </p>
              )}
            </form>
          )}
        </div>

        {step === "details" && (
          <DialogFooter className="shrink-0 border-t px-5 py-3 sm:justify-between">
            <div>
              {editing && (
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void submit("remove")}>
                  Remove from Systo
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" form={formId} disabled={busy || !choice || !label.trim()}>
                {busy ? "Saving…" : editing ? "Save" : "Connect"}
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
