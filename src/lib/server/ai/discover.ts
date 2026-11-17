import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { AIAccount, AIDiscoveredLogin, AIProvider } from "../../ai-types";
import { AI_NAMES } from "../../ai-types";
import { expandPath } from "./accounts";
import { record, str } from "./parse";

const exists = (path: string) => stat(path).then(() => true, () => false);
const list = (path: string) => readdir(path).catch(() => [] as string[]);

/** `~/…` for display and storage, so saved settings stay portable across user names. */
export function tildePath(path: string, home = homedir()) {
  return path === home ? "~" : path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

/** "codex_personal-b78eaba6a407" → "personal"; ".claude-work" → "work". */
export function folderLabel(provider: AIProvider, folder: string) {
  const raw = basename(folder);
  const decoded = /^instance-[0-9a-f]+$/i.test(raw) ? Buffer.from(raw.slice(9), "hex").toString("utf8") : raw;
  const name = decoded
    .replace(/^\./, "")
    .replace(new RegExp(`^${provider === "claude" ? "claude" : provider}[-_.]?`, "i"), "")
    .replace(/[-_][0-9a-f]{8,}$/i, "")
    .replace(/[-_.]+/g, " ")
    .trim();
  return name ? `${AI_NAMES[provider]} · ${name[0].toUpperCase()}${name.slice(1)}` : `My ${AI_NAMES[provider]}`;
}

function jwtEmail(token: unknown) {
  const payload = typeof token === "string" ? token.split(".")[1] : undefined;
  if (!payload) return undefined;
  try {
    const claims = record(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return str(claims.email) || str(record(claims["https://api.openai.com/profile"]).email);
  } catch {
    return undefined;
  }
}

/** Identity for de-duplication and display. Never returns tokens. */
async function identity(provider: AIProvider, file: string): Promise<{ key?: string; email?: string; plan?: string }> {
  try {
    if ((await stat(file)).size > 512 * 1024) return {};
    const json = record(JSON.parse(await readFile(file, "utf8")));
    if (provider === "codex") {
      const tokens = record(json.tokens);
      return { key: str(tokens.account_id), email: jwtEmail(tokens.id_token) };
    }
    if (provider === "claude") {
      return { plan: str(record(json.claudeAiOauth).subscriptionType) };
    }
  } catch {
    /* Unreadable logins are still offered; the account row reports the problem. */
  }
  return {};
}

interface Candidate {
  provider: AIProvider;
  dir: string;
  credential: string;
  sessions: string;
  isDefault: boolean;
  via?: string;
}

async function candidates(home: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const entries = await list(home);
  const codexDefault = process.env.CODEX_HOME || join(home, ".codex");
  const claudeDefault = process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const codex = (dir: string, isDefault = false, via?: string) =>
    out.push({ provider: "codex", dir, credential: join(dir, "auth.json"), sessions: join(dir, "sessions"), isDefault, via });
  const claude = (dir: string, isDefault = false, via?: string) =>
    out.push({ provider: "claude", dir, credential: join(dir, ".credentials.json"), sessions: join(dir, "projects"), isDefault, via });
  codex(codexDefault, true);
  claude(claudeDefault, true);
  if (claudeDefault !== join(home, ".claude")) claude(join(home, ".claude"));
  claude(join(home, ".config/claude"));
  out.push({
    provider: "pi",
    dir: process.env.PI_CODING_AGENT_DIR || join(home, ".pi/agent"),
    credential: join(process.env.PI_CODING_AGENT_DIR || join(home, ".pi/agent"), "auth.json"),
    sessions: join(process.env.PI_CODING_AGENT_DIR || join(home, ".pi/agent"), "sessions"),
    isDefault: true,
  });
  for (const name of entries) {
    if (/^\.codex[-_.]/.test(name)) codex(join(home, name));
    if (/^\.claude[-_.]/.test(name) && !/\.json/.test(name)) claude(join(home, name));
  }
  // Account homes created by Sona and Synara, which keep each subscription in its own folder.
  for (const app of [".synara", ".sona"]) {
    const via = app === ".synara" ? "Synara" : "Sona";
    const accounts = join(home, app, "codex-home-overlay/accounts");
    for (const name of await list(accounts)) codex(join(accounts, name), false, via);
    const claudeHomes = join(home, app, "userdata/provider-homes/claude");
    for (const name of await list(claudeHomes)) {
      claude(join(claudeHomes, name, ".claude"), false, via);
      claude(join(claudeHomes, name), false, via);
    }
  }
  return out;
}

const tracksDefault = (accounts: AIAccount[], provider: AIProvider) =>
  accounts.some((a) => a.provider === provider && a.source === "local" && !a.credentialPath);

/**
 * Logins on this Mac that could become accounts. Default logins (which may live in the Keychain)
 * are always offered; other folders only when they hold a credential file.
 */
export async function discoverLogins(accounts: AIAccount[], home = homedir()): Promise<AIDiscoveredLogin[]> {
  const tracked = new Set<string>();
  for (const a of accounts) {
    if (a.source !== "local" || !a.credentialPath) continue;
    const path = expandPath(a.credentialPath);
    tracked.add(path);
    tracked.add(await realpath(path).catch(() => path));
  }
  const seenFiles = new Set<string>();
  const seenIdentity = new Set<string>();
  const found: AIDiscoveredLogin[] = [];
  for (const c of await candidates(home)) {
    const hasCredential = await exists(c.credential);
    if (!c.isDefault && !hasCredential && !(c.provider === "claude" && await exists(c.sessions))) continue;
    if (c.isDefault && c.provider === "pi" && !hasCredential && !(await exists(c.sessions))) continue;
    if (c.isDefault && c.provider !== "pi" && !hasCredential && !(await exists(c.dir))) continue;
    const real = await realpath(c.credential).catch(() => c.credential);
    if (seenFiles.has(real)) continue;
    seenFiles.add(real);
    const who = hasCredential ? await identity(c.provider, c.credential) : {};
    const idKey = who.key && `${c.provider}:${who.key}:${who.email || ""}`;
    if (idKey && seenIdentity.has(idKey)) continue;
    if (idKey) seenIdentity.add(idKey);
    const alreadyTracked = c.isDefault ? tracksDefault(accounts, c.provider) : tracked.has(c.credential) || tracked.has(real);
    found.push({
      id: `${c.provider}:${tildePath(c.dir, home)}`,
      provider: c.provider,
      label: c.isDefault ? `My ${AI_NAMES[c.provider]}` : folderLabel(c.provider, c.dir.endsWith("/.claude") ? dirname(c.dir) : c.dir),
      folder: tildePath(c.dir, home),
      credentialPath: c.isDefault ? undefined : tildePath(c.credential, home),
      sessionsPath: c.isDefault ? undefined : (await exists(c.sessions)) ? tildePath(c.sessions, home) : undefined,
      isDefault: c.isDefault,
      email: who.email,
      plan: who.plan,
      via: c.via,
      tracked: alreadyTracked,
    });
  }
  return found;
}
