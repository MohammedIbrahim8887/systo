# AI usage

Open **AI usage** in the sidebar or press `Cmd+6` on macOS. Systo shows subscription quota windows and reset times separately from local input tokens, output tokens, cached reads, and USD totals. The period selector covers the last 24 hours, 7, 30, or 90 days of local sessions; provider limits keep their own reset windows. Provider checks and local totals are cached for two minutes. Refresh does not bypass that cache.

## Accounts and providers

On first use, Systo adds Claude and Codex entries and looks for their existing local logins and session folders. Sign in using the provider app first. Credentials are read without changing them; renew expired logins in the provider app, then refresh Systo. API keys do not expose subscription limits.

Use **Connect account** to add another subscription. Give it a clear name, choose its provider, and select **Read local login**. For a work or second personal account, enter that account's own credential JSON path and its distinct sessions folder. Absolute paths and paths starting with `~/` are accepted. A selected credential file is authoritative: Systo never falls back to another login if it cannot read that file. Explicit credential files also require an explicit sessions folder for local totals. Accounts sharing a sessions folder have local totals disabled to avoid mixing their usage. Up to 50 accounts can be tracked.

| Provider | Native quota source | Local token source |
| --- | --- | --- |
| Claude | Existing Claude Code OAuth login | Claude JSONL sessions |
| Codex | Existing Codex OAuth login | Codex JSONL sessions |
| OpenCode Go | Existing OpenCode Go login | Usage snapshot |
| Cursor | Existing Cursor login | Usage snapshot |
| Antigravity CLI | Existing Antigravity OAuth login | Usage snapshot |
| Grok CLI | Existing Grok CLI login | Usage snapshot |
| Pi | Track the upstream model provider's subscription separately | Pi JSONL sessions |
| Other provider | Usage snapshot | Usage snapshot |

Native quotas depend on what the provider reports for the account. Missing windows or totals are shown as unavailable, rather than inferred. Cursor may require macOS Safe Storage access to read its encrypted login; a usage snapshot is an alternative.

Default local session folders are `~/.claude/projects`, `~/.codex/sessions`, and `~/.pi/agent/sessions`. The corresponding `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, and `PI_CODING_AGENT_DIR` settings are respected. Local history covers only activity in those files, so it may not represent usage across every device or client on the subscription. Other tools need a snapshot for token totals when their quota API does not provide them.

## Tokens and USD

Input totals include ordinary input, cached reads, and cache writes. Cached reads are also shown separately. Systo deduplicates supported response records and ignores incomplete or malformed lines while the provider app writes them.

**Reported USD** uses costs present in the session records. Where a record has no cost, Systo can estimate its API value from the model's public list price, including supported cache, long-context, and fast-mode rates. The view labels totals containing estimates **API value · estimated USD**. This is an API-equivalent estimate, not the subscription bill. Unmatched models remain unpriced and USD is marked partial when some responses lack a usable cost.

For estimates, Systo fetches the public [LiteLLM price file](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json). No credentials or session data are sent with that request. Provider quota checks send the selected login only to the corresponding provider service.

Local scans are bounded to 3,000 JSONL files and 192 MiB per scan, with a 32 MiB limit per file and a directory depth limit of 12. Reaching a scan limit marks totals as partial. Systo reads raw session files in place and never stores copies of raw session data; parsed usage records are cached in memory. Account names and source paths are saved locally in `~/Library/Application Support/Systo/ai-accounts.json` on macOS, without credential contents.

## Usage snapshot bridge

Choose **Read usage snapshot file** and enter an absolute JSON file path or one starting with `~/`. This supports other tools, exporters, and providers without a native quota source. Systo reads the file; your exporter is responsible for updating it. Do not put credentials in the snapshot.

```json
{
  "version": 1,
  "updatedAt": "2026-11-17T10:00:00Z",
  "plan": "Work subscription",
  "windows": [
    {
      "label": "5 hours",
      "usedPercent": 25,
      "resetsAt": "2026-11-17T15:00:00Z"
    }
  ],
  "totals": {
    "inputTokens": 12000,
    "outputTokens": 3000,
    "cachedTokens": 2000,
    "costUsd": 0.12,
    "records": 4,
    "since": "2026-11-01T00:00:00Z",
    "until": "2026-11-17T10:00:00Z"
  }
}
```

`version: 1`, a valid `updatedAt`, and a `windows` array are required; the array may be empty. Each window needs a label. `usedPercent` is optional and must be between 0 and 100 when present; `resetsAt` is optional. `plan` and `totals` are optional. Totals require nonnegative `inputTokens` and `outputTokens`; the other total fields are optional. Use `since` and `until` to describe the totals' period. Snapshot totals retain their own period when you change the local period selector. A snapshot older than 15 minutes is marked as saved values, with its last update time. Files must fit within the 2 MiB JSON read limit.

## Connecting discovered logins

The AI usage view suggests local Claude, Codex, and Pi logins, including separate account folders created by Sona and Synara. Connect a suggestion directly, or choose a provider and enter another login folder; Systo fills in that provider's credential and token-history paths. You can dismiss suggestions without changing the provider's login.

Accounts are grouped by provider. Quota bars show the percentage remaining and reset time. For recognized window lengths, a tick shows an even usage pace; exhaustion times are projections from usage so far, not provider guarantees. Changing the period updates local token and cost totals, while quota windows retain the provider's schedule.

## macOS overlay behavior

The Dynamic Island uses one native non-activating NSPanel on the primary display, across other applications and full-screen Spaces. It does not create copies on HDMI or other external displays. Its AppKit configuration joins all Spaces, supports full-screen companion placement, stays visible when Systo loses focus, and sits above ordinary application windows. Display geometry is checked periodically so the single island follows primary-display geometry changes. Notched displays use their notch geometry; other displays use the top center near the menu bar.

The overlay is click-through while collapsed and accepts pointer input when expanded. Regression checks cover the single-overlay lifecycle and macOS overlay policy. A live native test confirmed the island remains on screen when a separate AppKit application enters a full-screen Space; `scripts/check-island-fullscreen.swift` repeats that check and restores the previous app. Windows multi-display overlay behavior is not covered by this implementation.

## Checks

```sh
pnpm type-check
bun test tests
```

## Responsive loading, pricing, and shared history

Accounts load progressively. The first response contains saved account names; provider checks and local history scans run in the background and update independently. Concurrent windows share the same work. The island's AI usage mode uses the same report and shows quota reset windows plus 30-day local token/API-value totals.

A bundled public price snapshot (2026-11-17) supplies Claude/OpenAI rates immediately, including offline. Systo refreshes the LiteLLM public rate table in the background and saves successful downloads to its own data folder. These are estimates at current API list prices, not subscription charges or historical invoices. Unknown models are listed in account details; partial values are marked. Sources: [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing), [OpenAI pricing](https://developers.openai.com/api/docs/pricing), and the source URL recorded in `bundled-prices.json`.

Large history files are streamed rather than silently skipped. Repeated Claude message blocks use the fullest usage record; Codex repeat detection uses cumulative usage when supplied. Symbolic links are resolved before grouping histories. If accounts share the same history, its total appears once with an explicit combined-history label; Systo cannot split those sessions by subscription.

Claude homes with projects but no credential JSON are discoverable, including Sona/Synara homes. For a selected `.credentials.json` that does not exist, Systo checks only that folder's hashed Claude Keychain service. It never falls back to another account. Unknown custom locations can still be added through the login folder field.
