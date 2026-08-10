---
layout: default
title: Review Command
---

# `review` Command

The `review` command reviews a pull request. This is the primary subcommand in Merge Mentor and accepts all general options, platform details, and review configurations.

## Usage

```bash
# Dry-run mode (preview only) - generates a detailed markdown report
merge-mentor review --pr 123

# Post comments to PR
merge-mentor review --pr 123 --write

# Specify a platform (default is github)
merge-mentor review --pr 456 --platform azure --write

# Use OpenCode SDK instead of Copilot SDK
merge-mentor review --pr 123 --provider opencode-sdk --write
```

Native code suggestions are included automatically when a finding is a
high-confidence, localized replacement in the pull request diff. Suggestions
are limited to fewer than 10 target lines and fewer than 10 replacement lines.
Findings that fail validation remain ordinary explanatory comments.

This works in dry-run mode and when posting with `--write` on both GitHub and
Azure DevOps. Cross-file findings, low-confidence findings, deleted lines, and
unsafe or malformed replacements do not produce native suggestions.

---

## Options

### General Options

| Option                          | Description                                                               | Env Variable   | Default          |
| ------------------------------- | ------------------------------------------------------------------------- | -------------- | ---------------- |
| `--pr <number>`                 | Pull request number (required unless `--pr-url` or `--ci` is used)        | -              | -                |
| `--pr-url <url>`                | PR URL (automatically parses platform, repository details, and PR number) | -              | -                |
| `--ci`                          | CI mode: auto-detect platform and PR from environment variables           | -              | `false`          |
| `--platform <platform>`         | Platform to use (`github` or `azure`)                                     | `MM_PLATFORM`  | `github`         |
| `--write`                       | Post comments to PR (otherwise dry-run; CI mode defaults to write)        | -              | `false`          |
| `--temp-path <path>`            | Base path for temporary files (cache, diffs, logs, etc.)                  | `MM_TEMP_PATH` | `./.mergementor` |
| `--local-workspace-path <path>` | Path to a pre-existing local repository checkout                          | -              | -                |

### Review Configuration

| Option                    | Description                                                                                                            | Env Variable         | Default   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------- | --------- |
| `--review-type <type>`    | Type of review (`general`, `testing`, `security`, `performance`, `fast`, `custom`)                                     | `MM_REVIEW_TYPE`     | `general` |
| `--passes <passNames>`    | Comma-separated additive review passes (`scan`, `security`, `logic`, `performance`, `monorepo`, `testing`, `database`) | `MM_REVIEW_PASSES`   | -         |
| `--strategy <strategy>`   | Execution strategy (`deep`, `fast`, or `multi-agent`)                                                                  | `MM_REVIEW_STRATEGY` | `fast`    |
| `--git-backend <backend>` | Git backend for cloning/fetching (`cli` or `isomorphic`)                                                               | `MM_GIT_BACKEND`     | `cli`     |

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

### AI Provider & Model Options

| Option                    | Description                                                                     | Env Variable            | Default        |
| ------------------------- | ------------------------------------------------------------------------------- | ----------------------- | -------------- |
| `--provider <provider>`   | AI provider (`copilot-sdk`, `opencode-sdk`).                                    | `MM_AI_PROVIDER`        | `copilot-sdk`  |
| `--copilot-token <token>` | Copilot GitHub token                                                            | `MM_COPILOT_TOKEN`      | -              |
| `--ai-timeout <ms>`       | Timeout in ms for all AI providers                                              | `MM_AI_TIMEOUT`         | `3600000` (1h) |
| `--ai-model <model>`      | Model name for the active AI provider                                           | `MM_AI_MODEL`           | -              |
| `--ai-base-url <url>`     | OpenAI-compatible API base URL for BYOK                                         | `MM_AI_BASE_URL`        | -              |
| `--ai-api-key <key>`      | API key for BYOK                                                                | `MM_AI_API_KEY`         | -              |
| `--reasoning <level>`     | Reasoning effort level (`low`, `medium`, `high`, `xhigh`) for supporting models | `MM_REASONING`          | -              |
| `--experimental-tools`    | Enable experimental structured output via Copilot SDK tool calls                | `MM_EXPERIMENTAL_TOOLS` | `false`        |
| `--long-context`          | Pin the session to the long-context tier                                        | `MM_LONG_CONTEXT`       | `false`        |
| `--verify-pbi`            | Verify PR changes against linked Product Backlog Items or Issues                | `MM_VERIFY_PBI`         | `false`        |

### File Filtering

| Option               | Description                                   | Default           |
| -------------------- | --------------------------------------------- | ----------------- |
| `--ignore <pattern>` | Glob pattern for files to ignore (repeatable) | `**/generated/**` |

### Console Output Options

| Option                    | Description                                 | Env Variable           | Default |
| ------------------------- | ------------------------------------------- | ---------------------- | ------- |
| `--no-stream`             | Disable streaming output display            | `MM_STREAMING_ENABLED` | -       |
| `--stream-lines <number>` | Number of lines in streaming display (1-20) | `MM_STREAMING_LINES`   | `9`     |

---

## Review Profiles, Passes, and Strategies

Every review includes a **baseline review** running with the **fast** execution strategy by default. You can optionally switch to the **deep** execution strategy for higher coverage, the **multi-agent** strategy for specialized subagent reviews, or add ordered **passes** to increase attention in specific areas.

```bash
# Baseline review with deep strategy for maximum issues detection
merge-mentor review --pr 123 --strategy deep --write

# Baseline review plus testing attention (default fast strategy)
merge-mentor review --pr 123 --passes "testing" --write

# Baseline review plus multiple ordered passes with deep strategy
merge-mentor review --pr 123 --passes "security,database,performance" --strategy deep --write

# Multi-agent review: specialized subagents coordinated by a lead synthesizer
merge-mentor review --pr 123 --strategy multi-agent

# Multi-agent review limited to specific subagents via passes
merge-mentor review --pr 123 --strategy multi-agent --passes security,performance,testing
```

### Choosing a Strategy

- **`fast` (default)**: Minimizes token/credit usage and gets faster results.
- **`deep`**: Highest issue detection rate. Uses multiple API calls. Under GitHub Copilot's usage-based billing, `deep` consumes roughly **2x the AI credits/tokens** compared to `fast`.
- **`multi-agent`**: Deconstructs PR analysis into independent domain-specialized subagents (General Logic & Correctness, Security & Trust, Performance & Scalability, Test Coverage & Quality, Architecture & Style) that run concurrently, coordinated by a **Lead Synthesizer** that deduplicates overlapping findings, resolves conflicting recommendations, and discards low-confidence noise.

### Multi-Agent Strategy Details

The `multi-agent` strategy is a separate execution mode that reuses the existing review profiles, finding types, aggregation, comment lifecycle, and platform adapters. It does not replace `deep` or `fast`.

- **Agent selection** is driven entirely by `--passes`. Each `ReviewPass` resolves to exactly one subagent; multiple passes can target the same agent.

| ReviewPass    | Subagent                             |
| ------------- | ------------------------------------ |
| `logic`       | 🧠 General Logic & Correctness Agent |
| `scan`        | 🧠 General Logic & Correctness Agent |
| `security`    | 🔒 Security & Trust Agent            |
| `performance` | ⚡ Performance & Scalability Agent   |
| `database`    | ⚡ Performance & Scalability Agent   |
| `testing`     | 🧪 Test Coverage & Quality Agent     |
| `monorepo`    | 🏗️ Architecture & Style Agent        |

With `--strategy multi-agent` and no explicit `--passes`, all five agents run with their default lenses. Supplying e.g. `--passes security,performance,testing` limits execution to the Security, Performance, and Test Coverage agents.

- **Selective dispatch:** A lightweight LLM pre-classification pass selects which _specialized_ subagents are relevant for the PR's diff before they are dispatched (e.g. the Security agent is skipped on CSS/Markdown-only diffs). The 🧠 **General Logic & Correctness Agent is exempt** — it always runs on every PR as the correctness baseline, so a classifier mistake can never drop logic-bug coverage.
- **Confidence threshold:** The Lead Synthesizer discards findings below the config-only `minConfidence` (default `0.7`, mapping high = 1.0, medium = 0.6, low = 0.3). Configure via `MM_MULTI_AGENT_MIN_CONFIDENCE`.
- **Concurrency:** Subagents run in parallel, bounded by the config-only `maxParallel` (default `2`). Configure via `MM_MULTI_AGENT_MAX_PARALLEL`.

### Available Passes

- `scan`
- `security`
- `logic`
- `performance`
- `monorepo`
- `testing`
- `database`

### Common Profile Choices

| Profile                    | Use When                                                 | AI Calls | What It Emphasizes                                                   |
| -------------------------- | -------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| **Baseline**               | Standard development or unsure what to add               | 2        | Broad code review coverage                                           |
| **Baseline + fast**        | Routine PRs where cost or latency matters                | 1        | Same baseline coverage with a cheaper execution strategy             |
| **Baseline + testing**     | Adding/modifying tests or testable code                  | 2        | Test coverage, test quality, assertions, mocks                       |
| **Baseline + security**    | Handling sensitive data or auth flows                    | 2        | Vulnerabilities, auth flaws, data exposure, unsafe trust boundaries  |
| **Baseline + performance** | Performance-critical paths or scaling concerns           | 2        | Efficiency, resource usage, caching, expensive queries               |
| **Baseline + database**    | Changing schemas, queries, repositories, or transactions | 2        | Schema safety, query correctness, migrations, transaction boundaries |
| **Baseline + monorepo**    | Touching workspace structure or cross-package contracts  | 2        | Package boundaries, dependency ownership, shared tooling impacts     |

---

## Testing Pass Deep Dive

The `testing` pass adds specialist attention to four key areas:

### 1. Test Coverage Analysis

- Verifies new/modified functions have corresponding tests.
- Checks edge cases (null, empty, invalid input) and error paths.
- Validates all public methods and conditional branches are covered.
- Checks async operations have success and failure tests.

### 2. Test Naming Convention Validation

Checks for language-specific naming patterns.

- **C# Convention**: `MethodName_Scenario_ExpectedBehavior` (e.g. `GetUser_InvalidId_ThrowsException`). Test class naming should follow `ServiceNameTests`.
- **TypeScript Convention**: `describe`/`it` blocks with behavior descriptions (e.g. `it("should throw error when id is invalid", ...)`). Test file naming should be `.test.ts` or `.spec.ts`.

### 3. Assertion Verification

- Assertions match test names and behavior.
- Multiple assertions focus on the same logical concept.
- Assertions verify behavior outcomes rather than implementation details.
- Appropriate matchers are used (`toBe` vs `toEqual`, specific vs generic).

### 4. Mock Framework Usage

Verifies proper usage of mocking libraries like Moq, NSubstitute, or Vitest.

---

## Key Features

### Git Backends

Merge Mentor supports two backends for cloning/fetching repositories to extract coding standards:

- **`cli` (default)**: Uses the system `git` binary via child process.
- **`isomorphic`**: Uses [isomorphic-git](https://isomorphic-git.org/) (pure JS, no binary required, experimental).

```bash
# Use pure-JS git (no system git binary required)
merge-mentor review --pr 123 --git-backend isomorphic --write
```

### Pre-Existing Issue Detection

Merge Mentor automatically skips posting comments on issues that already existed in the target branch prior to the PR. This ensures only new issues introduced by the PR are flagged, keeping reviews noise-free.

### Ignoring Files and Directories

Exclude files using glob patterns:

```bash
# Ignore multiple patterns (repeatable flag)
merge-mentor review --pr 123 --ignore '*.test.ts' --ignore 'dist/**' --ignore 'coverage/**' --write
```

### Streaming Output Display

Shows the last N lines of AI model output in real-time, providing feedback during long reviews. Automatically disables in non-TTY environments (CI/CD).

In **multi-agent** reviews, the pre-classifier and lead synthesizer stream live output. Every subagent streams its output into a shared live display prefixed per agent (`[security] …`), and reports plain-text progress (`⏳ [security] analyzing…` → `✓ [security] done — 3 finding(s) in 41s`). When streaming is active but no tokens arrive for a while (the model is "thinking" in silence) — or when streaming is inactive — periodic `still working: security (12s)…` lines keep you informed in any environment, including piped or captured output.

```bash
# Disable streaming output
merge-mentor review --pr 123 --no-stream

# Show more lines
merge-mentor review --pr 123 --stream-lines 10
```

### Detailed Markdown Reports

In dry-run mode, Merge Mentor saves comprehensive markdown reports to `.mergementor/reports/`. They include metadata, severity indicators (🔴 Critical, 🟠 High, 🟡 Medium, 🟢 Low), file findings, and resolved issues from previous reviews.

### Incremental Reviews

Only analyzes changed files on re-reviews, saving time and cost. The cache is stored in `.mergementor/cache/`.

Pass `--re-review` to re-review every file, ignoring cached results:

```bash
merge-mentor review --pr 123 --re-review
```

A fresh cache is written afterward, so subsequent reviews resume incremental behavior.

### Review Categories

Findings are classified into:

- 🐛 **Bug** - Potential bugs or logical errors
- 🔒 **Security** - Security vulnerabilities
- ⚡ **Performance** - Performance issues
- 📝 **Quality** - Code quality and readability
- 📚 **Documentation** - Missing or inadequate documentation
- 🏗️ **Architecture** - Architectural boundaries, coupling, and system structure concerns
- 🎨 **Design** - Software design patterns, clean code principles, and API design
- 🧪 **Testing** - Test quality, coverage gaps, assertions, and mock verification
