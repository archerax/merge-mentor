<p align="center">
  <img alt="Merge Mentor Logo" src="https://www.agile-casino.co.uk/merge-mentor/logo_transparent.png" width="220">
</p>

<h1 align="center">Merge Mentor</h1>

<p align="center">
  <strong>An AI-powered code review tool that delivers a first-pass review on your pull requests in minutes — catching bugs, security issues, and quality problems before your team needs to spend time on them.</strong>
</p>

<p align="center">
  Works with GitHub and Azure DevOps, integrates into CI pipelines, and supports multiple AI providers including GitHub Copilot SDK, OpenCode SDK, and Claude Agent SDK.
</p>

<br>

> [!IMPORTANT]
> **Full Documentation Site**: For detailed guides, advanced configurations, and CI/CD integration instructions, please visit our **[GitHub Pages Documentation Site](https://archerax.github.io/merge-mentor/pages/)**.

---

## Why Merge Mentor?

- **⚡ Faster feedback cycle** — Developers get actionable feedback the moment they open a PR.
- **💰 Free up your senior engineers** — AI handles the routine first pass so human reviewers can focus on architectural decisions.
- **🎯 Goes beyond linting** — Surfaces logic errors, insecure trust boundaries, missing edge cases, and cross-file issues.
- **🔒 Control where your code goes** — Supports OpenAI-compatible endpoints (Ollama, vLLM, Azure OpenAI) for private hosting.
- **🔁 Safe to try** — Dry-run is the default; preview every review before posting a single comment.

---

## Quick Start

```bash
# Install globally
npm install -g merge-mentor

# Run a review (dry-run mode) - using environment variables
MM_GITHUB_TOKEN=your_token \
MM_GITHUB_REPO_OWNER=owner \
MM_GITHUB_REPO_NAME=repo \
merge-mentor review --pr 123

# Post comments directly to PR
merge-mentor review --pr 123 --write
```

---

## CLI Commands

Merge Mentor offers a set of subcommands to support reviews, plan checks, and automatic fixes:

- **[review](./pages/review.md)**: Reviews a pull request and identifies potential bugs, security issues, and quality problems.
- **[fix](./pages/fix.md)**: Interactively fixes active review comments on a PR using an AI provider.
- **[describe](./pages/describe.md)**: Generates a title, summary, and changelog for a pull request.
- **[doctor](./pages/doctor.md)**: Troubleshoots and checks AI provider CLI installations and configuration.
- **[repos](./pages/repos.md)**: Manages local cloned repositories used for context loading.
- **[pbi](./pages/pbi.md)**: Reviews a Product Backlog Item / User Story / Issue against the INVEST model.
- **[project](./pages/project.md)**: Reviews a project or feature plan hierarchy against planning guidelines.

For full configuration settings and options, refer to the **[Configuration Guide](./pages/configuration.md)**.

---

## CI/CD Integration

Merge Mentor can be run automatically in your workflows using the `--ci` flag, which auto-detects pull request details and platform tokens.

- **[GitHub Actions Integration](./pages/ci-cd.md#github-actions)**
- **[Azure Pipelines Integration](./pages/ci-cd.md#azure-pipelines)**
- **[CI/CD State Caching](./pages/ci-cd.md#cicd-caching-highly-recommended)**

---

## Prerequisites

- **Node.js 22+**
- **Supported Platforms**: Windows, macOS, and Linux
- **AI Providers**: Copilot SDK (requires `MM_COPILOT_TOKEN`), OpenCode SDK, or Claude Agent SDK (requires `ANTHROPIC_API_KEY`).

---

## License

MIT License. See [LICENSE](./LICENSE) for details.
