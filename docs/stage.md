---
layout: default
title: Stage Command
---

# `stage` Command

The `stage` command reviews the **local working tree before you push**. It
reuses the full Merge Mentor review pipeline (passes, specialists, cross-file
analysis, finding deduplication, and the per-file SHA cache) but runs entirely
against local git state — no remote platform, no PR, no credentials required.

It is the "mentoring at the point of writing" companion to the webhook and
`review` flows: the webhook reviews PRs that _did_ get pushed; `stage` reviews
the work _before_ it gets pushed.

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

## Usage

```bash
# Review unstaged + staged working-tree changes vs HEAD
merge-mentor stage

# Review only staged changes vs HEAD (before committing)
merge-mentor stage --staged

# Review the full working tree against a base branch
merge-mentor stage --base origin/main

# Compare an arbitrary ref pair, e.g. all changes on the feature branch
merge-mentor stage --base main --head feat/foo

# Fail the run (exit 1) when critical/high findings exist — hook-friendly
merge-mentor stage --staged --exit-code

# Machine-readable output for editors/CI
merge-mentor stage --format json --output ./stage-review.json
```

## Options

### General Options

| Option                    | Description                                                        | Default           |
| ------------------------- | ------------------------------------------------------------------ | ----------------- |
| `--dir <path>`            | Repository root to operate on                                      | current directory |
| `--base <ref>`            | Base ref to diff against                                           | `HEAD`            |
| `--head <ref>`            | Head ref for ref-to-ref comparison (overrides working-tree review) | -                 |
| `--staged`                | Review only staged (index) changes vs the base ref                 | `false`           |
| `--temp-path <path>`      | Base path for temporary files (cache, diffs, logs, reports, etc.)  | `./.mergementor`  |
| `--git-backend <backend>` | Git backend for diffing (`cli` or `isomorphic`)                    | `cli`             |

### Review Configuration

| Option                  | Description                                                                                                            | Default   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------- |
| `--review-type <type>`  | Type of review (`general`, `testing`, `security`, `performance`, `fast`, `custom`)                                     | `general` |
| `--passes <passNames>`  | Comma-separated additive review passes (`scan`, `security`, `logic`, `performance`, `monorepo`, `testing`, `database`) | -         |
| `--strategy <strategy>` | Execution strategy (`deep`, `fast`, or `multi-agent`)                                                                  | `fast`    |

### File Filtering

| Option               | Description                                   |
| -------------------- | --------------------------------------------- |
| `--ignore <pattern>` | Glob pattern for files to ignore (repeatable) |

### Output Options

| Option              | Description                                                |
| ------------------- | ---------------------------------------------------------- |
| `--format <format>` | Output format (`terminal`, `markdown`, or `json`)          |
| `--output <path>`   | Write the report to a file instead of stdout               |
| `--exit-code`       | Exit `1` when critical/high findings exist (for git hooks) |
| `--no-cache`        | Skip reading/writing the per-file SHA cache                |
| `--no-stream`       | Disable streaming output display                           |

### AI Provider Configuration

| Option                    | Description                                       |
| ------------------------- | ------------------------------------------------- |
| `--provider <provider>`   | AI provider (`copilot-sdk`, `opencode-sdk`)       |
| `--copilot-token <token>` | Copilot GitHub token                              |
| `--ai-timeout <ms>`       | Timeout in ms for all AI providers                |
| `--ai-model <model>`      | Model name for the active AI provider             |
| `--ai-base-url <url>`     | OpenAI-compatible API base URL for BYOK providers |
| `--ai-api-key <key>`      | API key for BYOK providers                        |

## How It Works

- **No platform required.** Findings are surfaced as a terminal report (default),
  an optional Markdown report under `{tempPath}/reports/stage-<branch>.md`, or a
  stable JSON schema (`--format json`) for editors and CI tooling.
- **No comments are posted.** There is no remote to comment on, and `stage` never
  reads or sends remote platform credentials. The source diff is still sent to
  the configured remote AI provider by default.
- **Caching.** The per-file SHA cache is keyed by
  `local-<owner>-<repo>-<branch>`, so unchanged files skip the AI provider
  between runs — important because `stage` runs repeatedly during a session.
- **`--exit-code` hooks.** `merge-mentor stage --staged --exit-code` is designed
  for a `husky` `pre-commit` or `pre-push` hook. It only reports and gates; it
  never auto-fixes or applies changes.

### Example: `husky` pre-commit hook

```json
{
  "hooks": {
    "pre-commit": "merge-mentor stage --staged --exit-code"
  }
}
```

Findings retain their `finding-id` fingerprints, so a later
`merge-mentor review` on the same PR will not re-post them as new comments.

## Security Considerations

- `stage` never requires or uses remote platform tokens.
- By default the diff is still sent to your configured AI provider; the report
  states which provider was used so you know where your code went.
- Cache files live under `tempPath` and inherit the same hygiene conventions as
  existing review caches.
