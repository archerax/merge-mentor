---
layout: default
title: Getting Started & Configuration
---

# Getting Started & Configuration

Merge Mentor can be configured using environment variables, command-line parameters, or a combination of both. **Command-line parameters always override environment variables.**

## Prerequisites

- **Node.js 22+**
- **Supported Platforms**: Windows, macOS, and Linux
- **AI Provider Prerequisites**:
  - **Copilot SDK** (`copilot-sdk`): Requires a valid Copilot token set via `MM_COPILOT_TOKEN` or `--copilot-token`.
  - **OpenCode SDK** (`opencode-sdk`): Follow the official OpenCode installation instructions at [https://opencode.dev](https://opencode.dev).
  - **Claude Agent SDK** (`claude-agent-sdk`) **[DEPRECATED]**: Requires the `@anthropic-ai/claude-agent-sdk` package to be installed, plus a valid Anthropic API key configured via `ANTHROPIC_API_KEY` or `MM_AI_API_KEY`. This provider will be removed in the next major version. Migrate to `copilot-sdk` or `opencode-sdk`.
- **Platform Access**: Personal access token for GitHub or Azure DevOps.

---

## Environment Variables

All environment variables use the `MM_` prefix to avoid conflicts with other applications.

### GitHub Platform Configuration

```bash
export MM_PLATFORM=github
export MM_GITHUB_TOKEN=your_personal_access_token
export MM_GITHUB_REPO_OWNER=username_or_org
export MM_GITHUB_REPO_NAME=repository_name
```

### Azure DevOps Platform Configuration

```bash
export MM_PLATFORM=azure
export MM_AZURE_TOKEN=your_pat
export MM_AZURE_ORG=organization_name
export MM_AZURE_PROJECT=project_name
export MM_AZURE_REPO=repository_name
```

### Token Permissions

- **GitHub Token** (set via `MM_GITHUB_TOKEN` or `--github-token`):
  - `repo` scope (full control of private repositories)
  - Or `public_repo` for public repositories only
  - _Note:_ If running inside a GitHub Actions workflow, you can use the built-in `GITHUB_TOKEN` by setting `permissions: pull-requests: write`.

- **Azure DevOps PAT** (set via `MM_AZURE_TOKEN` or `--azure-token`):
  - Code: Read & Write
  - Pull Request Threads: Read & Write

---

## AI Provider Configuration

**Default Provider**: GitHub Copilot SDK (`copilot-sdk`)

```bash
# Select AI provider (copilot-sdk, opencode-sdk). Note: claude-agent-sdk is deprecated.
export MM_AI_PROVIDER=copilot-sdk

# Shared AI timeout (default: 3600000 ms / 1 hour)
export MM_AI_TIMEOUT=3600000

# AI Model Name (optional, defaults depend on active provider)
export MM_AI_MODEL=gpt-4o
```

### Available Models

Configure the active provider model via `MM_AI_MODEL` or `--ai-model`. Examples:

- `gpt-4o`
- `claude-sonnet-4.6`
- `claude-haiku-4.5`
- `claude-opus-4.8`

> **Note:** Claude models are only available with the deprecated `claude-agent-sdk` provider.

Check provider documentation for all supported models.

---

## Bring Your Own Key (BYOK) Examples

You can use `MM_AI_BASE_URL` and `MM_AI_API_KEY` to configure custom OpenAI-compatible endpoints:

### 1. Locally-Hosted Model (e.g. Ollama or vLLM)

```bash
export MM_AI_PROVIDER=copilot-sdk
export MM_AI_BASE_URL=http://localhost:11434/v1/
export MM_AI_API_KEY=ollama             # Some clients require a non-empty key
export MM_AI_MODEL=llama3.1             # Your local model name
```

### 2. Azure OpenAI

```bash
export MM_AI_PROVIDER=copilot-sdk
export MM_AI_BASE_URL=https://your-resource-name.openai.azure.com/openai/deployments/your-deployment-name/
export MM_AI_API_KEY=your_azure_api_key
export MM_AI_MODEL=gpt-4o               # Your deployed model name
```

---

## Optional Settings

```bash
# Review profile (fast or deep)
export MM_REVIEW_STRATEGY=fast

# Git backend for cloning (cli or isomorphic)
export MM_GIT_BACKEND=cli

# Base path for temporary files (cache, logs, reports, etc.)
export MM_TEMP_PATH=./.mergementor

# Logging
export LOG_LEVEL=info  # debug, info, warn, error

# Audit logging (enabled by default for security/compliance)
export AUDIT_LOGGING_ENABLED=true

# Streaming output display
export MM_STREAMING_ENABLED=true  # Enable/disable streaming output
export MM_STREAMING_LINES=9       # Number of lines to stream (1-20)
```

---

## Logging and Temporary Directories

By default, Merge Mentor stores temporary files in `./.mergementor` relative to the current working directory. You can customize this location using the `MM_TEMP_PATH` environment variable or `--temp-path` CLI flag.

### Important Directories

- **`logs/`**: Timestamped log files for debugging and audit trails (`.mergementor/logs/`).
- **`reports/`**: Markdown review reports from dry-run mode (`.mergementor/reports/`).
- **`cache/`**: Incremental review cache to track already-reviewed files (`.mergementor/cache/`).

### Audit Logging

Audit logging is enabled by default for security and compliance tracking. All critical actions are logged with structured data including PR Operations, Comment Actions, LLM executions, and Review Lifecycles.

Logs are written to timestamped log files (`.mergementor/logs/merge-mentor_YYYY-MM-DD_HH-mm-ss.log`) with a dedicated `audit` field for easy filtering and analysis.
