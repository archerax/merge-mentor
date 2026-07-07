---
layout: default
title: Home
---

<p align="center">
  <img alt="Merge Mentor Logo" src="https://www.agile-casino.co.uk/merge-mentor/logo_transparent.png" width="220">
</p>

# Merge Mentor

Merge Mentor is an AI-powered code review tool that delivers a first-pass review on your pull requests in minutes — catching bugs, security issues, and quality problems before your team needs to spend time on them.

Works with GitHub and Azure DevOps, integrates into CI pipelines, and supports multiple AI providers including GitHub Copilot SDK, OpenCode SDK, and Claude Agent SDK.

---

## ⚡ Quick Start

```bash
# Install globally
npm install -g merge-mentor

# Run a review (dry-run mode) - using environment variables
MM_GITHUB_TOKEN=your_token \
MM_GITHUB_REPO_OWNER=owner \
MM_GITHUB_REPO_NAME=repo \
merge-mentor review --pr 123
```

For more detailed setup, see the [Configuration Guide](./configuration.md) and [CI/CD Integration](./ci-cd.md).

---

## 🛠️ CLI Commands

Merge Mentor provides several subcommands to review, fix, and manage your development lifecycle:

- **[review](./review.md)**: Reviews a pull request and identifies potential bugs, security issues, and quality problems.
- **[fix](./fix.md)**: Interactively fixes active review comments on a PR using an AI provider.
- **[describe](./describe.md)**: Generates a title, summary, and changelog for a pull request.
- **[doctor](./doctor.md)**: Troubleshoots and checks AI provider CLI installations and configuration.
- **[repos](./repos.md)**: Manages local cloned repositories used for context loading.
- **[pbi](./pbi.md)**: Reviews a Product Backlog Item / User Story / Issue against the INVEST model.
- **[project](./project.md)**: Reviews a project or feature plan hierarchy against planning guidelines.

---

## 🚀 Key Features

- **Multi-Provider Support**: Supports GitHub Copilot SDK, OpenCode SDK, and Claude Agent SDK. Also supports custom OpenAI-compatible endpoints (BYOK) such as locally-hosted models (Ollama, vLLM) and Azure OpenAI.
- **Additive Review Passes**: Layers specialist attention on top of the baseline review (e.g. `testing`, `security`, `performance`, `database`, `monorepo`).
- **Smart Deduplication**: Avoids posting comments on issues that already existed in the target branch prior to the PR.
- **Real-time Streaming**: Displays the live output feedback from the AI model during execution.
