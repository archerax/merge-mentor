# Feature Plan: Token / Cost Reporting and Budget Caps

## Overview

Enterprise adopters ask what the tool costs before they approve it. Merge Mentor
should report usage per run and optionally stop a run that exceeds a budget.

## Current State

- Provider results carry optional `tokenUsage` (`libs/core/src/ai/types.ts`).
- `stats` reports PRs reviewed and comments posted, not tokens or cost.
- Audit logs record AI provider executions (`AuditLogger`).

## Proposal

1. **Persist usage** per run (tokens in/out, model, provider) in the audit log
   and reports.
2. **`stats --usage`**: totals and per-PR averages over a window.
3. **Budget caps:** `--max-tokens` / `MM_AI_MAX_TOKENS`; when exceeded, stop
   cleanly, post nothing partial, and say why.
4. **Cost estimate** only where a price table is supplied by the user; no
   bundled prices (they go stale).
5. Providers that do not report usage show "not reported", never zero.

## Guardrails

- Local only; consistent with the zero-telemetry promise.

## Tests

- Aggregation across multi-agent specialists; cap enforcement; missing usage.

## Open Decisions

- Is a hard stop acceptable, or warn-only for the first release?
