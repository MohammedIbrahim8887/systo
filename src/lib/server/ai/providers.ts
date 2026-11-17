import { isSealedCursorToken, unsealCursorToken } from "./cursor-storage";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import type { AIAccount, AIUsage } from "../../ai-types";
import { run } from "../exec";
import { openDb } from "../sqlite";
import { expandPath, readJson } from "./accounts";
import { parseSnapshot, parseUsage, record, str } from "./parse";

export function claudeKeychainService(directory?: string) {
  return "Claude Code-credentials" + (directory ? `-${createHash("sha256").update(directory.normalize("NFC")).digest("hex").slice(0, 8)}` : "");
}

async function keychain(service: string): Promise<unknown> {
  if (process.platform !== "darwin") return null;
  const result = await run(
    "/usr/bin/security",
    ["find-generic-password", "-s", service, "-w"],
    3000,
  );
  if (result.code !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    const value = result.stdout.trim();
    if (/^(?:[0-9a-f]{2})+$/i.test(value)) {
      try { return JSON.parse(Buffer.from(value, "hex").toString("utf8")); } catch { /* Not a JSON credential. */ }
    }
    return value;
  }
}
async function firstJson(paths: string[]) {
  for (const path of paths) {
    try {
      return await readJson(path);
    } catch {
      /* Try known credential locations only. */
    }
  }
  return null;
}
export async function credential(a: AIAccount): Promise<Record<string, unknown>> {
  // A selected file is authoritative. Never borrow another account's login.
  if (a.credentialPath) {
    try { return record(await readJson(a.credentialPath)); }
    catch (error) {
      // Only Claude's standard missing file may use that same folder's Keychain entry.
      // Never fall back to the default login or hide malformed-file errors.
      if (a.provider !== "claude" || basename(a.credentialPath) !== ".credentials.json" || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return record(await keychain(claudeKeychainService(dirname(expandPath(a.credentialPath)))));
    }
  }
  const home = homedir();
  switch (a.provider) {
    case "codex":
      return record(
        (await firstJson([
          ...(process.env.CODEX_HOME ? [join(process.env.CODEX_HOME, "auth.json")] : []),
          join(home, ".codex/auth.json"),
          join(home, ".config/codex/auth.json"),
        ])) || (await keychain("Codex Auth")),
      );
    case "claude":
      return record(
        (await firstJson([
          join(process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR || join(home, ".claude"), ".credentials.json"),
        ])) || (await keychain(claudeKeychainService(process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR))),
      );
    case "opencode":
      return record(
        await firstJson([
          join(process.env.XDG_DATA_HOME || join(home, ".local/share"), "opencode/auth.json"),
        ]),
      );
    case "pi":
      return record(
        await firstJson([
          join(process.env.PI_CODING_AGENT_DIR || join(home, ".pi/agent"), "auth.json"),
        ]),
      );
    case "grok":
      return record(
        await firstJson([join(process.env.GROK_HOME || join(home, ".grok"), "auth.json")]),
      );
    case "antigravity":
      return record(
        await firstJson([
          join(
            process.env.GEMINI_CONFIG_DIR || join(home, ".gemini"),
            "antigravity-cli/antigravity-oauth-token",
          ),
          join(
            process.env.GEMINI_CONFIG_DIR || join(home, ".gemini"),
            "antigravity-cli/oauth_creds.json",
          ),
          join(home, ".gemini/oauth_creds.json"),
        ]),
      );
    case "cursor": {
      const dbPath =
        process.platform === "darwin"
          ? join(home, "Library/Application Support/Cursor/User/globalStorage/state.vscdb")
          : process.platform === "win32"
            ? join(
                process.env.APPDATA || join(home, "AppData/Roaming"),
                "Cursor/User/globalStorage/state.vscdb",
              )
            : join(
                process.env.XDG_CONFIG_HOME || join(home, ".config"),
                "Cursor/User/globalStorage/state.vscdb",
              );
      // Existing database only; do not create a Cursor profile while probing.
      const { stat } = await import("node:fs/promises");
      try {
        await stat(dbPath);
        const db = await openDb(dbPath);
        try {
          const rows = db.all<{ key: string; value: string }>(
            "SELECT key, value FROM ItemTable WHERE key IN ('cursorAuth/accessToken', 'cursorAuth/stripeMembershipType')",
          );
          return Object.fromEntries(rows.map((r) => [r.key, r.value]));
        } finally {
          db.close();
        }
      } catch {
        return {};
      }
    }
    default:
      return {};
  }
}
class ProviderError extends Error {
  constructor(
    public status: AIUsage["status"],
    message: string,
  ) {
    super(message);
  }
}
async function json(
  url: string,
  token: string,
  options: { post?: unknown; headers?: Record<string, string> } = {},
) {
  const res = await fetch(url, {
    method: options.post === undefined ? "GET" : "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: options.post === undefined ? undefined : JSON.stringify(options.post),
  });
  if (!res.ok) {
    if (
      res.status === 401 ||
      (res.status === 403 && /json/.test(res.headers.get("content-type") || ""))
    )
      throw new ProviderError(
        "needs-auth",
        "Sign in again in the provider app, then refresh here.",
      );
    throw new ProviderError(
      "error",
      res.status === 429
        ? "Provider is throttling usage checks. Retrying in a few minutes."
        : `Provider usage check failed (HTTP ${res.status}). Try again later.`,
    );
  }
  const text = await res.text();
  if (text.length > 2 * 1024 * 1024)
    throw new ProviderError("error", "Provider usage response is too large.");
  return JSON.parse(text) as unknown;
}
export async function fetchAccount(a: AIAccount): Promise<AIUsage> {
  const base: AIUsage = {
    account: a,
    status: "ok",
    checkedAt: new Date().toISOString(),
    windows: [],
    lines: [],
  };
  try {
    if (a.source === "snapshot") {
      const parsed = parseSnapshot(await readJson(a.usagePath!));
      return { ...base, ...parsed, stale: Date.now() - Date.parse(parsed.updatedAt!) > 15 * 60000 };
    }
    const c = await credential(a);
    let token: string | undefined, payload: unknown, plan: string | undefined;
    switch (a.provider) {
      case "codex": {
        const tokens = record(c.tokens);
        token = str(tokens.access_token);
        if (token)
          payload = await json("https://chatgpt.com/backend-api/wham/usage", token, {
            headers: str(tokens.account_id)
              ? { "ChatGPT-Account-Id": str(tokens.account_id)! }
              : {},
          });
        break;
      }
      case "claude": {
        const oauth = record(c.claudeAiOauth);
        token = str(oauth.accessToken);
        plan = str(oauth.subscriptionType);
        if (token)
          payload = await json("https://api.anthropic.com/api/oauth/usage", token, {
            headers: { "anthropic-beta": "oauth-2025-04-20", "User-Agent": "claude-code/2.1.69" },
          });
        break;
      }
      case "opencode":
        token = str(record(c["opencode-go"]).key) || str(record(c.opencode).key);
        if (token) payload = await json("https://opencode.ai/zen/go/v1/usage", token);
        break;
      case "cursor":
        token = str(c["cursorAuth/accessToken"]) || str(c.accessToken);
        plan = str(c["cursorAuth/stripeMembershipType"]);
        if (token) {
          if (isSealedCursorToken(token)) {
            const unsealed = a.credentialPath ? undefined : await unsealCursorToken(token);
            if (!unsealed)
              throw new ProviderError(
                "unsupported",
                "Could not read Cursor’s encrypted login. Allow Cursor Safe Storage access on macOS, or connect a usage snapshot.",
              );
            token = unsealed;
          }
          payload = await json(
            "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
            token,
            { post: {}, headers: { "Connect-Protocol-Version": "1" } },
          );
        }
        break;
      case "antigravity": {
        token = str(record(c.token).access_token) || str(c.access_token);
        if (token) {
          const assist = record(
            await json("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", token, {
              post: {
                metadata: {
                  ideType: "GEMINI_CLI",
                  platform: "PLATFORM_UNSPECIFIED",
                  pluginType: "GEMINI",
                },
              },
            }),
          );
          plan = str(record(assist.paidTier).name) || str(record(assist.currentTier).name);
          const project =
            str(assist.cloudaicompanionProject) || str(record(assist.cloudaicompanionProject).id);
          try {
            payload = await json(
              "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
              token,
              { post: project ? { project } : {} },
            );
            if (!Array.isArray(record(payload).groups))
              payload = await json(
                "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
                token,
                { post: project ? { project } : {} },
              );
          } catch (error) {
            if (error instanceof ProviderError && error.status === "needs-auth") throw error;
            payload = await json(
              "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
              token,
              { post: project ? { project } : {} },
            );
          }
        }
        break;
      }
      case "grok": {
        const entry = Object.values(c)
          .map(record)
          .find((r) => str(r.key));
        token = str(c.access_token) || str(entry?.key);
        if (token)
          payload = await json("https://cli-chat-proxy.grok.com/v1/billing?format=credits", token, {
            headers: { "x-xai-token-auth": "xai-grok-cli" },
          });
        break;
      }
      case "pi":
        throw new ProviderError(
          "unsupported",
          "Pi uses the connected model provider's limits. Track that subscription separately; select a Pi sessions folder below for tokens and reported USD, or connect a usage snapshot.",
        );
      default:
        throw new ProviderError("unsupported", "Connect this provider through a usage snapshot.");
    }
    if (!token)
      throw new ProviderError(
        "needs-auth",
        "No supported login found. Sign in in the provider app or choose a credential file. API keys do not expose subscription limits.",
      );
    const parsed = parseUsage(a.provider, payload);
    return {
      ...base,
      ...parsed,
      plan: parsed.plan || plan,
      updatedAt: base.checkedAt,
      detail: parsed.windows.length
        ? undefined
        : "The provider did not report quota windows for this account.",
    };
  } catch (error) {
    return {
      ...base,
      status: error instanceof ProviderError ? error.status : "error",
      detail:
        error instanceof ProviderError
          ? error.message
          : a.source === "snapshot"
            ? "Could not read this usage snapshot. Check its path and version 1 format."
            : "Could not read the login or reach the provider. Check the credential path and try again.",
    };
  }
}
