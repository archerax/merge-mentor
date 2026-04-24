# merge-mentor

Automated code review bot powered by AI providers. Supports GitHub Copilot and OpenCode via both CLI and SDK integrations. Analyzes pull requests and provides intelligent feedback on code quality, security, performance, and best practices.

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

# Use OpenCode CLI instead of Copilot
merge-mentor review --pr 123 --provider opencode --write

# Or use npx (no installation required)
npx merge-mentor review --pr 123
```

## Features

- **Multi-Provider Support** - Works with GitHub Copilot and OpenCode via CLI and SDK providers
- **Multi-Platform Support** - Works with GitHub and Azure DevOps
- **Intelligent Analysis** - Reviews for bugs, security, performance, quality, and documentation
- **Specialist Review Types** - Focused reviews for testing, security, or performance concerns
- **Custom Review Phases** - Build a custom review from configurable general-review phases
- **Inline Comments** - Posts feedback on specific lines of code
- **Smart Deduplication** - Avoids flagging the same issue multiple times
- **Incremental Reviews** - Only analyzes changed files to save time
- **Multi-Run Mode** - Aggregate findings from multiple passes for thoroughness
- **Dry-Run Mode** - Preview changes before posting with detailed markdown reports (default)
- **Streaming Output** - Real-time feedback showing AI model output during reviews

## Prerequisites

- **Node.js 22+**
- **AI providers** require these CLIs to be installed manually:
  - **Copilot CLI** (required for `copilot-sdk` and `copilot`):
    ```bash
    npm install -g @github/copilot
    ```
  - **OpenCode CLI** (required for `opencode-sdk` and `opencode`):
    ```bash
    # Install OpenCode CLI (follow official instructions)
    # https://opencode.dev
    ```
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

**Linux/macOS:**

```bash
export MM_GITHUB_TOKEN=your_personal_access_token
export MM_GITHUB_REPO_OWNER=username_or_org
export MM_GITHUB_REPO_NAME=repository_name
export MM_PLATFORM=github
```

**Windows (PowerShell):**

```powershell
$env:MM_GITHUB_TOKEN="your_personal_access_token"
$env:MM_GITHUB_REPO_OWNER="username_or_org"
$env:MM_GITHUB_REPO_NAME="repository_name"
$env:MM_PLATFORM="github"
```

**Windows (Command Prompt):**

```cmd
set MM_GITHUB_TOKEN=your_personal_access_token
set MM_GITHUB_REPO_OWNER=username_or_org
set MM_GITHUB_REPO_NAME=repository_name
set MM_PLATFORM=github
```

### Azure DevOps Configuration

**Linux/macOS:**

```bash
export MM_AZURE_TOKEN=your_pat
export MM_AZURE_ORG=organization_name
export MM_AZURE_PROJECT=project_name
export MM_AZURE_REPO=repository_name
export MM_PLATFORM=azure
```

**Windows (PowerShell):**

```powershell
$env:MM_AZURE_TOKEN="your_pat"
$env:MM_AZURE_ORG="organization_name"
$env:MM_AZURE_PROJECT="project_name"
$env:MM_AZURE_REPO="repository_name"
$env:MM_PLATFORM="azure"
```

**Windows (Command Prompt):**

```cmd
set MM_AZURE_TOKEN=your_pat
set MM_AZURE_ORG=organization_name
set MM_AZURE_PROJECT=project_name
set MM_AZURE_REPO=repository_name
set MM_PLATFORM=azure
```

### AI Provider Configuration

**Default Provider**: GitHub Copilot SDK (`copilot-sdk`)

**Linux/macOS:**

```bash
# Select AI provider (copilot-sdk, copilot, opencode, opencode-sdk)
export MM_AI_PROVIDER=copilot-sdk

# Shared AI timeout (preferred)
export MM_AI_TIMEOUT=3600000

# Generic AI model setting
export MM_AI_MODEL=gpt-5.2-codex

# Deprecated Copilot-specific model alias (scheduled for removal in v2)
export MM_COPILOT_MODEL=claude-sonnet-4.6

# Generic AI BYOK settings (currently used by Copilot SDK for OpenAI-compatible endpoints)
export MM_AI_BASE_URL=https://your-resource.openai.azure.com/openai/v1/
export MM_AI_API_KEY=your_provider_api_key

# Deprecated OpenCode-specific model alias (scheduled for removal in v2)
export MM_OPENCODE_MODEL=claude-sonnet-4.6

```

**Windows (PowerShell):**

```powershell
# Select AI provider
$env:MM_AI_PROVIDER="copilot-sdk"

# Shared AI timeout (preferred)
$env:MM_AI_TIMEOUT="3600000"

# Generic AI model setting
$env:MM_AI_MODEL="gpt-5.2-codex"

# Deprecated Copilot-specific model alias (scheduled for removal in v2)
$env:MM_COPILOT_MODEL="claude-sonnet-4.6"

# Generic AI BYOK settings (currently used by Copilot SDK for OpenAI-compatible endpoints)
$env:MM_AI_BASE_URL="https://your-resource.openai.azure.com/openai/v1/"
$env:MM_AI_API_KEY="your_provider_api_key"

# Deprecated OpenCode-specific model alias (scheduled for removal in v2)
$env:MM_OPENCODE_MODEL="claude-sonnet-4.6"
```

**Or use command-line parameters:**

```bash
merge-mentor review --pr 123 \
  --provider copilot-sdk \
  --ai-model gpt-5.2-codex \
  --ai-base-url https://your-resource.openai.azure.com/openai/v1/ \
  --ai-api-key "$FOUNDRY_API_KEY" \
  --ai-timeout 3600000
```

For GPT-5 series Copilot SDK BYOK models, merge-mentor automatically uses the SDK `responses`
wire API recommended by the Copilot SDK BYOK documentation.

Deprecated v1 aliases remain supported for backward compatibility and are scheduled for removal in v2:

- `MM_AGENT_TIMEOUT` / `--agent-timeout`
- `MM_COPILOT_MODEL` / `--copilot-model`
- `MM_COPILOT_SDK_MODEL` / `--copilot-sdk-model`
- `MM_OPENCODE_MODEL` / `--opencode-model`
- `MM_OPENCODE_SDK_MODEL` / `--opencode-sdk-model`
- `MM_COPILOT_SDK_BASE_URL` / `--copilot-sdk-base-url`
- `MM_COPILOT_SDK_API_KEY` / `--copilot-sdk-api-key`

### Optional Settings

**Linux/macOS:**

```bash
# Comment filtering
export MM_SKIP_EXISTING_ISSUES=true

# Multi-run mode
export MM_RUNS=1  # 1-5 runs

# Review type
export MM_REVIEW_TYPE=general  # general, testing, security, performance, fast, or custom

# Git backend for cloning repositories (default: cli uses system git binary)
export MM_GIT_BACKEND=cli  # cli or isomorphic

# Bot identifier
export MM_COMMENT_IDENTIFIER="[merge-mentor]"

# Temporary directory configuration
export MM_TEMP_PATH=./.mergementor  # Base path for temporary files (cache, diffs, logs, repos, reports, transcripts)

# Logging
export LOG_LEVEL=info  # debug, info, warn, or error

# Audit logging (enabled by default for security/compliance)
export AUDIT_LOGGING_ENABLED=true

# Streaming output display
export MM_STREAMING_ENABLED=true  # Enable/disable streaming output (default: true)
export MM_STREAMING_LINES=5       # Number of lines in streaming display (default: 5)
```

**Or use command-line parameters:**

```bash
merge-mentor review --pr 123 \
  --skip-existing-issues true \
  --runs 3 \
  --review-type testing \
  --comment-identifier "[custom-bot]"

# Custom review with selected phases (CLI only)
merge-mentor review --pr 123 \
  --review-type custom \
  --phases "scan,logic,performance"

# Monorepo-focused custom review
merge-mentor review --pr 123 \
  --review-type custom \
  --phases "scan,monorepo,logic"
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

**Azure DevOps PAT** (set via `MM_AZURE_TOKEN` or `--azure-token`):

- Code: Read & Write
- Pull Request Threads: Read & Write

### Available Models

**Preferred**: Configure the active provider model via `MM_AI_MODEL` or `--ai-model`.

**Deprecated aliases**:

- **Copilot**: `MM_COPILOT_MODEL` or `--copilot-model`
- **Copilot SDK**: `MM_COPILOT_SDK_MODEL` or `--copilot-sdk-model`
- **OpenCode**: `MM_OPENCODE_MODEL` or `--opencode-model`
- **OpenCode SDK**: `MM_OPENCODE_SDK_MODEL` or `--opencode-sdk-model`

- `claude-sonnet-4.6` (default)
- `claude-sonnet-4.5`
- `claude-haiku-4.5`
- `claude-opus-4.5`

- Check OpenCode documentation for supported models

## Usage

```bash
# Dry-run mode (preview only) - generates detailed markdown report
merge-mentor review --pr 123

# Post comments to PR
merge-mentor review --pr 123 --write

# Use OpenCode CLI instead of Copilot
merge-mentor review --pr 123 --provider opencode --write

# Azure DevOps
merge-mentor review --pr 456 --platform azure --write

# Multiple review passes for thoroughness
merge-mentor review --pr 123 --runs 3 --write

# Testing-focused review
merge-mentor review --pr 123 --review-type testing --write

# Security-focused review
merge-mentor review --pr 123 --review-type security --write

# Performance-focused review
merge-mentor review --pr 123 --review-type performance --write

# Quiet mode
merge-mentor review --pr 123 --verbose false
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
merge-mentor review --pr 456 --review-type testing --write

# Thorough testing analysis with 3 passes
merge-mentor review --pr 456 --review-type testing --runs 3 --write
```

**3. Security-Sensitive Changes:**

```bash
# Security review for authentication or data handling
merge-mentor review --pr 789 --review-type security --write

# Comprehensive security analysis with 5 passes
merge-mentor review --pr 789 --review-type security --runs 5 --write
```

**4. Performance-Critical Code:**

```bash
# Performance review for optimization work
merge-mentor review --pr 321 --review-type performance --write

# Combined with multiple passes for thorough analysis
merge-mentor review --pr 321 --review-type performance --runs 3 --write
```

**5. Preview Before Posting:**

```bash
# Dry-run generates detailed markdown report without posting
merge-mentor review --pr 123 --review-type testing

# Review the report in .mergementor/reports/
cat .mergementor/reports/Github-myrepo-PR123-testing-review-report.md

# Post if satisfied
merge-mentor review --pr 123 --review-type testing --write
```

### Command Options

**Core Options:**
| Option | Description | Env Variable | Default |
|--------|-------------|--------------|---------|
| `--pr <number>` | Pull request number (required) | - | - |
| `--platform <github\|azure>` | Platform to use | `MM_PLATFORM` | `github` |
| `--provider <copilot\|copilot-sdk\|opencode\|opencode-sdk>` | AI provider to use | `MM_AI_PROVIDER` | `copilot-sdk` |
| `--git-backend <cli\|isomorphic>` | Git backend for repo cloning | `MM_GIT_BACKEND` | `cli` |
| `--review-type <type>` | Review type: general, testing, security, performance, fast, custom | `MM_REVIEW_TYPE` | `general` |
| `--phases <list>` | Comma-separated general-review phases for `--review-type custom` | - | - |
| `--write` | Post comments (otherwise dry-run) | - | `false` |
| `--verbose` | Enable verbose output | - | `true` |
| `--runs <1-5>` | Number of review passes | `MM_REVIEW_RUNS` | `1` |
| `--no-stream` | Disable streaming output display | `MM_STREAMING_ENABLED` | - |
| `--stream-lines <n>` | Number of lines in streaming display (1-20) | `MM_STREAMING_LINES` | `5` |

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
| Option | Description | Env Variable |
|--------|-------------|--------------|
| `--copilot-token <token>` | GitHub token for Copilot CLI/SDK auth (CI use) | `MM_COPILOT_TOKEN` |
| `--ai-timeout <ms>` | Timeout in ms for all AI providers | `MM_AI_TIMEOUT` |
| `--ai-model <model>` | Model name for the active AI provider | `MM_AI_MODEL` |
| `--copilot-model <model>` | Deprecated alias for `--ai-model` | `MM_COPILOT_MODEL` |
| `--copilot-sdk-model <model>` | Deprecated alias for `--ai-model` | `MM_COPILOT_SDK_MODEL` |
| `--ai-base-url <url>` | Generic OpenAI-compatible BYOK base URL | `MM_AI_BASE_URL` |
| `--ai-api-key <key>` | Generic BYOK API key | `MM_AI_API_KEY` |
| `--opencode-model <model>` | Deprecated alias for `--ai-model` | `MM_OPENCODE_MODEL` |
| `--opencode-sdk-model <model>` | Deprecated alias for `--ai-model` | `MM_OPENCODE_SDK_MODEL` |

**File Filtering:**
| Option | Description | Default |
|--------|-------------|---------|
| `--ignore <pattern>` | Glob pattern for files to ignore (repeatable) | `**/generated/**` |

**Comment Filtering:**
| Option | Description | Env Variable | Default |
|--------|-------------|--------------|---------|
| `--skip-existing-issues <bool>` | Skip pre-existing issues (true/false) | `MM_SKIP_EXISTING_ISSUES` | `true` |
| `--comment-identifier <id>` | Bot comment identifier | `MM_COMMENT_IDENTIFIER` | `[merge-mentor]` |

**Note:** Command-line parameters always override environment variables.

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

Skips issues that existed before the PR:

```bash
export MM_SKIP_EXISTING_ISSUES=true  # default
# Or use CLI parameter:
merge-mentor review --pr 123 --skip-existing-issues true
```

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

### Multi-Run Mode

AI reviews are non-deterministic. Running multiple passes catches more issues:

```bash
# Run 3 times and aggregate findings
merge-mentor review --pr 123 --runs 3 --write
```

Use 3-5 runs for critical/security-sensitive code, 1 run for regular development.

### Review Types

Focus reviews on specific concerns with the `--review-type` flag:

```bash
# General review (default) - comprehensive analysis
merge-mentor review --pr 123 --write

# Testing-focused review - test coverage and quality
merge-mentor review --pr 123 --review-type testing --write

# Security-focused review - vulnerabilities and threats
merge-mentor review --pr 123 --review-type security --write

# Performance-focused review - optimization opportunities
merge-mentor review --pr 123 --review-type performance --write

# Fast review - single-pass for cost savings (~50% reduction)
merge-mentor review --pr 123 --review-type fast --write

# Custom review - choose only the general-review phases you want
merge-mentor review --pr 123 --review-type custom --phases "scan,logic" --write

# Custom review for monorepo changes
merge-mentor review --pr 123 --review-type custom --phases "scan,monorepo,performance" --write
```

**Available Review Types:**

- **`general`** (default): Comprehensive review covering all aspects - bugs, security, performance, quality, and documentation (2 AI calls: file-level + cross-file analysis)
- **`testing`**: Testing specialist focused exclusively on test quality and coverage
- **`security`**: Security specialist focused exclusively on vulnerabilities and threats
- **`performance`**: Performance specialist focused exclusively on efficiency and optimization
- **`fast`**: Combined file and architectural review in a single AI call (~50% cost reduction compared to general)
- **`custom`**: General review prompt constrained to the selected general-review phases, in the exact order you provide

**Custom Review Phase Catalog:**

- `scan`
- `security`
- `logic`
- `performance`
- `monorepo`

Use `--phases` with `--review-type custom`. Phase names are comma-separated, validated strictly, and must use the built-in catalog above. Example:

```bash
merge-mentor review --pr 123 \
  --review-type custom \
  --phases "scan,security,logic"
```

Use `monorepo` when the PR touches workspace structure, package boundaries, shared tooling, dependency ownership, or other cross-package concerns.

**When to Use Specialist Reviews:**

| Review Type     | Use When                                           | AI Calls | What It Checks                                                                      |
| --------------- | -------------------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| **general**     | Standard development or unsure what to check       | 2        | All aspects: bugs, security, performance, quality, documentation                    |
| **fast**        | Need cost savings, routine PRs                     | 1        | Same as general but in single pass (file + architectural analysis combined)         |
| **custom**      | Want to tailor general review passes to a codebase | 2        | Only the selected general-review phases, in the order provided                      |
| **testing**     | Adding/modifying tests or testable code            | 2        | Test coverage, test quality, assertion accuracy, naming conventions, mock usage     |
| **security**    | Handling sensitive data or auth flows              | 2        | Injection vulnerabilities, authentication flaws, data exposure, cryptography issues |
| **performance** | Performance-critical paths or scaling concerns     | 2        | Algorithm efficiency, resource usage, caching opportunities, database queries       |

#### Testing Review Deep Dive

The testing specialist analyzes four key areas:

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
export MM_REVIEW_TYPE=testing

# Or CLI parameter
merge-mentor review --pr 123 --review-type testing --write
```

**Example Use Cases:**

```bash
# Review test changes in a PR
merge-mentor review --pr 456 --review-type testing --write

# Thorough testing analysis with multiple passes
merge-mentor review --pr 456 --review-type testing --runs 3 --write
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
- 📖 **Documentation** - Missing or inadequate documentation

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

      - name: Install Copilot CLI
        run: npm install -g @github/copilot

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

  - script: npm install -g @github/copilot
    displayName: Install Copilot CLI

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

Proprietary software. See [LICENSE](./LICENSE) for details.

---

**Version**: 1.9.0
**Author**: archerax
**Documentation**: Included in npm package

```

```
