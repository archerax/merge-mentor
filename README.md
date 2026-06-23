<p align="center">
  <img alt="Merge Mentor Logo" src="https://www.agile-casino.co.uk/merge-mentor/logo_transparent.png" width="220">
</p>

<h1 align="center">Merge Mentor</h1>

<p align="center">
  <strong>An AI-powered code review tool that delivers a first-pass review on your pull requests in minutes — catching bugs, security issues, and quality problems before your team needs to spend time on them.</strong>
</p>

<p align="center">
  Works with GitHub and Azure DevOps, integrates into CI pipelines, and supports multiple AI providers including GitHub Copilot SDK and OpenCode SDK.
</p>

<br>

## Why MergeMentor?

- **⚡ Faster feedback cycle** — Developers get actionable feedback the moment they open a PR, without waiting for a reviewer to become available. Particularly valuable for distributed teams working across time zones.
- **💰 Free up your senior engineers** — AI handles the routine first pass so your experienced reviewers can focus on architectural decisions and the changes that genuinely need human judgment.
- **🎯 Goes beyond linting** — Surfaces logic errors, insecure trust boundaries, missing edge-case handling, and cross-file issues that linters and static analysers typically don't catch.
- **🔒 Control where your code goes** — Use your own OpenAI-compatible endpoint (such as Amazon Bedrock, Azure OpenAI, or a locally-hosted model) when you need tighter control over where review traffic is sent.
- **📏 Consistent standards** — Every PR gets the same quality first-pass review regardless of team workload, reviewer availability, or fatigue.
- **🔁 Safe to try** — Dry-run is the default: preview every review before posting a single comment. Built-in audit logging keeps a compliance trail of all bot activity.
- **🌐 Works where your PRs already live** — Native support for GitHub and Azure DevOps, with CI integration for GitHub Actions and Azure Pipelines.

## Quick Start

```bash
# Install globally
npm install -g merge-mentor

# Run a review (dry-run mode) - using environment variables
MM_GITHUB_TOKEN=your_token \
MM_GITHUB_REPO_OWNER=owner \
MM_GITHUB_REPO_NAME=repo \
merge-mentor review --pr 123

# Or use command-line parameters (no env vars needed)
merge-mentor review --pr 123 \
  --github-token your_token \
  --github-repo-owner owner \
  --github-repo-name repo

# Post comments to PR
merge-mentor review --pr 123 --write

# Use OpenCode SDK instead of Copilot SDK
merge-mentor review --pr 123 --provider opencode-sdk --write

# Or use npx (no installation required)
npx merge-mentor review --pr 123
```

## Features

- **Multi-Provider Support** - Works with GitHub Copilot SDK and OpenCode SDK
- **Multi-Platform Support** - Works with GitHub and Azure DevOps
- **Intelligent Analysis** - Reviews for bugs, security, performance, quality, and documentation
- **Additive Review Passes** - Start from a baseline review and add focused passes like testing, security, database, or monorepo
- **Fast Review Strategy** - Choose between higher-accuracy deep mode and lower-cost fast mode (default)
- **Inline Comments** - Posts feedback on specific lines of code
- **Smart Deduplication** - Avoids flagging the same issue multiple times
- **Incremental Reviews** - Only analyzes changed files to save time
- **Dry-Run Mode** - Preview changes before posting with detailed markdown reports (default)
- **Streaming Output** - Real-time feedback showing AI model output during reviews

## Prerequisites

- **Node.js 22+**
- **AI provider prerequisites**:
  - **Copilot SDK** (`copilot-sdk`): Requires a valid Copilot token set via `MM_COPILOT_TOKEN` or `--copilot-token`
  - **OpenCode SDK** (`opencode-sdk`): Follow the official OpenCode installation instructions at https://opencode.dev
  - **Claude Agent SDK** (`claude-agent-sdk`): Requires the `@anthropic-ai/claude-agent-sdk` package to be installed or available, plus a valid Anthropic API key configured via `ANTHROPIC_API_KEY` or `MM_AI_API_KEY` (or `--ai-api-key`).
- **Platform Access** - Personal access token for GitHub or Azure DevOps

**Supported Platforms**: Windows, macOS, and Linux

## Installation

```bash
# Install globally
npm install -g merge-mentor

# Or use with npx (no installation required)
npx merge-mentor --help
```

## Configuration

Configure merge-mentor using environment variables or command-line parameters. **Command-line parameters always override environment variables.**

### Environment Variables

All environment variables use the `MM_` prefix to avoid conflicts with other applications.

### GitHub Configuration

```bash
export MM_GITHUB_TOKEN=your_personal_access_token
export MM_GITHUB_REPO_OWNER=username_or_org
export MM_GITHUB_REPO_NAME=repository_name
export MM_PLATFORM=github
```

### Azure DevOps Configuration

```bash
export MM_AZURE_TOKEN=your_pat
export MM_AZURE_ORG=organization_name
export MM_AZURE_PROJECT=project_name
export MM_AZURE_REPO=repository_name
export MM_PLATFORM=azure
```

### AI Provider Configuration

**Default Provider**: GitHub Copilot SDK (`copilot-sdk`)

```bash
# Select AI provider (copilot-sdk, opencode-sdk, claude-agent-sdk)
export MM_AI_PROVIDER=copilot-sdk

# Shared AI timeout (preferred)
export MM_AI_TIMEOUT=3600000

# Generic AI model setting
export MM_AI_MODEL=gpt-5.3-codex

# Generic AI BYOK settings (currently used by Copilot SDK for OpenAI-compatible endpoints)
export MM_AI_BASE_URL=https://your-resource.openai.azure.com/openai/v1/
export MM_AI_API_KEY=your_provider_api_key

# Enable experimental tool calls (only supported by Copilot SDK)
export MM_EXPERIMENTAL_TOOLS=true
```

**Or use command-line parameters:**

```bash
merge-mentor review --pr 123 \
  --provider copilot-sdk \
  --ai-model gpt-5.3-codex \
  --ai-base-url https://your-resource.openai.azure.com/openai/v1/ \
  --ai-api-key "$FOUNDRY_API_KEY" \
  --ai-timeout 3600000 \
  --experimental-tools
```

**Claude Agent SDK Provider Configuration:**

```bash
export MM_AI_PROVIDER=claude-agent-sdk

# Use standard Anthropic API key
export ANTHROPIC_API_KEY=your_anthropic_api_key

# Or use generic BYOK settings:
# export MM_AI_API_KEY=your_anthropic_api_key
# export MM_AI_BASE_URL=https://api.anthropic.com/v1
```

**Bring Your Own Key (BYOK) Examples:**

You can use `MM_AI_BASE_URL` and `MM_AI_API_KEY` to configure custom OpenAI-compatible endpoints:

_Locally-Hosted Model (e.g., Ollama or vLLM):_

```bash
export MM_AI_PROVIDER=copilot-sdk
export MM_AI_BASE_URL=http://localhost:11434/v1/
export MM_AI_API_KEY=ollama             # Some clients require a non-empty key
export MM_AI_MODEL=llama3.1             # Your local model name
```

_Azure OpenAI:_

```bash
export MM_AI_PROVIDER=copilot-sdk
export MM_AI_BASE_URL=https://your-resource-name.openai.azure.com/openai/deployments/your-deployment-name/
export MM_AI_API_KEY=your_azure_api_key
export MM_AI_MODEL=gpt-4o               # Your deployed model name
```

For GPT-5 series Copilot SDK BYOK models, merge-mentor automatically uses the SDK `responses`
wire API recommended by the Copilot SDK BYOK documentation.

> **BYOK cost note:** If you use a token-billed BYOK provider, review cost can vary significantly
> based on repository size, diff size, review profile/strategy, model choice, and prompt complexity.
> Published model prices are only a rough guide and may not predict real review cost or issue-finding
> performance well. The table below shows illustrative results from a small repository with **12 changed
> files** via **OpenRouter** — treat these as indicative only, and set usage limits or budgets with
> your provider. The same Haiku review consumes **GitHub AI Credits** based on token usage when run via the
> Copilot SDK provider.

| Model            | Cost (12-file review) | Issues found    |
| ---------------- | --------------------- | --------------- |
| Claude Haiku 4.5 | £0.25                 | 100% (baseline) |
| Kimi 2.5         | £0.22                 | ~68%            |
| Minimax M2.5     | £0.05                 | ~126%           |

Deprecated v1 aliases have been removed in v2. Use `MM_AI_MODEL` / `--ai-model` for all providers.

### Optional Settings

```bash
# Review profile
export MM_REVIEW_STRATEGY=fast        # fast (default) or deep

# Git backend for cloning repositories (default: cli uses system git binary)
export MM_GIT_BACKEND=cli  # cli or isomorphic

# Temporary directory configuration
export MM_TEMP_PATH=./.mergementor  # Base path for temporary files (cache, diffs, logs, repos, reports, transcripts)

# Logging
export LOG_LEVEL=info  # debug, info, warn, or error

# Audit logging (enabled by default for security/compliance)
export AUDIT_LOGGING_ENABLED=true

# Streaming output display
export MM_STREAMING_ENABLED=true  # Enable/disable streaming output (default: true)
export MM_STREAMING_LINES=9       # Number of lines in streaming display (default: 9)
```

**Or use command-line parameters:**

```bash
merge-mentor review --pr 123 --write

# Deep execution strategy
merge-mentor review --pr 123 \
  --strategy deep
```

### Audit Logging

Audit logging is enabled by default for security and compliance tracking. All critical actions are logged with structured data including:

- **PR Operations**: Fetching PR details, files, and comments
- **Comment Actions**: Creating, updating, and resolving comments
- **Copilot Execution**: All LLM prompt executions
- **Review Lifecycle**: Start/completion of reviews and individual file analysis

Audit logs are written to timestamped log files (`.mergementor/logs/merge-mentor_YYYY-MM-DD_HH-mm-ss.log`) with a dedicated `audit` field for easy filtering and analysis. Each review run generates its own log file, preserving historical audit trails.

**Example audit log entry**:

```json
{
  "audit": {
    "eventType": "comment.post.inline",
    "timestamp": "2025-12-27T13:00:00.000Z",
    "severity": "info",
    "actor": "merge-mentor-bot",
    "resource": {
      "type": "comment",
      "id": "pr-123-src/app.ts-42",
      "details": {
        "prNumber": 123,
        "path": "src/app.ts",
        "line": 42,
        "platform": "github"
      }
    },
    "action": "Post inline comment on PR #123 at src/app.ts:42",
    "result": "success"
  }
}
```

Audit logs can be filtered and analyzed for:

- Security audits and compliance reporting
- Tracking bot activity across PRs
- Debugging failed operations
- Usage analytics and cost tracking

### Temporary Directory Structure

By default, merge-mentor stores temporary files in `./.mergementor` relative to the current working directory. You can customize this location using the `MM_TEMP_PATH` environment variable or `--temp-path` CLI flag.

**Configuration Examples:**

```bash
# Use absolute path
export MM_TEMP_PATH=/var/tmp/merge-mentor

# Use relative path (relative to current directory)
export MM_TEMP_PATH=./temp/mm

# CLI parameter
merge-mentor review --pr 123 --temp-path /tmp/merge-mentor
```

**Important Directories:**

- **logs** - Timestamped log files for debugging and audit trails (`.mergementor/logs/`)
- **reports** - Markdown review reports from dry-run mode (`.mergementor/reports/`)

### Token Permissions

**GitHub Token** (set via `MM_GITHUB_TOKEN` or `--github-token`):

- `repo` scope (full control of private repositories)
- Or `public_repo` for public repositories only

> [!NOTE]
> If running inside a GitHub Actions workflow, you can use the built-in `GITHUB_TOKEN` rather than a Personal Access Token. Just ensure that the workflow job has the `permissions: pull-requests: write` block configured so the bot has permission to post PR comments.

**Azure DevOps PAT** (set via `MM_AZURE_TOKEN` or `--azure-token`):

- Code: Read & Write
- Pull Request Threads: Read & Write

### Available Models

Configure the active provider model via `MM_AI_MODEL` or `--ai-model`.

- `claude-sonnet-4.6` (default)
- `claude-haiku-4.5`
- `claude-opus-4.8`

Check provider documentation for supported models

## Usage

```bash
# Dry-run mode (preview only) - generates detailed markdown report
merge-mentor review --pr 123

# Post comments to PR
merge-mentor review --pr 123 --write

# Use OpenCode SDK instead of Copilot SDK
merge-mentor review --pr 123 --provider opencode-sdk --write

# Azure DevOps
merge-mentor review --pr 456 --platform azure --write

# Multiple review passes for thoroughness
merge-mentor review --pr 123 --passes "security,database" --write

# Baseline review plus testing attention
merge-mentor review --pr 123 --passes "testing" --write

# Baseline review plus security and database attention
merge-mentor review --pr 123 --passes "security,database" --write

# Same profile with fast execution
merge-mentor review --pr 123 --passes "performance" --strategy fast --write

# Run without real-time streaming output
merge-mentor review --pr 123 --no-stream
```

### Common Use Cases

**1. Standard Development Review:**

```bash
# General review for regular PRs
merge-mentor review --pr 123 --write
```

**2. Test Coverage Review:**

```bash
# Focus on test quality when adding/modifying tests
merge-mentor review --pr 456 --passes "testing" --write
```

**3. Security-Sensitive Changes:**

```bash
# Security attention for authentication or data handling
merge-mentor review --pr 789 --passes "security" --write

# Comprehensive security analysis with multiple focused passes
merge-mentor review --pr 789 --passes "security,database" --write
```

**4. Performance-Critical Code:**

```bash
# Performance attention for optimization work
merge-mentor review --pr 321 --passes "performance" --write

# Combined additive passes for broader attention
merge-mentor review --pr 321 --passes "performance,database" --write
```

**5. Preview Before Posting:**

```bash
# Dry-run generates detailed markdown report without posting
merge-mentor review --pr 123 --passes "testing"

# Review the report in .mergementor/reports/
cat .mergementor/reports/Github-myrepo-PR123-review-profile-report.md

# Post if satisfied
merge-mentor review --pr 123 --passes "testing" --write
```

### Command Options

**General Options:**
| Option | Description | Env Variable | Default |
|--------|-------------|--------------|---------|
| `--pr <number>` | Pull request number (required unless `--pr-url` or `--ci` is used) | - | - |
| `--pr-url <url>` | PR URL (e.g. `https://github.com/...`). Automatically sets platform, repository details, and PR number. Cannot be combined with other PR/repository flags. | - | - |
| `--ci` | CI mode: auto-detect platform and PR from the environment | - | `false` |
| `--platform <platform>` | Platform to use (`github` or `azure`) | `MM_PLATFORM` | `github` |
| `--write` | Post comments to PR (otherwise dry-run; CI mode defaults to write) | - | `false` |
| `--temp-path <path>` | Base path for temporary files (cache, diffs, logs, etc.) | `MM_TEMP_PATH` | `./.mergementor` |
| `--local-workspace-path <path>` | Path to a pre-existing local repository checkout | - | - |

**Review Configuration:**
| Option | Description | Env Variable | Default |
|--------|-------------|--------------|---------|
| `--review-type <type>` | Type of review (`general`, `testing`, `security`, `performance`, `fast`, `custom`) | `MM_REVIEW_TYPE` | `general` |
| `--passes <passNames>` | Comma-separated additive review passes (`scan`, `security`, `logic`, `performance`, `monorepo`, `testing`, `database`) | `MM_REVIEW_PASSES` | - |
| `--strategy <strategy>` | Execution strategy (`deep` or `fast`) | `MM_REVIEW_STRATEGY` | `fast` |
| `--git-backend <backend>` | Git backend for cloning/fetching (`cli` or `isomorphic`) | `MM_GIT_BACKEND` | `cli` |

**GitHub Configuration:**
| Option | Description | Env Variable |
|--------|-------------|--------------|
| `--github-token <token>` | GitHub personal access token | `MM_GITHUB_TOKEN` |
| `--github-repo-owner <owner>` | GitHub repository owner | `MM_GITHUB_REPO_OWNER` |
| `--github-repo-name <name>` | GitHub repository name | `MM_GITHUB_REPO_NAME` |

**Azure DevOps Configuration:**
| Option | Description | Env Variable |
|--------|-------------|--------------|
| `--azure-token <token>` | Azure DevOps PAT | `MM_AZURE_TOKEN` |
| `--azure-org <org>` | Azure DevOps organization | `MM_AZURE_ORG` |
| `--azure-project <project>` | Azure DevOps project | `MM_AZURE_PROJECT` |
| `--azure-repo <repo>` | Azure DevOps repository | `MM_AZURE_REPO` |

**AI Provider Configuration:**
| Option | Description | Env Variable | Default |
|--------|-------------|--------------|---------|
| `--provider <provider>` | AI provider (`copilot-sdk`, `opencode-sdk`, `claude-agent-sdk`) | `MM_AI_PROVIDER` | `copilot-sdk` |
| `--copilot-token <token>` | Copilot GitHub token | `MM_COPILOT_TOKEN` | - |
| `--ai-timeout <ms>` | Timeout in ms for all AI providers | `MM_AI_TIMEOUT` | `3600000` (1h) |
| `--ai-model <model>` | Model name for the active AI provider | `MM_AI_MODEL` | - |
| `--ai-base-url <url>` | OpenAI-compatible API base URL for BYOK | `MM_AI_BASE_URL` | - |
| `--ai-api-key <key>` | API key for BYOK | `MM_AI_API_KEY` | - |
| `--experimental-tools` | Enable experimental structured output via Copilot SDK tool calls | `MM_EXPERIMENTAL_TOOLS` | `false` |
| `--long-context` | Pin the Copilot session to the long-context tier | `MM_LONG_CONTEXT` | `false` |
| `--reasoning <level>` | Reasoning effort level (`low`, `medium`, `high`, `xhigh`) | `MM_REASONING` | - |

**File Filtering:**
| Option | Description | Default |
|--------|-------------|---------|
| `--ignore <pattern>` | Glob pattern for files to ignore (repeatable) | `**/generated/**` |

**Console Output Options:**
| Option | Description | Env Variable | Default |
|--------|-------------|--------------|---------|
| `--no-stream` | Disable streaming output display | `MM_STREAMING_ENABLED` | - |
| `--stream-lines <number>` | Number of lines in streaming display (1-20) | `MM_STREAMING_LINES` | `9` |

**Note:** Command-line parameters always override environment variables.

### CLI Commands

Merge Mentor supports several subcommands. If no subcommand is specified, it defaults to the `review` subcommand.

#### `review`

Reviews a pull request. This is the primary subcommand and accepts all options listed above.

#### `repos`

Manages cloned repositories used for context loading.

**Usage:**

```bash
merge-mentor repos [options]
```

**Options:**

- `--list`: List all cloned repositories.
- `--clean`: Remove all cloned repositories.
- `--clean-repo <name>`: Remove a specific cloned repository by folder name.
- `--temp-path <path>`: Base path for temporary files (overrides `MM_TEMP_PATH`).

#### `doctor`

Diagnostic command to check AI provider CLI installations and configuration.

**Usage:**

```bash
merge-mentor doctor [options]
```

**Options:**

- `--provider <provider>`: Check a specific provider (`copilot`, `opencode`, or `claude-agent-sdk`).

## Key Features Explained

### Git Backends

merge-mentor supports two backends for cloning and fetching repositories used for coding standard extraction:

| Backend      | Description                                                                      | Default |
| ------------ | -------------------------------------------------------------------------------- | ------- |
| `cli`        | Uses the system `git` binary via child process                                   | ✅ Yes  |
| `isomorphic` | Uses [isomorphic-git](https://isomorphic-git.org/) — pure JS, no binary required | No      |

The `cli` backend is the battle-tested default. The `isomorphic` backend eliminates the dependency on a system `git` binary and avoids passing tokens through process arguments (improving security in some environments), but is newer and considered experimental.

```bash
# Use the default system git binary
merge-mentor review --pr 123 --write

# Use pure-JS git (no system git binary required)
MM_GIT_BACKEND=isomorphic merge-mentor review --pr 123 --write
# or
merge-mentor review --pr 123 --git-backend isomorphic --write
```

> **Note:** The `isomorphic` backend does not support `git clean -fdx` (untracked file removal). Only tracked files are reset between reviews. This is a known limitation of the isomorphic-git library.

### Pre-Existing Issue Detection

merge-mentor automatically skips posting comments on issues that already existed in the target branch prior to the PR. This ensures only new issues introduced by the PR are flagged, keeping reviews focused and noise-free.

### Ignoring Files and Directories

Exclude files from review using glob patterns. By default, all changed files are reviewed:

```bash
# Ignore single pattern
merge-mentor review --pr 123 --ignore '*.test.ts' --write

# Ignore multiple patterns (repeatable flag)
merge-mentor review --pr 123 --ignore '*.test.ts' --ignore 'dist/**' --ignore 'coverage/**' --write

# Common patterns
merge-mentor review --pr 123 --ignore '**/*.test.ts' --ignore '**/*.spec.ts' --ignore 'node_modules/**' --write
```

Ignored files are logged for transparency in the review output.

### Review Profiles, Passes, and Strategies

Every review now includes a **baseline review** running with the **fast** execution strategy by default. You can optionally switch to the **deep** execution strategy for higher coverage, or add ordered **passes** to increase attention in specific areas.

```bash
# Baseline review only (default fast strategy)
merge-mentor review --pr 123 --write

# Baseline review plus testing attention (default fast strategy)
merge-mentor review --pr 123 --passes "testing" --write

# Baseline review with deep strategy for maximum issues detection
merge-mentor review --pr 123 --strategy deep --write

# Baseline review plus multiple ordered passes with deep strategy
merge-mentor review --pr 123 --passes "security,database,performance" --strategy deep --write
```

**What each piece means:**

- **Baseline review**: broad code review coverage across bugs, correctness, security, performance, maintainability, and documentation
- **Passes**: extra specialist attention layered on top of the baseline review
- **Strategy**: how the review runs (`deep` or `fast`)

**Choosing a strategy:**

- Use `fast` (default) when you want to minimize token/credit usage and get faster results.
- Use `deep` when you want the highest issue detection rate.

In our benchmark repository with deliberately introduced issues, `deep` found **76%** of the issues while
`fast` found **64%**. Under GitHub Copilot's usage-based billing, `deep` consumes roughly **2x the AI credits/tokens**
compared to `fast` (default) since it uses multiple API calls, so `--strategy` gives you a direct accuracy-versus-cost tradeoff.

**Available passes:**

- `scan`
- `security`
- `logic`
- `performance`
- `monorepo`
- `testing`
- `database`

Pass names are comma-separated, validated strictly, and run in the order provided. Example:

```bash
merge-mentor review --pr 123 \
  --passes "scan,security,logic"
```

Use `monorepo` when the PR touches workspace structure, package boundaries, shared tooling, dependency ownership, or other cross-package concerns.

Use `database` when the PR changes schemas, migrations, repositories, ORMs, transaction handling, or query-heavy code.

**Common profile choices:**

| Profile                    | Use When                                                 | AI Calls | What It Emphasizes                                                   |
| -------------------------- | -------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| **Baseline**               | Standard development or unsure what to add               | 2        | Broad code review coverage                                           |
| **Baseline + fast**        | Routine PRs where cost or latency matters                | 1        | Same baseline coverage with a cheaper execution strategy             |
| **Baseline + testing**     | Adding/modifying tests or testable code                  | 2        | Test coverage, test quality, assertions, mocks                       |
| **Baseline + security**    | Handling sensitive data or auth flows                    | 2        | Vulnerabilities, auth flaws, data exposure, unsafe trust boundaries  |
| **Baseline + performance** | Performance-critical paths or scaling concerns           | 2        | Efficiency, resource usage, caching, expensive queries               |
| **Baseline + database**    | Changing schemas, queries, repositories, or transactions | 2        | Schema safety, query correctness, migrations, transaction boundaries |
| **Baseline + monorepo**    | Touching workspace structure or cross-package contracts  | 2        | Package boundaries, dependency ownership, shared tooling impacts     |

#### Testing Pass Deep Dive

The `testing` pass adds specialist attention to four key areas while the baseline review still remains active:

**1. Test Coverage Analysis**

- Verifies new/modified functions have corresponding tests
- Checks edge cases (null, empty, invalid input)
- Ensures error paths are tested
- Validates all public methods have tests
- Confirms conditional branches are covered
- Checks async operations have success and failure tests

**2. Test Naming Convention Validation**

Language-specific naming patterns:

**C# Convention:**

```csharp
// Pattern: MethodName_Scenario_ExpectedBehavior
[Fact]
public void GetUser_InvalidId_ThrowsException()
{
    // Arrange
    var service = new UserService();

    // Act & Assert
    Assert.Throws<NotFoundException>(() => service.GetUser(-1));
}

// Test class naming: UserService → UserServiceTests
```

**TypeScript Convention:**

```typescript
// Pattern: describe/it blocks with behavior descriptions
describe("UserService", () => {
  describe("getUser", () => {
    it("should throw error when id is invalid", () => {
      const service = new UserService();

      expect(() => service.getUser(-1)).toThrow(NotFoundException);
    });
  });
});

// Test file naming: userService.ts → userService.test.ts or userService.spec.ts
```

**3. Assertion Verification**

- Assertions match test names and behavior
- Multiple assertions focus on same logical concept
- Assertions verify behavior outcomes, not implementation details
- Sufficient assertions to prove behavior
- Appropriate matchers used (toBe vs toEqual, specific vs generic)

**4. Mock Framework Usage**

**C# Mocking Best Practices:**

```csharp
// Using Moq
var mockRepository = new Mock<IUserRepository>();
mockRepository.Setup(r => r.GetUser(It.IsAny<int>()))
    .Returns(new User { Id = 1, Name = "Alice" });

// Using NSubstitute
var mockRepository = Substitute.For<IUserRepository>();
mockRepository.GetUser(Arg.Any<int>())
    .Returns(new User { Id = 1, Name = "Alice" });
```

**TypeScript Mocking Best Practices:**

```typescript
// Using Vitest
import { vi } from "vitest";

const mockRepository = {
  getUser: vi.fn().mockResolvedValue({ id: 1, name: "Alice" }),
};

// Verify interactions
expect(mockRepository.getUser).toHaveBeenCalledWith(1);
```

**Configuration:**

```bash
# Environment variable
export MM_REVIEW_PASSES=testing

# Or CLI parameter
merge-mentor review --pr 123 --passes "testing" --write
```

**Example Use Cases:**

```bash
# Review test changes in a PR
merge-mentor review --pr 456 --passes "testing" --write

# Combined passes for broader testing and security attention
merge-mentor review --pr 456 --passes "testing,security" --write
```

### Streaming Output Display

During reviews, merge-mentor shows the last N lines of AI model output in real-time:

```bash
# Default: show 5 lines of streaming output
merge-mentor review --pr 123

# Disable streaming output
merge-mentor review --pr 123 --no-stream

# Show more lines (1-20)
merge-mentor review --pr 123 --stream-lines 10
```

**Features:**

- Shows the last N lines of AI model output in real-time
- Provides visual feedback during long-running reviews
- Auto-disables in non-TTY environments (CI/CD pipelines, piped output)
- Can be explicitly disabled with `--no-stream`

**Configuration:**

```bash
export MM_STREAMING_ENABLED=true   # Enable/disable (default: true)
export MM_STREAMING_LINES=5        # Number of lines (default: 5, range: 1-20)
```

### Detailed Markdown Reports

In dry-run mode, merge-mentor automatically generates comprehensive markdown reports with all findings:

```bash
# Generate detailed report without posting comments
merge-mentor review --pr 123

# Report saved to: .mergementor/reports/pr-123-review-report.md
```

The markdown report includes:

- **PR summary** with metadata and statistics
- **Issues by severity and category** with visual indicators
- **File-specific findings** with line numbers and suggestions
- **Cross-file analysis** for architectural concerns
- **Overall assessment** and recommendations
- **Resolved issues** from previous reviews

Reports use emojis for visual clarity (🔴 Critical, 🟠 High, 🟡 Medium, 🟢 Low) and category icons (🐛 Bug, 🔒 Security, ⚡ Performance, etc.).

### Incremental Reviews

Only analyzes changed files on re-reviews, saving time and cost. Cache stored in `.mergementor/cache/`.

## Review Categories & Severity

**Categories**:

- 🐛 **Bug** - Potential bugs or logical errors
- 🔒 **Security** - Security vulnerabilities
- ⚡ **Performance** - Performance issues
- 📝 **Quality** - Code quality and readability
- 📚 **Documentation** - Missing or inadequate documentation
- 🏗️ **Architecture** - Architectural boundaries, coupling, and system structure concerns
- 🎨 **Design** - Software design patterns, clean code principles, and API design
- 🧪 **Testing** - Test quality, coverage gaps, assertions, and mock verification

**Severity Levels**:

- 🔴 **Critical** - Must be fixed
- 🟠 **High** - Should be addressed
- 🟡 **Medium** - Worth reviewing
- 🟢 **Low** - Minor suggestions

## CI/CD Integration

Use the `--ci` flag to automatically detect the CI environment and pick up the PR number, repository, and token from well-known environment variables. This is the recommended approach — no manual wiring of PR numbers or repo details needed.

### GitHub Actions

```yaml
name: Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write # Required to post comments
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Run Review
        run: npx merge-mentor review --ci
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`--ci` automatically reads `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, and the PR number from the GitHub Actions environment. `--write` defaults to `true` in CI mode so comments are posted to the PR.

### Azure Pipelines

```yaml
pr:
  branches:
    include: ["*"]

pool:
  vmImage: ubuntu-latest

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: "22.x"

  - script: npx merge-mentor review --ci
    displayName: Run Review
    env:
      SYSTEM_ACCESSTOKEN: $(System.AccessToken)
```

`--ci` automatically reads `SYSTEM_ACCESSTOKEN`, the collection URI (for org), `SYSTEM_TEAMPROJECT`, `BUILD_REPOSITORY_NAME`, and `SYSTEM_PULLREQUEST_PULLREQUESTID` from the Azure Pipelines environment.

> **Note:** `SYSTEM_ACCESSTOKEN` must be explicitly mapped in the pipeline step via the `env` block as shown above.
>
> **Permissions:** The Build Service account typically has Reader-only access and **cannot post PR comments** by default. In most organisations you'll need to provide a PAT (Personal Access Token) with _Code (Read)_ and _Pull Request Threads (Read & Write)_ scopes instead:
>
> ```yaml
> - script: npx merge-mentor review --ci
>   displayName: Run Review
>   env:
>     MM_AZURE_TOKEN: $(MERGE_MENTOR_PAT) # PAT with PR comment permission
> ```
>
> When `MM_AZURE_TOKEN` is set, `SYSTEM_ACCESSTOKEN` is not required. Store your PAT as a pipeline secret variable named `MERGE_MENTOR_PAT` (or any name you prefer) in the pipeline library or variable group.

### CI/CD Caching (Highly Recommended)

Merge Mentor automatically caches the review state (under `.mergementor/`) to skip reviewing files that haven't changed since the last run. Since CI environments run on ephemeral runner VMs that are destroyed after completion, you should configure your workflow to persist this directory across builds. This prevents redundant reviews and saves AI token costs.

#### GitHub Actions

Use `actions/cache` to persist the `.mergementor` directory:

```yaml
- name: Cache Merge Mentor State
  uses: actions/cache@v4
  with:
    path: .mergementor
    key: ${{ runner.os }}-merge-mentor-${{ github.ref_name }}-${{ github.run_id }}
    restore-keys: |
      ${{ runner.os }}-merge-mentor-${{ github.ref_name }}-
      ${{ runner.os }}-merge-mentor-
```

#### Azure Pipelines

Use the `Cache@2` task to persist the `.mergementor` directory:

```yaml
- task: Cache@2
  inputs:
    key: 'merge-mentor | "$(Agent.OS)" | "$(Build.SourceBranchName)"'
    path: .mergementor
    cacheHitVar: CACHE_RESTORED
  displayName: Cache Merge Mentor State
```

### Overriding CI-detected values

Explicit flags always take priority over CI-detected values, so you can still override individual options:

```bash
# Use a different AI provider, but let CI handle the rest
merge-mentor review --ci --provider copilot-sdk

# Override the PR number (e.g. for testing)
merge-mentor review --ci --pr 42

# Dry-run in CI (preview without posting)
merge-mentor review --ci --no-write

# Use a specific local checkout instead of the CI-detected workspace
merge-mentor review --ci --local-workspace-path /custom/checkout/path
```

### Manual setup (without --ci)

You can still provide all values explicitly via environment variables or CLI flags if preferred:

```bash
# GitHub Actions (manual)
npx merge-mentor review \
  --pr ${{ github.event.pull_request.number }} \
  --write
# with env: MM_GITHUB_TOKEN, MM_GITHUB_REPO_OWNER, MM_GITHUB_REPO_NAME

# Azure Pipelines (manual)
npx merge-mentor review \
  --pr $(System.PullRequest.PullRequestId) \
  --platform azure \
  --write
# with env: MM_AZURE_TOKEN, MM_AZURE_ORG, MM_AZURE_PROJECT, MM_AZURE_REPO
```

## File Organization and Logging

Logs are written to timestamped files in `.mergementor/logs/merge-mentor_YYYY-MM-DD_HH-mm-ss.log` in your current directory. Each review run generates its own log file, preserving historical logs for debugging and audit purposes.

```bash
# View latest logs
ls -la .mergementor/logs/
tail -f .mergementor/logs/merge-mentor_*.log

# View specific run
tail -f .mergementor/logs/merge-mentor_2025-01-06_18-40-30.log

# Set log level
export LOG_LEVEL=debug  # debug, info, warn, error
```

Review reports from dry-run mode are saved to `.mergementor/reports/` as markdown files for easy review and archival.

## Troubleshooting

### Timeout errors

Increase timeout for large PRs:

```bash
export MM_AI_TIMEOUT=3600000  # 1 hour for all AI providers
```

### Exit Codes

- `0` - Success or configuration issue
- `1` - Review failed or critical issues found

## License

MIT License. See [LICENSE](./LICENSE) for details.

---

**Version**: 2.2.0
**Author**: archerax
**Documentation**: Included in npm package

```

```
