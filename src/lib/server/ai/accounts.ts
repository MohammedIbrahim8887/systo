import { readFile, mkdir, rename, writeFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { AI_PROVIDERS, type AIAccount } from "../../ai-types";
import { appDataFile, appDataDir } from "../paths";
import { record, str } from "./parse";

export function expandPath(path: string) {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}
export async function readJson(path: string): Promise<unknown> {
  const file = expandPath(path);
  if ((await stat(file)).size > 2 * 1024 * 1024) throw new Error("JSON file exceeds 2 MB.");
  return JSON.parse(await readFile(file, "utf8"));
}
export function validateAccount(input: unknown): AIAccount {
  const a = record(input);
  if (
    !AI_PROVIDERS.includes(a.provider as AIAccount["provider"]) ||
    !str(a.label) ||
    str(a.label)!.length > 100 ||
    !["local", "snapshot"].includes(String(a.source))
  )
    throw new Error("Choose a provider, account name and source.");
  const paths: Partial<AIAccount> = {};
  for (const key of ["credentialPath", "sessionsPath", "usagePath"] as const) {
    if (a[key] === undefined || a[key] === "") continue;
    const path = str(a[key]);
    if (!path || path.length > 2048 || !isAbsolute(expandPath(path)) || /[\r\n\0]/.test(path))
      throw new Error("Use an absolute file path or a path starting with ~/.");
    paths[key] = path;
  }
  if (a.source === "snapshot" && !paths.usagePath) throw new Error("Choose a usage snapshot file.");
  if (a.provider === "custom" && a.source !== "snapshot")
    throw new Error("Other providers connect through a usage snapshot.");
  return {
    id: typeof a.id === "string" && /^[\w-]{1,80}$/.test(a.id) ? a.id : randomUUID(),
    provider: a.provider as AIAccount["provider"],
    label: str(a.label)!,
    source: a.source as AIAccount["source"],
    ...paths,
  };
}
export async function loadAccounts(): Promise<AIAccount[]> {
  try {
    const raw = await readJson(appDataFile("ai-accounts.json"));
    if (!Array.isArray(raw)) throw new Error("Invalid account settings.");
    return raw.map(validateAccount);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Could not read AI accounts. Check ai-accounts.json in Systo's data folder.");
    return ["claude", "codex"].map((provider) => ({
      id: `default-${provider}`,
      label: `My ${provider === "claude" ? "Claude" : "Codex"}`,
      provider: provider as AIAccount["provider"],
      source: "local",
    }));
  }
}
let writes = Promise.resolve();
export async function changeAccounts(change: (accounts: AIAccount[]) => AIAccount[]) {
  const result = writes.then(async () => {
    const next = change(await loadAccounts());
    if (next.length > 50) throw new Error("You can track up to 50 accounts.");
    await mkdir(appDataDir(), { recursive: true, mode: 0o700 });
    const temp = appDataFile(`ai-accounts-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(temp, appDataFile("ai-accounts.json"));
  });
  writes = result.catch(() => {});
  return result;
}

/** Reject aliases of an existing login rather than presenting them as another subscription. */
export function saveAccount(accounts: AIAccount[], account: AIAccount): AIAccount[] {
  const others = accounts.filter((a) => a.id !== account.id);
  if (
    account.source === "local" &&
    others.some(
      (a) =>
        a.source === "local" &&
        a.provider === account.provider &&
        (a.credentialPath ? expandPath(a.credentialPath) : "default") ===
          (account.credentialPath ? expandPath(account.credentialPath) : "default"),
    )
  ) {
    throw new Error(
      "That provider login is already tracked. Choose a separate credential file for another subscription.",
    );
  }
  return [...others, account];
}
