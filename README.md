# merge-mentor - Automated Code Review Bot

[![Test Coverage](https://img.shields.io/badge/coverage-94%25-brightgreen.svg)](./coverage)
[![Tests](https://img.shields.io/badge/tests-261%20passing-brightgreen.svg)](./src)
[![TypeScript](https://img.shields.io/badge/typescript-5.9.3-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-Proprietary-red.svg)](./LICENSE)

An automated code review bot that leverages GitHub Copilot CLI to perform comprehensive code reviews on pull requests from GitHub and Azure DevOps repositories.

## Features

- **Multi-Platform Support**: Review PRs from both GitHub and Azure DevOps
- **Comprehensive Analysis**: Reviews code for quality, bugs, security, performance, and documentation
- **Inline Comments**: Posts specific feedback on exact lines of code
- **Summary Reports**: Generates detailed summary comments with statistics
- **Comment Management**: Updates/resolves existing bot comments as issues are addressed
- **Cross-File Analysis**: Identifies architectural and design issues across the PR
- **Incremental Reviews**: Automatically skips re-reviewing unchanged files to reduce costs and improve speed
- **Dry-Run Mode**: Preview changes before posting (default behavior)

## Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- GitHub Copilot CLI installed and accessible in PATH
- Personal access tokens for GitHub and/or Azure DevOps

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd merge-mentor

# Install dependencies
pnpm install

# Build the project
pnpm build
```

## Configuration

Copy the example environment file and configure your tokens:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Platform Selection (default)
DEFAULT_PLATFORM=github

# GitHub Configuration
GITHUB_TOKEN=<your_github_personal_access_token>
GITHUB_REPO_OWNER=<username_or_org>
GITHUB_REPO_NAME=<repository_name>

# Azure DevOps Configuration
AZURE_DEVOPS_TOKEN=<your_azure_devops_pat>
AZURE_DEVOPS_ORG=<organization_name>
AZURE_DEVOPS_PROJECT=<project_name>
AZURE_DEVOPS_REPO=<repository_name>

# Bot Configuration
BOT_COMMENT_IDENTIFIER=[merge-mentor]

# Copilot Configuration
COPILOT_MODEL=gpt-4o  # Optional: Specify which Copilot model to use
COPILOT_TIMEOUT_MS=180000  # Optional: CLI timeout in milliseconds (default: 180000 = 3 minutes)

# Logging Configuration
LOG_LEVEL=info  # Optional: Set log level (debug, info, warn, error)
```

### GitHub Token Permissions

Your GitHub token needs the following scopes:

- `repo` - Full control of private repositories (or `public_repo` for public repos only)

### Azure DevOps Token Permissions

Your Azure DevOps PAT needs:

- Code: Read & Write
- Pull Request Threads: Read & Write

### Copilot Model Selection

You can optionally configure which Copilot model to use by setting `COPILOT_MODEL` in your `.env` file. If not specified, Copilot CLI will use its default model. Supported models include:

- `gpt-4o` - GPT-4 Optimized (recommended)
- `gpt-4` - GPT-4
- `claude-3.5-sonnet` - Claude 3.5 Sonnet
- `o1-preview` - O1 Preview
- `o1-mini` - O1 Mini

Check your Copilot CLI documentation for the latest available models.

### Copilot Timeout Configuration

The default timeout for Copilot CLI operations is 3 minutes (180000ms). For large or complex PRs, you may need to increase this timeout:

```env
COPILOT_TIMEOUT_MS=300000  # 5 minutes
```

If you see errors like `CLI process timed out after XXXms`, increase this value. Note that longer timeouts may impact performance and cost.

## Logging

merge-mentor includes comprehensive structured logging using Pino:

- **Development**: Pretty-printed logs to stderr with colors and timestamps, plus JSON logs to file
- **Production**: JSON-formatted logs to file for log aggregation systems
- **Log Levels**: `debug`, `info`, `warn`, `error`
- **Log File**: `.merge-mentor/logs/merge-mentor.log` in the project directory (auto-created)

### Configure Logging

Set the log level and output directory via environment variables:

```bash
# .env
LOG_LEVEL=debug  # Set to debug, info, warn, or error
LOG_DIR=/var/log/merge-mentor  # Optional: Custom log directory (defaults to .merge-mentor/logs)
```

### Log Files

Logs are automatically written to `.merge-mentor/logs/merge-mentor.log` (or `$LOG_DIR/merge-mentor.log` if configured). The log directory is created automatically if it doesn't exist.

**Note**: User-facing progress messages (via `console.log`) still appear in the terminal. Only framework logging goes to the file.

### Viewing Logs

```bash
# View recent logs
tail -f .merge-mentor/logs/merge-mentor.log

# Pretty-print JSON logs
tail .merge-mentor/logs/merge-mentor.log | jq

# Filter by level
grep '"level":"error"' .merge-mentor/logs/merge-mentor.log | jq

# Filter by component
grep '"component":"GitHubAdapter"' .merge-mentor/logs/merge-mentor.log | jq
```

### Log Output

Logs include contextual information to help debug issues:

```json
{
  "level": "error",
  "time": "2025-12-20T05:52:10.102Z",
  "component": "GitHubAdapter",
  "prNumber": 123,
  "path": "src/file.ts",
  "line": 42,
  "commitSha": "abc123",
  "error": "Validation Failed: {\"resource\":\"PullRequestReviewComment\",\"code\":\"custom\",\"field\":\"pull_request_review_thread.line\",\"message\":\"could not be resolved\"}",
  "msg": "Failed to post inline comment"
}
```

This detailed logging helps identify issues like:

- Invalid line numbers in comment requests
- Rate limiting problems
- API validation failures
- Network timeouts

For detailed debugging instructions, see [DEBUGGING.md](./DEBUGGING.md).

## Usage

### Review a Pull Request

**Important**: The GitHub Copilot CLI requires access to repository files. Ensure you're running from within a checked-out repository or that your CI/CD environment checks out the code first (see [CI/CD Integration](#cicd-integration) below).

```bash
# Dry-run mode (default) - shows what would be posted
pnpm review -- --pr 123

# Actually post comments to the PR
pnpm review -- --pr 123 --write

# Review an Azure DevOps PR
pnpm review -- --pr 456 --platform azure --write

# Disable verbose output
pnpm review -- --pr 123 --verbose false
```

### Command Options

| Option                       | Description                             | Default              |
| ---------------------------- | --------------------------------------- | -------------------- |
| `--pr <number>`              | Pull request number (required)          | -                    |
| `--platform <github\|azure>` | Platform to use                         | From env or `github` |
| `--write`                    | Post comments to PR (otherwise dry-run) | `false`              |
| `--verbose`                  | Enable verbose output                   | `true`               |

### CI/CD Integration

When running in CI/CD environments (GitHub Actions, Azure Pipelines, etc.), you **must** check out the repository before running the review. The Copilot CLI needs access to the actual file contents.

#### GitHub Actions Example

```yaml
name: Code Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "18"

      - name: Install Copilot CLI
        run: |
          # Install GitHub Copilot CLI
          npm install -g @githubnext/github-copilot-cli

      - name: Install dependencies
        run: pnpm install

      - name: Run review
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: pnpm review -- --pr ${{ github.event.pull_request.number }} --write
```

#### Azure Pipelines Example

```yaml
trigger:
  - main

pr:
  branches:
    include:
      - "*"

pool:
  vmImage: "ubuntu-latest"

steps:
  - checkout: self
    fetchDepth: 0

  - task: NodeTool@0
    inputs:
      versionSpec: "18.x"

  - script: npm install -g @githubnext/github-copilot-cli
    displayName: "Install Copilot CLI"

  - script: |
      pnpm install
      pnpm build
    displayName: "Install dependencies"

  - script: |
      pnpm review -- --pr $(System.PullRequest.PullRequestId) --platform azure --write
    displayName: "Run code review"
    env:
      AZURE_DEVOPS_TOKEN: $(AZURE_DEVOPS_TOKEN)
```

**Key Points:**

- Always include a checkout step (`actions/checkout@v4` or `checkout: self`)
- Install the GitHub Copilot CLI before running the review
- Pass the PR number using your platform's variables
- Set required tokens via secrets/variables

## How It Works

1. **Initialization**: Authenticates with the selected platform API
2. **PR Retrieval**: Fetches PR metadata and changed files
3. **Cache Check**: Loads previous review state to identify unchanged files
4. **File-by-File Review**: Analyzes each changed file using Copilot CLI with specialized prompts
5. **Cross-File Analysis**: Performs holistic analysis of all changes (skipped if all files cached)
6. **Comment Management**: Compares findings with existing bot comments
7. **Feedback Delivery**: Posts inline comments and a summary report
8. **State Caching**: Saves review results and cross-file analysis for future incremental reviews

## Review Categories

The bot analyzes code for:

- **Bug**: Potential bugs or logical errors
- **Security**: Security vulnerabilities
- **Performance**: Performance issues or inefficiencies
- **Quality**: Code quality and readability concerns
- **Documentation**: Missing or inadequate documentation

## Severity Levels

| Level    | Emoji | Description                               |
| -------- | ----- | ----------------------------------------- |
| Critical | 🔴    | Severe issues that must be fixed          |
| High     | 🟠    | Important issues that should be addressed |
| Medium   | 🟡    | Moderate concerns worth reviewing         |
| Low      | 🟢    | Minor suggestions for improvement         |

## Incremental Reviews

merge-mentor automatically caches review results to enable incremental reviews. When you re-review a PR:

- **Unchanged files are skipped**: Files with the same content SHA are not re-reviewed
- **Cross-file analysis is cached**: When no files changed, cross-file analysis is skipped entirely
- **Only changed files are analyzed**: Saves time and API costs on large PRs
- **Cache is automatic**: Stored in `.merge-mentor/cache/` directory (excluded from git)
- **Per-PR caching**: Each PR maintains its own review state

This means subsequent reviews after pushing new commits will only analyze the files that actually changed, making re-reviews much faster and more cost-effective.

### How It Works

1. After each review, file content hashes (SHAs), review results, and cross-file analysis are saved
2. On re-review, the current file SHAs are compared with cached SHAs
3. Files with matching SHAs reuse cached review results
4. If all files are unchanged, the cross-file analysis is also reused (no Copilot calls)
5. If any files changed, only those files are sent to Copilot for analysis and cross-file analysis is re-run
6. The cache is updated with new results after each review

**Note**: The cache directory (`.merge-mentor/cache/`) can be safely deleted to force a full re-review of all files.

## Development

### Code Quality

This project maintains high code quality standards:

- **94%+ test coverage** with 261 comprehensive tests
- **98%+ function coverage** across all modules
- **TypeScript strict mode** enabled
- **Zero magic numbers** - all constants extracted
- Follows Clean Code, Pragmatic TypeScript, and Testing best practices
- See [REVIEW.md](./REVIEW.md) for detailed quality analysis

### Project Structure

```
merge-mentor/
├── src/
│   ├── cli.ts              # Command-line interface
│   ├── config.ts           # Configuration management
│   ├── logger.ts           # Logging framework (Pino)
│   ├── errors/             # Custom error classes
│   │   └── index.ts
│   ├── platforms/
│   │   ├── types.ts        # Platform adapter interfaces
│   │   ├── github.ts       # GitHub API adapter
│   │   └── azure.ts        # Azure DevOps API adapter
│   ├── copilot/
│   │   ├── client.ts       # Copilot CLI wrapper
│   │   └── prompts.ts      # Review prompt templates
│   └── review/
│       ├── engine.ts       # Review orchestration
│       ├── commentManager.ts # Comment lifecycle management
│       └── reviewStateCache.ts # Review state caching
├── tests/                  # Unit tests
├── .env.example           # Example environment configuration
├── .merge-mentor/         # Runtime files (gitignored)
│   ├── cache/            # Review state cache
│   └── logs/             # Application logs
├── AGENTS.md              # AI agent instructions
├── TASKS.md               # Code quality tasks
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### Scripts

```bash
# Build the project
pnpm build

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage

# Type check (no build)
pnpm typecheck

# Lint code (requires eslint installation)
pnpm lint

# Format code (requires prettier installation)
pnpm format

# Run all quality checks
pnpm check
```

## Error Handling

The bot uses specific error types for different failure scenarios:

- `ConfigurationError` - Missing or invalid configuration
- `CopilotCliError` - Copilot CLI failures or unavailability
- `JsonParseError` - Malformed JSON responses from Copilot
- `ValidationError` - Invalid input parameters

### Repository Checkout Issues

If you see an error like "Path does not exist" or "Repository files not accessible", the Copilot CLI cannot access the repository files. This typically occurs in CI/CD environments where the repository hasn't been checked out.

**Solution**:

- **GitHub Actions**: Add `uses: actions/checkout@v4` before running the review
- **Azure Pipelines**: Add `checkout: self` step at the beginning
- **Local Development**: Run the command from within the repository directory

The tool will exit with code 0 in this case to avoid failing pipelines for configuration issues.

## Exit Codes

| Code | Meaning                                                         |
| ---- | --------------------------------------------------------------- |
| 0    | Review completed successfully (no critical issues found)        |
| 0    | Repository not checked out (configuration issue, not a failure) |
| 1    | Review completed with critical issues found                     |
| 1    | Review failed due to an error (authentication, API, etc.)       |

**Note**: When the repository is not checked out (common CI/CD configuration issue), the tool exits with code 0 to avoid failing pipelines. A warning message is displayed with instructions to fix the checkout configuration.

## License

This software is proprietary and licensed for private use only with explicit permission from the author (archerax). See [LICENSE](./LICENSE) for details.

Unauthorized copying, modification, distribution, or use is strictly prohibited.
