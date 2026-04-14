# Merge Mentor — Executive Status Report

**Date:** 2026-03-28
**Version:** 1.20.0
**Prepared by:** CTO (GitHub Copilot)
**Audience:** CEO / Executive Team

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Product Overview](#product-overview)
3. [Metrics Snapshot](#metrics-snapshot)
4. [What We Are Doing Well](#what-we-are-doing-well)
5. [What We Are Doing Badly](#what-we-are-doing-badly)
6. [Risks](#risks)
7. [The Planned Next Feature](#the-planned-next-feature)
8. [Recommended Priorities](#recommended-priorities)

---

## Executive Summary

The product is **functionally solid and shipping**. We have 20 minor versions since the December 2025 launch, a clean build, and 777 tests all passing. We have a competitive feature set across 4 AI providers, 2 VCS platforms, and 5 review types.

However, meaningful technical debt is accumulating in three areas — code duplication, coverage gaps, and two unresolved security issues — and there are two risks I would characterise as genuine business concerns (licensing and platform compatibility). The main threats are technical debt compounding faster than we are paying it down, and legal/adoption blockers that need executive decisions, not engineering ones.

---

## Product Overview

Merge Mentor is an automated AI-powered code review CLI and bot. It analyzes pull request diffs using local AI CLI tools and posts structured findings (bugs, security vulnerabilities, performance issues, code quality) as inline comments on GitHub and Azure DevOps pull requests.

### Supported AI Providers

| Provider | Type | Notes |
|---|---|---|
| GitHub Copilot CLI | CLI subprocess | Default provider |
| GitHub Copilot SDK | Native SDK (`@github/copilot-sdk`) | Added in v1.18+ |
| OpenCode CLI | CLI subprocess | Third-party |
| Cursor CLI | CLI subprocess | Third-party |

### Supported Platforms

| Platform | Status |
|---|---|
| GitHub | ✅ Full support |
| Azure DevOps | ✅ Full support |

### Review Types

| Type | Description |
|---|---|
| `general` | Comprehensive default review |
| `fast` | Single-pass cost-optimised review (~50% cheaper) |
| `testing` | Focused on test coverage and quality |
| `security` | Focused on vulnerabilities and threats |
| `performance` | Focused on efficiency and optimisation |

### Key Features

- **Incremental caching** — Only reviews files changed since the last run (85% faster on re-reviews)
- **Smart deduplication** — Never posts the same comment twice
- **Auto-resolution** — Detects when issues are fixed and resolves comments with an explanation
- **Multi-run mode** — Aggregates findings across N passes for thoroughness
- **Confidence filtering** — Posts only high-confidence findings by default
- **Dry-run markdown reports** — Full review reports written to `.mergementor/reports/` without posting
- **Streaming output** — Real-time display of AI output during review
- **Audit logging** — Structured JSON audit trail of all bot actions for compliance
- **Rate limit handling** — Exponential backoff with jitter for API throttling

---

## Metrics Snapshot

| Metric | Value |
|---|---|
| Version | 1.20.0 |
| Production source files | 40 TypeScript files |
| Production lines of code | ~11,800 lines |
| Test files | 31 spec files |
| Test lines of code | ~9,500 lines |
| Tests passing | **777 passing, 8 skipped** |
| Test suites | **31 / 31 passing** |
| Build status | ✅ Clean |
| Lint status | ✅ Clean |
| Bundle size | 228.5 KB (minified, production) |
| Node.js requirement | `>= 24.0.0` |
| License | ⚠️ **UNLICENSED** |

### Test Coverage vs. Configured Thresholds

The project has configured an 85% coverage threshold in `vitest.config.ts`, but actual coverage falls short in three of four dimensions:

| Metric | Threshold | Actual | Status |
|---|---|---|---|
| Lines | 85% | 81.46% | ❌ **-3.5%** |
| Branches | 85% | 71.53% | ❌ **-13.5%** |
| Functions | 85% | 84.88% | ⚠️ ~at threshold |
| Statements | 85% | 81.29% | ❌ **-3.7%** |

> **Note:** The threshold is configured but not enforced in CI, so these failures are silent.

---

## What We Are Doing Well

### ✅ Core Product Quality

The build is green, the linter is clean, and every test passes. We have zero `any` usage in production TypeScript — strong discipline that pays dividends in stability. There are no `TODO`/`FIXME` markers in production code. The architecture follows a clean **ports-and-adapters** pattern with proper dependency injection throughout, making modules independently testable.

### ✅ Feature Breadth and Velocity

We moved from v1.0 to v1.20 in roughly three months. The CHANGELOG shows well-scoped releases with clear migration guides for every breaking change. We've shipped a feature set that compares favourably with commercial alternatives: multi-provider, multi-platform, streaming output, incremental reviews, deduplication, auto-resolution, and five specialised review types.

### ✅ Test Discipline

777 tests across 31 suites with a sub-10s total run time is excellent. Test helpers in `src/ports/` enable clean isolation of external dependencies (filesystem, process execution, clock, environment). The testing standards and patterns are consistent across the codebase and well-documented in project instructions.

### ✅ Extensibility

`EXTENDING.md` is a high-quality guide for adding new specialist review types. The architecture makes adding a new specialist genuinely straightforward. This is a real competitive advantage if we want partners or enterprise customers to self-serve new review specialisations.

### ✅ Operational Tooling

Rate limit handling with exponential backoff, per-run timestamped log files, structured audit logging, and dry-run markdown reports all demonstrate production maturity. These are the features that make the difference between a prototype and something you can hand to an enterprise customer.

---

## What We Are Doing Badly

### ❌ Coverage Is Below Our Own Threshold — Silently

We have configured an 85% coverage gate but are not enforcing it in CI. The gate is failing — branches are at 71.5%, which is 13.5 points below target — and nobody is noticing because the CI pipeline does not run `pnpm test:coverage`. Branch coverage misses are specifically where edge-case bugs live.

**Worst offenders:**

| File | Line % | Branch % | Risk |
|---|---|---|---|
| `src/ai/prompts/specialists/fast.ts` | **0%** | **0%** | Shipped feature, zero test coverage |
| `src/ports/fileSystem.ts` | 11% | 100% | Core infrastructure abstraction |
| `src/ports/executableFinder.ts` | 13% | 10% | Finds AI CLI tools on PATH |
| `src/review/engine.ts` | 73% | 72% | Heart of the product — 1,233 lines |
| `src/program.ts` | 58% | 61% | CLI entry point |
| `src/ai/providers/cursor.ts` | 67% | 47% | Customer-facing AI provider |
| `src/ai/providers/opencode.ts` | 66% | 45% | Customer-facing AI provider |

`fast.ts` at 0% is the most visible example: we shipped a documented `--review-type fast` feature with a dedicated CHANGELOG entry, and it has no automated tests. If it regresses, we will not find out until a customer reports it.

### ❌ Multi-Run Mode Tests Are Skipped With No Tracking

The `--runs N` feature (documented in README, shipped in v1.3.0) has **two explicitly skipped tests** in `engine.spec.ts`. Neither skip is annotated with a GitHub issue or explanation. This is a customer-facing feature whose test coverage has been knowingly abandoned. It could stay skipped indefinitely.

```
test.skip("executes multiple runs and aggregates findings", ...)
test.skip("does not wait after last run", ...)
```

### ❌ Code Duplication in AI Providers Is Severe and Worsening

`opencode.ts` and `cursor.ts` are **572 lines each** with nearly identical content — the same CLI execution logic, the same response parsing, the same error handling, different binary name. Combined with `copilot.ts` (1,026 lines) and `copilot-sdk.ts` (659 lines), we are maintaining approximately **2,400 lines of near-duplicate logic** across four files.

Consequences already visible:
- Cursor and OpenCode have identical coverage numbers (45%/47%) — bugs are shared silently
- Every prompt improvement must be applied in four places
- Adding a 5th provider requires copying ~600 lines of boilerplate

This was flagged in `REVIEW.md` (finding F2) and remains unaddressed after multiple releases.

### ❌ `engine.ts` Is a God Class

At 1,233 lines, the review engine handles PR orchestration, file filtering, diff storage writing, comment management, multi-run aggregation, streaming display, and specialist dispatch. It is the file most likely to cause a regression. Its 73%/72% coverage reflects how difficult it is to test comprehensively at this size. It needs decomposition before it becomes genuinely untouchable.

### ❌ GitHub Pagination Is Missing

`getPRFiles()` and `getExistingBotComments()` on the GitHub platform adapter do not paginate. They silently return at most 100 items. A PR with more than 100 changed files is reviewed **incompletely with no warning**. The Azure DevOps adapter already handles batching (fixed in v1.8.0 for a customer-facing bug) — GitHub was never updated to match. This is a correctness bug in production, not a theoretical risk.

---

## Risks

### 🔴 CRITICAL: Command Injection in `repoManager.ts`

Branch names and repository URLs are interpolated directly into shell commands without sanitisation. A PR submitted from a branch named `main; rm -rf /` or similar would execute injected commands at the privilege level of the CI runner.

- **File:** `src/review/repoManager.ts`
- **Tracked since:** `REVIEW.md` finding F4 (v1.12.0 review) — **unaddressed for 3+ months**
- **Exposure:** Any automated CI/CD pipeline using merge-mentor with public PRs
- **Fix:** Use `execFile()` with array arguments instead of string interpolation in `exec()`

This is a pre-authentication remote code execution surface in a tool that runs in privileged CI environments. It must be fixed before any public-facing or multi-tenant deployment.

### 🔴 CRITICAL: GitHub PR Pagination Missing

As described above — PRs with >100 files are silently partially reviewed. This is a correctness bug that could cause us to miss critical issues in large refactors, and customers have no visibility that it is happening.

### 🔴 BUSINESS: License Is UNLICENSED

`package.json` declares `"license": "UNLICENSED"`. This means legally ambiguous distribution rights. If we intend to commercialise, open-source, partner-distribute, or publish to npm, this needs a formal IP decision before we have distributed it to any customers. This is a legal/business risk requiring an executive decision, not an engineering one.

### 🔴 BUSINESS: Node.js 24+ Hard Requirement

We require `node >= 24.0.0`, which is the current latest release. Most enterprises are running Node.js 18 LTS or 20 LTS. This is a meaningful adoption barrier for enterprise customers who cannot upgrade their CI runners or developer machines on short notice.

- **Action needed:** Audit whether any Node 24-specific APIs are actually used, then target Node 20 LTS if feasible — this would immediately expand our addressable enterprise market.

### 🟠 HIGH: Token Leakage in Error Logs

GitHub and Azure DevOps PATs are embedded in git clone URLs during repository operations. If any error surfaces a URL in a log line or exception message, credentials are exposed. The audit logger (`auditLogger.ts`) has 4% uncovered branches — error paths through the logging layer are largely untested. A deliberate audit pass is needed before customer-facing deployment.

### 🟠 HIGH: Linter Guardrails Deliberately Disabled

`biome.json` disables `noExplicitAny` and `noNonNullAssertion` globally. The codebase is currently clean, but we have removed the automated gate that would catch regressions being introduced. With four nearly identical provider files, a copy-paste of `as any` or `value!` from older code would pass review and CI undetected.

### 🟡 MEDIUM: Weak Temporary File Entropy

Temp files are named using `Date.now() + Math.random().toString(36)`, which provides approximately 31 bits of entropy. On a system handling concurrent reviews, this creates a predictable temp file path that a local attacker could target. Standard practice is to use `crypto.randomUUID()` or `os.tmpdir()` with a proper random suffix.

---

## The Planned Next Feature

`PLAN.md` contains a detailed, well-thought-out design for a `merge-mentor serve` subcommand — a long-running HTTP server that receives Azure DevOps PR webhook events, deduplicates them, and queues reviews for sequential processing. The plan covers:

1. A new `serve` CLI subcommand in `program.ts`
2. An HTTP server (`src/server/httpServer.ts`) with `/webhook` and `/health` routes
3. Webhook payload parsing and validation for Azure DevOps service hook schemas
4. A deduplicating in-memory review queue (latest-wins per `org/project/repo/prNumber`)
5. Config extension for `port`, `webhookUsername`, `webhookPassword`
6. Full test suite following existing conventions

**Current implementation status: 0%.** None of the planned modules exist. The plan is high quality and could be executed in a focused sprint, but it needs to be formally staffed if it is on a customer commitment timeline.

---

## Recommended Priorities

### Immediate (this week)

| # | Action | Reason |
|---|---|---|
| 1 | **Fix command injection in `repoManager.ts`** | Pre-auth RCE risk in CI pipelines |
| 2 | **Fix GitHub pagination in `getPRFiles()` / `getExistingBotComments()`** | Silent correctness bug in production |
| 3 | **Decide on license** | Business/legal blocker for distribution |
| 4 | **Wire 85% coverage threshold into CI** | Silent threshold failures for months |

### This Sprint

| # | Action | Reason |
|---|---|---|
| 5 | **Write tests for `fast.ts`** (currently 0%) | Documented feature with no safety net |
| 6 | **Un-skip multi-run tests** | Customer-facing feature with no automation |
| 7 | **Audit Node 24 requirement** — target Node 20 LTS | Enterprise adoption blocker |
| 8 | **Audit token handling in error paths** | Credential leakage risk |

### Next Sprint

| # | Action | Reason |
|---|---|---|
| 9 | **Extract shared AI provider base class** | Eliminates ~1,400 lines of duplication; prevents drift |
| 10 | **Begin webhook server implementation** per PLAN.md | Significant planned feature, needs staffing |

### Ongoing

| # | Action | Reason |
|---|---|---|
| 11 | **Decompose `engine.ts`** into focused modules | 1,233-line god class will cause regressions |
| 12 | **Re-enable linter rules** `noExplicitAny` and `noNonNullAssertion` | Restore automated guardrails |

---

## Appendix: Key Files

| File | Lines | Role |
|---|---|---|
| `src/review/engine.ts` | 1,233 | Core review orchestrator |
| `src/ai/providers/copilot.ts` | 1,026 | Primary AI provider |
| `src/ai/prompts/prompts.ts` | 830 | AI prompt construction |
| `src/ai/prompts/severityContext.ts` | 683 | Severity/category context |
| `src/ai/providers/copilot-sdk.ts` | 659 | Native Copilot SDK provider |
| `src/platforms/azure.ts` | 596 | Azure DevOps adapter |
| `src/ai/providers/opencode.ts` | 572 | OpenCode CLI provider |
| `src/ai/providers/cursor.ts` | 572 | Cursor CLI provider |
| `src/audit/auditLogger.ts` | 382 | Compliance audit logger |
| `src/config.ts` | ~350 | Configuration and validation |

---

*This report was generated by automated codebase analysis and live pipeline execution (`pnpm build`, `pnpm test`, `pnpm test:coverage`, `pnpm lint`) on 2026-03-28.*
