import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { parseSnapshot, parseUsage } from "../src/lib/server/ai/parse";
import { saveAccount, validateAccount } from "../src/lib/server/ai/accounts";
import { credential, fetchAccount } from "../src/lib/server/ai/providers";
import { sessionsRoot, sessionTotals, parsePiLine } from "../src/lib/server/ai/sessions";
import { parseRateTable, priceTokens } from "../src/lib/server/ai/pricing";
import {
  parseClaudeTranscriptLine,
  parseCodexTranscriptLine,
  initialCodexTranscriptState,
} from "../src/lib/server/ai/transcript";
import { decryptCursorToken, isSealedCursorToken } from "../src/lib/server/ai/cursor-storage";
import type { AIAccount } from "../src/lib/ai-types";
const account: AIAccount = {
  id: "work",
  provider: "codex",
  label: "Work",
  source: "local",
  credentialPath: "/missing/work/auth.json",
};

test("Codex parses actual window lengths, credit units, zero usage and reset seconds", () => {
  const parsed = parseUsage(
    "codex",
    {
      plan_type: "pro",
      rate_limit: {
        primary_window: { used_percent: 0, reset_at: 1800000000, limit_window_seconds: 18000 },
        secondary_window: {
          used_percent: 75,
          reset_after_seconds: 900,
          limit_window_seconds: 604800,
        },
      },
      credits: { balance: 42 },
    },
    0,
  );
  expect(parsed.windows).toEqual([
    { label: "5 hours", usedPercent: 0, resetsAt: new Date(1800000000000).toISOString() },
    { label: "Weekly", usedPercent: 75, resetsAt: new Date(900000).toISOString() },
  ]);
  expect(parsed.lines[0].value).toBe("42");
  expect(parsed.plan).toBe("pro");
});
test("Claude reads scoped model limits and does not invent absent windows", () => {
  const result = parseUsage("claude", {
    five_hour: { utilization: 50 },
    seven_day: null,
    limits: [
      { kind: "weekly_scoped", utilization: 10, scope: { model: { display_name: "Fable" } } },
    ],
  });
  expect(result.windows.map((w) => w.label)).toEqual(["5 hours", "Weekly · Fable"]);
  expect(parseUsage("claude", {}).windows).toEqual([]);
});
test("OpenCode, Cursor, Grok and Antigravity preserve provider-specific quota units", () => {
  expect(
    parseUsage("opencode", { usage: { monthly: { percent: 23 } } }).windows[0].usedPercent,
  ).toBe(23);
  expect(
    parseUsage("cursor", {
      planUsage: { totalPercentUsed: 34 },
      billingCycleEnd: 1800000000000,
      spendLimitUsage: { individualLimit: 2000, individualRemaining: 1800 },
    }).lines[0].value,
  ).toBe("$2.00 / $20.00");
  expect(
    parseUsage("antigravity", {
      groups: [
        {
          buckets: [
            { bucketId: "3p-5h", remainingFraction: 0.75 },
            { bucketId: "3p-5h", remainingFraction: 0.75 },
          ],
        },
      ],
    }).windows,
  ).toHaveLength(1);
  expect(
    parseUsage("grok", { config: { creditUsagePercent: 0.25, currentPeriod: { type: "weekly" } } })
      .windows[0],
  ).toMatchObject({ label: "Weekly", usedPercent: 25 });
});
test("snapshot bridge validates format, does not invent missing USD", () => {
  const result = parseSnapshot({
    version: 1,
    updatedAt: "2026-11-17T10:00:00Z",
    windows: [],
    totals: { inputTokens: 0, outputTokens: 0 },
  });
  expect(result.totals?.costUsd).toBeUndefined();
  expect(() => parseSnapshot({ version: 1, windows: [] })).toThrow();
  expect(() =>
    parseSnapshot({
      version: 1,
      updatedAt: new Date().toISOString(),
      windows: [{ label: "Bad", usedPercent: -10 }],
    }),
  ).toThrow();
});
test("account validation accepts multiple provider accounts and rejects invalid paths", () => {
  expect(validateAccount({ ...account, credentialPath: "~/accounts/work/auth.json" }).id).toBe(
    "work",
  );
  expect(() => validateAccount({ ...account, credentialPath: "auth.json" })).toThrow();
  expect(() => validateAccount({ ...account, source: "snapshot" })).toThrow();
  expect(sessionsRoot(account)).toBeUndefined();
});
test("explicit missing credentials never fall back to the ambient account", async () => {
  await expect(credential(account)).rejects.toThrow();
  const result = await fetchAccount(account);
  expect(result.status).toBe("error");
  expect(result.windows).toEqual([]);
  expect(JSON.stringify(result)).not.toContain("access_token");
});
test("Claude cache tokens are disjoint and Codex repeated events are not counted twice", () => {
  const claude = parseClaudeTranscriptLine(
    JSON.stringify({
      type: "assistant",
      timestamp: new Date().toISOString(),
      message: {
        id: "1",
        model: "test",
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_read_input_tokens: 7,
          cache_creation_input_tokens: 3,
        },
      },
    }),
  );
  expect(claude?.kind === "usage" && claude.tokens).toMatchObject({
    inputTokens: 10,
    cacheReadTokens: 7,
    cacheWrite5mTokens: 3,
    outputTokens: 2,
  });
  const state = initialCodexTranscriptState();
  parseCodexTranscriptLine(
    JSON.stringify({ type: "turn_context", payload: { model: "test" } }),
    state,
  );
  const event = JSON.stringify({
    timestamp: new Date().toISOString(),
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10 } },
    },
  });
  const result = parseCodexTranscriptLine(event, state);
  expect(result?.kind === "usage" && result.tokens.inputTokens).toBe(20);
  expect(parseCodexTranscriptLine(event, state)).toBeNull();
});
test("model prices handle cache reads and unknown models", () => {
  const table = parseRateTable({
    "test-model": {
      input_cost_per_token: 0.001,
      output_cost_per_token: 0.002,
      cache_read_input_token_cost: 0.0001,
    },
  });
  expect(
    priceTokens(table, "test-model", {
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 5,
      cacheWriteTokens: 0,
    }),
  ).toBeCloseTo(0.0145);
  expect(
    priceTokens(table, "unknown", {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }),
  ).toBeNull();
});
test("Pi reported cost and encrypted Cursor login can be read without exposing keys", () => {
  expect(
    parsePiLine(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        message: {
          role: "assistant",
          model: "test",
          usage: { input: 10, output: 3, cost: { total: 0.01 } },
        },
      }),
    )?.reportedCostUsd,
  ).toBe(0.01);
  const key = pbkdf2Sync("test-password", "saltysalt", 1003, 16, "sha1");
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
  const blob = Buffer.concat([Buffer.from("v10"), cipher.update("test-token"), cipher.final()]);
  const value = `cursor-safe-storage:v1:${blob.toString("base64")}`;
  expect(isSealedCursorToken(value)).toBe(true);
  expect(decryptCursorToken(value, "test-password")).toBe("test-token");
  expect(decryptCursorToken(value, "wrong")).toBeUndefined();
});
test("session totals honor the chosen account folder, date range, reported USD and duplicate responses", async () => {
  const root = await mkdtemp(join(tmpdir(), "systo-ai-test-"));
  try {
    await mkdir(join(root, "project"));
    const response = (id: string, age: number) =>
      JSON.stringify({
        type: "assistant",
        timestamp: new Date(Date.now() - age * 86400000).toISOString(),
        costUSD: 0.02,
        message: {
          id,
          model: "test",
          usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 6 },
        },
      });
    const file = join(root, "project", "session.jsonl");
    await writeFile(
      file,
      [response("one", 0), response("one", 0), response("old", 10), "{partial"].join("\n"),
    );
    const a: AIAccount = { ...account, provider: "claude", sessionsPath: root };
    const totals = await sessionTotals(a, 7);
    expect(totals).toMatchObject({
      records: 1,
      inputTokens: 16,
      outputTokens: 4,
      cachedTokens: 6,
      costUsd: 0.02,
      costRecords: 1,
      estimatedCostRecords: 0,
    });
    await writeFile(file, response("new", 0));
    expect((await sessionTotals(a, 7))?.records).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a second subscription requires a distinct login, edits retain account identity", () => {
  expect(() => saveAccount([account], { ...account, id: "another" })).toThrow("already tracked");
  expect(saveAccount([account], { ...account, label: "Renamed" })).toHaveLength(1);
  expect(
    saveAccount([account], {
      ...account,
      id: "another",
      credentialPath: "/accounts/personal/auth.json",
    }),
  ).toHaveLength(2);
});

test("provider requests use the selected account token and return only normalized usage", async () => {
  const root = await mkdtemp(join(tmpdir(), "systo-ai-auth-"));
  const originalFetch = globalThis.fetch;
  const sent: string[] = [];
  try {
    const authPath = join(root, "auth.json");
    await writeFile(
      authPath,
      JSON.stringify({
        tokens: { access_token: "fixture-work-token", account_id: "work-account" },
      }),
    );
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe("https://chatgpt.com/backend-api/wham/usage");
      expect(init?.redirect).toBe("error");
      const headers = new Headers(init?.headers);
      expect(headers.get("ChatGPT-Account-Id")).toBe("work-account");
      sent.push(headers.get("Authorization") || "");
      return Response.json({
        plan_type: "plus",
        rate_limit: { primary_window: { used_percent: 17 } },
      });
    }) as typeof fetch;
    const result = await fetchAccount({ ...account, credentialPath: authPath });
    expect(sent).toEqual(["Bearer fixture-work-token"]);
    expect(result).toMatchObject({
      status: "ok",
      plan: "plus",
      windows: [{ label: "5 hours", usedPercent: 17 }],
    });
    expect(JSON.stringify(result)).not.toContain("fixture-work-token");
    globalThis.fetch = (async () =>
      new Response('{"error":"expired"}', {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    expect((await fetchAccount({ ...account, credentialPath: authPath })).status).toBe(
      "needs-auth",
    );
    globalThis.fetch = (async () => new Response("wait", { status: 429 })) as typeof fetch;
    expect((await fetchAccount({ ...account, credentialPath: authPath })).status).toBe("error");
    const snapshotPath = join(root, "snapshot.json");
    await writeFile(
      snapshotPath,
      JSON.stringify({
        version: 1,
        updatedAt: "2020-01-01T00:00:00Z",
        windows: [{ label: "Weekly", usedPercent: 30 }],
      }),
    );
    const snapshot = await fetchAccount({
      ...account,
      source: "snapshot",
      usagePath: snapshotPath,
    });
    expect(snapshot.stale).toBe(true);
    expect(snapshot.windows[0].usedPercent).toBe(30);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});
