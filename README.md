# merge-mentor

Automated code review bot powered by AI CLI tools. Supports multiple AI providers including GitHub Copilot CLI, OpenCode CLI, and Cursor CLI. Analyzes pull requests and provides intelligent feedback on code quality, security, performance, and best practices.

## Quick Start

```bash
# Install globally
npm install -g merge-mentor

# Run a review (dry-run mode)
GITHUB_TOKEN=your_token \
GITHUB_REPO_OWNER=owner \
GITHUB_REPO_NAME=repo \
merge-mentor review --pr 123

# Post comments to PR
merge-mentor review --pr 123 --write

# Use OpenCode CLI instead of Copilot
merge-mentor review --pr 123 --provider opencode --write

# Use Cursor CLI
merge-mentor review --pr 123 --provider cursor --write

# Or use npx (no installation required)
npx merge-mentor review --pr 123
```

## Features

- **Multi-Provider Support** - Works with GitHub Copilot CLI, OpenCode CLI, and Cursor CLI
- **Multi-Platform Support** - Works with GitHub and Azure DevOps
- **Intelligent Analysis** - Reviews for bugs, security, performance, quality, and documentation
- **Inline Comments** - Posts feedback on specific lines of code
- **Smart Deduplication** - Avoids flagging the same issue multiple times
- **Incremental Reviews** - Only analyzes changed files to save time
- **Multi-Run Mode** - Aggregate findings from multiple passes for thoroughness
- **Confidence Filtering** - Only posts high-confidence issues by default
- **Auto-Resolution** - Detects when issues are fixed and resolves comments
- **Dry-Run Mode** - Preview changes before posting with detailed markdown reports (default)

## Prerequisites

- **Node.js 20+**
- **AI CLI Tool** - At least one must be installed and accessible in PATH:
  - **GitHub Copilot CLI** (default):
    ```bash
    npm install -g @githubnext/github-copilot-cli
    ```
  - **OpenCode CLI**:
    ```bash
    # Install OpenCode CLI (follow official instructions)
    # https://opencode.dev
    ```
  - **Cursor CLI**:
    ```bash
    # Install Cursor CLI
    curl https://cursor.com/install -fsS | bash
    # Ensure cursor-agent is in your PATH
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

Configure merge-mentor using environment variables or command-line parameters.

### GitHub Configuration

**Linux/macOS:**
```bash
export GITHUB_TOKEN=your_personal_access_token
export GITHUB_REPO_OWNER=username_or_org
export GITHUB_REPO_NAME=repository_name
export DEFAULT_PLATFORM=github
```

**Windows (PowerShell):**
```powershell
$env:GITHUB_TOKEN="your_personal_access_token"
$env:GITHUB_REPO_OWNER="username_or_org"
$env:GITHUB_REPO_NAME="repository_name"
$env:DEFAULT_PLATFORM="github"
```

**Windows (Command Prompt):**
```cmd
set GITHUB_TOKEN=your_personal_access_token
set GITHUB_REPO_OWNER=username_or_org
set GITHUB_REPO_NAME=repository_name
set DEFAULT_PLATFORM=github
```

### Azure DevOps Configuration

**Linux/macOS:**
```bash
export AZURE_DEVOPS_TOKEN=your_pat
export AZURE_DEVOPS_ORG=organization_name
export AZURE_DEVOPS_PROJECT=project_name
export AZURE_DEVOPS_REPO=repository_name
export DEFAULT_PLATFORM=azure
```

**Windows (PowerShell):**
```powershell
$env:AZURE_DEVOPS_TOKEN="your_pat"
$env:AZURE_DEVOPS_ORG="organization_name"
$env:AZURE_DEVOPS_PROJECT="project_name"
$env:AZURE_DEVOPS_REPO="repository_name"
$env:DEFAULT_PLATFORM="azure"
```

**Windows (Command Prompt):**
```cmd
set AZURE_DEVOPS_TOKEN=your_pat
set AZURE_DEVOPS_ORG=organization_name
set AZURE_DEVOPS_PROJECT=project_name
set AZURE_DEVOPS_REPO=repository_name
set DEFAULT_PLATFORM=azure
```

### AI Provider Configuration

**Default Provider**: GitHub Copilot CLI (`copilot`)

**Linux/macOS:**
```bash
# Select AI provider (copilot, opencode, or cursor)
export AI_PROVIDER=copilot

# Copilot-specific settings
export COPILOT_MODEL=gpt-5.2
export COPILOT_TIMEOUT_MS=180000

# OpenCode-specific settings (when using --provider opencode)
export OPENCODE_MODEL=claude-sonnet-4.5
export OPENCODE_TIMEOUT_MS=180000

# Cursor-specific settings (when using --provider cursor)
export CURSOR_MODEL=gpt-5
export CURSOR_TIMEOUT_MS=180000
```

**Windows (PowerShell):**
```powershell
# Select AI provider
$env:AI_PROVIDER="copilot"

# Copilot settings
$env:COPILOT_MODEL="gpt-5.2"
$env:COPILOT_TIMEOUT_MS="180000"

# OpenCode settings
$env:OPENCODE_MODEL="claude-sonnet-4.5"
$env:OPENCODE_TIMEOUT_MS="180000"

# Cursor settings
$env:CURSOR_MODEL="gpt-5"
$env:CURSOR_TIMEOUT_MS="180000"
```

### Optional Settings

**Linux/macOS:**
```bash
# Comment filtering
export MIN_COMMENT_CONFIDENCE=high  # high, medium, or low
export SKIP_PREEXISTING_ISSUES=true
export POST_RESOLUTION_COMMENTS=true

# Multi-run mode
export REVIEW_RUNS=1  # 1-5 runs

# Logging
export LOG_LEVEL=info  # debug, info, warn, or error
export LOG_DIR=.merge-mentor/logs  # optional, defaults to .merge-mentor/logs

# Audit logging (enabled by default for security/compliance)
export AUDIT_LOGGING_ENABLED=true
```

### Audit Logging

Audit logging is enabled by default for security and compliance tracking. All critical actions are logged with structured data including:

- **PR Operations**: Fetching PR details, files, and comments
- **Comment Actions**: Creating, updating, and resolving comments
- **Copilot Execution**: All LLM prompt executions
- **Review Lifecycle**: Start/completion of reviews and individual file analysis

Audit logs are written to the application logs (`.merge-mentor/logs/merge-mentor.log`) with a dedicated `audit` field for easy filtering and analysis.

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
- Identifying patterns in review failures

### Token Permissions

**GitHub Token**:
- `repo` scope (full control of private repositories)
- Or `public_repo` for public repositories only

**Azure DevOps PAT**:
- Code: Read & Write
- Pull Request Threads: Read & Write

### Available Models

**Copilot CLI**: Configure via `COPILOT_MODEL` environment variable.
- `claude-sonnet-4.5`
- `claude-haiku-4.5`
- `claude-opus-4.5`
- `claude-sonnet-4`
- `gpt-5.1-codex-max`
- `gpt-5.1-codex`
- `gpt-5.2`
- `gpt-5.1`
- `gpt-5`
- `gpt-5.1-codex-mini`
- `gpt-5-mini`
- `gpt-4.1`
- `gemini-3-pro-preview`

**OpenCode CLI**: Configure via `OPENCODE_MODEL` environment variable.
- Check OpenCode documentation for supported models

**Cursor CLI**: Configure via `CURSOR_MODEL` environment variable.
- Supports multiple AI models (GPT-5, Claude 4 Sonnet, Claude 4 Opus)
- Check Cursor CLI documentation for latest supported models

## Usage

```bash
# Dry-run mode (preview only) - generates detailed markdown report
merge-mentor review --pr 123

# Post comments to PR
merge-mentor review --pr 123 --write

# Use OpenCode CLI instead of Copilot
merge-mentor review --pr 123 --provider opencode --write

# Use Cursor CLI
merge-mentor review --pr 123 --provider cursor --write

# Azure DevOps
merge-mentor review --pr 456 --platform azure --write

# Multiple review passes for thoroughness
merge-mentor review --pr 123 --runs 3 --write

# Quiet mode
merge-mentor review --pr 123 --verbose false
```

### Command Options

| Option | Description | Default |
|--------|-------------|---------|
| `--pr <number>` | Pull request number (required) | - |
| `--platform <github\|azure>` | Platform to use | `github` |
| `--provider <copilot\|opencode\|cursor>` | AI provider to use | `copilot` |
| `--write` | Post comments (otherwise dry-run with markdown report) | `false` |
| `--verbose` | Enable verbose output | `true` |
| `--runs <1-5>` | Number of review passes | `1` |

## Key Features Explained

### Confidence-Based Filtering

Only high-confidence issues are posted by default to reduce noise:

```bash
export MIN_COMMENT_CONFIDENCE=high  # high (default), medium, or low
```

### Pre-Existing Issue Detection

Skips issues that existed before the PR:

```bash
export SKIP_PREEXISTING_ISSUES=true  # default
```

### Auto-Resolution with Explanations

When code is fixed, the bot resolves comments with an explanation:

```bash
export POST_RESOLUTION_COMMENTS=true  # default
```

### Multi-Run Mode

AI reviews are non-deterministic. Running multiple passes catches more issues:

```bash
# Run 3 times and aggregate findings
merge-mentor review --pr 123 --runs 3 --write
```

Use 3-5 runs for critical/security-sensitive code, 1 run for regular development.

### Detailed Markdown Reports

In dry-run mode, merge-mentor automatically generates comprehensive markdown reports with all findings:

```bash
# Generate detailed report without posting comments
merge-mentor review --pr 123

# Report saved to: .merge-mentor/reports/pr-123-review-report.md
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

Only analyzes changed files on re-reviews, saving time and cost. Cache stored in `.merge-mentor/cache/`.

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

### GitHub Actions

```yaml
name: Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install Copilot CLI
        run: npm install -g @githubnext/github-copilot-cli

      - name: Run Review
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPO_OWNER: ${{ github.repository_owner }}
          GITHUB_REPO_NAME: ${{ github.event.repository.name }}
        run: npx merge-mentor review --pr ${{ github.event.pull_request.number }} --write
```

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
      versionSpec: "20.x"

  - script: npm install -g @githubnext/github-copilot-cli
    displayName: Install Copilot CLI

  - script: |
      npx merge-mentor review \
        --pr $(System.PullRequest.PullRequestId) \
        --platform azure \
        --write
    displayName: Run Review
    env:
      AZURE_DEVOPS_TOKEN: $(AZURE_DEVOPS_TOKEN)
      AZURE_DEVOPS_ORG: $(System.TeamFoundationCollectionUri)
      AZURE_DEVOPS_PROJECT: $(System.TeamProject)
      AZURE_DEVOPS_REPO: $(Build.Repository.Name)
```

## Logging

Logs are written to `.merge-mentor/logs/merge-mentor.log` in your current directory.

```bash
# View logs
tail -f .merge-mentor/logs/merge-mentor.log

# Set log level
export LOG_LEVEL=debug  # debug, info, warn, error
```

## Troubleshooting

### Timeout errors
Increase timeout for large PRs:
```bash
export COPILOT_TIMEOUT_MS=300000  # 5 minutes (for Copilot)
export OPENCODE_TIMEOUT_MS=300000  # 5 minutes (for OpenCode)
export CURSOR_TIMEOUT_MS=300000  # 5 minutes (for Cursor)
```

### Exit Codes
- `0` - Success or configuration issue
- `1` - Review failed or critical issues found

## License

Proprietary software. See [LICENSE](./LICENSE) for details.

---

**Version**: 1.6.0  
**Author**: archerax  
**Documentation**: Included in npm package
