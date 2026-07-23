---
layout: default
title: PBI Command
---

# `pbi` Command

The `pbi` command reviews a Product Backlog Item, User Story, or Issue against the **INVEST** model (Independent, Negotiable, Valuable, Estimable, Small, Testable) using an AI provider.

## Usage

```bash
# Review a GitHub issue / PBI (dry-run, console output)
merge-mentor pbi 42

# Review a PBI and post comments back to the issue/story on the platform
merge-mentor pbi 42 --write

# Review a PBI on Azure DevOps
merge-mentor pbi 1024 --platform azure --write
```

---

## Options

### General & Platform Options

| Option                  | Description                                                     | Env Variable   | Default          |
| ----------------------- | --------------------------------------------------------------- | -------------- | ---------------- |
| `<id>`                  | The ID of the issue or Product Backlog Item (required argument) | -              | -                |
| `--platform <platform>` | Platform to use (`github` or `azure`)                           | `MM_PLATFORM`  | `github`         |
| `--write`               | Post comments back to the PBI/Issue (default is dry-run mode)   | -              | `false`          |
| `--temp-path <path>`    | Base path for temporary files                                   | `MM_TEMP_PATH` | `./.mergementor` |

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

| Option                  | Description                                                                          | Env Variable     | Default       |
| ----------------------- | ------------------------------------------------------------------------------------ | ---------------- | ------------- |
| `--provider <provider>` | AI provider (`copilot-sdk`, `opencode-sdk`). Note: `claude-agent-sdk` is deprecated. | `MM_AI_PROVIDER` | `copilot-sdk` |
| `--ai-model <model>`    | Model name for the active AI provider                                                | `MM_AI_MODEL`    | -             |
| `--ai-base-url <url>`   | OpenAI-compatible API base URL for BYOK                                              | `MM_AI_BASE_URL` | -             |
| `--ai-api-key <key>`    | API key for BYOK                                                                     | `MM_AI_API_KEY`  | -             |

---

## INVEST Model Verification

The AI provider analyzes the Product Backlog Item's description, acceptance criteria, and comments to evaluate how well it matches the INVEST quality framework:

- **I**ndependent: The item should be self-contained with minimal dependencies.
- **N**egotiable: It should describe the co-creation of value, leaving room for discussion.
- **V**aluable: It must deliver clear value to the end user or business.
- **E**stimable: It contains enough information for developers to estimate the effort.
- **S**mall: It should be sized appropriately to fit within a single sprint/iteration.
- **T**estable: It must have clear acceptance criteria to allow writing automated or manual tests.
