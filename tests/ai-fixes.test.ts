import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverLogins } from "../src/lib/server/ai/discover";
import { initialCodexTranscriptState, parseCodexTranscriptLine } from "../src/lib/server/ai/transcript";
import { loadPrices, lookupRate } from "../src/lib/server/ai/pricing";

test("discovers Claude homes with local sessions and Keychain credentials", async () => {
  const home = await mkdtemp(join(tmpdir(), "systo-discover-"));
  try {
    const folder = join(home, '.synara/userdata/provider-homes/claude/instance-636c617564655f776f726b/.claude');
    await mkdir(join(folder, 'projects'), {recursive:true});
    const found = await discoverLogins([], home);
    expect(found.find(l=>l.provider==='claude' && !l.isDefault)?.sessionsPath).toBe('~/.synara/userdata/provider-homes/claude/instance-636c617564655f776f726b/.claude/projects');
    expect(found.find(l=>l.provider==='claude' && !l.isDefault)?.label).toBe('Claude · Work');
  } finally {await rm(home,{recursive:true,force:true});}
});

test("equal-size Codex responses count separately when cumulative usage advances", () => {
  const s=initialCodexTranscriptState();
  const line=(payload:unknown,type='event_msg')=>JSON.stringify({type,timestamp:'2026-11-17T12:00:00Z',payload});
  parseCodexTranscriptLine(line({model:'gpt-5.2'},'turn_context'),s);
  const event=(total:number)=>line({type:'token_count',info:{last_token_usage:{input_tokens:100,output_tokens:10},total_token_usage:{input_tokens:total,output_tokens:total/10}}});
  expect(parseCodexTranscriptLine(event(100),s)?.kind).toBe('usage');
  expect(parseCodexTranscriptLine(event(200),s)?.kind).toBe('usage');
  expect(parseCodexTranscriptLine(event(200),s)).toBeNull();
});

test("prices remain available without a network response", async () => {
  const before=performance.now();
  const table=await loadPrices();
  expect(lookupRate(table,'claude-sonnet-4-5')).not.toBeNull();
  expect(lookupRate(table,'gpt-5.2')).not.toBeNull();
  expect(performance.now()-before).toBeLessThan(1000);
}, 12000);

import { ProgressiveCache } from "../src/lib/server/ai/progressive";
import { sessionTotals } from "../src/lib/server/ai/sessions";
import { claudeKeychainService } from "../src/lib/server/ai/providers";

test("slow account work is shared while completed accounts can render", async () => {
  const cache = new ProgressiveCache<string>();
  let resolve!: (v: string) => void;
  let calls = 0;
  const load = () => { calls++; return new Promise<string>(r => { resolve = r; }); };
  expect(cache.read('slow', load, 'loading')).toEqual({value:'loading',pending:true});
  cache.read('slow', load, 'loading');
  cache.read('fast', async () => 'ready', 'loading');
  await Bun.sleep(0);
  expect(calls).toBe(1);
  expect(cache.read('fast', async () => 'wrong', 'loading')).toEqual({value:'ready',pending:false});
  resolve('done');
  await Bun.sleep(0);
  expect(cache.read('slow', load, 'loading')).toEqual({value:'done',pending:false});
});

test("Claude prices the final streamed usage, not the first partial block", async () => {
  const root=await mkdtemp(join(tmpdir(),'systo-final-usage-'));
  try {
    const response=(output:number)=>JSON.stringify({type:'assistant',timestamp:new Date().toISOString(),message:{id:'same-message',model:'claude-sonnet-4-5',usage:{input_tokens:100,output_tokens:output}}});
    await writeFile(join(root,'session.jsonl'),[response(1),response(100)].join('\n'));
    const result=await sessionTotals({id:'fixture',provider:'claude',label:'Fixture',source:'local',sessionsPath:root},1);
    expect(result?.records).toBe(1);
    expect(result?.outputTokens).toBe(100);
    expect(result?.costUsd).toBeCloseTo(0.0018,6);
  } finally {await rm(root,{recursive:true,force:true});}
});

test("Claude secure storage uses an isolated NFC-normalized directory hash", () => {
  expect(claudeKeychainService()).toBe('Claude Code-credentials');
  expect(claudeKeychainService('/accounts/work')).not.toBe(claudeKeychainService('/accounts/personal'));
  expect(claudeKeychainService('/accounts/é')).toBe(claudeKeychainService('/accounts/e\u0301'));
});

import { groupSessionRoots } from "../src/lib/server/ai";

test("symlinked histories belong to one shared group and are counted once", async () => {
  const root=await mkdtemp(join(tmpdir(), 'systo-shared-'));
  try {
    await mkdir(join(root,'sessions'));
    await symlink(join(root,'sessions'),join(root,'alias'));
    const accounts = ['sessions','alias'].map((name) => ({id:name,provider:'codex' as const,label:name,source:'local' as const,sessionsPath:join(root,name)}));
    const {roots,resolved}=await groupSessionRoots(accounts);
    expect(roots.size).toBe(1);
    expect(resolved.get('sessions')).toBe(resolved.get('alias'));
    expect([...roots.values()][0].map(a=>a.id)).toEqual(['sessions','alias']);
  } finally {await rm(root,{recursive:true,force:true});}
});
