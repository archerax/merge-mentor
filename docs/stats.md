---
layout: default
title: Stats Command
---

# `stats` Command

The `stats` command reports how many pull requests Merge Mentor has reviewed and how many comments it has posted. By default it queries the **real PRs** in your GitHub or Azure DevOps repository, so it reflects what is actually on the platform (including reviews run by CI; on GitHub a comment must come from a `[bot]` account or the token's own account to count). The same live numbers appear on the **Stats** page of the [web dashboard](./ui.md), with a 7/30/90-day window selector.

## Usage

```bash
# Live stats for the configured repository (PRs active in the last 30 days)
merge-mentor stats

# A different window, or a larger scan
merge-mentor stats --since 90d --limit 300
merge-mentor stats --since 2026-01-31

# Another repository, and machine-readable output
merge-mentor stats --platform github --github-repo-owner my-org --github-repo-name my-repo --json

# Azure DevOps
merge-mentor stats --platform azure

```

The token needs the same read access as `review` (comments and pull requests).

## AI usage and cost (`--usage`)

```bash
# Token usage and cost for PR reviews run in this project (last 30 days)
merge-mentor stats --usage

# A different window, machine-readable
merge-mentor stats --usage --since 90d --json
```

Every PR review writes a small usage record next to its markdown report (`<tempPath>/reports/<pr>-review-usage-<timestamp>.json`). `stats --usage` reads those local files: it needs no platform credentials, makes no API calls, and nothing leaves your machine. Each review run gets its own record, so re-reviews of the same PR are all counted.

It reports input, output, reasoning and cached tokens; averages per review and per PR; and breakdowns by model and provider.

- **Not reported, never zero.** Providers that do not report usage (or a field such as cached tokens) show `not reported`. Reviews without usage are counted separately and excluded from the totals.
- **Partial runs.** If only some of a review's AI calls reported usage, the totals cover those calls and the review is flagged as partial.
- **Cost** is shown only when the provider reports it. GitHub Copilot reports cost per request, shown as AI credits (1 credit = $0.01). There is no built-in price table for other providers, so they show tokens only.
- The **Stats** page of the [web dashboard](./ui.md) shows the same usage in an **AI usage** section, read from the same local files. It works even when the platform token is not configured.
- Records are per project (`--temp-path` / `MM_TEMP_PATH`), and reviews run before this feature existed have no record. Only PR reviews are recorded.

## Options

| Option                        | Description                                                           | Env Variable           | Default          |
| ----------------------------- | --------------------------------------------------------------------- | ---------------------- | ---------------- |
| `--since <date\|Nd>`          | Only count PRs/activity since a date (`2026-01-31`) or window (`30d`) | -                      | `30d`            |
| `--limit <number>`            | Maximum number of PRs to inspect (1-1000)                             | -                      | `100`            |
| `--temp-path <path>`          | Base path for temporary files, including audit `logs`                 | `MM_TEMP_PATH`         | `./.mergementor` |
| `--json`                      | Output statistics as JSON                                             | -                      | `false`          |
| `--usage`                     | Report AI token usage and cost from local review reports              | -                      | `false`          |
| `--platform <platform>`       | `github` or `azure`                                                   | `MM_PLATFORM`          | `azure`          |
| `--github-token <token>`      | GitHub personal access token                                          | `MM_GITHUB_TOKEN`      | -                |
| `--github-repo-owner <owner>` | GitHub repository owner                                               | `MM_GITHUB_REPO_OWNER` | -                |
| `--github-repo-name <name>`   | GitHub repository name                                                | `MM_GITHUB_REPO_NAME`  | -                |
| `--azure-token <token>`       | Azure DevOps personal access token                                    | `MM_AZURE_TOKEN`       | -                |
| `--azure-org <org>`           | Azure DevOps organization                                             | `MM_AZURE_ORG`         | -                |
| `--azure-project <project>`   | Azure DevOps project                                                  | `MM_AZURE_PROJECT`     | -                |
| `--azure-repo <repo>`         | Azure DevOps repository                                               | `MM_AZURE_REPO`        | -                |

## What is counted

- **PRs scanned**: PRs, open or closed, inside the window, newest first, up to `--limit`. A warning is shown when the limit is reached so you know older PRs were left out.
- **PRs reviewed**: scanned PRs that carry at least one Merge Mentor comment.
- **Comments posted**: Merge Mentor comments on those PRs, split into inline and general (PR-level, including the review summary). A comment counts only if it contains the bot identifier (`botCommentIdentifier`); on GitHub it must also come from the token's own account, the same rule `review` uses to recognise its comments.
- PRs whose comments cannot be fetched are reported as unreadable and excluded from the totals; the command fails if none of the PRs can be read (for example with an expired token).

Platform differences:

- **GitHub** windows by the PR's last update time and counts every Merge Mentor comment, including thread replies.
- **Azure DevOps** can only filter by PR creation date, and counts the comment threads Merge Mentor started (replies inside a thread are not counted).
- Comments are counted over the whole life of each PR in the window, not only within the window.
