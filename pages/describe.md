---
layout: default
title: Describe Command
---

# `describe` Command

The `describe` command generates a title, summary, and changelog for a pull request. It analyzes the differences in code between the PR branch and the target branch to build a detailed change report.

## Usage

```bash
# Generate a summary and changelog (dry-run mode, output to console)
merge-mentor describe --pr 123

# Suggest a Conventional Commit style title for the PR
merge-mentor describe --pr 123 --suggest-title

# Generate and update the actual PR description and title on the remote platform (GitHub/Azure DevOps)
merge-mentor describe --pr 123 --write
```

---

## Options

### General Options

| Option                          | Description                                                               | Env Variable   | Default          |
| ------------------------------- | ------------------------------------------------------------------------- | -------------- | ---------------- |
| `--pr <number>`                 | Pull request number (required unless `--pr-url` or `--ci` is used)        | -              | -                |
| `--pr-url <url>`                | PR URL (automatically parses platform, repository details, and PR number) | -              | -                |
| `--ci`                          | CI mode: auto-detect platform and PR from environment variables           | -              | `false`          |
| `--platform <platform>`         | Platform to use (`github` or `azure`)                                     | `MM_PLATFORM`  | `github`         |
| `--suggest-title`               | Suggest a Conventional Commit style title for the PR                      | -              | `false`          |
| `--write`                       | Update the PR description and/or title on the remote platform             | -              | `false`          |
| `--temp-path <path>`            | Base path for temporary files (cache, diffs, logs, etc.)                  | `MM_TEMP_PATH` | `./.mergementor` |
| `--local-workspace-path <path>` | Path to a pre-existing local repository checkout                          | -              | -                |

### File Filtering & Output

| Option               | Description                                   | Default           |
| -------------------- | --------------------------------------------- | ----------------- |
| `--ignore <pattern>` | Glob pattern for files to ignore (repeatable) | `**/generated/**` |
| `--no-stream`        | Disable streaming output display              | `false`           |

### AI Provider Configuration

| Option                    | Description                                                     | Env Variable       | Default        |
| ------------------------- | --------------------------------------------------------------- | ------------------ | -------------- |
| `--provider <provider>`   | AI provider (`copilot-sdk`, `opencode-sdk`, `claude-agent-sdk`) | `MM_AI_PROVIDER`   | `copilot-sdk`  |
| `--copilot-token <token>` | Copilot GitHub token                                            | `MM_COPILOT_TOKEN` | -              |
| `--ai-timeout <ms>`       | Timeout in ms for all AI providers                              | `MM_AI_TIMEOUT`    | `3600000` (1h) |
| `--ai-model <model>`      | Model name for the active AI provider                           | `MM_AI_MODEL`      | -              |
| `--ai-base-url <url>`     | OpenAI-compatible API base URL for BYOK                         | `MM_AI_BASE_URL`   | -              |
| `--ai-api-key <key>`      | API key for BYOK                                                | `MM_AI_API_KEY`    | -              |
