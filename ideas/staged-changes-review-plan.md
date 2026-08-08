# Feature Plan: Staged-Changes Review (Pre-Push Mentoring)

> **Status:** Implemented (`merge-mentor stage`). See [docs/stage.md](../docs/stage.md).
> Remaining roadmap items (offline provider pairing, `--apply`, web UI
> integration, webhook synergy) are tracked in the [Future Roadmap](#future-roadmap-post-mvp).

## Overview

**Merge Mentor** reviews pull requests after they are pushed to GitHub or Azure
DevOps. By that point the author has committed, pushed, and opened a PR — the
highest-friction moments for acting on feedback.

This feature adds a local, **pre-push** review mode: `merge-mentor stage`
reviews the author's working tree against a base branch (`HEAD` or a configured
base) right on the developer's machine, before any commit is pushed or any PR is
opened. The author gets findings while the change is still theirs alone to
adjust, at the exact point in the workflow where fixing is cheapest.

It is a "mentoring at the point of writing" workflow and a natural companion to
the planned Azure DevOps webhook: the webhook reviews PRs that _did_ get pushed;
`stage` reviews the work _before_ it gets pushed.

```
git checkout -b feat/auth-refactor
# ... write code ...
merge-mentor stage --staged        # ← review the diff before committing
# ... address findings ...
git add -A && git commit -m "..."
merge-mentor stage --base main     # ← review the full branch before pushing
git push
# merge-mentor review --pr 42       # ← existing flow, unchanged
```

---

## Current State

- The CLI is Commander-based; commands are registered in `src/program.ts`.
- `ReviewEngine` (`src/review/engine.ts`) is tightly coupled to a
  `PlatformAdapter` and a PR number: it fetches details, files, and existing
  comments through the adapter and posts results back through it.
- `WorkspaceManager.resolveWorkspace()` already supports a pre-existing local
  checkout via `localWorkspacePath` (used by `--ci`), so the engine can already
  operate over a local repo; it just has no way to be _fed_ a local diff.
- The `GitClient` port (`src/review/gitClient.ts`, with `cli` and `isomorphic`
  backends) supports clone/fetch/checkout/clean/setRemoteUrl but has **no diff
  or status operation** — that is the missing primitive.
- `ReviewStateCache` caches per-file review results keyed by file SHA
  (`src/review/reviewStateCache.ts`), so unchanged files can be skipped between
  runs. This is directly reusable.
- `CommentManager` embeds a stable per-finding `finding-id` marker in comments,
  but for local mode there is no platform to post to.
- `tempPath` defaults to `./.mergementor`; `reports/`, `cache/`, `logs/`,
  `transcripts/` subdirectories already exist.

---

## CLI Design

A new top-level command — no subcommand nesting:

```bash
# Review unstaged + staged working-tree changes vs HEAD
merge-mentor stage

# Review only staged changes vs HEAD (before committing)
merge-mentor stage --staged

# Review the full working tree (or staged set) against a base branch
merge-mentor stage --base origin/main

# Compare an arbitrary ref pair, e.g. all changes on the feature branch
merge-mentor stage --base main --head feat/foo

# Fail the run (exit 1) when critical/high findings exist — hook-friendly
merge-mentor stage --staged --exit-code

# Machine-readable output for editors/CI
merge-mentor stage --format json --output ./stage-review.json
```

### Options

| Option                | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| `--dir <path>`        | Repo root to operate on (default: current directory)                     |
| `--base <ref>`        | Base ref (default `HEAD`; e.g. `main`, `origin/main`, a SHA)             |
| `--head <ref>`        | Head ref (default: working tree; paired with `--base` for ref-to-ref)    |
| `--staged`            | Review only staged changes (vs `HEAD`)                                   |
| `--profile`           | Reuse existing review type/passes selection (`general`, `security`, ...) |
| `--passes`            | Ordered review passes (same as `review`)                                 |
| `--provider`/`--ai-*` | AI provider and model configuration                                      |
| `--ignore <glob>`     | Ignore patterns (existing ignore mechanism)                              |
| `--exit-code`         | Exit `1` when critical/high findings exist (for git hooks)               |
| `--format`            | `terminal`, `markdown`, or `json` output                                 |
| `--output <path>`     | Write the report to a file (else stdout)                                 |
| `--no-cache`          | Skip reading/writing the per-file SHA cache                              |
| `--temp-path`         | Base temp path (Env: `MM_TEMP_PATH`)                                     |

---

## Internals

### 1. New `GitClient` operations (both backends)

Add to the port so `cli` and `isomorphic` stay interchangeable:

- `diff(baseRef, headRef?)` — unified diff between two refs.
- `workingTreeDiff()` / `stagedDiff()` — working-tree / index diff vs `HEAD`
  (or an explicit base).
- `status()` — file status list (added/modified/deleted/renamed) for the
  working tree, mirroring `PRFile`.

The `isomorphic` backend already has `statusMatrix`; diffs can be produced via
`log` + `diff` or `diff-tree`. `CliGitClient` maps to `git diff` /
`git status --porcelain`.

### 2. `LocalPlatformAdapter`

A thin `PlatformAdapter` implementation that synthesizes the PR-shaped inputs
`ReviewEngine` already expects, but from local git instead of a remote API:

- `getPRDetails()` → a pseudo-PR: `number` from the current branch
  (`-1` if unknown), `title`/`description` empty, `headBranch` from the branch
  name, `baseBranch` from `--base`.
- `getPRFiles()` → `PRFile[]` derived from the diff/status above.
- `getRepoInfo()` → `{ platform: "local", owner, repo }` parsed from the
  configured remote URL (used only for cache-key stability and workspace
  resolution).
- Comment APIs (`postInlineComment`, `postGeneralComment`, ...) → **no-ops**
  that return successfully; there is no remote to comment on.

This lets the entire existing review pipeline (passes, specialists,
cross-file analysis, `findingAggregator`, `ReviewStateCache`) run unchanged.

### 3. Local output instead of comments

Because there is no platform to post to, findings are surfaced as:

- A **terminal report** (default) grouped by file/severity, identical in shape
  to `displayResults()`.
- An optional **markdown report** under `{tempPath}/reports/stage-{branch}-{sha}.md`.
- An optional **JSON report** (`--format json`) with a stable schema so editors
  and future tooling can render inline diagnostics.
- Findings retain their `finding-id` fingerprints so a later
  `merge-mentor review` on the same PR does not re-post them as new comments.

### 4. Caching and dedup

- Reuse `ReviewStateCache` keyed by `local-{owner}-{repo}-{branch}`: unchanged
  files (same SHA) skip the AI provider between runs. This matters because
  `stage` will run repeatedly during a session.
- Ref-to-ref mode stores the base SHA in the cache so a forced base update
  invalidates only the affected files.

### 5. Hook integration

`--exit-code` + `--staged` is designed to run from a `husky` `pre-commit` or
`pre-push` hook. The plan intentionally does **not** auto-fix or auto-apply
suggestions; it only reports and gates, keeping the hook non-destructive.

---

## Security Considerations

- `stage` never reads or sends remote platform credentials; no token is required
  unless the repo is private and the workspace must be (re)cloned for context
  extraction.
- The source diff is still sent to the configured **remote** AI provider by
  default. Fully offline operation is only achieved when paired with a local
  provider (see roadmap); the report should state which provider was used so
  authors know where their code went.
- Cache files contain diff-derived content; they live under `tempPath` like
  existing review caches and inherit the same hygiene conventions.

---

## Tests

- Diff parsing: added/modified/deleted/renamed files map to `PRFile[]`.
- `--staged` includes only staged changes; unstaged-only changes are excluded.
- `--base` vs `HEAD` comparison produces the expected unified diff.
- `LocalPlatformAdapter` comment APIs are no-ops and never throw.
- Cache reuse: a second run over unchanged files performs zero AI calls.
- Base-SHA invalidation: updating the base ref re-reviews only affected files.
- `--exit-code`: returns `0` with no critical/high findings, `1` otherwise.
- JSON schema stability for `--format json`.
- Both `git` backends (`cli` and `isomorphic`) produce equivalent diffs.

---

## Verification

1. Run the new unit and integration tests.
2. Run `pnpm check`.
3. In a scratch repo, stage a known bug, run `merge-mentor stage --staged`, and
   confirm the finding matches what `merge-mentor review` would post on a PR
   containing the same change.
4. Re-run over an unchanged working tree and confirm zero AI calls (cache hit).
5. Wire `merge-mentor stage --staged --exit-code` into `husky` `pre-commit` and
   confirm it blocks commits containing a critical finding and passes clean ones.

---

## Future Roadmap (Post-MVP)

1. **Offline provider pairing** — first-class support for a local model
   (e.g. Ollama) so `stage` can run fully offline for teams that cannot send
   code to remote providers.
2. **Suggested-patch application** — optional `--apply` that prints (not applies)
   concrete `git apply`-able suggestions; explicit human opt-in only.
3. **Web UI integration** — surface stage findings as inline editor diagnostics
   once the v4 web app exists.
4. **Webhook synergy** — a `stage` run against the _base_ branch of an incoming
   webhook event can cheaply re-review only changed files before the full
   `review` run.

---

## Open Decisions & Dependencies

- Whether `stage` should share the same `AGENTS.md`/`repoContext` loading as
  `review` (that loader is a dependency of the repo-intelligence plan; until it
  lands, `stage` inherits whatever `review` has).
- The pseudo-PR `number` semantics for cache keys when the branch has no remote
  counterpart.
- Whether findings should be persisted into the `ReviewStateCache` namespace for
  the _real_ PR so a later `review` skips duplicates (they already share the
  `finding-id` scheme).
- Exact name of the command (`stage` vs `local-review` vs `prepush`) — `stage`
  is used above but is not final.
