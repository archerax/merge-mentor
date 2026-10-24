---
layout: default
title: Stats Command
---

# `stats` Command

The `stats` command reports how many pull requests Merge Mentor has reviewed and how many comments it has posted. By default it queries the **real PRs** in your GitHub or Azure DevOps repository, so it reflects what is actually on the platform (including reviews run by CI or by teammates). The same live numbers appear on the **Stats** page of the [web dashboard](./ui.md), with a 7/30/90-day window selector.

## Usage

```bash
# Live stats for the configured repository (PRs active in the last 30 days)
merge-mentor stats

# A different window, or a larger scan
merge-mentor stats --since 90d --limit 300
merge-mentor stats --since 2026-01-31

# Another repository, and machine-readable output
merge-mentor stats --github-repo-owner my-org --github-repo-name my-repo --json

# Azure DevOps
merge-mentor stats --platform azure

# Offline: summarize the local audit logs instead of querying the platform
merge-mentor stats --source audit
```

The token needs the same read access as `review` (comments and pull requests).

## Options

| Option                        | Description                                                                | Env Variable           | Default          |
| ----------------------------- | -------------------------------------------------------------------------- | ---------------------- | ---------------- |
| `--source <source>`           | `live` (query the platform) or `audit` (local audit logs)                  | -                      | `live`           |
| `--since <date\|Nd>`          | Only count PRs/activity since a date (`2026-01-31`) or window (`30d`)      | -                      | `30d` (live)     |
| `--limit <number>`            | Maximum number of PRs to inspect in live mode                              | -                      | `100`            |
| `--json`                      | Output statistics as JSON                                                  | -                      | `false`          |
| `--platform <platform>`       | `github` or `azure`                                                        | `MM_PLATFORM`          | `github`         |
| `--github-token <token>`      | GitHub personal access token                                               | `MM_GITHUB_TOKEN`      | -                |
| `--github-repo-owner <owner>` | GitHub repository owner                                                    | `MM_GITHUB_REPO_OWNER` | -                |
| `--github-repo-name <name>`   | GitHub repository name                                                     | `MM_GITHUB_REPO_NAME`  | -                |
| `--azure-token <token>`       | Azure DevOps personal access token                                         | `MM_AZURE_TOKEN`       | -                |
| `--azure-org <org>`           | Azure DevOps organization                                                  | `MM_AZURE_ORG`         | -                |
| `--azure-project <project>`   | Azure DevOps project                                                       | `MM_AZURE_PROJECT`     | -                |
| `--azure-repo <repo>`         | Azure DevOps repository                                                    | `MM_AZURE_REPO`        | -                |
| `--temp-path <path>`          | Base path for temporary files, including `logs` (used by `--source audit`) | `MM_TEMP_PATH`         | `./.mergementor` |

## What is counted (live)

- **PRs scanned**: PRs, open or closed, inside the window, newest first, up to `--limit`. A warning is shown when the limit is reached so you know older PRs were left out.
- **PRs reviewed**: scanned PRs that carry at least one Merge Mentor comment.
- **Comments posted**: Merge Mentor comments on those PRs, split into inline and general (PR-level, including the review summary). A comment counts only if it contains the bot identifier (`botCommentIdentifier`); on GitHub it must also come from the token's own account, the same rule `review` uses to recognise its comments.
- PRs whose comments cannot be fetched are reported as unreadable and excluded from the totals.

Platform differences:

- **GitHub** windows by the PR's last update time and counts every Merge Mentor comment, including thread replies.
- **Azure DevOps** can only filter by PR creation date, and counts the comment threads Merge Mentor started (replies inside a thread are not counted).
- Comments are counted over the whole life of each PR in the window, not only within the window.

## Audit source

`--source audit` reads the audit events the CLI writes to `<temp-path>/logs`, so it needs no network or token but only sees reviews run from this machine. Audit events record the PR number but not the repository, so PRs are de-duplicated per platform and number, and deleting the log files resets the totals.
