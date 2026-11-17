import { expect, test } from "bun:test";
import { pathsForFolder, folderForAccount, pace, resetText, windowSpanMs } from "../src/lib/ai-display";
import { folderLabel, tildePath } from "../src/lib/server/ai/discover";

test("login folders map to separate credential and history files", () => {
  expect(pathsForFolder("codex", " ~/work/ ")).toEqual({ credentialPath: "~/work/auth.json", sessionsPath: "~/work/sessions" });
  expect(pathsForFolder("claude", "~/claude-work")).toEqual({ credentialPath: "~/claude-work/.credentials.json", sessionsPath: "~/claude-work/projects" });
  expect(pathsForFolder("codex", "~/.codex/")).toEqual({});
  expect(folderForAccount({provider: "antigravity", credentialPath: "~/work/antigravity-cli/oauth_creds.json"})).toBe("~/work");
  expect(folderForAccount({provider: "codex", credentialPath: "~/custom.json"})).toBeUndefined();
});

test("pace projects exhaustion only within a known active quota window", () => {
  const now = Date.parse("2026-11-17T12:00:00Z");
  const w = {label: "5 hours", usedPercent: 80, resetsAt: "2026-11-17T14:30:00Z"};
  expect(pace(w, now)).toEqual({expectedUsed: 50, status: "ahead", runsOutIn: 2250000});
  expect(pace({...w, label: "Unknown"}, now)).toBeUndefined();
  expect(pace({...w, resetsAt: "2026-11-16T12:00:00Z"}, now)).toBeUndefined();
  expect(windowSpanMs("Weekly")).toBe(7 * 86400000);
  expect(resetText(w.resetsAt, now)).toBe("Resets in 2h 30m");
});

test("discovery display names strip account hashes and preserve unrelated paths", () => {
  expect(folderLabel("codex", "/accounts/codex_personal-b78eaba6a407")).toBe("Codex · Personal");
  expect(tildePath("/home/user/.codex", "/home/user")).toBe("~/.codex");
  expect(tildePath("/home/username/.codex", "/home/user")).toBe("/home/username/.codex");
});
