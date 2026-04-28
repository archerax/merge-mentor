# Token Efficiency Investigation

## Background

With BYOK support now available, users pay directly for AI token usage. Output tokens are typically priced at ~5× the rate of input tokens. This makes **output token reduction the highest-leverage opportunity** for cost savings.

This document identifies the key drivers of token waste and ranks them by impact and ease of fix.

---

## Summary: Top Issues by Impact

| # | Issue | Token Type | Est. Cost Impact | Status |
|---|-------|-----------|-----------------|---------|
| 1 | MANDATORY ANALYSIS STRUCTURE | Output | Very High | ✅ DONE |
| 2 | Verbose `reasoning` field requirements | Output | High | Pending |
| 3 | `severityContext` section (~5,000 tokens per prompt) | Input | High | Pending |
| 4 | Excessive examples in each prompt (17–27 examples) | Input | Medium | Pending |
| 5 | Self-challenge & counter-argument documentation | Output | Medium | Pending |
| 6 | Token usage not tracked in SDK providers | Observability | — | Pending |
| 7 | Multi-run cost multiplication with no warnings | Architecture | Medium | ✅ DONE |

---

## Output Token Issues (5× cost multiplier — highest priority)

### 1. MANDATORY ANALYSIS STRUCTURE ✅ DONE

**Implementation:** `--token-saver` flag (`MM_TOKEN_SAVER` env var)

**Where:** `prompts.ts` (`buildBatchedFileReviewPrompt`), `general.ts` (`buildGeneralFileReviewPrompt`), `fast.ts` (`buildFastReviewPrompt`)

**What it does:** Every prompt instructs the model to write out multi-pass analysis as free-form text *before* generating the JSON:

```
## Pass 1: Surface Scan
Line-by-line observations of suspicious patterns

## Pass 2: Security Deep Dive
- Authentication/authorization analysis
…

## Pass 5: Architectural Analysis
…

## Findings Summary
Only after completing all passes above, list findings.
```

**Why it's expensive:** This "think aloud" text is generated as output tokens (5× cost) but is never shown to users or stored anywhere useful. For a medium PR with 10 files, this alone can generate 500–2,000+ output tokens per review call — pure cost with no user-facing value at runtime.

**Recommendation:** Make this an opt-in `verbose`/`thorough` mode. The default should allow the model to reason internally (models still perform multi-pass analysis, they just don't write it out). This is the single biggest quick win.

**Status:** ✅ **Implemented.** Added `--token-saver` CLI flag (and `MM_TOKEN_SAVER` env var) that suppresses the MANDATORY ANALYSIS STRUCTURE preamble and verbose output format examples. Default behavior unchanged (verbose). Users opt in to token savings with `--token-saver` or `MM_TOKEN_SAVER=true`.

---

### 2. Verbose Reasoning Field Requirements

**Where:** All prompt builders via "Verification Documentation Requirements" section

**What it does:** Every finding must include a `reasoning` field with 5 explicit checkpoints:

```
✓ Confirmation: What you verified ("Confirmed line X has Y")
✓ Context check: What surrounding code you examined
✓ Pattern check: Whether you searched for existing solutions
✓ Impact assessment: Concrete consequences of the issue
✓ Severity justification: Why this specific severity level
```

And the example provided shows:
```
✓ Confirmed line 45: users[index] access without bounds check
✓ Scanned lines 40-50: no validation present for index parameter
✓ Checked context: index comes from req.query.id (user-controlled input)
✓ Impact: Runtime TypeError crashes server if index >= users.length
✓ Severity justification: high (production crash risk from user input)
```

**Why it's expensive:** Each finding's `reasoning` field alone can generate 100–300 output tokens. A PR review with 15 findings generates 1,500–4,500 output tokens just for reasoning — at 5× the cost of the same input token count.

**Recommendation:** Introduce a "compact reasoning" mode (could be the default for BYOK). A 1–2 sentence summary is sufficient for most users. Keep the verbose format available but opt-in.

---

### 3. Self-Challenge Requirement and Counter-Argument Documentation

**Where:** 11 occurrences across all prompt files

**What it does:** Instructs the model to document a full counter-argument workflow for each potential finding:
```
Counter-Argument Considered: "..."
Rebuttal: "..."
Decision: ✅ Report / ❌ Don't report
```

With 2–3 full workflow examples shown in each prompt.

**Why it's expensive:** The self-challenge questions are valuable for reducing false positives, but requiring *documented* counter-arguments generates output tokens that users never see. The model can still perform this check mentally.

**Recommendation:** Keep the mental discipline (the "SELF-CHALLENGE REQUIREMENT" questions) but remove the requirement to write out the counter-argument in output. Only require it to influence whether the finding is *included*, not to be documented in the response.

---

## Input Token Issues (1× cost, but still significant)

### 4. `buildSeverityContextSection()` — ~5,000 Input Tokens Per Prompt

**Where:** Called in 13 places across all prompt builders

**What it contains:** 20 detailed examples each showing the same bug in 2–3 different code contexts with full reasoning explanations. This section alone is **~19,800 characters ≈ ~4,957 tokens**.

Example of the scale: Examples 1–20 each have 2–3 multi-paragraph code snippets + reasoning. The table, rules, and 20 examples together dwarf most of the rest of the prompt.

**Why it matters:** This section is appended to every major file review prompt. For a PR with 3 separate AI calls (file review, cross-file, potentially fast review), this section contributes ~15,000 input tokens.

**Recommendation:**
- Reduce from 20 examples to 8–10 representative ones (covering the key patterns)
- Consider only including it for high-sensitivity review types (security, financial)
- Or conditionally include it based on the file contexts being reviewed

---

### 5. Excessive Examples in Prompt Bodies

**File-level counts:**
- `prompts.ts` (batched review): **27 examples** (EXCELLENT/WEAK verification examples)
- `security.ts`: **21 examples**
- `testing.ts`: **18 examples**  
- `performance.ts`: **21 examples**

**Why it matters:** These examples — while helpful for guiding the model — represent thousands of input tokens. Research shows 3–5 good examples typically provide most of the benefit; beyond that, marginal gains don't justify the cost.

**Recommendation:** Trim each prompt's examples from 17–27 down to 4–6 representative ones. Remove "negative examples" (the ❌ EXAMPLE sections) or consolidate them into a single brief "NEVER REPORT" list rather than full examples.

---

### 6. Duplicate `buildWorkspaceSection` Function

**Where:** Defined independently in 5 files (`fast.ts`, `security.ts`, `general.ts`, `testing.ts`, `performance.ts`) — plus 2 additional **inline** workspace sections in `prompts.ts` (for cross-file prompts) that aren't using the shared function at all.

**Why it matters:** This is primarily a maintenance issue (7 separate copies to update), but the inline versions in `prompts.ts` are slightly more verbose than the shared function versions. Also: the workspace section in `prompts.ts` cross-file prompt contains 4 "Critical Scenarios" examples that the shared function version does not have (~200 extra tokens per call).

**Recommendation:** Extract to a shared module (e.g., `src/ai/prompts/sections/workspace.ts`) and replace all copies. Standardize the content.

---

## Observability Gaps

### 7. Token Usage Not Tracked in SDK Providers

**Where:** `src/ai/providers/copilot-sdk.ts`, `src/ai/providers/opencode-sdk.ts`

**What's missing:** The `copilot.ts` (CLI provider) parses and returns `TokenUsage` including `inputTokens` and `outputTokens`. Neither SDK provider (`copilot-sdk.ts`, `opencode-sdk.ts`) captures token usage — the `tokenUsage` field on `AIResponse` is never populated.

**Why it matters:** Without token tracking in the SDK providers, BYOK users have no visibility into how much they're spending per review. Token data is available in OpenAI-compatible API responses (`usage.prompt_tokens`, `usage.completion_tokens`).

**Recommendation:** Add token usage extraction from SDK API responses. Surface aggregated token counts in the review summary output.

---

### 7. Multi-Run Cost Multiplication ✅ DONE

**Implementation:** Cost warning logged during review execution

**Where:** `reviewRuns` config option (default: 1, max: 5)

**What happens:** Each additional review run multiplies ALL token costs linearly. Running `reviewRuns=3` triples both input and output token costs.

**Recommendation:**
- Log a cost warning when `reviewRuns > 1` and BYOK is configured (`aiApiKey` is set)
- Consider showing estimated token multiplier in the review summary

**Status:** ✅ **Implemented.** Cost warnings are logged to stdout during review execution when `reviewRuns > 1` and a BYOK provider is active (detected via `aiApiKey`). Warnings inform users of the token cost multiplier before each subsequent run begins.

---

## Architecture-Level Opportunity: "Compact Mode"

All of the output token issues could be addressed holistically with a `MM_COMPACT_MODE=true` (or `--compact`) flag that switches to a cost-optimised prompt profile:

| Feature | Default (thorough) | Compact |
|---------|-------------------|---------|
| MANDATORY ANALYSIS STRUCTURE | Yes | No |
| Reasoning field | 5 checkpoints | 1–2 sentences |
| Counter-argument documentation | Required | Omitted |
| Severity context examples | 20 | 5 |
| Per-prompt examples | 17–27 | 4–6 |

This would be a reasonable default for BYOK users.

---

## Estimated Token Savings Potential

These are rough estimates based on typical review sizes (10 files, 15 findings, 1 run):

| Optimisation | Saved Output Tokens | Saved Input Tokens |
|-------------|--------------------|--------------------|
| Remove MANDATORY ANALYSIS STRUCTURE | 800–2,000 | 400 |
| Compact reasoning fields | 600–1,500 | 300 |
| Remove counter-argument docs from output | 200–500 | 100 |
| Trim severityContext examples (20→8) | — | 2,400 |
| Trim per-prompt examples (25→5) | — | 2,000–3,000 |
| Remove self-challenge output requirement | 300–600 | 200 |
| **Total per single review** | **~2,000–5,000** | **~5,000–6,000** |

At typical BYOK pricing ($15/M output, $3/M input), reducing 4,000 output tokens and 5,500 input tokens saves roughly **$0.077 per review**. For teams running hundreds of reviews per month, this adds up to meaningful savings.

---

## Next Steps

The following items remain to be addressed:

1. **Item 2:** Compact reasoning fields (verbose `reasoning` field)
2. **Item 3:** Reduce `severityContext` examples from 20 to 8
3. **Item 4:** Trim examples in prompt bodies (17–27 → 4–6 per file)
4. **Item 5:** Remove counter-argument documentation from output (keep mental discipline)
5. **Item 6:** Add token usage extraction in SDK providers (`copilot-sdk.ts`, `opencode-sdk.ts`)
6. **Item 8:** Extract shared `buildWorkspaceSection` to module
