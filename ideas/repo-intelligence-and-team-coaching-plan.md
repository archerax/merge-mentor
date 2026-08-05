# Feature Plan: Repository Intelligence & Team Coaching

## Overview

**Merge Mentor** currently enforces general code-quality rules and project-specific
configuration, but team conventions are often tacit, scattered across hundreds of
merged pull requests, or buried in human review comments.

This plan merges two related ideas — **Living Repository Intelligence & Rule
Discovery** and **Team Training Needs Analytics** — into a single implementation
with two top-level CLI commands that share one historical-PR analysis pipeline:

- `merge-mentor analyze` — mine historical PR review data to produce a frequent
  issues report and auto-generated `AGENTS.md` rules that sharpen future AI reviews.
- `merge-mentor coach` — mine the same data (strictly anonymized) to produce a
  team training needs report: skill gaps, workshop topics, and documentation gaps.

Both commands share the fetch, filter, clustering, caching, and report internals.
Whichever command runs second operates entirely on the cached PR data, so no PRs
are re-fetched.

---

## Current State

- The CLI is Commander-based; commands are registered in `src/program.ts`.
- The `PlatformAdapter` interface (`src/platforms/types.ts`) supports
  single-PR operations only. There is **no API to list merged PRs** or to
  fetch review threads for arbitrary PRs — both must be added.
- JSON file caching is already an established pattern:
  `ReviewStateCache` stores state under `{tempPath}/cache/{prIdentifier}.json`,
  and cloned repos live under `{tempPath}/repos`. `tempPath` defaults to
  `./.mergementor`.
- The `repos` command manages clone-cache hygiene (`--list`, `--clean`,
  `--clean-repo`) and is the model for history-cache management.
- Review prompts accept a `repoContext` string of coding standards, but there is
  **no AGENTS.md loader** — only `.mergementor.json` is parsed
  (`src/review/configLoader.ts`). Generated rules only take effect if this gap
  is closed.

---

## CLI Design

Two top-level commands — no subcommand nesting:

```bash
# Analyze past year of PRs: frequent issues report + AGENTS.md rules
merge-mentor analyze --since 1y

# Analyze past 6 months, report only
merge-mentor analyze --since 6m --report-only --output-file ./docs/repo-health.md

# Preview suggested AGENTS.md rules without writing
merge-mentor analyze --since 1y --generate-rules --dry-run

# Team training needs report for the past year
merge-mentor coach --since 1y

# Team training needs report for the past 6 months
merge-mentor coach --since 6m --output ./docs/team-training-roadmap.md
```

### Shared Options

Both commands accept the same option set:

| Option                       | Description                                                               |
| ---------------------------- | ------------------------------------------------------------------------- |
| `--since <window>`           | History window (`6m`, `1y`)                                               |
| `--limit <n>`                | Maximum PR sample size                                                    |
| `--repo-url <url>`           | Repo URL (auto-sets platform/owner/repo); else `--github-*` / `--azure-*` |
| `--exclude-repos <names>`    | Exclude repos from analysis                                               |
| `--exclude-paths <patterns>` | Exclude paths from analysis                                               |
| `--temp-path <path>`         | Base temp path (Env: `MM_TEMP_PATH`)                                      |
| `--cache-dir <path>`         | Override history cache location                                           |
| `--refresh`                  | Re-fetch all PRs, ignoring cache                                          |
| `--no-cache`                 | Run without reading or writing the cache                                  |
| `--format <format>`          | `markdown` or `json` report output                                        |
| `--output <path>`            | Report output file                                                        |
| `--provider` / `--ai-*`      | AI provider and model configuration                                       |

`coach` additionally supports `--exclude-repos` / `--exclude-paths` for
sensitive experimental projects (shared, not coach-only).

---

## Shared Internals

### New PlatformAdapter Methods (added once, implemented for GitHub + Azure)

- `listMergedPRs({ since, limit, cursor })` — paginated listing of merged PRs.
- `getReviewThreads(prNumber)` — all review threads (resolved and unresolved)
  with author, path, line, createdAt, and isBot.

### New `src/intelligence/` Module

| File                       | Responsibility                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `cache.ts`                 | JSON history cache (see below)                                                       |
| `historyFetcher.ts`        | Adapter → cached PR store; incremental sync                                          |
| `commentFilter.ts`         | Local bot/trivial-comment filter (Dependabot, CI bots, "LGTM", emojis) — no LLM cost |
| `anonymizer.ts`            | Strip usernames, emails, commit signatures (used by `coach`; optional for `analyze`) |
| `clustering.ts`            | Semantic clustering / LLM categorization of comments                                 |
| `reports/analyzeReport.ts` | Frequent-issues report + rule generation                                             |
| `reports/coachReport.ts`   | Team training needs report                                                           |

---

## JSON History Cache (not SQLite)

JSON keeps the implementation simple and matches the repo's existing file-based
caching conventions.

- **Location:** `{tempPath}/history/{platform}-{owner}-{repo}.json`
- **Content:** raw, per-PR records keyed by PR number, storing `mergedAt`,
  `updatedAt`, title, changed file paths, and review threads (author, body, path,
  line, resolved, createdAt, isBot), plus the pagination cursor for resumable
  backfills.
- **Store raw, anonymize at read time:** the cache keeps original data so both
  commands share it. `coach` strips identifiers in the `anonymizer` before any
  LLM work; `analyze` keeps attribution for "resolved vs. recurring debates".
- **Incremental sync:** on re-run, fetch the PR list and only re-fetch threads
  for PRs whose `updatedAt` is newer than the cache entry. A second command over
  the same window is a pure cache hit.
- **Hygiene:** extend the `repos` command (or add `analyze cache list/clean`)
  using the existing `--list` / `--clean` / `--clean-repo` UX. Prune entries
  outside the requested window.

---

## `analyze` Outputs

### 1. Frequent Issues & Quality Report

Markdown (`MM_Repo_Intelligence_Report.md`) and JSON (`repo-intelligence.json`):

- Top 10 most frequent review topics.
- High-friction files and modules (hotspots).
- Summary of resolved vs. recurring review debates.
- Actionable technical-debt recommendations.

### 2. Automated `AGENTS.md` Rule Discovery

Synthesize recurring human comments into structured rules (`--dry-run` previews
without writing):

- **Always Rules** — patterns reviewers consistently request.
- **Ask First Rules** — high-risk changes that needed team alignment.
- **Never Rules** — anti-patterns frequently rejected.
- **Good/Bad code examples** synthesized from real PR diffs and comments.

---

## `coach` Outputs

Team Training Needs Report, Markdown (`Team_Training_Needs_Report.md`) and JSON:

- **Top skill-gap categories** with % frequency (e.g. async error handling
  flagged in 34% of TypeScript PRs).
- **High-friction architecture hotspots** — modules with the highest review
  iteration counts.
- **Recommended workshop / tech-talk topics** for engineering syncs.
- **Documentation & `AGENTS.md` gaps** — conventions worth documenting.
- **Refactoring & debt priorities** in legacy modules.

### Privacy & Ethical Safeguards

- Zero individual profiling: usernames, emails, and commit signatures are
  stripped before analysis.
- No per-author or per-reviewer statistics in any report.
- Constructive framing ("Team Opportunity for Workshop", never
  "Developer Error Count").

---

## Token Cost & Performance Strategy

1. **Local pre-filtering:** bot and trivial comments are removed without
   contacting the AI provider.
2. **Hierarchical batch summarization:** map-reduce comments by directory/module
   before the final synthesis pass.
3. **Derived-data caching:** cache embeddings/clusters keyed by normalized
   comment hash so re-analysis of cached PRs costs zero tokens.
4. **Near-duplicate detection:** normalize comment bodies into hashes to identify
   the same feedback repeated verbatim across PRs — feeds both "top recurring
   issues" and "skill-gap frequency".

---

## Unified Report Schema

Both commands emit JSON with a shared envelope so the future Web UI dashboard can
render them with one schema instead of two bespoke formats.

---

## Future Roadmap (Post-MVP)

1. **AGENTS.md loader in the review engine** — closes the loop so generated
   rules are actually enforced by future reviews. This is a dependency for the
   rule-discovery feature to deliver value.
2. **Continuous rule-drift detection** — periodic CI audits flag new comments
   that contradict existing `AGENTS.md` rules.
3. **Rule impact analytics** — measure reduction in human review comments after a
   discovered rule is enforced.
4. **Web UI integration** — visual trends for frequent issues, topic clusters,
   and candidate rule cards with one-click "Approve Rule to AGENTS.md".
5. **Training impact tracker** — measure reduction in specific findings in the
   months after a workshop.

---

## Open Decisions & Dependencies

- The generated `AGENTS.md` rules only take effect if the review engine gains an
  AGENTS.md loader; the rule output format must match what the engine can ingest.
- Confirm whether `analyze` should optionally apply the anonymizer (e.g. for a
  shareable report) or always keep attribution.
- The `--repo-url` / multi-repo selection model is shared with the existing
  single-repo configuration conventions and should be validated first.
