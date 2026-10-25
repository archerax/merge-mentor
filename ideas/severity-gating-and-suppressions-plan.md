# Feature Plan: CI Severity Gating and Finding Suppressions

## Overview

Teams adopting Merge Mentor in CI need to decide what blocks a build, and need a
way to say "this finding is accepted here" without switching review off.

> **Constraint:** the CEO decision is _no custom rules_. Gating is a pipeline
> threshold, not a rule. Suppressions are the closest thing to configuration in
> this list and need an explicit go/no-go (see Open Decisions).

## Current State

- Review exits successfully whether or not it finds issues (no gating documented
  in `docs/review.md` or `docs/ci-cd.md`; to confirm in code).
- `--ignore <pattern>` excludes files, but nothing excludes a single finding.
- Findings carry a stable fingerprint (`finding-id`) in inline comments, which
  is a natural key for suppression.

## Proposal

### A. Severity gating (low risk)

- `--fail-on <severity>` (e.g. `blocker`, `high`, `medium`) makes `review` exit
  non-zero when an unresolved finding at or above the level exists.
- Applies to current-run findings plus unresolved bot threads; dry-run supported.
- Document in `docs/ci-cd.md` for GitHub Actions and Azure Pipelines.

### B. Suppressions (needs decision)

- Resolving a bot thread in the platform UI is already a "dismiss" signal;
  prefer honouring that over new syntax.
- If explicit syntax is wanted: a reply command such as `/mentor ignore` on the
  thread, recorded by fingerprint so the finding is not re-raised.
- No separate suppression file.

## Tests

- Exit code per severity threshold; none-found; only-resolved findings.
- A suppressed fingerprint is not re-posted after new pushes.

## Open Decisions

- Is any suppression mechanism acceptable under the no-custom-rules decision?
- Severity vocabulary: review findings vs PBI (`critical/high/medium/low`)
  differ; gating must define the mapping.
