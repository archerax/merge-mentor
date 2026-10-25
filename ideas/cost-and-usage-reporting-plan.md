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

| Topic                  | Decision                                                                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Budget caps            | None for now                                                                                                                                                                                                                                                                                |
| Surfaces               | `stats --usage` (CLI) and web dashboard                                                                                                                                                                                                                                                     |
| Data source            | JSON sidecar next to each report (no separate ledger); audit log keeps per-call detail                                                                                                                                                                                                      |
| Scope                  | Per project: reports under `<tempPath>/reports` (default `./.mergementor`)                                                                                                                                                                                                                  |
| CI / ephemeral runners | Out of scope for v1                                                                                                                                                                                                                                                                         |
| Recorded fields        | tokens in/out, cached, reasoning, model, provider, PR identity (repo, number, title, from the report); per-phase/specialist breakdown is a follow-up                                                                                                                                        |
| Review types           | PR reviews only in v1                                                                                                                                                                                                                                                                       |
| Opt-out                | None; usage is written with the report (local-only)                                                                                                                                                                                                                                         |
| Retention              | Same as reports (whatever cleans reports removes usage)                                                                                                                                                                                                                                     |
| Dashboard              | Runs on the same machine as the CLI; reads the same reports directory                                                                                                                                                                                                                       |
| Output                 | Totals first; `stats --usage --json` comes free from the existing `--json` flag                                                                                                                                                                                                             |
| Reasoning tokens       | New optional `reasoningTokens`; `outputTokens` becomes completion-only                                                                                                                                                                                                                      |
| Partial data           | Show totals from reported calls, mark run "partial (N of M calls reported)"                                                                                                                                                                                                                 |
| Cost unit              | Provider-reported cost first: Copilot's `assistant.usage` reports `copilotUsage.totalNanoAiu` (nano-AIU); 1 AIU = 1 AI credit = $0.01                                                                                                                                                       |
| Re-reviews             | One timestamped usage file per run (`<pr>-review-usage-<ts>.json`), so every run counts                                                                                                                                                                                                     |
| BYOK cost              | Hard-coded DeepSeek list prices (V4.1-Flash, V4-Pro), OFF-PEAK rates only, matched by model id (`deepseek` + `flash`/`pro`, plus the `deepseek-chat` alias for Flash), computed per call at write time into `costUsd`; never overrides provider-reported cost; no label, no config override |

## Proposal

1. **Extend `TokenUsage`**: add `reasoningTokens` and a provider-reported cost
   field (AICs for Copilot). Update `mergeTokenUsage` and the OpenCode mapper.
2. **Per-run totals** only in v1 (per-phase attribution deferred, see Future).
3. **Persist usage with the report** (`libs/core` + `libs/shared/reports`): PR
   review reports are markdown only (`<pr>-review-profile-report.md`), so write
   a structured JSON sidecar next to each one (`<pr>-review-profile-report.json`,
   as PRD reviews already do) holding PR identity, timestamp, and the run
   `TokenUsage` summary with a schema version. Add a reader in
   `libs/shared/reports`, tolerant of missing or corrupt sidecars.
4. **`stats --usage`**: totals and per-PR averages over a window, by model and
   provider, read from report sidecars in the local reports directory (not
   the GitHub/Azure API like the existing `stats`); shows "not reported" (never zero) and "partial" markers.
5. **Web dashboard**: usage view reading the same sidecars.
6. **Cost display**: show `$` derived from AICs when the provider reports them
   (`aics * 0.01`). For BYOK DeepSeek models, estimate `costUsd` from the
   hard-coded price table (`libs/shared/src/utils/modelPricing.ts`); other
   models show tokens only. Price assumptions: reported input tokens are cache
   misses, `cachedTokens` are cache hits, reasoning tokens bill as output.

## Guardrails

- Local only; consistent with the zero-telemetry promise.
- Usage lives alongside reports, which already contain PR titles; no new
  sensitive data is stored.
- Providers that do not report usage show "not reported", never zero.

## Tests

- Aggregation across multi-agent specialists and PBI verification.
- Partial-usage flagging; missing usage.
- Sidecar write/read round-trip; missing or corrupt sidecar tolerated; reports
  from before this change show "not reported".
- Reasoning-token split in OpenCode mapper.

## Status

- Done: `TokenUsage` extension (reasoning, nano-AIU, estimated `costUsd`),
  per-run usage files, call coverage, `stats --usage`, dashboard AI usage
  section, DeepSeek list-price estimates.
- Open: verify against a real DeepSeek BYOK run that reported `inputTokens`
  excludes cached tokens (cost is overstated if it includes them); peak-hour
  pricing is not modelled; `deepseek-reasoner` is unpriced.

## Future

- Usage for PBI, project, and PRD reviews (PRD already has JSON reports).
- Per-phase/specialist usage breakdown (tag at `onTokenUsage` call sites; could
  source from audit log events).
- cross-project aggregation; configurable reports path for stats.
- Budget caps (`--max-tokens` / `MM_AI_MAX_TOKENS`): hard stop vs. warn-only,
  overshoot handling between AI calls.
- CI story: upload/cache recipe or job-summary output.
- PR comment footer with usage.
