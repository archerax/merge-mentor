# Feature Plan: Outcome Tracking (Did the Mentor Help?)

## Overview

**Merge Mentor** posts findings and then stops. Nothing records whether a
finding was fixed, dismissed, or ignored, so a team cannot judge whether the
tool is worth the time it takes to read.

This feature adds a **read-only measurement layer**. A new `merge-mentor
outcomes` command scans every PR in the configured repository from the last 12
months, and for each PR that carries Merge Mentor comments, works out what
happened to each comment. Results are collated into aggregate stats shown in the
CLI and on a new page of the web dashboard, and saved to a JSON file that also
serves as a cache so unchanged PRs are never re-scanned.

**Scope (this release): display only.** The stats let a person judge
effectiveness. Nothing feeds back into reviews. There is no `signal.json`, no
confidence re-weighting, and no automatic behaviour change. That fits the
human-in-the-loop principle and the standing decision that Merge Mentor adds no
custom rules of its own.

---

## Amendments From the Previous Version

| Previous plan                                                    | Now                                                                                 |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Only merged PRs, `--since 6m`                                    | Every PR (open, merged, abandoned) updated in the last **12 months** by default     |
| Produces `signal.json` that re-weights findings in the engine    | **Removed.** Display only; learning is a later, separately approved plan            |
| Depends on new `listMergedPRs` / `getReviewThreads` methods      | Reuse the existing `PullRequestLister.listPullRequests` and extend thread reads     |
| Per-PR state in `{tempPath}/outcomes/{pr}.json` (many files)     | One results file with a per-PR cache key, plus a schema version                     |
| Markdown report is the main output                               | CLI table + JSON by default, plus a dashboard page                                  |
| Shares a pipeline with the repo-intelligence plan                | Standalone. That plan can adopt this cache later                                    |
| `fixed` vs `dismissed` decided by diffing the file at the review SHA | Simpler heuristic first (see Outcome Model); full diff analysis stays an open item |
| Paths like `src/review/...`                                      | Corrected to `libs/*` and `apps/*`                                                  |

---

## Current State (verified in the repo)

- **Listing PRs already exists.** `PullRequestLister.listPullRequests({ since,
  limit })` returns `{ number, title, state, updatedAt }`
  (`libs/domain/src/platform.ts`). `collectLiveReviewStats` in
  `libs/core/src/review/reviewStats.ts` already pages through it with bounded
  concurrency.
- **Platform caveat.** GitHub filters `since` by last update. Azure DevOps can
  only filter by creation date, so a PR created before the window but active
  inside it is not listed there. A 12-month window will therefore miss older
  long-lived Azure PRs; the output must say so.
- **Finding link.** Each inline comment embeds
  `<!-- finding-id: base64(filename:line:category) -->`
  (`libs/core/src/review/commentManager.ts`). Severity is not in the marker, only
  in the visible comment body (`**Severity**: ...`), so severity has to be
  parsed from the body, and older or edited comments may not have it.
- **Thread state.** `getExistingBotComments(pr)` returns each bot comment with
  `path`, `line`, and `isResolved`. That is enough for resolved vs open. It does
  not say who resolved a thread, when, or whether anyone replied.
- **`stats` command and `/stats` dashboard page** already count PRs reviewed and
  comments posted live. Outcome tracking should sit beside them, not replace
  them.
- **Local storage convention.** Reports, cache, and logs live under
  `{tempPath}` (default `./.mergementor`), written atomically from the web
  server (`atomicWrite.server.ts`).

---

## What Gets Measured

For each PR in the window:

1. Skip it if the cache says it is unchanged (see Caching).
2. Fetch the bot comments. If there are none, record the PR as `no-comments`
   (cached, so it is not fetched again) and move on.
3. For each bot comment, record an outcome.

### Outcome model

| Outcome        | Definition                                                                          |
| -------------- | ----------------------------------------------------------------------------------- |
| `resolved`     | Thread resolved                                                                     |
| `open-merged`  | PR merged with the thread still open                                                |
| `open-closed`  | PR abandoned/closed unmerged with the thread open                                   |
| `open`         | PR still open, thread unresolved (no outcome yet)                                   |

`resolved` is deliberately **not** split into "fixed" vs "dismissed" in the first
version. Telling them apart needs a diff of the flagged lines between the review
SHA and the merged head, which is expensive and error-prone (line drift, force
pushes, squash merges). Showing resolved vs left-open is honest and cheap, and
the user can judge from it. The split is the first follow-up once the basic
numbers look useful (see Open Decisions).

Metrics are broken down **only** by things a person can act on:

- Totals: PRs scanned, PRs with Merge Mentor comments, comments, by outcome.
- **Resolution rate** = `resolved / (resolved + open-merged + open-closed)`,
  excluding still-`open` comments so in-flight PRs do not drag the rate down.
- Breakdown by **category**, by **severity** (when parseable, else `unknown`),
  and by **month** (trend over the 12 months).
- Optional median time-to-resolution, only if the platform exposes a resolved
  timestamp cheaply. Otherwise omit it rather than fake it.

**Privacy:** results are aggregate. No per-author or per-reviewer breakdown, and
the cache stores no author names or comment text, only the fields needed to
count (see below).

---

## CLI Design

```bash
# Scan the last 12 months, using the cache (default)
merge-mentor outcomes

# Different window, or a scan cap
merge-mentor outcomes --since 6m --limit 500

# Ignore the cache and rescan everything
merge-mentor outcomes --refresh

# One PR, for checking the classification by hand
merge-mentor outcomes --pr 42

# Machine-readable
merge-mentor outcomes --json
```

### Options

| Option                              | Description                                                   | Default           |
| ----------------------------------- | ------------------------------------------------------------- | ----------------- |
| `--since <date\|Nm\|Ny>`            | Window start: a date, or relative (`6m`, `12m`, `1y`)         | `12m`             |
| `--limit <n>`                       | Maximum PRs to scan (warn when reached, as `stats` does)      | `1000`            |
| `--pr <n>`                          | Score one PR (always rescans it)                              | -                 |
| `--refresh`                         | Ignore cached entries and rescan                              | `false`           |
| `--json`                            | Print the aggregate as JSON                                   | `false`           |
| `--temp-path`, `--platform`, `--github-*`, `--azure-*` | Same as `stats`                            | same as `stats`   |

The command is **read-only against the platform**: it never posts, replies, or
resolves. Unlike `review`, it does not need `--write` because there is nothing
to write to the platform. It writes only to the local results file.

### Console output

A short summary, not a wall of text: totals, resolution rate, then small tables
by category, severity and month. A one-line note states how many PRs were served
from cache vs freshly scanned, how many were unreadable, and whether the limit
or the Azure creation-date caveat applies.

---

## Caching and Results File

One file: `{tempPath}/outcomes/outcomes.json`, written atomically.

```json
{
  "version": 1,
  "platform": "github",
  "project": "owner/repo",
  "generatedAt": "2026-11-07T10:00:00Z",
  "prs": {
    "42": {
      "updatedAt": "2026-10-02T09:12:00Z",
      "state": "closed",
      "scannedAt": "2026-11-07T10:00:00Z",
      "comments": [
        { "category": "bug", "severity": "high", "outcome": "resolved", "createdMonth": "2026-09" }
      ]
    }
  }
}
```

**Cache rule:** a PR is skipped when its listed `updatedAt` equals the cached
`updatedAt` **and** its state is final (merged/closed). Open PRs are rescanned
whenever `updatedAt` changes. A PR whose comments were last scanned while still
open is rescanned once after it closes.

Why `updatedAt` is a usable key: on GitHub, adding a comment bumps the PR's
update time, but it is not confirmed that resolving a thread does on either
platform. So the cache also rescans any PR closed within the last ~14 days
regardless of `updatedAt`, which catches late resolutions.

Other rules:

- **Schema version.** If `version` does not match, discard and rescan rather
  than guess.
- **Repo-scoped.** If `platform`/`project` differ from the current config, do
  not reuse the file.
- **Window pruning.** PRs older than the window are dropped from the aggregate
  but may stay in the file; `--refresh` rebuilds it.
- **Resumable.** Write the file periodically during a long scan so an
  interruption keeps the work done so far.
- **No secrets, no comment text, no authors** in the file.

The file doubles as input for later analysis, which is why it is plain JSON with
a version number.

---

## Web Dashboard

New route `apps/web/src/routes/outcomes.tsx` with a server function in
`apps/web/src/server/outcomes.functions.ts` / `outcomes.server.ts`, following the
`stats` page pattern (loader, `PageHeader`, tiles, tables).

- Tiles: PRs with comments, comments posted, resolved, left open, resolution
  rate.
- Tables by category and severity; a simple month-by-month trend.
- **Refresh** button that runs the scan and shows progress. The first scan of
  12 months can take minutes, so it must not block page load: show cached
  results immediately, with "last scanned at ..." and a rescan action.
- Same security posture as the other pages: localhost only, token-guarded
  server functions (`requestGuard.server.ts`).
- Add a nav link next to **Stats**.

---

## Internals

| Location                                              | Responsibility                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `libs/core/src/review/outcomes/scanner.ts`            | List PRs, apply cache rules, fetch comments with bounded concurrency      |
| `libs/core/src/review/outcomes/classifier.ts`         | Comment + PR state to outcome; parse category (marker) and severity (body) |
| `libs/core/src/review/outcomes/aggregate.ts`          | Totals, resolution rate, category/severity/month breakdowns               |
| `libs/core/src/review/outcomes/cache.ts`              | Read/write/validate `outcomes.json` (version, repo scope, atomic write)   |
| `apps/cli/src/commands/outcomes.ts`                   | Commander command, option parsing, console rendering                      |
| `apps/web/src/routes/outcomes.tsx` + server functions | Dashboard page                                                            |

Reuse `collectLiveReviewStats`'s listing and concurrency approach rather than
writing a second PR crawler; consider extracting the shared part.

### Platform adapter changes

- `getExistingBotComments` already gives `path`, `line`, `isResolved`. Add the
  comment `createdAt` (for the monthly trend) and the PR's final state is
  already available from the listing, so no new method is needed for the first
  version.
- Confirm Azure DevOps thread status maps cleanly to resolved/open (Azure has
  `fixed`, `wontFix`, `closed`, `byDesign` statuses, all of which should count
  as resolved, but `wontFix`/`byDesign` could later feed the "dismissed" split).

### Rate limits

12 months of a busy repo is many API calls (one comments fetch per PR with
bot activity). Mitigations: bounded concurrency, the existing
`rateLimitHandler`, the cache, and a visible progress counter. The `--limit` cap
and the "N PRs left out" warning match what `stats` does.

---

## Tests

- Classifier: each outcome, on both platforms' comment shapes; severity parsing
  with and without the body field; legacy comments with no `finding-id`.
- Aggregate math: resolution rate excludes in-flight comments; empty windows;
  months bucketed correctly across year boundaries.
- Cache: unchanged final PR is skipped; changed `updatedAt` rescans; schema
  version mismatch and different repo discard the file; `--refresh` ignores it;
  an interrupted scan keeps completed PRs.
- Scanner: PRs with no bot comments are cached as such; unreadable PRs are
  counted, not fatal, unless all fail (same rule as `stats`).
- Privacy: the results file and all outputs contain no author names or comment
  text.
- Web: server function returns cached results without scanning; the scan runs
  only on explicit request.
- GitHub and Azure adapters against recorded fixtures.

---

## Verification

1. `pnpm check`.
2. On a real repo, run a review that posts findings, resolve some threads, leave
   some open, merge, then `merge-mentor outcomes --pr <n>` and confirm the counts.
3. Run `merge-mentor outcomes` twice: the second run reports nearly all PRs
   served from cache and makes almost no API calls.
4. Resolve a thread on an already-scanned, still-open PR and confirm the next run
   picks the change up. Repeat on a closed PR to confirm the `updatedAt`
   assumption (or the TTL fallback).
5. Open `/outcomes` in the dashboard: cached numbers appear immediately, and
   rescan updates them.

---

## Not in This Release

- Feeding outcomes back into reviews (`signal.json`, confidence weighting,
  false-positive suppression). Revisit only after people have looked at the
  numbers and decided they are meaningful, and with a human approving any
  behaviour change.
- Per-author or per-reviewer breakdowns.
- Fixed vs dismissed classification (see below).
- Links to the coaching and repo-intelligence plans.

## Decisions Made

- **Outcome split:** resolved vs left open only. Revisit fixed/dismissed (Azure
  `wontFix`/`byDesign`, or a diff of the flagged lines) once real data shows it
  is worth the cost.
- **Cache safety:** always rescan PRs closed within the last ~14 days, and trust
  the cache for older closed PRs. This holds even if resolving a thread does
  bump `updatedAt`, so late resolutions are not missed. Still worth a quick
  manual check on both platforms to see whether the window can shrink.
- **Dashboard scan:** show the cached results immediately with a "last scanned"
  time; a button starts a rescan with a progress counter. The CLI and dashboard
  share the same `outcomes.json`.
- **Severity:** parse it from the comment body only. No change to the posted
  comment format. Comments where it cannot be parsed show as `unknown`. If the
  comment template changes, the parser and its tests must change with it.

## Open Decisions

- **Default window vs repo size.** For very large repos the 12-month scan may be
  slow; consider a lower default `--limit` with a clear warning.
- **Should `stats` and `outcomes` merge** into one command/page once outcomes
  settles? Keep separate for now to avoid destabilising `stats`.
