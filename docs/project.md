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

# Review an Azure work item by URL
merge-mentor project --url https://dev.azure.com/org/project/_workitems/edit/99 --azure-repo repo

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
| `[id]`                  | The ID of the root planning item/Epic                                  | -              | -                |
| `--id <id>`             | The ID of the root planning item/Epic                                  | -              | -                |
| `--url <url>`           | Azure DevOps work-item URL (sets platform, organization, and project)  | -              | -                |
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

| Option                  | Description                                  | Env Variable     | Default       |
| ----------------------- | -------------------------------------------- | ---------------- | ------------- |
| `--provider <provider>` | AI provider (`copilot-sdk`, `opencode-sdk`). | `MM_AI_PROVIDER` | `copilot-sdk` |
| `--ai-model <model>`    | Model name for the active AI provider        | `MM_AI_MODEL`    | -             |
| `--ai-base-url <url>`   | OpenAI-compatible API base URL for BYOK      | `MM_AI_BASE_URL` | -             |
| `--ai-api-key <key>`    | API key for BYOK                             | `MM_AI_API_KEY`  | -             |

---

## Plan Verification

The AI provider parses the entire work item hierarchy, including parent/child
relationships and dependency links, and produces a severity-ranked, traceable
review. Untrusted work-item content is wrapped in explicit security boundaries so
it is analysed as data, never followed as instructions.

It evaluates four non-overlapping dimensions:

- **Completeness**: Whether child items fully cover the root's scope — missing
  requirements, orphaned items, empty containers, and duplicate coverage.
- **Dependency**: Ordering and state conflicts from the dependency links (e.g. a
  successor "In Progress" while its predecessor is not done) and priority
  inversions. Dependency direction is explicit: a `successor` source depends on
  its target (target completes first); a `predecessor` source completes before
  its target.
- **Acceptance Criteria**: Missing, vague, or untestable acceptance criteria on
  child stories.
- **Estimation**: Missing estimates, oversized items that need splitting, and
  inconsistent MoSCoW/priority.

Each review reports structured `findings` (work item ID, dimension, severity
`critical`/`high`/`medium`/`low`, issue, and recommendation) alongside the four
prose summaries and an overall confidence level. The findings are grouped by
severity in the posted report and terminal output.

**Notes:**

- Items in a `Done`/completed state are kept in full — delivered scope is treated
  as evidence when checking completeness.
- Comments are capped at the latest 5 per item and 500 characters each, with an
  omission marker when content is elided.
- GitHub project review is not yet supported.
