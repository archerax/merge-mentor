# Merge Mentor — Project Review

**Date:** 2026-02-23
**Reviewer:** GitHub Copilot (Claude Opus 4.6)
**Version:** 1.12.0
**Scope:** Full codebase re-review — architecture, code quality, testing, security, and maintainability

---

## Executive Summary

Merge Mentor is an automated code review CLI that now abstracts across **four** AI providers (Copilot CLI, Copilot SDK, OpenCode, Cursor) and two platforms (GitHub, Azure DevOps). The project demonstrates strong fundamentals: strict TypeScript, immutable interfaces with `readonly`, clean factory/strategy patterns, comprehensive error types, and a disciplined testing culture (777 passing tests, 8 skipped).

Since the initial review, a fourth AI provider (`copilot-sdk`) was added using the `@github/copilot-sdk` package, along with new test files for provider validation and SDK coverage. However, the **build is now broken** (2 TypeScript errors in `copilot-sdk.ts`) and the **linter is failing** (46 CRLF formatting violations). The `providerFactory.spec.ts` test suite is also flaky — failing in normal runs but passing during coverage collection.

The **single largest concern** remains massive code duplication, which has **worsened** — the four AI provider implementations now share ~2,400 lines of identical logic (up from ~1,800). The review engine has grown to 1,228 lines. The specialist prompt files still duplicate verification/self-challenge sections verbatim. Security-sensitive patterns (shell command injection via `exec()`, token leakage in URLs) remain unaddressed.

Of the 30 findings from the initial review, **3 were fixed** (F14, F24, F30), **2 were partially improved** (F11, F13), and **25 remain open**. Five new issues were identified.

**Bottom line:** The project has added valuable new capability (SDK provider) but accrued additional debt in the process. The immediate priority should be restoring a clean build/lint pipeline, then addressing the growing duplication before adding more providers.

---

## Metrics Snapshot

| Metric                | Value                                           | Δ vs. Prior          |
| --------------------- | ----------------------------------------------- | -------------------- |
| Production code       | 11,823 lines across 40 files                    | +507 lines, +1 file  |
| Unit test code        | 9,474 lines across 31 spec files                | +125 lines, +1 file  |
| Integration test code | 1,701 lines across 4 test files                 | −413 lines           |
| Unit tests            | 777 passing, 8 skipped                          | +4 passing           |
| Build status          | ❌ **BROKEN** — 2 TS errors in `copilot-sdk.ts` | was ✅               |
| Lint status           | ❌ **BROKEN** — 46 CRLF formatting errors       | was ✅               |
| Test suites           | 1 flaky (`providerFactory.spec.ts`)             | was 0                |
| Bundle size           | 227.9 KB (production, minified)                 | +7.1 KB              |
| Coverage thresholds   | 85% lines/functions/branches/statements         | unchanged            |
| Actual coverage       | 81.48% lines, 72.15% branches, 88.07% funcs     | **below thresholds** |

---

## Findings

### 🔴 Critical — Build & Pipeline

#### F-NEW1. Build is broken — `copilot-sdk.ts` TypeScript errors

**File:** `src/ai/providers/copilot-sdk.ts`

`tsc --noEmit` fails with 2 errors:

1. **TS2307:** Cannot find module `@github/copilot-sdk` — the package is installed in `node_modules` but TypeScript cannot resolve its type declarations.
2. **TS7006:** Parameter `event` implicitly has an `any` type — in the `session.on("assistant.message_delta", (event) => { ... })` callback.

**Impact:** No production build can be created. The `pnpm check` pipeline is completely blocked.

**Recommendation:** Add type declarations for the SDK (either `@types/` package, a local `.d.ts` file, or explicit type annotations on the callback parameter). Verify module resolution settings in `tsconfig.json`.

#### F-NEW2. Lint pipeline is broken — 46 CRLF formatting errors

**Files:** All `.ts` files across the project

Biome reports 46 formatting violations, all related to CRLF (`\r\n`) line endings. This indicates the repository's line ending configuration (`.gitattributes` or editor settings) is inconsistent with Biome's expectations.

**Impact:** `pnpm lint` fails, blocking the `pnpm check` pipeline.

**Recommendation:** Add a `.gitattributes` file with `* text=auto eol=lf` and run `biome check --write` to normalize all files. Ensure editor settings enforce LF.

#### F-NEW3. Flaky test suite — `providerFactory.spec.ts`

**File:** `src/ai/providerFactory.spec.ts`

This test file fails during `pnpm test` (Error: Cannot find package `@github/copilot-sdk`) but passes during `pnpm test:coverage`. The failure occurs because `providerFactory.ts` statically imports `copilot-sdk.ts`, which imports the SDK package. The inconsistency between runs suggests a module resolution timing or caching issue.

**Impact:** CI reliability is undermined — test results vary between runs.

**Recommendation:** Mock the `@github/copilot-sdk` import in the test file, or use dynamic imports to lazily load the SDK provider so the factory module doesn't fail when the SDK is unavailable.

---

### 🔴 Critical — Architecture & Duplication

#### F1. Massive duplication across AI provider files — **WORSENED**

**Files:** `src/ai/providers/copilot.ts` (960 lines), `copilot-sdk.ts` (572), `cursor.ts` (552), `opencode.ts` (552)

The **four** provider files now share ~2,400 lines of near-identical code (up from ~1,800 with three providers): all `Raw*` interfaces, `parseResponse`, `parseCrossFileResponse`, `mapRawFindingsToFindings`, `mapRawCrossFileFindingsToFindings`, `validateResponse`, `normalizeCategory`, `normalizeSeverity`, `normalizeConfidence`, `parseTokenUsage`, and retry-loop patterns.

The addition of `copilot-sdk.ts` copied all validation and parsing logic a fourth time. Any bug fix or schema change must now be applied in **four** places.

**Recommendation:** Extract a `BaseCliProvider` abstract class or shared module. Each concrete provider defines only its execution mechanism and unique features.

#### F2. Duplicated prompt sections across 6+ specialist files

**Status:** Unchanged from prior review.

**Files:** `src/ai/prompts/specialists/general.ts`, `security.ts`, `performance.ts`, `testing.ts`, `fast.ts`, and `prompts.ts`

`buildWorkspaceContextSection()` is duplicated verbatim 5 times. Verification checklists, self-challenge sections, severity thresholds, and confidence definitions are copy-pasted across all specialist prompt files.

**Recommendation:** Create `src/ai/prompts/shared.ts` with composable prompt-building functions.

#### F3. Review engine is a god class — **GROWN to 1,228 lines**

**File:** `src/review/engine.ts` (was 1,106 lines, now 1,228)

`ReviewEngine` handles 12+ responsibilities: PR orchestration, file review dispatch, cross-file analysis, fast review mode, multi-run aggregation, comment execution, line number validation, diff storage management, repo cloning, streaming display, and more. Tests access private methods via 4 `as any` casts.

**Recommendation:** Decompose into focused collaborators: `FileReviewDispatcher`, `CommentExecutor`, `LineValidator`, `ReviewCacheManager`. The engine becomes a thin orchestrator.

---

### 🟠 High — Security

#### F4. Command injection risk in `repoManager.ts`

**Status:** Unchanged from prior review.

**File:** `src/review/repoManager.ts`

Branch names and repository URLs are interpolated directly into shell commands via `exec()` (promisified `child_process.exec`). Commands like `` `git clone --depth 1 --single-branch --branch ${branch} "${cloneUrl}" "${repoPath}"` `` are vulnerable to injection via crafted branch names.

**Recommendation:** Use `execFile()` (which doesn't invoke a shell) or validate/escape all arguments before interpolation.

#### F5. Token leakage in clone URLs

**Status:** Unchanged from prior review.

**Files:** `src/review/repoManager.ts`, `src/platforms/azure.ts`

Tokens are embedded in git clone URLs. Failed commands may expose tokens in error messages and logs.

**Recommendation:** Use `GIT_ASKPASS` or credential helpers. Redact tokens in error output at minimum.

#### F6. Biome linter has `noExplicitAny: "off"` and `noNonNullAssertion: "off"`

**File:** `biome.json`

Both `noExplicitAny` and `noNonNullAssertion` are disabled project-wide, weakening type safety. AGENTS.md says "Avoid `any`."

**Recommendation:** Enable both as warnings, then progressively fix violations.

---

### 🟡 Medium — Code Quality

#### F7. `program.ts` duplicates config loading

**Status:** Unchanged. **File:** `src/program.ts` (660 lines, was 647)

The review command's `.action()` handler calls `loadConfig()` redundantly — `executeReview()` already does this internally.

#### F8. Missing pagination in GitHub adapter

**Status:** Unchanged. **File:** `src/platforms/github.ts`

`getFilesForPR()`, `getExistingComments()`, and `getDiffForPR()` all use `per_page: DEFAULT_PAGE_SIZE` with no pagination loop. PRs with more than 100 files or comments will have silently truncated results.

**Recommendation:** Use Octokit's `paginate()` helper.

#### F11. `console.log` in production code

**Status:** Partially improved — now limited to the `logProgress()` helper at line 1199 of `engine.ts`, which is wrapped in a TTY check. Three additional `console.log` references in JSDoc examples (not actual code).

#### F12. Inconsistent error class organization

**Status:** Unchanged. `CursorCliError` and `OpenCodeCliError` are defined locally in their provider files (`cursor.ts`, `opencode.ts`), while `CopilotCliError` and `CopilotSdkError` live in `src/errors/index.ts`.

#### F13. Audit logger — positional parameters and hardcoded resource type

**Status:** Partially improved. `logCopilotExecution()` is now deprecated and delegates to generic `logAIProviderExecution()`, which accepts a provider parameter. However, methods still use up to 7 positional parameters instead of options objects. The resource type in audit events is still hardcoded to `"copilot"` regardless of provider.

#### F15. `languageDetector.ts` only supports 2 languages

**Status:** Unchanged. **File:** `src/utils/languageDetector.ts` (34 lines)

Only C# (`.cs`, `.csx`) and TypeScript (`.ts`, `.tsx`, `.mts`, `.cts`) are detected. JavaScript, Python, Go, Java, Rust, Ruby, PHP all return `"unknown"`.

#### F16. Module-level mutable cache with no invalidation

**Status:** Unchanged across all four provider files.

#### F17. Dynamic imports inside methods

**Status:** Unchanged in `engine.ts`.

#### F-NEW4. New `copilot-sdk.ts` uses weak temp filename entropy

**File:** `src/ai/providers/copilot-sdk.ts`

Uses `Date.now() + Math.random().toString(36)` for temp file naming. The random portion has only ~31 bits of entropy. Under high concurrency, collisions could occur.

**Recommendation:** Use `crypto.randomUUID()` for collision-resistant temp filenames.

#### F-NEW5. `program.ts` uses `console.log` extensively

**File:** `src/program.ts`

Contains 30+ `console.log` calls for CLI output across the `review`, `doctor`, and other commands. While some CLI output is expected, this bypasses the structured logger and makes output testing difficult.

**Recommendation:** Introduce a display/output layer that can be mocked in tests and redirected in non-TTY environments.

---

### 🟢 Low — Minor Issues

#### F18. Missing `sanitizeProjectName()` in `generatePRIdentifier()`

**Status:** Unchanged.

#### F20. Hardcoded categories in comment summary

**Status:** Unchanged. `src/review/commentManager.ts` summary table still only shows 5 of 12 possible categories (bug, security, performance, quality, documentation).

#### F21. Review state cache has no size limits or TTL

**Status:** Unchanged. Cache files grow unboundedly.

#### F22. Stale/orphan comments in barrel file

**Status:** Unchanged. `src/ai/index.ts` has comments referencing removed exports.

#### F23. `diffStorage.ts` Windows path handling

**Status:** Unchanged. `sanitizePath()` only replaces forward slashes (`/`), not backslashes (`\`).

#### F25. `findingAggregator.ts` is a stateless class

**Status:** Unchanged.

---

### ✅ Fixed Since Prior Review

#### F14. Duplicate `PRDetails` interface — **FIXED**

`repoManager.ts` no longer defines its own `PRDetails` interface. It imports from `src/platforms/types.ts`.

#### F24. Unused `AZURE_THREAD_STATUS` constant — **FIXED**

The constant has been removed from `src/platforms/azure.ts`.

#### F30. No-op assertions in platform tests — **FIXED**

No `expect(true).toBe(true)` tautologies remain in the test suite.

---

### 🧪 Testing Gaps

#### F26. Files with 0% test coverage

| File                                  | Risk                                            |
| ------------------------------------- | ----------------------------------------------- |
| `src/ai/prompts/specialists/fast.ts`  | Medium — fast review prompt builder (246 lines) |
| `src/cli.ts`                          | Low — entry point                               |
| `src/ai/index.ts`                     | Low — barrel file with stale comments           |
| `src/ai/types.ts`                     | Low — pure type definitions                     |
| `src/ai/prompts/specialists/types.ts` | Low — pure type definitions                     |
| `src/audit/index.ts`                  | Low — barrel file                               |
| `src/platforms/types.ts`              | Low — pure type definitions                     |

#### F27. Files with weak test coverage

| File                                        | Coverage (Stmts) | Issue                                                          |
| ------------------------------------------- | ---------------- | -------------------------------------------------------------- |
| `src/program.ts`                            | 58.82%           | CLI action handlers, repo management, doctor command uncovered |
| `src/ai/providers/opencode.ts`              | 64.67%           | Duplicated code from copilot with lower coverage               |
| `src/ai/providers/cursor.ts`                | 65.86%           | Same duplication issue                                         |
| `src/review/engine.ts`                      | 73.14%           | 8 skipped tests; 4 `as any` casts for private method access    |
| `src/review/diffStorage.ts`                 | 77.50%           | No dedicated spec file                                         |
| `src/ai/prompts/specialists/security.ts`    | 53.33%           | Cross-file prompt builder uncovered                            |
| `src/ai/prompts/specialists/performance.ts` | 53.33%           | Cross-file prompt builder uncovered                            |

#### F28. Logger tests are smoke-level only

**Status:** Unchanged. 5 tests, no behavior verification.

#### F29. 8 skipped tests in engine.spec.ts

**Status:** Unchanged. Labeled "disabled in Phase 1" — 2 individual `test.skip()` calls and 1 `describe.skip()` block containing 6 tests for specialized review mode.

#### F-NEW6. Overall coverage below thresholds

The configured coverage thresholds are 85% for all metrics, but actual coverage is:

- **Statements:** 81.43% (threshold: 85%)
- **Branches:** 72.15% (threshold: 85%)
- **Functions:** 88.07% (threshold: 85%) ✅
- **Lines:** 81.48% (threshold: 85%)

Only function coverage meets the threshold. Branch coverage is the weakest at 72.15%.

---

## Strengths Worth Preserving

1. **`readonly` on all interface properties** — excellent immutability discipline throughout
2. **Factory + Strategy patterns** — `createAIProvider()` cleanly supports 4 providers via the `AIProviderClient` interface
3. **Comprehensive error hierarchy** — `MergeMentorError` subtypes with structured properties; `CopilotSdkError` properly added to central module
4. **Audit logging** — consistent success/failure logging on all operations
5. **Defensive JSON parsing** — all providers gracefully handle malformed AI responses with fallback defaults
6. **Prompt anti-examples** — teaching the AI what NOT to report is strong prompt engineering
7. **Rate limit handler** — elegant higher-order function with exponential backoff + jitter
8. **Reasoning validation** — quality gate checking AI output reasoning depth (new `validation.spec.ts` with 14 tests)
9. **Test data factories** — `createMockResult()`, `createMockFinding()`, etc. are well-used
10. **Clean tooling chain** — TypeScript strict mode, Biome, Knip, Vitest, esbuild — modern and fast (when pipeline is green)
11. **New SDK provider** — `copilot-sdk.ts` adds Copilot SDK integration with comprehensive tests (16 passing)

---

## Top 10 Next Steps

### 1. Fix broken build and lint pipeline

**Priority:** 🔴 Critical | **Effort:** Small | **Impact:** Unblocks all development

- Fix `copilot-sdk.ts` TypeScript errors (add type declarations or annotations)
- Normalize line endings to LF across all files
- Add `.gitattributes` with `* text=auto eol=lf`
- Fix flaky `providerFactory.spec.ts` (mock SDK import or use dynamic imports)

### 2. Extract shared AI provider base class

**Priority:** 🔴 Critical | **Effort:** Large | **Impact:** Eliminates ~2,400 lines of duplication

Create `BaseCliProvider` with all shared parsing, validation, mapping, and retry logic. Each of the 4 providers implements only its execution mechanism and unique features. Move `CursorCliError` and `OpenCodeCliError` into `src/errors/`.

### 3. Extract shared prompt sections

**Priority:** 🔴 Critical | **Effort:** Medium | **Impact:** Eliminates ~2,000 lines of duplication

Create `src/ai/prompts/shared.ts` with composable prompt-building functions: `buildWorkspaceContextSection()`, `buildVerificationChecklist()`, `buildSelfChallengeSection()`, `buildSeverityThresholds()`, `buildConfidenceDefinitions()`.

### 4. Decompose `ReviewEngine` into focused collaborators

**Priority:** 🟠 High | **Effort:** Large | **Impact:** Improved testability, maintainability

Extract: `FileReviewDispatcher`, `CommentExecutor`, `LineValidator`, `ReviewCacheManager`. Remove `as any` test casts by testing through public API.

### 5. Fix command injection and token leakage vulnerabilities

**Priority:** 🟠 High | **Effort:** Small | **Impact:** Security hardening

Replace `exec()` with `execFile()` in `repoManager.ts`. Redact tokens in error output. Use `GIT_ASKPASS` instead of URL-embedded tokens.

### 6. Implement GitHub pagination

**Priority:** 🟡 Medium | **Effort:** Small | **Impact:** Correct handling of large PRs

Use Octokit's `paginate()` in `getFilesForPR()`, `getExistingComments()`, and `getDiffForPR()`.

### 7. Close test coverage gaps — reach 85% thresholds

**Priority:** 🟡 Medium | **Effort:** Medium | **Impact:** Restore CI coverage gates

- Add `diffStorage.spec.ts` and `fast.spec.ts`
- Strengthen `logger.spec.ts` with behavior tests
- Increase `program.ts` coverage (currently 58.82%)
- Increase `cursor.ts`/`opencode.ts` coverage (currently ~65%) — or extract base class first
- Re-enable or remove the 8 skipped engine tests
- Focus on branch coverage (currently 72.15% vs 85% threshold)

### 8. Refactor audit logger to use options objects

**Priority:** 🟡 Medium | **Effort:** Small | **Impact:** Clean code compliance

Replace positional parameters with typed options objects. Fix hardcoded `"copilot"` resource type.

### 9. Expand `languageDetector` to support more languages

**Priority:** 🟡 Medium | **Effort:** Small | **Impact:** Better review quality for polyglot repos

Replace `if/else` chain with data-driven `Map<string, Language>` covering JavaScript, Python, Go, Java, Rust, Ruby, PHP.

### 10. Enable `noExplicitAny` and `noNonNullAssertion` in Biome

**Priority:** 🟢 Low | **Effort:** Medium (progressive) | **Impact:** Type safety

Enable as warnings, fix progressively. Base class extraction (Step 2) will eliminate many `any` usages.

---

## Finding Status Summary

| Finding    | Description                                     | Status                         |
| ---------- | ----------------------------------------------- | ------------------------------ |
| **F-NEW1** | Build broken — `copilot-sdk.ts` TS errors       | 🔴 NEW                         |
| **F-NEW2** | Lint broken — 46 CRLF formatting errors         | 🔴 NEW                         |
| **F-NEW3** | Flaky `providerFactory.spec.ts`                 | 🟠 NEW                         |
| **F1**     | Provider duplication (now 4 files)              | ❌ WORSENED                    |
| **F2**     | Prompt section duplication                      | ❌ Not fixed                   |
| **F3**     | Engine god class (now 1,228 lines)              | ❌ WORSENED                    |
| **F4**     | Command injection in repoManager                | ❌ Not fixed                   |
| **F5**     | Token leakage in clone URLs                     | ❌ Not fixed                   |
| **F6**     | `noExplicitAny` + `noNonNullAssertion` disabled | ❌ Not fixed                   |
| **F7**     | Duplicate config loading in `program.ts`        | ❌ Not fixed                   |
| **F8**     | GitHub missing pagination                       | ❌ Not fixed                   |
| **F11**    | `console.log` in engine.ts                      | ⚠️ Partially improved          |
| **F12**    | Error classes not centralized                   | ❌ Not fixed                   |
| **F13**    | Audit logger positional params                  | ⚠️ Partially improved          |
| **F14**    | Duplicate `PRDetails` interface                 | ✅ **FIXED**                   |
| **F15**    | Language detector limited to 2 languages        | ❌ Not fixed                   |
| **F16**    | Mutable cache, no invalidation                  | ❌ Not fixed                   |
| **F17**    | Dynamic imports in engine methods               | ❌ Not fixed                   |
| **F18**    | Missing `sanitizeProjectName()` call            | ❌ Not fixed                   |
| **F20**    | Hardcoded categories in summary                 | ❌ Not fixed                   |
| **F21**    | Cache has no size limits or TTL                 | ❌ Not fixed                   |
| **F22**    | Stale comments in barrel file                   | ❌ Not fixed                   |
| **F23**    | Windows backslash handling in diffStorage       | ❌ Not fixed                   |
| **F24**    | Unused Azure constant                           | ✅ **FIXED**                   |
| **F25**    | Stateless `FindingAggregator` class             | ❌ Not fixed                   |
| **F26**    | Files with 0% coverage                          | ❌ Not fixed                   |
| **F27**    | Files with weak coverage                        | ❌ WORSENED (below thresholds) |
| **F28**    | Logger tests smoke-level only                   | ❌ Not fixed                   |
| **F29**    | 8 skipped engine tests                          | ❌ Not fixed                   |
| **F30**    | No-op assertions in platform tests              | ✅ **FIXED**                   |
| **F-NEW4** | Weak temp filename entropy                      | 🟢 NEW                         |
| **F-NEW5** | `program.ts` excessive `console.log`            | 🟡 NEW                         |
| **F-NEW6** | Overall coverage below thresholds               | 🟡 NEW                         |

**Totals:** 3 fixed, 2 partially improved, 20 unchanged, 3 worsened, 6 new issues

---

## Appendix: File Size Distribution

| File                                        | Lines | Status                                 |
| ------------------------------------------- | ----- | -------------------------------------- |
| `src/review/engine.ts`                      | 1,228 | 🔴 Decompose (was 1,106)               |
| `src/ai/providers/copilot.ts`               | 960   | 🔴 Extract base class                  |
| `src/ai/prompts/specialists/testing.ts`     | 748   | 🟡 Extract shared sections             |
| `src/ai/prompts/prompts.ts`                 | 671   | 🟡 Extract shared sections             |
| `src/program.ts`                            | 660   | 🟡 Remove duplication (was 647)        |
| `src/ai/prompts/severityContext.ts`         | 574   | ✅ Acceptable (data-heavy)             |
| `src/ai/providers/copilot-sdk.ts`           | 572   | 🔴 Extract base class (NEW)            |
| `src/ai/providers/opencode.ts`              | 552   | 🔴 Extract base class                  |
| `src/ai/providers/cursor.ts`                | 552   | 🔴 Extract base class                  |
| `src/ai/prompts/specialists/performance.ts` | 546   | 🟡 Extract shared sections             |
| `src/platforms/azure.ts`                    | 526   | 🟡 Consider extracting diff generation |
| `src/ai/prompts/specialists/security.ts`    | 523   | 🟡 Extract shared sections             |
| `src/ai/prompts/specialists/general.ts`     | 362   | 🟡 Extract shared sections             |
| `src/audit/auditLogger.ts`                  | 349   | 🟡 Refactor to options objects         |
| All other files                             | < 300 | ✅ Appropriate size                    |
