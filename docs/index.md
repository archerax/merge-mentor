---
layout: default
title: Home
---

<p align="center">
  <img alt="Merge Mentor Logo" src="https://www.agile-casino.co.uk/merge-mentor/logo_transparent.png" width="220">
</p>

# Merge Mentor

Merge Mentor is an AI-powered code review tool that delivers a first-pass review on your pull requests in minutes — catching bugs, security issues, and quality problems before your team needs to spend time on them.

Works with GitHub and Azure DevOps, integrates into CI pipelines, and supports multiple enterprise AI providers including GitHub Copilot SDK, Amazon Bedrock, Azure OpenAI, and OpenCode SDK.

---

## 🔒 Security, Privacy & AI Governance

Merge Mentor is a **self-hosted CLI tool** that runs directly on your local workstation or CI runner.

- **Your Approved AI Provider Only**: Merge Mentor does not route your code through any third-party SaaS server. It connects directly to **your enterprise-approved AI provider** (such as GitHub Copilot SDK, Amazon Bedrock, Azure OpenAI, or OpenCode SDK) using your own credentials.
- **Zero Telemetry**: No usage tracking, analytics, or telemetry of any kind are collected.
- **Local Data & Logs**: Audit logs, execution caches, and reports stay strictly on your local disk under `./.mergementor`.
- **Dry-Run by Default**: Reviews run in preview mode by default. Comments are only published to your pull requests when you explicitly pass `--write`.

---

## ⚡ Quick Start

```bash
# Run a review (dry-run mode) instantly with npx - using environment variables
MM_GITHUB_TOKEN=your_token \
MM_GITHUB_REPO_OWNER=owner \
MM_GITHUB_REPO_NAME=repo \
npx merge-mentor@latest review --pr 123
```

For more detailed setup, see the [Configuration Guide](./configuration.md) and [CI/CD Integration](./ci-cd.md).

---

## 🛠️ CLI Commands

Merge Mentor provides several subcommands to review, fix, and manage your development lifecycle:

- **[review](./review.md)**: Reviews a pull request and identifies potential bugs, security issues, and quality problems.
- **[stage](./stage.md)**: Reviews the local working tree against a base ref before you push or open a PR.
- **[fix](./fix.md)**: Interactively fixes active review comments on a PR using an AI provider.
- **[reply](./reply.md)**: Generates responses to review comments and optionally resolves comment threads.
- **[describe](./describe.md)**: Generates a title, summary, and changelog for a pull request.
- **[doctor](./doctor.md)**: Troubleshoots and checks AI provider CLI installations and configuration.
- **[repos](./repos.md)**: Manages local cloned repositories used for context loading.
- **[pbi](./pbi.md)**: Reviews a Product Backlog Item / User Story / Issue against the INVEST model.
- **[project](./project.md)**: Reviews a project or feature plan hierarchy against planning guidelines.
- **[eval](./eval.md)**: Runs the Golden-PR evaluation harness against a test corpus.

---

## 🚀 Key Features

- **Multi-Provider Support**: Supports GitHub Copilot SDK and OpenCode SDK. Also supports custom OpenAI-compatible endpoints (BYOK) such as locally-hosted models (Ollama, vLLM) and Azure OpenAI.
- **Additive Review Passes**: Layers specialist attention on top of the baseline review (e.g. `testing`, `security`, `performance`, `database`, `monorepo`).
- **Smart Deduplication**: Avoids posting comments on issues that already existed in the target branch prior to the PR.
- **Real-time Streaming**: Displays the live output feedback from the AI model during execution.
