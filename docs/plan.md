---
layout: default
title: Plan Command
---

# `plan` Command

The `plan` command generates a phased implementation plan for an **Azure DevOps** work item, grounded in your local codebase. It fetches the work item, switches your local repository to a clean, fast-forwarded base branch, asks a higher-tier planning model to inspect the repository and produce tasks, and writes the result as a Markdown file with checkboxes.

> **Azure DevOps only.** GitHub issues are rejected with a clear error.

## Usage

```bash
# Generate a plan for work item 1024 against the main branch (local save only)
merge-mentor plan 1024 --base main

# Generate a plan and attach the Markdown file to the work item
merge-mentor plan 1024 --base main --write

# Use a specific planning model for this run
merge-mentor plan 1024 --base main --plan-model gpt-6-sol

# Allow planning with uncommitted local changes
merge-mentor plan 1024 --base main --allow-dirty
```

The generated plan is saved under `.mergementor/reports/`. Files are named `merge-mentor-plan-<id>.md`, and the version is derived from the plan files already attached to the work item (falling back to locally saved plans). Running the command again for the same work item therefore produces `merge-mentor-plan-<id>-v2.md`, `-v3`, … instead of colliding with an existing plan.

---

## Options

### General Options

| Option                    | Description                                                        | Env Variable     | Default          |
| ------------------------- | ------------------------------------------------------------------ | ---------------- | ---------------- |
| `[id]`                    | The Azure DevOps work item ID                                      | -                | -                |
| `--id <id>`               | The Azure DevOps work item ID                                      | -                | -                |
| `--url <url>`             | Azure DevOps work-item URL                                         | -                | -                |
| `--platform <platform>`   | Platform; only `azure` is supported                                | -                | `azure`          |
| `--base <branch>`         | Base branch to switch to and fast-forward from `origin` (required) | -                | -                |
| `--write`                 | Attach the generated plan file to the work item                    | -                | `false`          |
| `--allow-dirty`           | Allow execution with uncommitted local changes                     | -                | `false`          |
| `--temp-path <path>`      | Base path for temporary files                                      | `MM_TEMP_PATH`   | `./.mergementor` |
| `--git-backend <backend>` | Git backend (`cli` or `isomorphic`)                                | `MM_GIT_BACKEND` | `cli`            |

### Azure DevOps Credentials

| Option                      | Description               | Env Variable       |
| --------------------------- | ------------------------- | ------------------ |
| `--azure-token <token>`     | Azure DevOps PAT          | `MM_AZURE_TOKEN`   |
| `--azure-org <org>`         | Azure DevOps organization | `MM_AZURE_ORG`     |
| `--azure-project <project>` | Azure DevOps project      | `MM_AZURE_PROJECT` |
| `--azure-repo <repo>`       | Azure DevOps repository   | `MM_AZURE_REPO`    |

### AI Provider Configuration

| Option                    | Description                                 | Env Variable       | Default                              |
| ------------------------- | ------------------------------------------- | ------------------ | ------------------------------------ |
| `--provider <provider>`   | AI provider (`copilot-sdk`, `opencode-sdk`) | `MM_AI_PROVIDER`   | `copilot-sdk`                        |
| `--copilot-token <token>` | Copilot GitHub token                        | `MM_COPILOT_TOKEN` | -                                    |
| `--ai-model <model>`      | Model name for the active AI provider       | `MM_AI_MODEL`      | provider default                     |
| `--plan-model <model>`    | Higher-tier model used to generate the plan | `MM_AI_PLAN_MODEL` | `MM_AI_MODEL`, else provider default |
| `--ai-base-url <url>`     | OpenAI-compatible API base URL for BYOK     | `MM_AI_BASE_URL`   | -                                    |
| `--ai-api-key <key>`      | API key for BYOK                            | `MM_AI_API_KEY`    | -                                    |
| `--ai-timeout <ms>`       | Timeout in ms for all AI providers          | `MM_AI_TIMEOUT`    | -                                    |

---

## Output

The generated Markdown document contains:

- A heading with the work item ID and title.
- An `## Overview` section stating what the plan is trying to achieve (objective and outcome).
- One `## Phase N: <name>` section per phase, each with a goal and `- [ ]` task checkboxes. The repo-relative files each task touches and its acceptance criteria are indented beneath each task.
- `## Assumptions`, `## Risks`, `## Out of Scope`, and `## Unresolved Questions` sections.

Tasks are expected to cite only file paths that exist in the repository, and each phase should identify the tests or verification steps that prove the work is done.

If the work item lacks enough information for a trustworthy plan, the document reports the status as `insufficient_information` and lists the missing information instead of tasks.

---

## Safety

- The command operates on the **current working directory**.
- Unless `--allow-dirty` is passed, it aborts when the working tree has uncommitted changes.
- It switches to `--base` and runs a **fast-forward-only** pull. If the base branch has diverged, the pull fails safely and leaves your working tree untouched.
- Work item titles, descriptions, acceptance criteria, and comments are treated as untrusted data. They are wrapped in explicit delimiters and the model is instructed never to follow instructions embedded in them.
