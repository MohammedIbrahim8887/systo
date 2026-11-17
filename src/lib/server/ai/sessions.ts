import { readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AIAccount, AITotals } from "../../ai-types";
import { expandPath } from "./accounts";
import { record, num, str } from "./parse";
import {
  initialCodexTranscriptState,
  transcriptTokenTotal,
  parseClaudeTranscriptLine,
  parseCodexTranscriptLine,
  type TranscriptUsageRecord,
} from "./transcript";
import { loadPrices, priceTranscriptUsage } from "./pricing";

export function sessionsRoot(a: AIAccount): string | undefined {
  if (a.sessionsPath) return expandPath(a.sessionsPath);
  // Explicit credential files must opt into a matching history directory.
  if (a.credentialPath) return undefined;
  if (a.provider === "claude")
    return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects");
  if (a.provider === "codex")
    return join(process.env.CODEX_HOME || join(homedir(), ".codex"), "sessions");
  if (a.provider === "pi")
    return join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi/agent"), "sessions");
  return undefined;
}
interface ParsedFile {
  mtime: number;
  size: number;
  rows: TranscriptUsageRecord[];
}
const files = new Map<string, ParsedFile>();
export function parsePiLine(line: string): TranscriptUsageRecord | null {
  try {
    const r = record(JSON.parse(line)),
      message = record(r.message),
      u = record(message.usage);
    if (
      message.role !== "assistant" ||
      !Object.keys(u).length ||
      !str(r.timestamp) ||
      !Number.isFinite(Date.parse(str(r.timestamp)!))
    )
      return null;
    return {
      kind: "usage",
      provider: "claudeAgent",
      timestampMs: Date.parse(str(r.timestamp)!),
      model: str(message.model) || "",
      cwd: "",
      tokens: {
        inputTokens: num(u.input) ?? 0,
        outputTokens: num(u.output) ?? 0,
        cacheReadTokens: num(u.cacheRead) ?? 0,
        cacheWrite5mTokens: num(u.cacheWrite) ?? 0,
        cacheWrite1hTokens: 0,
      },
      reportedCostUsd: num(record(u.cost).total) ?? null,
      fast: false,
      failed: false,
      dedupeKey: str(r.id) ? `pi:${str(r.id)}` : null,
    };
  } catch {
    return null;
  }
}
export async function sessionTotals(a: AIAccount, days: number): Promise<AITotals | undefined> {
  const root = sessionsRoot(a);
  if (!root || !["claude", "codex", "pi"].includes(a.provider)) return undefined;
  try {
    if (!(await stat(root)).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  const paths: { path: string; mtime: number; size: number }[] = [];
  let truncated = false;
  const walk = async (directory: string, depth: number) => {
    if (depth > 12) {
      truncated = true;
      return;
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (paths.length >= 20000) {
        truncated = true;
        break;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory())
        await walk(path, depth + 1).catch(() => {
          truncated = true;
        });
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const s = await stat(path);
        paths.push({ path, mtime: s.mtimeMs, size: s.size });
      }
    }
  };
  await walk(root, 0);
  paths.sort((a, b) => b.mtime - a.mtime);
  const now = Date.now(),
    since = now - days * 86400000;
  const rows: TranscriptUsageRecord[] = [];
  const seen = new Map<string, number>();
  for (const file of paths) {
    if (file.mtime < since) continue;

    let parsed = files.get(file.path);
    if (!parsed || parsed.mtime !== file.mtime || parsed.size !== file.size) {
      const next: TranscriptUsageRecord[] = [];
      const state = initialCodexTranscriptState();
      const input = createReadStream(file.path, { encoding: "utf8" });
      const lines = createInterface({ input, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          // Skip tool output before JSON decoding; only these lines affect usage/model state.
          if (a.provider === "claude" && (!line.includes('"usage"') || !line.includes('"assistant"'))) continue;
          if (a.provider === "codex" && !line.includes('"token_count"') && !line.includes('"turn_context"') && !line.includes('"session_meta"')) continue;
          if (line.length > 2 * 1024 * 1024) {
            truncated = true;
            continue;
          }
          try {
            const r =
              a.provider === "codex"
                ? parseCodexTranscriptLine(line, state)
                : a.provider === "claude"
                  ? parseClaudeTranscriptLine(line)
                  : parsePiLine(line);
            if (r?.kind === "usage" && r.model !== "<synthetic>" && transcriptTokenTotal(r.tokens) > 0) {
              // A stable session id in the file name prevents replayed archives counting twice.
              next.push({
                ...r,
                dedupeKey:
                  r.dedupeKey || `${a.provider}:${file.path.split(/[\\/]/).pop()}:${next.length}`,
              });
            }
          } catch {
            /* Ignore partial/malformed lines while the CLI writes. */
          }
        }
      } finally {
        lines.close();
        input.destroy();
      }
      parsed = { mtime: file.mtime, size: file.size, rows: next };
      if (files.size >= 3000) files.delete(files.keys().next().value!);
      files.set(file.path, parsed);
    }
    for (const r of parsed.rows) {
      if (r.timestampMs < since || r.timestampMs > now) continue;
      const previous = r.dedupeKey ? seen.get(r.dedupeKey) : undefined;
      if (previous !== undefined) {
        // Streamed Claude blocks can repeat a message with fuller final usage.
        if (transcriptTokenTotal(r.tokens) >= transcriptTokenTotal(rows[previous].tokens)) rows[previous] = r;
      } else {
        if (r.dedupeKey) seen.set(r.dedupeKey, rows.length);
        rows.push(r);
      }
    }
  }
  const prices = rows.some((r) => r.reportedCostUsd === null) ? await loadPrices() : new Map();
  const totals: AITotals = {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    records: rows.length,
    since: new Date(since).toISOString(),
    until: new Date(now).toISOString(),
    truncated,
    costRecords: 0,
    estimatedCostRecords: 0,
    unpricedModels: [],
  };
  let usd = 0;
  for (const r of rows) {
    const t = r.tokens;
    totals.inputTokens +=
      t.inputTokens + t.cacheReadTokens + t.cacheWrite5mTokens + t.cacheWrite1hTokens;
    totals.cachedTokens += t.cacheReadTokens;
    totals.outputTokens += t.outputTokens;
    if (r.reportedCostUsd !== null) {
      usd += r.reportedCostUsd;
      totals.costRecords!++;
    } else {
      const cost = priceTranscriptUsage(prices, r);
      if (cost !== null) {
        usd += cost;
        totals.costRecords!++;
        totals.estimatedCostRecords!++;
      } else if (!totals.unpricedModels!.includes(r.model)) {
        totals.unpricedModels!.push(r.model || "Unknown model");
      }
    }
  }
  if (totals.costRecords) totals.costUsd = usd;
  return totals;
}
