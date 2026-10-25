# Feature Plan: Respect AGENTS.md (Review by the Rules the Code Was Written With)

## Overview

**Product decision (CEO):** Merge Mentor will not introduce its own custom
rules format. Instead it respects the repository's existing `AGENTS.md` (when
present), so a PR is reviewed against the same instructions the coding agents
and developers used to write it.

This plan covers verifying what the AI SDKs already do, closing the gaps, and
making the behaviour visible and safe.

---

## Current State (investigated)

- **Merge Mentor code never reads AGENTS.md.** The only mention is a comment in
  `libs/core/src/ai/prompts/securityPreamble.ts` treating a "malicious
  AGENTS.md" as untrusted. The `repoContext` parameter on the review prompts
  (`libs/core/src/ai/prompts/prompts.ts`) is never populated by any caller.
- **Copilot SDK (`@github/copilot-sdk` 1.0.26):** custom instructions
  (`.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`) are loaded by
  default unless `skipCustomInstructions` is set. We never set it and we pass
  `workingDirectory`, so they should load when a workspace exists. Source: the
  SDK's type definitions; **not yet confirmed by a live session**.
- **OpenCode SDK (`@opencode-ai/sdk` 1.19.3):** the SDK exposes only
  `session.init` (generates an AGENTS.md). Loading is done by the OpenCode
  server from the directory passed in the session query. Documented OpenCode
  behaviour, **not confirmable from the SDK and not yet tested**.
- **Other providers** (Bedrock, Azure OpenAI, BYOK/OpenAI-compatible) have no
  workspace access and receive nothing.
- **Workspace is the PR head checkout** (`checkoutRef` in
  `libs/core/src/review/engine.ts`). Auto-loading therefore reads the
  _PR author's_ version of AGENTS.md.

## Gaps

1. No AGENTS.md without a checkout (no clone, no CI workspace).
2. Provider behaviour differs and nothing tells the user which case applies.
3. A PR can edit AGENTS.md and weaken the rules that review it. This conflicts
   with the security preamble, which treats repository content as untrusted.
4. Only `review` was examined. `fix`, `reply`, `describe`, `plan` and the
   multi-agent specialists create their own sessions and may differ.

## Proposal

1. **Verify with live tests.** Fixture repo with a distinctive AGENTS.md rule;
   run Copilot and OpenCode sessions and assert the rule influences output.
   Keep as an `eval` case so regressions are caught.
2. **Load the base-branch AGENTS.md ourselves.** Read `AGENTS.md` at the PR's
   base ref (via the platform adapter, no checkout needed) and inject it through
   the existing `repoContext` slot, wrapped as untrusted data. Gives all
   providers the rules and works without a checkout.
3. **Decide how head-branch edits are handled** (see Open Decisions). Default
   recommendation: use the base version and flag the PR when it edits AGENTS.md.
4. **Make it visible.** Report in the review output, audit log and `doctor`
   whether AGENTS.md was found, from which ref, and whether the provider applied
   it natively or via injection.
5. **Cover other commands** (`fix`, `reply`, `describe`, `plan`) with the same
   loader.
6. **Docs:** `docs/review.md`, `docs/configuration.md`, README security section.

## Scope Limits

- No new rules file, schema or config. `.github/copilot-instructions.md` and
  `CLAUDE.md` are out of scope unless a provider loads them natively.
- Nested/per-directory AGENTS.md: native SDK behaviour only for the first
  release (Copilot has on-demand discovery); no custom resolution.
- Size cap on injected content (to be set) with a visible truncation marker.

## Guardrails

- Injected content wrapped with the existing untrusted-content delimiters; the
  security preamble stays authoritative.
- Never execute anything referenced by AGENTS.md (the review tool set stays
  read-only unless the user enabled write/shell tools).

## Tests

- Loader: found, missing, oversized, binary/invalid UTF-8, base ref differs from
  head.
- Prompt: section present only when file found; wrapped as untrusted.
- Adapter: reading a file at a ref on GitHub and Azure DevOps.
- Eval case per provider proving the rule is honoured.

## Open Decisions

- If a PR edits AGENTS.md: ignore the edit for that review, apply and flag, or
  apply silently? (Recommendation: base version used, PR flagged.)
- Disable SDK auto-loading to avoid double-loading, or accept duplicates?
- Size cap value.
