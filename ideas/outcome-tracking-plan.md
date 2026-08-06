# Feature Plan: Outcome Tracking (Did the Mentor Help?)

## Overview

**Merge Mentor** posts findings and then stops. It never learns whether a
finding was fixed, dismissed, or ignored — so it cannot measure its own value,
detect its own false positives, or tune its thresholds. Its feedback loop is
open.

This feature closes the loop. A new `merge-mentor outcomes` command revisits
reviewed pull requests after they are merged (or aged past a window), inspects
what happened to each bot-initiated comment, and produces a **resolution
report** plus a **signal file** the review engine can consume to get sharper
over time:

- **Resolution rate** — how many findings were fixed, dismissed, or ignored.
- **False-positive candidates** — finding categories/patterns repeatedly
  dismissed across PRs.
- **Recurring findings** — the same issue flagged in multiple PRs, which points
  at systemic gaps rather than one-off mistakes.
- **Self-tuning signal** — low-confidence findings in repeatedly-dismissed
  categories can be down-weighted; consistently-confirmed ones promoted.

This is the "measure the mentor" layer and compounds the value of every other
feature: webhook reviews, staged-changes reviews, and repo-intelligence reports
all produce the findings this command scores.

---

## Current State

- `CommentManager` embeds a stable per-finding fingerprint in every inline
  comment — `<!-- finding-id: base64(filename:line:category) -->`
  (`src/review/commentManager.ts`). This is the key that lets a later scan map a
  resolved/dismissed thread back to the exact finding that produced it.
- The `PlatformAdapter` already exposes `getExistingBotComments`,
  `getUnresolvedCommentThreads`, `resolveCommentThread`, and `postCommentReply`
  (`src/platforms/types.ts`) — enough to read thread state on a _known_ PR.
- There is **no API to list merged PRs** or to **fetch threads for arbitrary
  PRs** — both must be added. The repo-intelligence plan
  (`ideas/repo-intelligence-and-team-coaching-plan.md`) already specifies these
  exact methods (`listMergedPRs`, `getReviewThreads`) and a JSON history cache;
  outcome tracking should **share** that pipeline, not duplicate it.
- `ReviewStateCache` stores per-file findings per PR under
  `{tempPath}/cache/{prIdentifier}.json`; the bot identifier that distinguishes
  bot comments is configured (`botCommentIdentifier`).
- `AuditLogger` records review lifecycle events but nothing about downstream
  outcome.
- The `reply` command already resolves threads, so a human closing a thread is a
  real, observable signal — outcome tracking just measures it.

---

## CLI Design

A new top-level command:

```bash
# Score every reviewed+merged PR in the window (reuses history cache)
merge-mentor outcomes --since 6m

# Score a single PR
merge-mentor outcomes --pr 42

# Only PRs reviewed by this bot
merge-mentor outcomes --since 6m --bot-identifier "[Merge Mentor]"

# Emit only the self-tuning signal file (no report)
merge-mentor outcomes --since 6m --signal-only

# Output a report
merge-mentor outcomes --since 6m --format markdown --output ./docs/mentor-outcomes.md
```

### Options

| Option                                | Description                                                             |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `--pr <n>`                            | Score a single PR instead of a window                                   |
| `--since <window>`                    | History window (`6m`, `1y`); requires `listMergedPRs`                   |
| `--limit <n>`                         | Maximum PR sample size                                                  |
| `--bot-identifier`                    | Override the bot marker used to recognize bot comments                  |
| `--min-age <days>`                    | Skip PRs merged more recently than this (default: findings need ~1 day) |
| `--signal-only`                       | Write only `signal.json`, no report                                     |
| `--format`                            | `markdown` or `json` report output                                      |
| `--output <path>`                     | Report output file                                                      |
| `--refresh`                           | Re-fetch all PRs, ignoring the shared history cache                     |
| `--repo-url`/`--github-*`/`--azure-*` | Repo selection, same conventions as the intelligence plan               |

---

## Outcome Model

For each bot comment (matched via the `finding-id` marker), classify into
exactly one outcome:

| Outcome      | Definition                                                            |
| ------------ | --------------------------------------------------------------------- |
| `fixed`      | Thread resolved and the flagged code changed after the comment        |
| `dismissed`  | Thread resolved without a code change (e.g. "won't fix", intentional) |
| `ignored`    | Thread left open through merge / closed by merge with no resolution   |
| `unresolved` | PR not yet merged; no outcome yet                                     |

`fixed` vs `dismissed` is decided by diffing the flagged file between the
reviewed SHA and the current/merged head: a diff at/around the flagged line
means `fixed`; no diff means `dismissed`. Thread state from
`getReviewThreads` supplies resolved/active + author, and `isBot` + the
`finding-id` marker supply the finding link.

### Metrics

- **Resolution rate** = `fixed / (fixed + dismissed + ignored)` per category,
  severity, and pass.
- **Dismissed-by-category** — feeds false-positive candidates.
- **Median time-to-resolution** (from comment creation to thread resolution).
- **Recurrence** — identical `finding-id` fingerprints appearing across
  multiple PRs (systemic, not one-off).

---

## Self-Tuning Signal

`outcomes` writes `{tempPath}/outcomes/signal.json`, a per-category/pattern
table of accumulated evidence:

```json
{
  "version": 1,
  "sourceWindow": { "since": "6m", "prsScored": 312 },
  "categories": {
    "quality": { "fixed": 41, "dismissed": 12, "confirmedRate": 0.77 }
  },
  "patterns": [
    {
      "fingerprint": "async-error-handling",
      "category": "bug",
      "fixed": 6,
      "dismissed": 9,
      "confirmedRate": 0.4,
      "suggestedWeight": 0.5
    }
  ]
}
```

The review engine consumes `signal.json` (when present) to adjust **confidence
weights** at finding-aggregation time:

- Down-weight low-confidence findings whose category/pattern is repeatedly
  dismissed.
- Promote findings in patterns with a high confirmed rate.
- Never auto-suppress: the signal only nudges confidence, never deletes a
  finding, and only applies to findings below a confidence threshold.
- Signal files are versioned and additive; re-running the command over a wider
  window accumulates evidence rather than resetting it.

## Guardrails

- The signal is advisory and opt-in (`--signal` / config flag to enable the
  engine to read it). Default behavior changes nothing about reviews.
- Reports are aggregate; they contain no per-author or per-reviewer breakdown
  (same privacy posture as the `coach` plan). The `finding-id` marker is used
  only to link a thread to a finding fingerprint — it is not a user identity.
- Dismissal alone never marks a finding "wrong"; the report labels it a
  _candidate_ for review, and a human approves any engine behavior change.

---

## Internals

### 1. New `PlatformAdapter` methods (shared with the intelligence plan)

- `listMergedPRs({ since, limit, cursor })`.
- `getReviewThreads(prNumber)` — all threads with author, path, line,
  createdAt, status, isBot.
- A way to know whether the flagged code changed after the comment
  (`getPRFiles` on the current head, or a `getFileAtRef`/commit-history helper).
  Whichever shape the intelligence plan lands on should be shared.

### 2. `src/outcomes/` module

| File                        | Responsibility                                           |
| --------------------------- | -------------------------------------------------------- |
| `classifier.ts`             | Map threads → findings via `finding-id` → outcome model  |
| `fixDetector.ts`            | `fixed` vs `dismissed` via post-review diff analysis     |
| `metrics.ts`                | Aggregate metrics (resolution rate, recurrence, latency) |
| `signal.ts`                 | Build/version/merge `signal.json`                        |
| `reports/outcomesReport.ts` | Markdown/JSON report                                     |

### 3. Durable per-PR state

Store a per-PR outcome record at `{tempPath}/outcomes/{prIdentifier}.json`
(reusing the file-per-item `ReviewStateCache` pattern), so re-runs only process
PRs not yet scored and the pipeline is resumable and idempotent.

---

## Tests

- `finding-id` decoding and thread-to-finding matching.
- `fixed` vs `dismissed` classification given a diff and a resolved thread.
- Metrics math (resolution rate, recurrence, median latency) on fixtures.
- `signal.json` versioning, additive merging, and confidence-weight application
  in the aggregator (with and without the opt-in flag).
- Idempotency: re-running over scored PRs performs no duplicate work.
- Privacy: no per-author data in any report output.
- Both GitHub and Azure adapters against recorded fixtures.

---

## Verification

1. Run the new unit and integration tests.
2. Run `pnpm check`.
3. On a real repo: run a review that posts findings, resolve some threads (one
   with a code change, one "won't fix", leave one open), merge, then run
   `merge-mentor outcomes --pr <n>` and confirm the three outcomes classify
   correctly.
4. Run `--since 6m` twice and confirm the second run is a pure cache hit.
5. Generate `signal.json`, re-run a review with the engine opt-in flag, and
   confirm only below-threshold, repeatedly-dismissed findings are
   down-weighted — nothing is suppressed.

---

## Future Roadmap (Post-MVP)

1. **Training impact tracker** — correlate resolution-rate changes with the
   `coach` training roadmap (shared with the intelligence plan).
2. **Web UI dashboard** — visual resolution trends and false-positive candidate
   cards with "confirm → adjust weight" one-click actions.
3. **Automated retry** — findings dismissed repeatedly could be re-flagged on
   the next PR _only_ after a human confirms the signal.
4. **Prevention attribution** — when `staged-changes review` finds a bug that a
   later `review` on the pushed PR did not need to flag, attribute it as a
   prevented finding in the metrics.

---

## Open Decisions & Dependencies

- Depends on `listMergedPRs` + `getReviewThreads` from the repo-intelligence
  plan; the shared history-cache format must be finalized first.
- Whether the engine reads `signal.json` automatically or behind a
  config flag (default recommended: opt-in).
- Whether `fixed` detection needs a full diff or can rely on a "was this
  file/lines touched after review" check.
- Whether `finding-id` markers should be extended with a pattern/context hash to
  power cross-PR recurrence beyond filename+line+category.
