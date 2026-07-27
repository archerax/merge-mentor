---
layout: default
title: Reply Command
---

# `reply` Command

The `reply` command generates intelligent responses to open review comments on a pull request using an AI provider. It can also automatically resolve comment threads once the AI confirms that a reported defect has been fixed.

## Usage

```bash
# Reply to unresolved bot-initiated threads awaiting a reply (dry-run mode)
merge-mentor reply --pr 123 --dry-run

# Reply and automatically resolve threads where the defect is fixed
merge-mentor reply --pr 123 --resolve

# Interactively prompt before replying to each thread
merge-mentor reply --pr 123 --interactive

# Target a specific comment or thread ID
merge-mentor reply --pr 123 --comment-id 987654321
```

---

## Options

### Command Options

| Option                    | Description                                                               | Env Variable     | Default          |
| ------------------------- | ------------------------------------------------------------------------- | ---------------- | ---------------- |
| `--pr <number>`           | Pull request number (required unless `--pr-url` or `--ci` is used)        | -                | -                |
| `--pr-url <url>`          | PR URL (automatically parses platform, repository details, and PR number) | -                | -                |
| `--ci`                    | CI mode: auto-detect platform and PR from environment variables           | -                | `false`          |
| `--comment-id <id>`       | Specific comment or thread ID to reply to                                 | -                | -                |
| `--resolve`               | Automatically resolve the thread if AI confirms defect is fixed           | -                | `false`          |
| `--interactive`           | Interactively prompt before replying to each thread                       | -                | `false`          |
| `--dry-run`               | Simulate response without posting to platform                             | -                | `false`          |
| `--platform <platform>`   | Platform to use (`github` or `azure`)                                     | `MM_PLATFORM`    | `github`         |
| `--temp-path <path>`      | Base path for temporary files (cache, diffs, logs, etc.)                  | `MM_TEMP_PATH`   | `./.mergementor` |
| `--git-backend <backend>` | Git backend for cloning/fetching (`cli` or `isomorphic`)                  | `MM_GIT_BACKEND` | `cli`            |

### Platform Credentials

| Option                        | Description                  | Env Variable           |
| ----------------------------- | ---------------------------- | ---------------------- |
| `--github-token <token>`      | GitHub personal access token | `MM_GITHUB_TOKEN`      |
| `--github-repo-owner <owner>` | GitHub repository owner      | `MM_GITHUB_REPO_OWNER` |
| `--github-repo-name <name>`   | GitHub repository name       | `MM_GITHUB_REPO_NAME`  |
| `--azure-token <token>`       | Azure DevOps PAT             | `MM_AZURE_TOKEN`       |
| `--azure-org <org>`           | Azure DevOps organization    | `MM_AZURE_ORG`         |
| `--azure-project <project>`   | Azure DevOps project         | `MM_AZURE_PROJECT`     |
| `--azure-repo <repo>`         | Azure DevOps repository      | `MM_AZURE_REPO`        |

### AI Provider Configuration

| Option                    | Description                                  | Env Variable       | Default        |
| ------------------------- | -------------------------------------------- | ------------------ | -------------- |
| `--provider <provider>`   | AI provider (`copilot-sdk`, `opencode-sdk`). | `MM_AI_PROVIDER`   | `copilot-sdk`  |
| `--copilot-token <token>` | Copilot GitHub token                         | `MM_COPILOT_TOKEN` | -              |
| `--ai-timeout <ms>`       | Timeout in ms for all AI providers           | `MM_AI_TIMEOUT`    | `3600000` (1h) |
| `--ai-model <model>`      | Model name for the active AI provider        | `MM_AI_MODEL`      | -              |
| `--ai-base-url <url>`     | OpenAI-compatible API base URL for BYOK      | `MM_AI_BASE_URL`   | -              |
| `--ai-api-key <key>`      | API key for BYOK                             | `MM_AI_API_KEY`    | -              |

---

## How It Works

1. **Thread Selection**: By default, `reply` finds unresolved comment threads initiated by Merge Mentor where the latest comment is from a human user. You can also target a specific thread using `--comment-id`.
2. **Context Gathering**: The tool loads the surrounding code snippet (15 lines above/below the comment line, or full file if under 100 lines) from the workspace.
3. **AI Generation**: The AI provider analyzes the conversation history and local code snippet to generate a relevant reply and evaluate whether the issue has been resolved.
4. **Posting & Resolution**: If `--dry-run` is omitted, the reply is posted to the PR. If `--resolve` is set and the AI confirms the defect is resolved, the comment thread is automatically marked as resolved.
