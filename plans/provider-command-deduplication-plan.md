# Provider & Command Copy-Paste Deduplication Plan

## Overview

The three AI providers (`copilot-sdk`, `opencode-sdk`, `claude-agent-sdk`) share **~1,440 duplicated lines** of parsing, validation, retry, and transcript-saving logic. The `review`, `describe`, **and `fix`** commands also duplicate CI detection, config loading, and provider wiring (~160 lines across **three** commands, not two).

This plan extracts the shared patterns into `src/ai/shared/` and `src/commands/shared/`, keeping each provider file focused on SDK-specific plumbing.

**Ground rule: no provider or command changes observable behavior** — only how the code is organized. The few intentional, benign exceptions are explicitly listed in the [Behavioral Change Watchlist](#behavioral-change-watchlist) and each is called out in its task.

---

## Verified Facts (checked against the code)

Byte-identical across all three providers (verified by diff):

- `parseJsonResponse()` — 21 lines ×3
- `validateReasoning()` — 36 lines ×3
- `inferPromptType()` — 7 lines ×3
- `delay()` — 3 lines ×3
- `parseFileReview()` / `parseCrossFileReview()` / `parseBatchedFileReview()` / `parseFastReview()` — ~150 lines ×3 (incl. doc comments)
- The `PromptType` type alias — 6 lines ×3 (**missed by the original plan**)

Byte-identical across `opencode-sdk` + `claude-agent-sdk` only:

- `getJsonSchema()` switch — 14 lines ×2
- The four inline JSON schema consts (`FILE_REVIEW_SCHEMA`, `CROSS_FILE_REVIEW_SCHEMA`, `BATCHED_FILE_REVIEW_SCHEMA`, `FAST_REVIEW_SCHEMA`) — 141 lines ×2
- `copilot-sdk` has neither (it uses markdown/regex extraction, not structured output)

**Not** identical — these need parameterization, not blind moves:

- `executePrompt()` retry loops (76 / 44 / 53 lines). See [T9](#t9--extract-retry-loop--srcaisharedretrypromptts) for the exact divergences.
- `saveTranscript()` (113 / 58 / 108 lines). Shared scaffolding, but: different filename prefixes and headers, copilot/claude serialize session events differently, opencode has no events or token usage, and copilot labels a section `RAW RESPONSE` vs `RAW API RESPONSE` elsewhere.
- Claude's private `mergeTokenUsage()` (10 lines) is a **near**-duplicate of `src/utils/tokenUsage.ts`, not an exact one. See [T7](#t7--replace-claudes-private-mergetokenusage-with-the-shared-one).

Command-level (verified in `review.ts`, `describe.ts`, `fix.ts`):

- CI detection block exists in **all three** commands. `fix.ts` uses a simpler variant: shorter error message, no `MM_*` token pre-loading.
- `mergeCIContext()` lives in `review.ts` and is imported by `describe.ts` and `fix.ts` — a cross-command import smell. Moving it to `src/commands/shared/` fixes that too.
- Config loading → `initLogger` → platform validation → `validateConfig` → adapter creation is the same pipeline in all three commands. Only `review`/`describe` additionally validate the AI provider allowlist and print the claude deprecation warning.

Interface constraint (important):

- `parseFileReview`, `parseCrossFileReview`, `parseBatchedFileReview`, `parseFastReview` are **public methods on the `AIProviderClient` interface** (`src/ai/types.ts`) and are called directly in provider specs. After extraction each provider keeps these as thin public wrappers delegating to the shared functions — the interface and existing specs stay untouched.

Repo conventions to follow in every task:

- Relative imports must end with `.js`.
- Co-located specs: new module `foo.ts` gets `foo.spec.ts` next to it.
- Biome: 2-space indent, 100 col, no `any`, no non-null assertions.
- Knip runs in `pnpm lint`: only export what is actually imported elsewhere.
- Verify with `pnpm typecheck` (fast) → targeted `vitest run <spec>` → `pnpm check` at phase end.

---

## Behavioral Change Watchlist

Every item below is intentional, small, and must be called out in the commit/PR that introduces it. Everything not listed here must be byte-for-byte behavior-preserving.

| #   | Change                                                                                                                                                                                                                                  | Task | Justification                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------- |
| 1   | Claude token usage: `cachedTokens` becomes `undefined` instead of `0` when neither side reports it (so `formatTokenUsage` stops printing `Cached tokens: 0`); model merge uses `??` instead of `\|\|` (identical for non-empty strings) | T7   | Shared util is more correct; reporting 0 cached tokens is misleading            |
| 2   | Copilot transcript section header `RAW RESPONSE` → `RAW API RESPONSE`                                                                                                                                                                   | T8   | Standardize debug-only transcript format                                        |
| 3   | `fix` command gains `MM_AZURE_TOKEN`/`MM_GITHUB_TOKEN` env pre-loading and the more detailed `--ci` error message                                                                                                                       | T10  | Same SYSTEM_ACCESSTOKEN pitfall applies to fix; one behavior is better than two |

---

## Phase 1 — Shared Response Parsers (pure functions, byte-identical, low risk)

### T1 — Extract `delay()` → `src/ai/shared/delay.ts`

- **Duplication:** 3 lines ×3 = 9 lines
- **Risk:** Low
- **Why first:** trivial; establishes the `src/ai/shared/` directory, spec-file convention, and the create-shared-module → switch-3-providers workflow.
- **Approach:** `export function delay(ms: number): Promise<void>`. Add a minimal spec (resolves after the given ms; use fake timers). Replace the three private `delay()` methods with the import.
- **Verify:** `pnpm typecheck && pnpm test`

### T2 — Extract `validateReasoning()` → `src/ai/shared/validateReasoning.ts`

- **Duplication:** 36 lines ×3 = 108 lines (byte-identical)
- **Risk:** Low
- **Approach:** The method uses `this.logger`, so the shared function takes a logger as its first parameter:
  `validateReasoning(logger, reasoning, filename, lineOrLocation)`. Extract the `minLength`, `evidencePattern`, and `impactPattern` constants with it. Add a spec covering: short-reasoning warning, missing-evidence warning, missing-impact warning, clean reasoning (no warning), numeric vs string location.
- **Depends on:** nothing. **Needed by:** T5.
- **Verify:** `pnpm typecheck && pnpm test`

### T3 — Extract `parseJsonResponse()` → `src/ai/shared/parseJsonResponse.ts`

- **Duplication:** 21 lines ×3 = 63 lines (byte-identical)
- **Risk:** Low
- **Approach:** Pure function, no logger needed. Throws `JsonParseError` from `src/errors/`. Spec covers: ` ```json ` block, bare `{...}` regex fallback, no-JSON → `JsonParseError`, malformed JSON → `JsonParseError`. Copilot's `tryRecoverTimedOutResponse()` keeps calling it unchanged.
- **Verify:** `pnpm typecheck && pnpm test`

### T4 — Extract `PromptType` + `inferPromptType()` → `src/ai/shared/promptType.ts`

- **Duplication:** 13 lines ×3 = 39 lines (byte-identical; the original plan missed the triplicated type alias)
- **Risk:** Low
- **Approach:** Export both `PromptType` (union incl. `"unknown"`) and `inferPromptType(prompt)`. Note `ExecutePromptOptions.promptType` in `src/ai/types.ts` declares the same four non-unknown literals inline — leave `types.ts` as-is (public API surface) but have the shared type reuse nothing from it; do not widen the public interface. Spec covers all four substrings + unknown.
- **Needed by:** T6, T9.
- **Verify:** `pnpm typecheck && pnpm test`

### T5 — Extract the four review parsers → `src/ai/shared/responseParsers.ts`

- **Duplication:** ~150 lines ×3 ≈ 450 lines (byte-identical): `parseFileReview` (23), `parseCrossFileReview` (29), `parseBatchedFileReview` (32), `parseFastReview` (55), plus doc comments
- **Risk:** Low-Medium
- **Approach:**
  - Shared functions take a logger first param and delegate to `validateReasoning` (T2): `parseFileReview(logger, filename, response)`, etc.
  - Each provider **keeps its public interface methods** (`AIProviderClient` in `types.ts`) as one-line delegating wrappers passing `this.logger`. No spec changes, no interface changes.
  - Existing provider specs already cover these methods thoroughly (e.g. `copilot-sdk.spec.ts` "parseFileReview" / "validateReasoning warnings" describes) — they must pass unmodified, which is the regression net. Add one shared-module spec only for logger-independence (functions work without class context).
- **Depends on:** T2.
- **Verify:** `pnpm typecheck && pnpm test`

**Phase 1 gate:** `pnpm check` green. Addresses ~670 duplicated lines (gross); net reduction ≈ 440 lines after the shared copies remain.

---

## Phase 2 — Shared Infrastructure (medium risk)

### T6 — Extract inline JSON schemas + `getJsonSchema()` → `src/ai/shared/jsonSchemas.ts`

- **Duplication:** 141 lines of schema consts ×2 = 282 lines, plus the identical 14-line switch ×2
- **Risk:** Medium
- **Approach:**
  - Move the four schema consts **verbatim** (with comments) into the shared module, and move `getJsonSchema(promptType)` with them (it becomes a plain function over the shared `PromptType` from T4).
  - **Do not** "generate JSON schemas from the Zod schemas" (suggested in the original plan): the inline schemas are deliberately looser than the Zod ones (e.g. `severity: { type: "string" }` vs an enum with `.catch()`), so regenerating would change the structured-output contract sent to the SDKs. That unification, if wanted, is a separate behavior-changing proposal — see Out of Scope.
  - Only opencode-sdk and claude-agent-sdk change; copilot-sdk never had these.
- **Depends on:** T4.
- **Verify:** `pnpm typecheck && pnpm test`

### T7 — Replace claude's private `mergeTokenUsage()` with the shared one

- **Duplication:** 10 lines in `claude-agent-sdk.ts`
- **Risk:** Low
- **Approach:** Delete the private method, import `mergeTokenUsage` from `src/utils/tokenUsage.js`, and rename `this.mergeTokenUsage(...)` call sites. **Introduces watchlist item 1** (`cachedTokens: 0` → `undefined`; `||` → `??` for model). Check claude spec snapshots/assertions for `cachedTokens: 0` expectations and update the test expectation if one exists — that is a test-correction for an intended behavior change, not a regression.
- **Verify:** `pnpm typecheck && pnpm test`

### T8 — Extract `saveTranscript()` scaffolding → `src/ai/shared/saveTranscript.ts`

- **Duplication:** 113 + 58 + 108 = 279 lines; shared scaffolding is ~55 of those per provider
- **Risk:** Low-Medium
- **Approach:**
  - Shared function signature:
    ```ts
    saveTranscript(deps, data): Promise<void>
    // deps: { fileSystem, clock, logger, tempPath, providerLabel, filePrefix, model? }
    // data: { prompt, rawResponse?, jsonOutput?, tokenUsage?, success, error?, attempt, timeline?: string[] }
    ```
  - The shared module owns: directory creation, timestamp/filename generation, header/section formatting, error-section, write, warn-on-failure.
  - **Event serialization stays in the providers.** Copilot keeps its `SessionEvent` switch (~60 lines) and claude keeps its `unknown[]` switch (~50 lines), each as a private `formatSessionTimeline(events): string[]`; opencode passes no `timeline`. This is simpler than injecting a formatter callback and keeps SDK event types out of the shared module.
  - Each provider keeps a thin private `saveTranscript()` wrapper that builds `deps`/`data` — call sites don't change.
  - **Introduces watchlist item 2** (copilot's `RAW RESPONSE` header becomes `RAW API RESPONSE`).
- **Verify:** `pnpm typecheck && pnpm test` (provider specs cover transcript file creation via mocked `FileSystem`)

### T9 — Extract retry loop → `src/ai/shared/retryPrompt.ts`

- **Duplication:** 76 + 44 + 53 = 173 lines; shared skeleton ≈ 45 lines/provider
- **Risk:** Medium (highest in the plan — touches the execution path)
- **The three loops are NOT identical.** Exact divergences to parameterize:

  | Aspect           | copilot                                                              | opencode                                | claude                            |
  | ---------------- | -------------------------------------------------------------------- | --------------------------------------- | --------------------------------- |
  | Token usage      | accumulated via `onUsageCollected` callback                          | **none** — response has no `tokenUsage` | merged from `runSdk` return value |
  | Early abort      | breaks on auth-failure messages                                      | —                                       | —                                 |
  | Attempt counting | `actualAttempts` (for error msg)                                     | uses `maxRetries` in msg                | uses `maxRetries` in msg          |
  | Final error msg  | strips `"<provider> error: "` prefix; `"N attempt(s)"` pluralization | plain                                   | plain                             |
  | Warn log label   | `"Copilot SDK …"`                                                    | `"OpenCode SDK …"`                      | `"Claude Agent SDK …"`            |

- **Design:**
  ```ts
  interface RetryPromptDeps {
    providerName: "copilot-sdk" | "opencode-sdk" | "claude-agent-sdk"; // audit + error prefix
    displayName: string;    // "Copilot SDK" — preserves warn-log wording exactly
    model?: string;
    maxRetries: number;
    logger: ChildLogger;
    auditLogger: AuditLogger;
  }
  interface RetryPromptHooks {
    shouldAbort?: (error: Error) => boolean;            // copilot auth break only
    formatFinalError?: (lastError: Error | null, attempts: number) => string; // copilot only
  }
  retryPrompt<T>(deps, hooks, run: (attempt: number) => Promise<{ raw: string; parsed: unknown; usage?: TokenUsage }>): Promise<AIResponse>
  ```
  The shared loop owns: attempt loop, `actualAttempts`, warn log, `delay(RETRY_DELAY_BASE_MS * attempt)` backoff, usage accumulation via shared `mergeTokenUsage` (skipped when `run` returns no `usage`), success/failure audit logs, and the final `AIProviderError` (default message matches opencode/claude exactly; copilot passes `formatFinalError` for its prefix-strip + pluralization).
- **Pre-step inside this task:** change copilot's `runSdk` to **return** `usage` in its result instead of reporting via the `onUsageCollected` callback (`collectedUsage` is in scope at every return point). Internal-only change; then delete the callback parameter.
- **Migration order (simplest first):** opencode → claude → copilot, running that provider's spec after each switch. Do **not** delete the old loops until all three are migrated.
- **Depends on:** T4 (uses `PromptType`), T7 (claude already on shared `mergeTokenUsage`).
- **Verify:** `pnpm typecheck && pnpm test` after **each** provider switch, then `pnpm check`.

**Phase 2 gate:** `pnpm check` green. Addresses ~770 duplicated lines (gross); net ≈ 515 more lines removed (~955 cumulative net).

---

## Phase 3 — Command-Level Dedup (independent of Phases 1–2)

### T10 — Extract CI detection + `mergeCIContext()` → `src/commands/shared/ci.ts`

- **Duplication:** ~20 lines ×**3** commands = ~60 lines (original plan said ×2 — `fix.ts` has it too)
- **Risk:** Low
- **Approach:**
  - `ensureCIContext<T extends ReviewOptions>(options, deps): T` encapsulating: `detectCIEnvironment`, throw-if-undetected, the `🤖 CI mode` log, `MM_*` token pre-loading, `mergeCIContext`.
  - **Move `mergeCIContext` itself** from `review.ts` into this module (keep it exported) and update the imports in `review.ts`, `describe.ts`, `fix.ts` — this removes the cross-command import smell.
  - **Introduces watchlist item 3:** `fix.ts` adopts the shared variant (env token pre-loading + detailed error message). Call this out in the PR.
  - Existing command specs drive these blocks through `executeReview`/`executeDescribe`/`executeFixCommand` with mocked `env` — they are the regression net. `fix.spec.ts` may need its shorter-error-message expectation updated to the shared message (intended change).
- **Verify:** `pnpm typecheck && pnpm test`

### T11 — Extract config/platform/adapter bootstrap → `src/commands/shared/bootstrap.ts`

- **Duplication:** ~50 lines ×3 commands
- **Risk:** Low-Medium
- **Approach:**
  ```ts
  bootstrapCommand(configInput, opts): { config, platform, adapter }
  // does: loadConfig(configInput) → initLogger(config.tempPath) →
  //       platform resolve + allowlist check → validateConfig → adapter creation
  ```
  - Each command keeps building its own `configInput` (the `loadConfig` args genuinely differ per command — review passes `reviewType`/`passes`/`strategy`, fix passes none of those).
  - Extract a second helper `resolveAIProvider(rawProvider, config): AIProviderType` (allowlist + error) used by `review`/`describe` only — `fix` intentionally has no allowlist today; adding one would be a behavior change, so leave fix as-is.
  - Extract `logStartupSummary(output, { platform, aiProvider, aiModel, aiBaseUrl })` for the identical `Platform:/Provider:/Model:/BYOK URL:` lines **plus** the claude deprecation warning (identical in review + describe). Command-specific lines (`Starting code review…` vs `…description generation…`, review's `Review:` line) stay in the commands.
- **Depends on:** nothing (T10 not required, but landing T10 first keeps imports tidy).
- **Verify:** `pnpm typecheck && pnpm test`

### T12 — Final sweep

- Run `pnpm check` (typecheck + prettier + biome + knip + build + full tests).
- Knip: ensure no unused exports in the new shared modules; no orphaned private methods left in providers.
- Measure the result: `wc -l src/ai/providers/*.ts src/commands/*.ts` vs baseline (2,787 provider lines; 985 lines across the three affected commands) and record the reduction in the PR description.
- Update `src/utils/README.md` only if it gains a sibling README convention; otherwise no doc changes needed.

**Phase 3 gate:** `pnpm check` green. Addresses ~160 duplicated lines; net ≈ 110 more lines removed (~1,065 cumulative net).

---

## Migration Strategy

Per-task pattern (Phases 1–2):

1. Create the shared module + co-located spec.
2. Switch **all three providers in one commit** for byte-identical extractions (T1–T6, T8) — the existing per-provider specs are the regression net, and one-commit moves keep the providers from drifting mid-refactor.
3. **Exception — T9 (retry loop):** migrate one provider at a time (opencode → claude → copilot), running that provider's spec after each switch, because the loops are behaviorally divergent.
4. Delete dead code in the same commit as the switch (avoids knip failures).

Commit granularity: one commit per task (T1…T12) keeps reviews small and bisectable. Phases 1, 2, 3 can be separate PRs; T1–T5 are also safe to batch into one PR if preferred.

## Risk Assessment

| Phase        | Duplicated lines (gross) | Net lines removed | Cumulative net | Risk | Rationale                                                                         |
| ------------ | ------------------------ | ----------------- | -------------- | ---- | --------------------------------------------------------------------------------- |
| 1 (Parsers)  | ~670                     | ~440              | ~440           | Low  | Byte-identical pure functions; existing specs cover them via the public interface |
| 2 (Infra)    | ~770                     | ~515              | ~955           | Med  | Schemas verbatim-moved; retry loop is divergent → hooks + per-provider migration  |
| 3 (Commands) | ~160                     | ~110              | ~1,065         | Low  | Three commands, one intended fix.ts behavior change                               |

Dependency graph: T1–T3 independent; T5 ← T2; T6 ← T4; T9 ← T4, T7; T8, T10–T12 independent. Phase 3 is fully independent of Phases 1–2 and can land in parallel.

## Out of scope

- **Unifying the inline JSON schemas with the Zod schemas** (`src/ai/schemas.ts`). The inline schemas are intentionally looser than the Zod ones; deriving one from the other changes the structured-output contract with the SDKs. If desired, propose it separately with its own risk analysis.
- **`claude-agent-sdk.ts` removal in v3.0** (per roadmap). It still participates as a third data point while it exists. Extracting shared code now makes the v3.0 cleanup easier — the parsers and utilities live in shared modules, so deleting `claude-agent-sdk.ts` just removes SDK-specific plumbing, not reusable logic.
- Copilot-only helpers (`convertFindingsToParsedResponse`, `groupFindingsByFile`, `combineToolAndJsonFindings`, `isSessionIdleTimeout`, `tryRecoverTimedOutResponse`, BYOK config validation) — not duplicated; stay put.
- Adding an AI-provider allowlist to the `fix` command — a behavior change unrelated to deduplication.
