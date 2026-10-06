---
layout: default
title: PBI Command
---

# `pbi` Command

The `pbi` command reviews a Product Backlog Item, User Story, or Issue for backlog quality and development readiness using an AI provider. The review is grounded in established agile principles such as **INVEST**, but presents a holistic narrative assessment rather than a criterion-by-criterion checklist.

## Usage

```bash
# Review a GitHub issue / PBI (dry-run, console output)
merge-mentor pbi 42

# Review by URL
merge-mentor pbi --url https://github.com/owner/repo/issues/42

# Review a PBI and post comments back to the issue/story on the platform
merge-mentor pbi 42 --write

# Review a PBI on Azure DevOps
merge-mentor pbi 1024 --platform azure --write
```

---

## Options

### General & Platform Options

| Option                  | Description                                                   | Env Variable   | Default          |
| ----------------------- | ------------------------------------------------------------- | -------------- | ---------------- |
| `[id]`                  | The ID of the issue or Product Backlog Item                   | -              | -                |
| `--id <id>`             | The ID of the issue or Product Backlog Item                   | -              | -                |
| `--url <url>`           | GitHub issue or Azure DevOps work-item URL                    | -              | -                |
| `--platform <platform>` | Platform to use (`github` or `azure`)                         | `MM_PLATFORM`  | `github`         |
| `--write`               | Post comments back to the PBI/Issue (default is dry-run mode) | -              | `false`          |
| `--temp-path <path>`    | Base path for temporary files                                 | `MM_TEMP_PATH` | `./.mergementor` |

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

| Option                  | Description                                  | Env Variable     | Default       |
| ----------------------- | -------------------------------------------- | ---------------- | ------------- |
| `--provider <provider>` | AI provider (`copilot-sdk`, `opencode-sdk`). | `MM_AI_PROVIDER` | `copilot-sdk` |
| `--ai-model <model>`    | Model name for the active AI provider        | `MM_AI_MODEL`    | -             |
| `--ai-base-url <url>`   | OpenAI-compatible API base URL for BYOK      | `MM_AI_BASE_URL` | -             |
| `--ai-api-key <key>`    | API key for BYOK                             | `MM_AI_API_KEY`  | -             |

---

## Review Approach

The AI provider analyzes the Product Backlog Item's description, acceptance criteria, and comments and returns a single narrative assessment of its quality and readiness, followed by actionable suggestions. It weighs well-established backlog-quality considerations — such as whether the item can be delivered independently, leaves room for negotiation, delivers clear value, is estimable, is appropriately sized, and is testable — internally, without organizing the output around them or assigning pass/fail ratings.
