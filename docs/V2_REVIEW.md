# v2.0 Release Readiness Review

> **Audience:** Product Owner / Engineering Lead
> **Scope:** Pre-release audit of the entire `merge-mentor` codebase (v1.33.0)
> **Artifacts reviewed:** All source files, test files, CHANGELOG, RELEASE docs, README

---

## How to Read This Document

Issues are grouped into four tiers:

| Tier       | Meaning                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| **Tier 1** | Breaking changes. We can only fix these during a major version bump.     |
| **Tier 2** | Bugs and missing test coverage that carry real risk in production.       |
| **Tier 3** | Refactoring opportunities. No functional change, better maintainability. |
| **Tier 4** | Nice-to-have polish. Low risk, low effort, good for sprint filler.       |

Each issue includes:

- **Impact:** What happens to users if we ship with this unfixed.
- **Effort:** Rough size estimate (Small / Medium / Large).
- **Recommendation:** Clear yes/no on whether this should block v2.0.

---

## Tier 1 -- Breaking Changes

These require modifying public APIs, interfaces, or repository contracts. v2.0 is our only window to fix them without churn.

---

### 1.1 AI Provider Code Duplication (~800+ lines)

- **Files:** `src/ai/providers/copilot.ts`, `copilot-sdk.ts`, `opencode.ts`, `opencode-sdk.ts`
- **What it is:** All four providers re-implement approximately 70% of the same logic independently. Validators (`validateReasoning`, `validateSeverity`, `validateConfidence`, `validateCategory`, `validateCrossFileCategory`), JSON parsing (`parseJsonResponse`), response parsers (`parseFileReview`, `parseCrossFileReview`, `parseBatchedFileReview`, `parseFastReview`), and the `delay` utility are all defined four times with identical code. Seven raw response type interfaces are defined inline in every file.
- **What happens if we don't fix it:** Future bug fixes must be applied in four places. Adding a fifth provider (e.g., Claude) means copy-pasting 500+ lines. Already, `OpenCodeCliError` extends `Error` directly while its three siblings extend `MergeMentorError` -- a bug caused by this duplication.
- **Proposed fix:** Extract a `BaseAIProvider` abstract class. Concrete providers only implement `executePrompt()` (their actual API call) and a response-text extractor.
- **Effort:** Large
- **Recommendation:** **Block v2.0.** This is a ticking maintenance bomb.

---

### 1.2 Error Class Consolidation

- **Files:** `src/errors/index.ts`, `src/ai/providers/opencode.ts`
- **What it is:** `CopilotCliError`, `CopilotSdkError`, and `OpenCodeSdkError` are identical boilerplate (message + optional cause). `OpenCodeCliError` is defined inline in `opencode.ts` and extends `Error` rather than `MergeMentorError` -- it is the only error in the system that does not inherit from the base class. Separately, all custom errors define their own `cause` property, which shadows the native ES2022 `Error.cause`. Tools like `pino` and `serialize-error` that inspect `error.cause` for chaining will not see the cause chain.
- **What happens if we don't fix it:** Callers catching `MergeMentorError` will miss `OpenCodeCliError`. Error logs will be missing cause information, making production debugging harder.
- **Proposed fix:** Replace the four provider-specific error classes with a single parameterized `AIProviderError`. Pass `{ cause }` to `super(message, { cause })` so the native error-chain works. Move the `OpenCodeCliError` definition out of `opencode.ts` into `errors/index.ts`.
- **Effort:** Medium
- **Recommendation:** **Block v2.0.** Correctness issue in a critical path.

---

### 1.3 Platform Name Detection via Constructor Inspection

- **Files:** `src/review/engine.ts` (lines 298-300)
- **What it is:** The engine determines whether it's running on GitHub or Azure by inspecting `platform.constructor.name.toLowerCase().includes("github")`.
- **What happens if we don't fix it:** This breaks silently if the class is renamed (`GitHubAdapter` to `DefaultAdapter`), if the code is minified (production builds with esbuild could mangle class names), or if a third platform adapter (GitLab, Bitbucket) is added.
- **Proposed fix:** Add a `getPlatformName(): "github" | "azure"` method to the `PlatformAdapter` interface.
- **Effort:** Small
- **Recommendation:** **Block v2.0.** Adding to an interface is a breaking change.

---

### 1.4 `buildWorkspaceSection` Duplicated 5 Times

- **Files:** `src/ai/prompts/specialists/testing.ts`, `general.ts`, `security.ts`, `performance.ts`, `fast.ts`
- **What it is:** The function `buildWorkspaceSection` is defined identically in five files. It is an AI prompt helper that explains how the AI model can navigate the local workspace. Each copy is ~25 lines. The files-listing pattern (formatting `manifest.files` into a bulleted list) is also duplicated five times.
- **What happens if we don't fix it:** Changing the workspace prompt format requires edits in five places. Already, `general.ts` inlines a workspace section in its cross-file prompt instead of calling the helper, creating a sixth divergent copy.
- **Proposed fix:** Extract to `src/ai/prompts/shared/workspaceSection.ts`. Also extract a `buildFilesListing()` helper.
- **Effort:** Medium
- **Recommendation:** **Do in v2.0.** The cross-file inline version in `general.ts` is a latent drift bug; fixing it means changing the AI prompt, which ideally happens on a major version boundary.

---

### 1.5 `Phases` vs `Passes` Naming Inconsistency

- **Files:** `src/review/reviewSelection.ts`, CHANGELOG, README
- **What it is:** The CHANGELOG v1.32.0 introduced `--phases` as a CLI flag. The README documents `--passes`. The source code in `reviewSelection.ts` accepts `fieldName: "phases"` as a parameter. The feature is called "review passes" everywhere in the code except for the legacy `"phases"` string in the parser.
- **What happens if we don't fix it:** Users see `--passes` in documentation but the parser still references `phases` internally. Error messages and comments may refer to either term, causing confusion.
- **Proposed fix:** Remove the `"phases"` variant from `parsePassList()` and rename all remaining references.
- **Effort:** Small
- **Recommendation:** **Do in v2.0.** Requires updating public-facing error messages.

---

### 1.6 `verbose` Bypasses Config Entirely

- **Files:** `src/program.ts` (line 601), `src/config.ts`
- **What it is:** `--verbose` is a CLI option with a default of `true`. It is passed directly from `program.ts` to `ReviewEngine`, bypassing the `Config` object and `CliOverrides` entirely. There is no `verbose` field on the `Config` interface.
- **What happens if we don't fix it:** `verbose` cannot be set via the `MM_*` env var system. All other CLI options flow through `Config` -- this is the only exception.
- **Proposed fix:** Add `verbose: boolean` to `Config` and `CliOverrides`. Default to `true` in `loadConfig()`. Route through config like every other option.
- **Effort:** Small
- **Recommendation:** **Do in v2.0.** Adding a required field to `Config` is a breaking change.

---

### 1.7 `tokenSaver` -- Dead Field in Config

- **Status:** ✅ **Resolved** -- Removed from `Config` interface, `buildGeneralFileReviewPrompt`, `buildFastReviewPrompt`, and `buildFastReviewOutputFormat`. The field was never populated and always evaluated to `undefined`.

---

### 1.8 `streamingLines` Default Mismatch

- **Files:** `src/config.ts` (lines 72, 170), `src/review/engine.ts` (line 297)
- **What it is:** Three different defaults exist for the same value. The JSDoc comment on the `Config` interface says 5. The `loadConfig()` function hardcodes 9. The `ReviewEngine` constructor fallback says 5 (but is unreachable because config always supplies a value). Effective default at runtime is 9.
- **What happens if we don't fix it:** The comment is wrong, which confuses contributors. The engine fallback is dead code.
- **Proposed fix:** Standardize on 9 everywhere. Remove the dead engine fallback. Update the JSDoc comment.
- **Effort:** Small
- **Recommendation:** **Do in v2.0.** Trivial, and the comment is literally wrong today.

---

### 1.9 Azure `generateDiffFromBlobs` Catches All Errors

- **Files:** `src/platforms/azure.ts` (lines 448-454)
- **What it is:** The `catch` block in `generateDiffFromBlobs` silently swallows all exceptions -- network errors, permission errors, auth failures -- and returns an empty diff with no changes. The caller sees a valid file with zero additions and zero deletions.
- **What happens if we don't fix it:** Real failures (e.g., expired tokens, network outages) produce a review that says "no changes found" instead of an error. The user gets a false sense of security.
- **Proposed fix:** Distinguish between "file not found" (expected for added/deleted files) and "unexpected error" (should surface as an error, not a silent empty diff).
- **Effort:** Medium
- **Recommendation:** **Do in v2.0.** This is an API contract change -- callers currently don't expect `generateDiffFromBlobs` to throw for network errors.

---

### 1.10 GitHub and Azure Adapters Accept Entire Config Object

- **Files:** `src/platforms/github.ts` (line 28), `src/platforms/azure.ts` (line 48)
- **What it is:** Both constructors accept `Config` with 25+ fields but only use 3-5 of them. This creates false coupling -- the adapters appear to depend on the full config shape when they don't.
- **What happens if we don't fix it:** Changing `Config` (e.g., adding a new non-platform field) forces re-reading the adapter code to verify it doesn't use the new field.
- **Proposed fix:** Pass only the narrow interfaces they actually need (`GitHubConfig` / `AzureConfig` + `botCommentIdentifier`).
- **Effort:** Small
- **Recommendation:** **Do in v2.0.** Constructor signature change = breaking change.

---

### 1.11 Specialist Cross-File Context Interfaces Are Nearly Identical

- **Files:** `src/ai/prompts/specialists/types.ts`
- **What it is:** `GeneralCrossFileContext`, `SecurityCrossFileContext`, and `PerformanceCrossFileContext` all share the same base fields (`filesSummary`, `fileReviewResults`, `existingCommentsContext`). The testing context has its own shape but shares `allChangedFiles`.
- **What happens if we don't fix it:** Adding a shared field to all cross-file contexts requires editing four interfaces.
- **Proposed fix:** Extract a `BaseCrossFileContext` interface and extend it.
- **Effort:** Small
- **Recommendation:** **Do in v2.0.** Adding to type definitions is a breaking change.

---

### 1.12 `outputFormats.ts` Dead Parameter

- **Status:** ✅ **Resolved** -- Removed the `_options` parameter from `buildFastReviewOutputFormat` alongside the `tokenSaver` cleanup (see 1.7).

---

## Tier 2 -- Bugs & Missing Test Coverage

These are correctness or quality risks. They do not require interface changes but should ship before v2.0.

---

### 2.1 Azure Change Type Bitmask Bug (critical)

- **Files:** `src/platforms/azure.ts` (lines 339-354)
- **What it is:** Azure DevOps change types are bit flags: Add=1, Edit=2, Rename=8, Delete=16. A file that is renamed _and_ edited has `changeType = 10` (8 | 2). The `switch` statement uses exact equality (`case 2`, `case 8`) and will miss combined flags, falling to `default: "modified"`.
- **What happens if we don't fix it:** Renamed-and-edited files are reported with the wrong status. The diff generation logic may skip diffing or generate incorrect patches.
- **Proposed fix:** Use bitmask checks: `if (changeType & 2)`, `if (changeType & 8)`, etc.
- **Effort:** Small
- **Recommendation:** **Must fix before release.** This is a correctness bug in production code.

---

### 2.2 Binary File Detection Missing in Azure

- **Files:** `src/platforms/azure.ts` (lines 480-487)
- **What it is:** `fetchFileContentAtCommit` fetches file content from the Azure Items API. Binary files are returned as base64-encoded strings. The code does not check the `versionControlContentType` in the response and treats base64 strings as plain text.
- **What happens if we don't fix it:** Binary files (`.png`, `.pdf`, `.dll`, etc.) produce meaningless garbage "diffs" that the AI provider attempts to review, wasting tokens and potentially causing the AI to fabricate issues about base64 strings.
- **Proposed fix:** Check the API response for content-type metadata and skip binary files.
- **Effort:** Small
- **Recommendation:** **Must fix before release.** Token waste and review quality degradation.

---

### 2.3 Azure Raw Fetch Bypasses Rate Limit Handling

- **Files:** `src/platforms/azure.ts` (lines 288-332, 459-488)
- **What it is:** Two functions (`fetchAllIterationChanges` and `fetchFileContentAtCommit`) build URLs and auth headers manually using raw `fetch()` calls. All other Azure API calls use `withRateLimitHandling()` to retry on 429/503 responses with exponential backoff. These raw calls do not.
- **What happens if we don't fix it:** Under heavy load or rate-limited Azure DevOps instances, these calls fail immediately with HTTP 429 instead of retrying. The review aborts.
- **Proposed fix:** Route through `withRateLimitHandling` or the Azure DevOps SDK.
- **Effort:** Medium
- **Recommendation:** **Fix before release.** Reliability issue.

---

### 2.4 Unvalidated `prIdentifier` Parsing Produces NaN

- **Files:** `src/review/engine.ts` (lines 818, 1141)
- **What it is:** Both `reviewFilesBatched` and `performFastReview` extract the PR number using `parseInt(prIdentifier.split("-PR")[1], 10)`. If `prIdentifier` does not contain `-PR`, the split returns `["entireString"]`, indexing `[1]` yields `undefined`, and `parseInt(undefined, 10)` yields `NaN`. This `NaN` is then passed to audit loggers.
- **What happens if we don't fix it:** Audit logs contain `NaN` as the PR number. Harder to debug. Currently masked because `prIdentifier` is always correctly formatted by `generatePRIdentifier`, but there is no guarantee this remains true.
- **Proposed fix:** Extract to a helper function that validates the result and throws if it's not a number.
- **Effort:** Small
- **Recommendation:** **Fix before release.** Defense-in-depth.

---

### 2.5 Summary Table Silently Hides Categories

- **Files:** `src/review/commentManager.ts` (lines 382-391)
- **What it is:** The `buildCategoryTable` method renders a markdown table of finding counts by category. It hardcodes five categories: `bug`, `security`, `performance`, `quality`, `documentation`. However, the actual `FindingCategory` type also includes `architecture`, `design`, and `testing`. If the AI returns findings in these categories, `countByCategory` counts them correctly but the summary table silently omits them.
- **What happens if we don't fix it:** Users see incomplete summary tables. Findings in `architecture`, `design`, or `testing` categories exist in the review but are invisible in the summary.
- **Proposed fix:** Generate the table dynamically from all categories that have at least one finding.
- **Effort:** Small
- **Recommendation:** **Fix before release.** User-facing output is wrong.

---

### 2.6 Non-Exhaustive Switch in `executeAction`

- **Files:** `src/review/engine.ts` (line 1286)
- **What it is:** The `switch (action.type)` in `executeAction` only handles `case "create"`. The `CommentAction.type` is currently typed as `"create"` only, but the code references `action.existingCommentId` throughout, suggesting `"update"` and `"delete"` actions were planned.
- **What happens if we don't fix it:** Adding a new action type later would silently no-op with no error or warning.
- **Proposed fix:** Add a `default:` branch that throws an error, or make the switch exhaustive.
- **Effort:** Small
- **Recommendation:** **Fix before release.** Silent failure is dangerous.

---

### 2.7 Config `streamingEnabled` / `stream` Naming Inconsistency

- **Files:** `src/config.ts` (line 70, 165), `src/program.ts` (line 45, 185)
- **What it is:** The `Config` interface calls the field `streamingEnabled`. The CLI uses Commander's `--no-stream` convention, which sets a key called `stream`. The mapping at `program.ts:185` translates between them: `streamingEnabled: resolvedOptions.stream !== false ? undefined : false`. Functionally correct, but the two-tier naming is confusing.
- **What happens if we don't fix it:** Contributors may add `streamingEnabled` directly to CLI options, creating a silent fork.
- **Proposed fix:** Rename `stream` to `streamingEnabled` in the `ReviewOptions` interface.
- **Effort:** Small
- **Recommendation:** **Fix before release.** Shipping inconsistent naming to v2.0 locks it in.

---

### 2.8 `reviewSelection.ts` Has Zero Test Coverage

- **Files:** `src/review/reviewSelection.ts` (197 lines)
- **What it is:** This module exports five functions (`validateReviewType`, `validateReviewStrategy`, `parseReviewPasses`, `resolveReviewProfile`, `formatReviewTypeLabel`) that handle review type resolution, pass parsing, pass deduplication, and profile construction. It has validation logic, comma-separated list parsing, and error throwing. There are no tests.
- **What happens if we don't fix it:** A bug in pass resolution (wrong pass selected, pass silently dropped) could cause the AI to skip a specialist review without any indication to the user.
- **Proposed fix:** Write unit tests covering all review types, edge cases (empty `reviewPasses`, invalid pass names, conflicting profiles), and error paths.
- **Effort:** Medium
- **Recommendation:** **Must fix before release.** This is core business logic with no safety net.

---

### 2.9 `diffStorage.ts` Has Zero Test Coverage

- **Files:** `src/review/diffStorage.ts` (301 lines)
- **What it is:** The `DiffStorage` class handles writing numbered diffs to disk, creating manifest.json metadata files, sanitizing filenames, and cleaning up stale diffs. It depends on injectable `FileSystem` and `Clock` ports -- meaning it is _designed_ to be tested, but no tests exist.
- **What happens if we don't fix it:** A regression in diff storage (e.g., a bad filename-sanitization change) could break the batched review pipeline. The AI would review stale or missing diffs.
- **Proposed fix:** Write tests using the existing `FileSystem` and `Clock` test helpers.
- **Effort:** Medium
- **Recommendation:** **Must fix before release.** IO-heavy class with no tests is a regression risk.

---

### 2.10 Thin Test Coverage on Specialist Prompts

- **Files:** `src/ai/prompts/specialists/testing.ts` (828 lines, 221 test lines), `general.ts` (535), `security.ts` (570), `performance.ts` (595)
- **What it is:** The testing specialist prompt builder has an 0.27:1 test-to-source ratio. The general/security/performance files share a single 1055-line spec for 1700 lines of source (0.62:1 combined) despite having many conditional branches (language-specific guidance, test-file presence/absence, workspace paths, additive passes). Tests are mostly string-containment checks rather than structural validation.
- **What happens if we don't fix it:** A template bug (e.g., a conditional branch that generates wrong guidance for TypeScript vs. C# files) would ship silently. The prompt is syntactically valid JSON but semantically wrong.
- **Proposed fix:** Test each conditional branch. Use snapshot testing or structural validation of generated prompts.
- **Effort:** Large
- **Recommendation:** **Strongly recommended before release.** These prompts are the product.

---

### 2.11 Dynamic Import of `fast.ts` in Engine

- **Files:** `src/review/engine.ts` (line 1174)
- **What it is:** The fast-review prompt builder is the only prompt builder imported dynamically. All others are imported statically. If the dynamic import fails (typo, bundler issue), the error surfaces only when a user triggers a fast review, not at startup.
- **Proposed fix:** Static-import it alongside the other prompt builders.
- **Effort:** Small
- **Recommendation:** **Fix before release.** Simple safety improvement.

---

### 2.12 Copy-pasted `buildSelectedPassesSection` in Two Files

- **Files:** `src/ai/prompts/specialists/general.ts` (lines 169-181), `fast.ts` (lines 64-76)
- **What it is:** These identically-named functions exist in both files. Any change to pass descriptions must be made in two places.
- **Proposed fix:** Extract to `src/ai/prompts/shared/passHelpers.ts`.
- **Effort:** Small
- **Recommendation:** **Fix before release.** Duplication risk.

---

## Tier 3 -- Refactoring Opportunities

These improve maintainability and reduce defect risk without changing behavior. Safe to defer past v2.0.

---

### 3.1 Decompose `ReviewEngine` (1350 lines)

- **Files:** `src/review/engine.ts`
- **What it is:** `ReviewEngine` is a God Class orchestrating PR data fetching, workspace resolution, repo cloning, diff formatting, diff storage, file-level review, cross-file analysis, line number validation, comment posting, audit logging, and state caching. A bug in any of these concerns means touching a 1350-line file.
- **What happens if we don't fix it:** Nothing immediately. But each feature added (e.g., AI provider retry policies, new comment formats, GitLab support) bloats this class further.
- **Proposed fix:** Extract into `ReviewOrchestrator` that delegates to `DiffService`, `LineValidator`, `WorkspaceResolver`, and `ReviewRunner`.
- **Effort:** Large
- **Recommendation:** **Do after v2.0.** Too risky to refactor alongside breaking changes. v2.1 goal.

---

### 3.2 Decompose Specialist Prompt Builders

- **Files:** `src/ai/prompts/specialists/testing.ts`, `security.ts`, `performance.ts`, `general.ts`
- **What it is:** Each specialist prompt builder is 500-800 lines of nested ternaries, inline JSON examples, and repeated sections. All four follow the exact same structural skeleton (Preamble, Role, Workspace, Scope, Files, Focus Areas, Verification, Examples, Self-Challenge, Output Format). The inline examples alone are ~150 lines each, hardcoded inside template literals.
- **What happens if we don't fix it:** Adding a new specialist (e.g., accessibility) requires copy-pasting the skeleton again. Changing the preamble format requires editing four files.
- **Proposed fix:** Create a `buildSpecialistPrompt(config)` factory function. Move examples to `src/ai/prompts/examples/`.
- **Effort:** Large
- **Recommendation:** **Do after v2.0.** Pure refactoring, no user-facing change.

---

### 3.3 Shared Prompt Infrastructure

Beyond `buildWorkspaceSection`, five helper functions are copy-pasted:

- `buildFilesListing()` -- duplicated in all 5 specialists
- `buildAdditionalContextSections()` -- `general.ts` and `fast.ts`
- `FILE_REVIEW_PASS_DETAILS` / `CROSS_FILE_PASS_DETAILS` -- large inline data structures
- Step-numbering ternaries in `outputFormats.ts` -- fragile if a third instruction type is added

**Proposed fix:** Consolidate into `src/ai/prompts/shared/`. Extract pass details into a dedicated data file.

---

### 3.4 Prompt Output Format JSON Schemas Untyped

- **Files:** `src/ai/prompts/specialists/outputFormats.ts` (lines 49-66, 85-100, 108-140)
- **What it is:** The JSON output format schemas (defining the structure the AI should respond with) are raw JSON strings inside JavaScript template literals. A typo in a field name would go unnoticed until AI parsing fails at runtime.
- **Proposed fix:** Define typed constants and `JSON.stringify` them at runtime for compile-time validation.
- **Effort:** Medium

---

### 3.5 Token Usage Utility Has Repeated Pattern

- **Files:** `src/utils/tokenUsage.ts` (lines 30-46)
- **What it is:** The pattern `(sum > 0 || a.field !== undefined || b.field !== undefined) ? sum : undefined` is repeated four times for each token field.
- **Proposed fix:** Extract a `sumOptional(a, b)` helper.
- **Effort:** Trivial

---

### 3.6 Azure Sequential HTTP Requests

- **Files:** `src/platforms/azure.ts` (lines 359-455)
- **What it is:** For a PR with 50 files, `generateDiffFromBlobs` makes up to 100 sequential HTTP requests (base + target content for each file). Review time grows linearly with file count; for a large PR, the Azure API calls alone could take 30+ seconds.
- **Proposed fix:** Use `Promise.all` with bounded concurrency (e.g., 5 simultaneous requests).
- **Effort:** Small

---

## Tier 4 -- Nice to Have

Low effort, low risk. Good for sprint filler or a new contributor.

| #   | Issue                                                                                  | File                        | Effort  |
| --- | -------------------------------------------------------------------------------------- | --------------------------- | ------- |
| 4.1 | `_AzureChangeType` constant defined but never used                                     | `azure.ts:22-27`            | Trivial |
| 4.2 | magic number `50` for truncation in `prIdentifier.ts:81`                               | `utils/prIdentifier.ts`     | Trivial |
| 4.3 | Comment body may exceed API length limits (65K chars)                                  | `commentManager.ts:273-291` | Small   |
| 4.4 | `verbose` semantic is inverted (controls all output, not just debug)                   | `engine.ts:1321`            | Small   |
| 4.5 | GitHub comment posting has TOCTOU race on commit SHA                                   | `github.ts:181-199`         | Trivial |
| 4.6 | `formatModelName` returns "Default model" when no model configured                     | `commentManager.ts:344-350` | Trivial |
| 4.7 | `premiumRequests` field in `mergeTokenUsage` has inconsistent handling vs other fields | `tokenUsage.ts:43-46`       | Trivial |
| 4.8 | `redact.ts` should accept a configurable redaction marker                              | `utils/redact.ts:48`        | Trivial |
| 4.9 | `prIdentifier.ts` hardcodes `"PR"` prefix; won't work with GitLab "MR"                 | `utils/prIdentifier.ts:50`  | Trivial |

---

## Already Planned as v2.0 Changes (in CHANGELOG `[Unreleased]`)

These are documented in the CHANGELOG and are already in progress or planned:

1. Remove `--runs` / `MM_REVIEW_RUNS` (multi-run mode removed)
2. Remove all deprecated provider-specific CLI options (`--agent-timeout`, `--copilot-model`, `--copilot-sdk-model`, `--copilot-sdk-base-url`, `--copilot-sdk-api-key`, `--opencode-model`, `--opencode-sdk-model`, and all provider-specific `--*-timeout` flags)
3. Remove all deprecated provider-specific env vars (`MM_AGENT_TIMEOUT`, `MM_COPILOT_*`, `MM_OPENCODE_*`)
4. Remove deprecated `Config` fields (`copilotModel`, `copilotSdkModel`, `opencodeModel`, `opencodeSdkModel`, `copilotTimeoutMs`, `copilotSdkTimeoutMs`, `opencodeTimeoutMs`, `opencodeSdkTimeoutMs`, `reviewRuns`, `customReviewPhases`)
5. Simplify `ReviewEngine` constructor (remove legacy third-argument overload)
6. Remove `GeneralReviewPhase` type alias and `parseCustomReviewPhases` function
7. Remove `customReviewPhases` from `ReviewCommentManagerOptions`

---

## Summary

| Tier                  | Count | Should Block v2.0?              |
| --------------------- | ----- | ------------------------------- |
| Tier 1 (Breaking)     | 12    | Yes -- 11 recommended blocks    |
| Tier 2 (Bugs + Tests) | 12    | Yes -- 6 must-fix, 6 should-fix |
| Tier 3 (Refactoring)  | 6     | No -- do after v2.0             |
| Tier 4 (Polish)       | 9     | No -- sprint filler             |

### Recommended Go/No-Go Criteria for v2.0

**Must complete before release:**

- [ ] 1.1: Extract shared `BaseAIProvider` (the biggest single item)
- [ ] 1.2: Consolidate error classes
- [ ] 1.3: Add `getPlatformName()` to `PlatformAdapter`
- [ ] 2.1: Fix Azure change type bitmask bug
- [ ] 2.2: Add binary file detection in Azure
- [ ] 2.5: Fix summary table category omission
- [ ] 2.8: Write tests for `reviewSelection.ts`
- [ ] 2.9: Write tests for `diffStorage.ts`

**Strongly recommended before release:**

- [ ] 1.4: Extract `buildWorkspaceSection` (touches AI prompts)
- [ ] 1.5: Standardize "passes" vs "phases" naming
- [ ] 1.6: Route `verbose` through config
- [x] 1.7: Remove `tokenSaver` dead field
- [ ] 1.8: Fix `streamingLines` defaults
- [ ] 1.9: Fix Azure error swallowing
- [ ] 1.10: Narrow adapter constructors
- [ ] 1.11: Extract `BaseCrossFileContext`
- [ ] 2.3: Route Azure raw fetch through rate limiting
- [ ] 2.4: Validate PR number parsing
- [ ] 2.6: Make `executeAction` switch exhaustive
- [ ] 2.7: Rename `stream` to `streamingEnabled`
- [ ] 2.10: Increase specialist prompt test coverage
- [ ] 2.11: Static-import `fast.ts`
- [ ] 2.12: Extract `buildSelectedPassesSection`

**Can ship after v2.0:**

- [ ] 3.1: Decompose `ReviewEngine`
- [ ] 3.2: Decompose specialist prompt builders
- [ ] 3.3 - 3.6: Remaining Tier 3 refactoring
- [ ] 4.1 - 4.9: All Tier 4 polish items
