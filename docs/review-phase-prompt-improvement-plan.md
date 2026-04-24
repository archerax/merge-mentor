# Review Phase Prompt Improvement Plan

## Problem

The custom review-phase prompts have a solid foundation, but they are heavier and more verbose than current prompt-engineering best practices. The main issues are:

- They require visible step-by-step analysis and counter-argument writeups instead of keeping reasoning internal.
- They encourage broad, sometimes noisy reporting with language like "be thorough and strict" and "any potential vulnerability, no matter how small."
- Some phase guidance overlaps, which weakens the value of selecting a narrow custom phase set.
- Existing PR comments are injected as plain text, while PR metadata already has stronger trust-boundary handling.
- Prompt length is high because verification rules, examples, and analysis instructions repeat across file and cross-file flows.

## Goals

1. Increase signal-to-noise ratio for custom review findings.
2. Keep structured output reliable while reducing prompt verbosity.
3. Preserve explicit phase selection and ordering.
4. Improve trust-boundary handling for all untrusted review inputs.
5. Keep the resulting prompts compatible with existing parsing and review flows.

## Scope

### In scope

- Custom phase file-review prompt generation in `src/ai/prompts/specialists/general.ts`
- Custom phase cross-file prompt generation in `src/ai/prompts/specialists/general.ts`
- Shared prompt schema wording in `src/ai/prompts/specialists/outputFormats.ts`
- Reasoning field documentation in `src/platforms/types.ts`
- Provider-side reasoning validation heuristics in:
  - `src/ai/providers/copilot.ts`
  - `src/ai/providers/copilot-sdk.ts`
  - `src/ai/providers/opencode.ts`
  - `src/ai/providers/opencode-sdk.ts`
- Prompt and parsing tests covering custom phases and reasoning expectations

### Out of scope

- A full redesign of non-custom specialist prompts unless shared helpers make the change low-risk
- Changing review categories, severity enums, or CLI flags
- Reworking the overall review engine flow

## Proposed Changes

### 1. Replace visible chain-of-thought instructions with concise evidence-based rationale

Update custom prompts so the model performs phase passes internally and returns only the required JSON output.

#### Planned prompt changes

- Replace instructions such as "document your analysis step-by-step" and "Before providing JSON, document your analysis" with:
  - think through the selected phases internally
  - return JSON only
  - keep `reasoning` concise and evidence-based
- Reframe `reasoning` as a short justification grounded in:
  - the changed lines
  - nearby checked context
  - repository-pattern verification when relevant
  - concrete impact
- Remove requests for explicit counter-argument transcripts in normal output

#### Why

This aligns better with current best practice for structured outputs: internal reasoning is allowed, but visible output should stay concise, deterministic, and schema-focused.

### 2. Raise the reporting threshold to reduce noisy findings

Tighten the reporting standard so custom reviews focus on material, actionable issues.

#### Planned prompt changes

- Replace "Be thorough and strict" with language that favors high-signal review behavior
- Replace "Any potential vulnerability, no matter how small" with a requirement to report credible, actionable security issues
- Add explicit preference for:
  - high-confidence findings
  - concrete impact
  - fixes that address root cause
- Add explicit discouragement for:
  - speculative concerns
  - generic style nits
  - issues without clear user, system, or maintainability impact

### 3. Tighten phase boundaries for custom mode

Make selected phases more distinct so `--phases scan,logic` behaves differently from the default broad review.

#### Planned prompt changes

- Review the `FILE_REVIEW_PHASE_DETAILS` and `CROSS_FILE_PHASE_DETAILS` text for overlap
- Narrow `scan` so it stays focused on suspicious diff patterns and incomplete changes
- Keep `logic` focused on correctness and failure behavior
- Keep `performance` focused on measurable efficiency and scalability concerns
- Keep `monorepo` focused on package boundaries, dependency hygiene, and workspace structure
- Remove generic "consider everything" guidance that leaks omitted phases back into the review

### 4. Explicitly constrain allowed output categories in the prompts

Today the providers validate categories after the fact, and invalid file-review categories fall back to `quality`.

#### Planned changes

- Add explicit allowed file-review categories to the file prompt
- Add explicit allowed cross-file categories to the cross-file prompt
- Make the JSON schema examples and surrounding instructions use only valid categories for each context

#### Why

This should reduce category drift and lower the chance of lossy provider-side coercion.

### 5. Extend trust-boundary handling to existing PR comments

Existing comment summaries should be treated as untrusted content just like PR title and description.

#### Planned changes

- Introduce a wrapper or delimiter helper for existing comment context
- Apply it where existing comments are inserted into file and cross-file prompts
- Preserve the current usefulness of deduplication guidance while making the trust boundary explicit

### 6. Reduce prompt size by removing repetition

The prompts can stay strict without repeating large example sections everywhere.

#### Planned changes

- Consolidate repeated verification language into shorter reusable sections
- Remove or shrink long illustrative examples where a short rule is sufficient
- Keep one clear schema example and one concise reasoning example instead of multiple long examples
- Prefer short checklists over narrative prose

## Contract Updates Needed

The current type documentation and validation logic still assume long chain-of-thought output.

### Planned updates

- Update `reasoning` comments in `src/platforms/types.ts` to describe concise, evidence-based rationale rather than chain-of-thought
- Adjust provider `validateReasoning()` heuristics so they no longer assume long reasoning text is better
- Keep some minimum quality guardrails, but change them to check for:
  - non-empty rationale
  - code-grounded evidence
  - impact explanation
- Update any tests that currently enforce long verification-heavy reasoning strings

## Implementation Phases

### Phase 1: Prompt contract rewrite

- Rewrite custom file-review prompt instructions
- Rewrite custom cross-file prompt instructions
- Update output-format wording to prefer JSON-only responses and concise rationale

### Phase 2: Phase-specific content cleanup

- Refine selected-phase descriptions and reporting items
- Remove overlap between phases
- Tighten category instructions

### Phase 3: Trust-boundary hardening

- Add explicit delimiters for existing comment context
- Use the helper consistently across affected prompts

### Phase 4: Type and provider alignment

- Update `reasoning` field documentation
- Adjust reasoning validation heuristics in all providers

### Phase 5: Test refresh

- Update prompt tests to assert the new compact instructions
- Update provider/parsing tests that depend on long reasoning language
- Keep coverage for:
  - selected phase inclusion and omission
  - valid category guidance
  - existing-comment handling
  - concise reasoning acceptance

## Validation Plan

- Run `pnpm check`
- Review updated prompt snapshots/content assertions in:
  - `src/ai/prompts/specialists/specialists.spec.ts`
  - related prompt and provider tests affected by reasoning-contract changes
- Manually inspect generated custom prompts for:
  - phase isolation
  - smaller size
  - clear JSON contract
  - explicit trust boundaries

## Risks and Watchouts

- If prompt instructions become too compact, models may skip verification and produce lower-confidence findings.
- If provider validation stays stricter than the new prompts, high-quality concise rationales may be downgraded or warned on incorrectly.
- If phase text is narrowed too aggressively, users may miss useful findings they previously expected from custom mode.

## Success Criteria

- Custom phase prompts are shorter and more direct.
- They no longer request visible chain-of-thought-style analysis.
- Findings are better aligned to selected phases.
- Existing comments are clearly treated as untrusted input.
- Provider validation and tests reflect the new concise-rationale contract.
