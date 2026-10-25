# Feature Plan: Usage & Cost Tracking

## Overview

Enterprise adopters ask what the tool costs before they approve it. Merge Mentor
should record usage per run and report it in the CLI and the web dashboard.

**Scope: tracking and reporting only.** Budget caps are deferred (see Future).

## Current State

- Provider results carry optional `tokenUsage` (`libs/domain/src/ai.ts`): input,
  output, cached, `premiumRequests`, model, durations.
- `ReviewEngine` already aggregates `TokenUsage` across all AI calls in a review
  (`mergeTokenUsage`), including PBI verification.
- Copilot SDK maps the `assistant.usage` event; OpenCode maps `info.tokens`
  (reasoning tokens are currently folded into output).
- `stats` reports PRs reviewed and comments posted, not usage. Nothing is
  persisted locally.

## Decisions

| Topic | Decision |
|---|---|
| Budget caps | None for now |
| Surfaces | `stats --usage` (CLI) and web dashboard |
| Data source | Local usage ledger, one JSON line per run |
| Ledger location | Per-user dir, e.g. `~/.merge-mentor/usage.jsonl` |
| CI / ephemeral runners | Out of scope for v1 |
| Ledger fields | tokens in/out, cached, reasoning, model, provider, PR identity (repo, number, title); per-phase/specialist breakdown is a follow-up |
| Opt-out | None; ledger is always on (local-only) |
| Retention | Unbounded for v1 |
| Dashboard | Runs on the same machine as the CLI; reads the default ledger path |
| Output | Totals first; no `--json` in v1 |
| Reasoning tokens | New optional `reasoningTokens`; `outputTokens` becomes completion-only |
| Partial data | Show totals from reported calls, mark run "partial (N of M calls reported)" |
| Cost unit | Provider-reported cost only (Copilot bills in AICs, 1 AIC = $0.01) |

## Proposal

1. **Extend `TokenUsage`**: add `reasoningTokens` and a provider-reported cost
   field (AICs for Copilot). Update `mergeTokenUsage` and the OpenCode mapper.
2. **Per-run totals** only in v1 (per-phase attribution deferred, see Future).
3. **Usage ledger** (`libs/shared`): append-only JSONL writer + reader, with
   schema version per line, tolerant of corrupt lines. Written once at the end
   of each review run.
4. **`stats --usage`**: totals and per-PR averages over a window, by model and
   provider; shows "not reported" (never zero) and "partial" markers.
5. **Web dashboard**: usage view reading the same ledger.
6. **Cost display**: show `$` derived from AICs when the provider reports them
   (`aics * 0.01`); otherwise tokens only. No bundled model price tables.

## Guardrails

- Local only; consistent with the zero-telemetry promise.
- PR title is stored locally in the ledger; document this and allow disabling
  the ledger.
- Providers that do not report usage show "not reported", never zero.

## Tests

- Aggregation across multi-agent specialists and PBI verification.
- Partial-usage flagging; missing usage.
- Ledger round-trip, corrupt-line tolerance, concurrent appends.
- Reasoning-token split in OpenCode mapper.

## Open Questions

- Does the Copilot SDK `assistant.usage` event expose AIC cost (or only tokens
  and a model multiplier)? Verify against the installed SDK version; if absent,
  decide whether to compute from tokens or show tokens only for Copilot.

## Future

- Per-phase/specialist usage breakdown (tag at `onTokenUsage` call sites).
- `stats --usage --json`; ledger retention/rotation; configurable ledger path.
- Budget caps (`--max-tokens` / `MM_AI_MAX_TOKENS`): hard stop vs. warn-only,
  overshoot handling between AI calls.
- CI story: upload/cache recipe or job-summary output.
- PR comment footer with usage.
