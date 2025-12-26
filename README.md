# merge-mentor

Automated code review bot powered by GitHub Copilot CLI. Analyzes pull requests and provides intelligent feedback on code quality, security, performance, and best practices.

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

# Or use npx (no installation required)
npx merge-mentor review --pr 123
```

## Features

- **Multi-Platform Support** - Works with GitHub and Azure DevOps
- **Intelligent Analysis** - Reviews for bugs, security, performance, quality, and documentation
- **Inline Comments** - Posts feedback on specific lines of code
- **Smart Deduplication** - Avoids flagging the same issue multiple times
- **Incremental Reviews** - Only analyzes changed files to save time
- **Multi-Run Mode** - Aggregate findings from multiple passes for thoroughness
- **Confidence Filtering** - Only posts high-confidence issues by default
- **Auto-Resolution** - Detects when issues are fixed and resolves comments
- **Dry-Run Mode** - Preview changes before posting (default)

## Prerequisites

- **Node.js 20+**
- **GitHub Copilot CLI** - Must be installed and accessible in PATH
  ```bash
  # Install Copilot CLI
  npm install -g @githubnext/github-copilot-cli
  ```
- **Platform Access** - Personal access token for GitHub or Azure DevOps

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

```bash
export GITHUB_TOKEN=your_personal_access_token
export GITHUB_REPO_OWNER=username_or_org
export GITHUB_REPO_NAME=repository_name
export DEFAULT_PLATFORM=github
```

### Azure DevOps Configuration

```bash
export AZURE_DEVOPS_TOKEN=your_pat
export AZURE_DEVOPS_ORG=organization_name
export AZURE_DEVOPS_PROJECT=project_name
export AZURE_DEVOPS_REPO=repository_name
export DEFAULT_PLATFORM=azure
```

### Optional Settings

```bash
# Copilot model selection
export COPILOT_MODEL=gpt-4o

# Timeout for Copilot CLI operations (milliseconds)
export COPILOT_TIMEOUT_MS=180000

# Comment filtering
export MIN_COMMENT_CONFIDENCE=high  # high, medium, or low
export SKIP_PREEXISTING_ISSUES=true
export POST_RESOLUTION_COMMENTS=true

# Multi-run mode
export REVIEW_RUNS=1  # 1-5 runs

# Logging
export LOG_LEVEL=info  # debug, info, warn, or error
```

### Token Permissions

**GitHub Token**:
- `repo` scope (full control of private repositories)
- Or `public_repo` for public repositories only

**Azure DevOps PAT**:
- Code: Read & Write
- Pull Request Threads: Read & Write

### Available Models

Configure via `COPILOT_MODEL` environment variable. If not set, uses Copilot CLI default.

Supported models:
- `gpt-4o` (recommended)
- `gpt-4-turbo`
- `gpt-4`
- `claude-3.5-sonnet`
- `claude-3-opus`
- `o1-preview`
- `o1-mini`

Check Copilot CLI documentation for the latest available models.

## Usage

Run merge-mentor from within a checked-out repository (Copilot CLI needs access to files):

```bash
# Dry-run mode (preview only)
merge-mentor review --pr 123

# Post comments to PR
merge-mentor review --pr 123 --write

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
| `--write` | Post comments (otherwise dry-run) | `false` |
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

**Important**: Check out the repository before running (Copilot CLI needs file access).

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
      - uses: actions/checkout@v4
      
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
  - checkout: self
  
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

### Repository not accessible
Ensure you're running from within a checked-out repository:
- **GitHub Actions**: Add `uses: actions/checkout@v4`
- **Azure Pipelines**: Add `checkout: self`
- **Local**: Run from repository directory

### Timeout errors
Increase timeout for large PRs:
```bash
export COPILOT_TIMEOUT_MS=300000  # 5 minutes
```

### Exit Codes
- `0` - Success or configuration issue
- `1` - Review failed or critical issues found

## License

Proprietary software. See [LICENSE](./LICENSE) for details.

---

**Version**: 1.4.0  
**Author**: archerax  
**Documentation**: Included in npm package
