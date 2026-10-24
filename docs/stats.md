---
layout: default
title: Stats Command
---

# `stats` Command

The `stats` command reports how many pull requests Merge Mentor has reviewed and how many comments it has posted. It reads the audit events the CLI already writes to `<temp-path>/logs` (default `./.mergementor/logs`), so no extra setup is needed. The same numbers appear on the **Stats** page of the [web dashboard](./ui.md).

## Usage

```bash
# Totals across all recorded activity
merge-mentor stats

# Only the last 30 days, or since a given date
merge-mentor stats --since 30d
merge-mentor stats --since 2026-01-31

# Machine-readable output
merge-mentor stats --json
```

## Options

| Option               | Description                                                       | Env Variable   | Default          |
| -------------------- | ----------------------------------------------------------------- | -------------- | ---------------- |
| `--since <date\|Nd>` | Only count activity since a date (`2026-01-31`) or window (`30d`) | -              | all activity     |
| `--json`             | Output statistics as JSON                                         | -              | `false`          |
| `--temp-path <path>` | Base path for temporary files, including `logs`                   | `MM_TEMP_PATH` | `./.mergementor` |

## What is counted

- **PRs reviewed**: distinct PRs with a completed review. Audit events record the PR number but not the repository, so PRs are de-duplicated per platform and number.
- **Review runs**: completed reviews; re-reviewing a PR adds a run but not a PR.
- **Comments posted**: successful inline comments, thread replies, and general PR comments. Dry-run reviews post nothing, so they add runs but no comments.
- **Comments failed**: comment posts that returned an error.

Stats only cover the log files present on disk; deleting `.mergementor/logs` resets them.
