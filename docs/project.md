---
layout: default
title: Project Command
---

# `project` Command

The `project` command reviews a project or feature plan hierarchy against planning and architectural guidelines using an AI provider. It evaluates child Epics, Features, and User Stories linked under a root Planning Item.

## Usage

```bash
# Review a project hierarchy (dry-run, console output)
merge-mentor project 99

# Review project plan and post comments back to the root epic/plan on the remote platform
merge-mentor project 99 --write

# Review a project on Azure DevOps
merge-mentor project 5432 --platform azure --write
```

---

## Options

### General & Platform Options

| Option                  | Description                                                            | Env Variable   | Default          |
| ----------------------- | ---------------------------------------------------------------------- | -------------- | ---------------- |
| `<id>`                  | The ID of the root planning item/Epic (required argument)              | -              | -                |
| `--platform <platform>` | Platform to use (`github` or `azure`)                                  | `MM_PLATFORM`  | `github`         |
| `--write`               | Post comments back to the root planning item (default is dry-run mode) | -              | `false`          |
| `--temp-path <path>`    | Base path for temporary files                                          | `MM_TEMP_PATH` | `./.mergementor` |

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

| Option                  | Description                                                     | Env Variable     | Default       |
| ----------------------- | --------------------------------------------------------------- | ---------------- | ------------- |
| `--provider <provider>` | AI provider (`copilot-sdk`, `opencode-sdk`, `claude-agent-sdk`) | `MM_AI_PROVIDER` | `copilot-sdk` |
| `--ai-model <model>`    | Model name for the active AI provider                           | `MM_AI_MODEL`    | -             |
| `--ai-base-url <url>`   | OpenAI-compatible API base URL for BYOK                         | `MM_AI_BASE_URL` | -             |
| `--ai-api-key <key>`    | API key for BYOK                                                | `MM_AI_API_KEY`  | -             |

---

## Plan Verification

The AI provider parses the entire work item hierarchy to check for:

- **Completeness**: Ensures that all child items (Epics -> Features -> Stories) have description, scope, and test requirements defined.
- **Scope Creep**: Detects items that expand scope beyond the root project intent.
- **Logical Ordering**: Verifies dependencies between work items are structured logically.
- **Risk & Architecture alignment**: Highlights architectural risks, data boundary concerns, or external integration friction.
