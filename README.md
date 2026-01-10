# merge-mentor

Automated code review bot powered by AI CLI tools. Supports multiple AI providers including GitHub Copilot CLI, OpenCode CLI, Cursor CLI, and OpenAI API. Analyzes pull requests and provides intelligent feedback on code quality, security, performance, and best practices.

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

# Use Cursor CLI
merge-mentor review --pr 123 --provider cursor --write

# Use OpenAI API (requires API key)
MM_OPENAI_API_KEY=sk-... merge-mentor review --pr 123 --provider openai --write

# Or use npx (no installation required)
npx merge-mentor review --pr 123
```

## Features

- **Multi-Provider Support** - Works with GitHub Copilot CLI, OpenCode CLI, Cursor CLI, and OpenAI API
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

- **Node.js 22+**
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
  - **OpenAI API** (no CLI installation needed):
    ```bash
    # Just set your API key
    export MM_OPENAI_API_KEY=sk-your-api-key
    # Or use Azure Foundry (OpenAI-compatible endpoint)
    export MM_OPENAI_API_KEY=your-azure-key
    export MM_OPENAI_BASE_URL=https://your-foundry.azure.com/v1
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

All environment variables are now prefixed with `MM_` to avoid conflicts with other applications. The old unprefixed variables are still supported for backward compatibility but are deprecated.

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
# Select AI provider (copilot, opencode, cursor, or openai)
export MM_AI_PROVIDER=copilot

# Copilot-specific settings
export MM_COPILOT_MODEL=gpt-5.2
export MM_COPILOT_TIMEOUT=180000

# OpenCode-specific settings (when using --provider opencode)
export MM_OPENCODE_MODEL=claude-sonnet-4.5
export MM_OPENCODE_TIMEOUT=180000

# Cursor-specific settings (when using --provider cursor)
export MM_CURSOR_MODEL=gpt-5
export MM_CURSOR_TIMEOUT=180000

# OpenAI-specific settings (when using --provider openai)
export MM_OPENAI_API_KEY=sk-your-api-key
export MM_OPENAI_MODEL=gpt-4o
export MM_OPENAI_TIMEOUT=180000
# Optional: Custom base URL for Azure Foundry
export MM_OPENAI_BASE_URL=https://your-foundry.azure.com/v1
export MM_OPENAI_MAX_RETRIES=3
```

**Windows (PowerShell):**
```powershell
# Select AI provider
$env:MM_AI_PROVIDER="copilot"

# Copilot settings
$env:MM_COPILOT_MODEL="gpt-5.2"
$env:MM_COPILOT_TIMEOUT="180000"

# OpenCode settings
$env:MM_OPENCODE_MODEL="claude-sonnet-4.5"
$env:MM_OPENCODE_TIMEOUT="180000"

# Cursor settings
$env:MM_CURSOR_MODEL="gpt-5"
$env:MM_CURSOR_TIMEOUT="180000"

# OpenAI settings
$env:MM_OPENAI_API_KEY="sk-your-api-key"
$env:MM_OPENAI_MODEL="gpt-4o"
$env:MM_OPENAI_TIMEOUT="180000"
```

**Or use command-line parameters:**
```bash
merge-mentor review --pr 123 \
  --provider opencode \
  --opencode-model claude-sonnet-4.5 \
  --opencode-timeout 180000

# OpenAI example
merge-mentor review --pr 123 \
  --provider openai \
  --openai-api-key sk-your-key \
  --openai-model gpt-4o
```

### Optional Settings

**Linux/macOS:**
```bash
# Comment filtering
export MM_MIN_COMMENT_CONFIDENCE=high  # high, medium, or low
export MM_SKIP_EXISTING_ISSUES=true
export MM_POST_RESOLUTION_COMMENTS=true

# Multi-run mode
export MM_REVIEW_RUNS=1  # 1-5 runs

# Bot identifier
export MM_COMMENT_IDENTIFIER="[merge-mentor]"

# Logging
export LOG_LEVEL=info  # debug, info, warn, or error
export LOG_DIR=.merge-mentor/logs  # optional, defaults to .merge-mentor/logs

# Audit logging (enabled by default for security/compliance)
export AUDIT_LOGGING_ENABLED=true
```

**Or use command-line parameters:**
```bash
merge-mentor review --pr 123 \
  --min-comment-confidence medium \
  --skip-existing-issues true \
  --post-resolution-comments true \
  --runs 3 \
  --comment-identifier "[custom-bot]"
```

### Audit Logging

Audit logging is enabled by default for security and compliance tracking. All critical actions are logged with structured data including:

- **PR Operations**: Fetching PR details, files, and comments
- **Comment Actions**: Creating, updating, and resolving comments
- **Copilot Execution**: All LLM prompt executions
- **Review Lifecycle**: Start/completion of reviews and individual file analysis

Audit logs are written to timestamped log files (`.merge-mentor/logs/merge-mentor_YYYY-MM-DD_HH-mm-ss.log`) with a dedicated `audit` field for easy filtering and analysis. Each review run generates its own log file, preserving historical audit trails.

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

**GitHub Token** (set via `MM_GITHUB_TOKEN` or `--github-token`):
- `repo` scope (full control of private repositories)
- Or `public_repo` for public repositories only

**Azure DevOps PAT** (set via `MM_AZURE_TOKEN` or `--azure-token`):
- Code: Read & Write
- Pull Request Threads: Read & Write

### Available Models

**Copilot CLI**: Configure via `MM_COPILOT_MODEL` environment variable or `--copilot-model` CLI parameter.
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

**OpenCode CLI**: Configure via `MM_OPENCODE_MODEL` environment variable or `--opencode-model` CLI parameter.
- Check OpenCode documentation for supported models

**Cursor CLI**: Configure via `MM_CURSOR_MODEL` environment variable or `--cursor-model` CLI parameter.
- Supports multiple AI models (GPT-5, Claude 4 Sonnet, Claude 4 Opus)
- Check Cursor CLI documentation for latest supported models

**OpenAI API**: Configure via `MM_OPENAI_MODEL` environment variable or `--openai-model` CLI parameter.
- `gpt-4o` (default)
- `gpt-4o-mini`
- `gpt-4-turbo`
- `gpt-4`
- `gpt-3.5-turbo`
- Any model available on your OpenAI account or Azure Foundry deployment

### Azure Foundry Compatibility

OpenAI provider supports Azure Foundry (OpenAI-compatible endpoints):

```bash
# Azure Foundry configuration
export MM_OPENAI_API_KEY="your-azure-api-key"
export MM_OPENAI_BASE_URL="https://your-foundry.azure.com/v1"
export MM_OPENAI_MODEL="gpt-4"

# Run review
merge-mentor review --pr 123 --provider openai --write
```

### Backward Compatibility

The old unprefixed environment variables are still supported but deprecated:

| Old Variable | New Variable (MM_ prefixed) |
|--------------|----------------------------|
| `DEFAULT_PLATFORM` | `MM_PLATFORM` |
| `GITHUB_TOKEN` | `MM_GITHUB_TOKEN` |
| `GITHUB_REPO_OWNER` | `MM_GITHUB_REPO_OWNER` |
| `GITHUB_REPO_NAME` | `MM_GITHUB_REPO_NAME` |
| `AZURE_DEVOPS_TOKEN` | `MM_AZURE_TOKEN` |
| `AZURE_DEVOPS_ORG` | `MM_AZURE_ORG` |
| `AZURE_DEVOPS_PROJECT` | `MM_AZURE_PROJECT` |
| `AZURE_DEVOPS_REPO` | `MM_AZURE_REPO` |
| `BOT_COMMENT_IDENTIFIER` | `MM_COMMENT_IDENTIFIER` |
| `AI_PROVIDER` | `MM_AI_PROVIDER` |
| `COPILOT_MODEL` | `MM_COPILOT_MODEL` |
| `COPILOT_TIMEOUT_MS` | `MM_COPILOT_TIMEOUT` |
| `OPENCODE_MODEL` | `MM_OPENCODE_MODEL` |
| `OPENCODE_TIMEOUT_MS` | `MM_OPENCODE_TIMEOUT` |
| `CURSOR_MODEL` | `MM_CURSOR_MODEL` |
| `CURSOR_TIMEOUT_MS` | `MM_CURSOR_TIMEOUT` |
| `OPENAI_API_KEY` | `MM_OPENAI_API_KEY` |
| `OPENAI_MODEL` | `MM_OPENAI_MODEL` |
| `OPENAI_TIMEOUT_MS` | `MM_OPENAI_TIMEOUT` |
| `OPENAI_BASE_URL` | `MM_OPENAI_BASE_URL` |
| `OPENAI_MAX_RETRIES` | `MM_OPENAI_MAX_RETRIES` |
| `MIN_COMMENT_CONFIDENCE` | `MM_MIN_COMMENT_CONFIDENCE` |
| `SKIP_PREEXISTING_ISSUES` | `MM_SKIP_EXISTING_ISSUES` |
| `POST_RESOLUTION_COMMENTS` | `MM_POST_RESOLUTION_COMMENTS` |
| `REVIEW_RUNS` | `MM_REVIEW_RUNS` |

**Note:** MM_ prefixed variables take precedence if both are set.

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

**Core Options:**
| Option | Description | Env Variable | Default |
|--------|-------------|--------------|---------|
| `--pr <number>` | Pull request number (required) | - | - |
| `--platform <github\|azure>` | Platform to use | `MM_PLATFORM` | `github` |
| `--provider <copilot\|opencode\|cursor\|openai>` | AI provider to use | `MM_AI_PROVIDER` | `copilot` |
| `--write` | Post comments (otherwise dry-run) | - | `false` |
| `--verbose` | Enable verbose output | - | `true` |
| `--runs <1-5>` | Number of review passes | `MM_REVIEW_RUNS` | `1` |

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
| `--copilot-model <model>` | Copilot model name | `MM_COPILOT_MODEL` |
| `--copilot-timeout <ms>` | Copilot timeout in ms | `MM_COPILOT_TIMEOUT` |
| `--opencode-model <model>` | OpenCode model name | `MM_OPENCODE_MODEL` |
| `--opencode-timeout <ms>` | OpenCode timeout in ms | `MM_OPENCODE_TIMEOUT` |
| `--cursor-model <model>` | Cursor model name | `MM_CURSOR_MODEL` |
| `--cursor-timeout <ms>` | Cursor timeout in ms | `MM_CURSOR_TIMEOUT` |
| `--openai-api-key <key>` | OpenAI API key | `MM_OPENAI_API_KEY` |
| `--openai-model <model>` | OpenAI model name (default: gpt-4o) | `MM_OPENAI_MODEL` |
| `--openai-timeout <ms>` | OpenAI timeout in ms | `MM_OPENAI_TIMEOUT` |
| `--openai-base-url <url>` | OpenAI base URL (for Azure Foundry) | `MM_OPENAI_BASE_URL` |
| `--openai-max-retries <n>` | OpenAI max retry attempts | `MM_OPENAI_MAX_RETRIES` |

**Comment Filtering:**
| Option | Description | Env Variable | Default |
|--------|-------------|--------------|---------|
| `--min-comment-confidence <level>` | Minimum confidence (high, medium, low) | `MM_MIN_COMMENT_CONFIDENCE` | `high` |
| `--skip-existing-issues <bool>` | Skip pre-existing issues (true/false) | `MM_SKIP_EXISTING_ISSUES` | `true` |
| `--post-resolution-comments <bool>` | Post resolution comments (true/false) | `MM_POST_RESOLUTION_COMMENTS` | `true` |
| `--comment-identifier <id>` | Bot comment identifier | `MM_COMMENT_IDENTIFIER` | `[merge-mentor]` |

**Note:** Command-line parameters always override environment variables.

## Key Features Explained

### Confidence-Based Filtering

Only high-confidence issues are posted by default to reduce noise:

```bash
export MM_MIN_COMMENT_CONFIDENCE=high  # high (default), medium, or low
# Or use CLI parameter:
merge-mentor review --pr 123 --min-comment-confidence medium
```

### Pre-Existing Issue Detection

Skips issues that existed before the PR:

```bash
export MM_SKIP_EXISTING_ISSUES=true  # default
# Or use CLI parameter:
merge-mentor review --pr 123 --skip-existing-issues true
```

### Auto-Resolution with Explanations

When code is fixed, the bot resolves comments with an explanation:

```bash
export MM_POST_RESOLUTION_COMMENTS=true  # default
# Or use CLI parameter:
merge-mentor review --pr 123 --post-resolution-comments true
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
          node-version: "22"

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
      versionSpec: "22.x"

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

Logs are written to timestamped files in `.merge-mentor/logs/merge-mentor_YYYY-MM-DD_HH-mm-ss.log` in your current directory. Each review run generates its own log file, preserving historical logs for debugging and audit purposes.

```bash
# View latest logs
ls -la .merge-mentor/logs/
tail -f .merge-mentor/logs/merge-mentor_*.log

# View specific run
tail -f .merge-mentor/logs/merge-mentor_2025-01-06_18-40-30.log

# Set log level
export LOG_LEVEL=debug  # debug, info, warn, error
```

## File Organization

merge-mentor creates several directories in your project root for different purposes:

```
.merge-mentor/
├── cache/                          # Review state caching
│   └── Github-myrepo-PR123.json     # Platform-aware cache files
├── diffs/                          # Temporary diff storage for batched reviews  
│   └── Azure-MyProject-PR456/       # Platform-aware diff directories
├── logs/                           # Timestamped log files
│   └── merge-mentor_2025-01-06_18-40-30.log
├── reports/                        # Dry-run markdown reports
│   └── Github-myrepo-PR123-review-report.md
└── temp/                           # Temporary files for large prompts
    └── prompt-abc123.txt             # Auto-cleaned after use
```

**Key improvements**:
- **Unique identifiers**: Cache and diff files use `{Platform}-{Project}-PR{Number}` format to prevent conflicts
- **Historical preservation**: Each run creates new timestamped log files instead of overwriting
- **Platform isolation**: Multiple platforms and projects can be used without file conflicts

## Troubleshooting

### Timeout errors
Increase timeout for large PRs:
```bash
export COPILOT_TIMEOUT_MS=300000  # 5 minutes (for Copilot)
export OPENCODE_TIMEOUT_MS=300000  # 5 minutes (for OpenCode)
export CURSOR_TIMEOUT_MS=300000  # 5 minutes (for Cursor)
export OPENAI_TIMEOUT_MS=300000  # 5 minutes (for OpenAI)
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
