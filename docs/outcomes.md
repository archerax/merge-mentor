---
layout: default
title: Outcomes Command
---

# `outcomes` Command

The `outcomes` command shows what became of the review threads Merge Mentor started on your pull requests, so you can judge whether its feedback is being acted on. It scans every PR in the configured repository from the last 12 months and, for each PR that has Merge Mentor comments, records whether each inline thread was **resolved** or **left open**.

It is **read-only**: it never posts, replies or resolves anything, so it does not need `--write`. It only shows numbers for you to interpret. Nothing it finds changes how reviews are done. The same numbers appear on the **Outcomes** page of the [web dashboard](./ui.md).

## Usage

```bash
# Scan the last 12 months (saved results are reused, so repeat runs are fast)
merge-mentor outcomes

# A shorter window, or a cap on how many PRs are scanned
merge-mentor outcomes --since 6m
merge-mentor outcomes --since 2026-01-31 --limit 300

# Check one PR by hand (it must be inside the window)
merge-mentor outcomes --pr 42

# Ignore saved results and rescan everything
merge-mentor outcomes --refresh

# Machine-readable output
merge-mentor outcomes --json
```

The token needs the same read access as `review` (comments and pull requests).

## Options

| Option                        | Description                                                                    | Env Variable           | Default          |
| ----------------------------- | ------------------------------------------------------------------------------ | ---------------------- | ---------------- |
| `--since <date\|Nd\|Nm\|Ny>`  | Only scan PRs active since a date (`2026-01-31`) or window (`30d`, `6m`, `1y`) | -                      | `12m`            |
| `--limit <number>`            | Maximum number of PRs to scan (1-1000)                                         | -                      | `1000`           |
| `--pr <number>`               | Scan a single PR (always rescanned; must be inside the window)                 | -                      | -                |
| `--refresh`                   | Ignore saved results and rescan every PR                                       | -                      | `false`          |
| `--json`                      | Output statistics as JSON                                                      | -                      | `false`          |
| `--temp-path <path>`          | Base path for temporary files, including the saved results                     | `MM_TEMP_PATH`         | `./.mergementor` |
| `--platform <platform>`       | `github` or `azure`                                                            | `MM_PLATFORM`          | `azure`          |
| `--github-token <token>`      | GitHub personal access token                                                   | `MM_GITHUB_TOKEN`      | -                |
| `--github-repo-owner <owner>` | GitHub repository owner                                                        | `MM_GITHUB_REPO_OWNER` | -                |
| `--github-repo-name <name>`   | GitHub repository name                                                         | `MM_GITHUB_REPO_NAME`  | -                |
| `--azure-token <token>`       | Azure DevOps personal access token                                             | `MM_AZURE_TOKEN`       | -                |
| `--azure-org <org>`           | Azure DevOps organization                                                      | `MM_AZURE_ORG`         | -                |
| `--azure-project <project>`   | Azure DevOps project                                                           | `MM_AZURE_PROJECT`     | -                |
| `--azure-repo <repo>`         | Azure DevOps repository                                                        | `MM_AZURE_REPO`        | -                |

## What is counted

Each **inline review thread** that Merge Mentor started gets one outcome:

| Outcome            | Meaning                                              |
| ------------------ | ---------------------------------------------------- |
| Resolved           | The thread was resolved                              |
| Left open (merged) | The PR was merged with the thread still open         |
| Left open (closed) | The PR was closed without merging, thread still open |
| Still in flight    | The PR is still open and the thread is unresolved    |

The **resolution rate** is `resolved / (resolved + left open)`. Threads on PRs that are still open are left out, so work in progress does not lower it. It shows `n/a` until at least one thread has reached an outcome.

Totals are also broken down by **category** (read from the comment's hidden `finding-id` marker), **severity** (read from the comment's `Severity` line) and **month**. A category or severity that cannot be read, for example on an edited comment, is shown as `unknown`.

A few things to keep in mind when reading the numbers:

- **Resolved does not prove a fix.** A thread can be resolved because the code was changed, or simply because someone clicked resolve. The command does not tell these apart.
- **General comments are not counted.** The review summary and other PR-level comments have no resolved state. Use [`stats`](./stats.md) for comment totals.
- **GitHub** counts a thread only if its first comment came from the bot account that posted it, as `review` does. **Azure DevOps** treats any thread status other than active or pending as resolved.
- **Azure DevOps** can only filter PRs by creation date, so a PR created before the window but active inside it is not included.
- PRs whose comments cannot be fetched are reported as unreadable and excluded; the command fails if none can be read (for example with an expired token).
- When the PR limit is reached a warning is shown, and older PRs are not counted.

## Saved results and caching

Results are saved to `{temp-path}/outcomes/outcomes.json` (by default `./.mergementor/outcomes/outcomes.json`). The file also works as a cache, so later runs only contact the platform for PRs that may have changed:

- A closed PR is reused if it has not changed **and** it had been closed for more than 14 days when it was last scanned.
- PRs that are still open, or were closed within the last 14 days, are always rescanned, because a thread resolved later is not known to change the PR's update time.
- Use `--refresh` to rescan everything.

The file holds counts per thread (category, severity, outcome, month) and no comment text, author names or credentials. It is plain JSON with a `version` field, so you can analyse it later. If the file was written by another version, or for another repository, it is ignored and the PRs are scanned again. Results are saved while a long scan runs, so an interrupted scan keeps the work already done.

The first scan of 12 months in a busy repository can take several minutes. It makes one request per PR that needs scanning, with a few in parallel.

## Web dashboard

The **Outcomes** page shows the saved results as soon as it opens and never scans on its own. Use **Scan last 12 months** (or **Rescan**) to start a scan; progress is shown while it runs. Tick **Rescan everything** to ignore the saved results.
