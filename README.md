# PR Bot - Automated Code Review Bot

An automated code review bot that leverages GitHub Copilot CLI to perform comprehensive code reviews on pull requests from GitHub and Azure DevOps repositories.

## Features

- **Multi-Platform Support**: Review PRs from both GitHub and Azure DevOps
- **Comprehensive Analysis**: Reviews code for quality, bugs, security, performance, and documentation
- **Inline Comments**: Posts specific feedback on exact lines of code
- **Summary Reports**: Generates detailed summary comments with statistics
- **Comment Management**: Updates/resolves existing bot comments as issues are addressed
- **Cross-File Analysis**: Identifies architectural and design issues across the PR
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
cd pr-bot

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
BOT_COMMENT_IDENTIFIER=[AI Code Review Bot]
```

### GitHub Token Permissions

Your GitHub token needs the following scopes:
- `repo` - Full control of private repositories (or `public_repo` for public repos only)

### Azure DevOps Token Permissions

Your Azure DevOps PAT needs:
- Code: Read & Write
- Pull Request Threads: Read & Write

## Usage

### Review a Pull Request

```bash
# Dry-run mode (default) - shows what would be posted
pnpm review -- --pr 123

# Actually post comments to the PR
pnpm review -- --pr 123 --write

# Review an Azure DevOps PR
pnpm review -- --pr 456 --platform azure --write

# Quiet mode (minimal output)
pnpm review -- --pr 123 --quiet
```

### Command Options

| Option | Description | Default |
|--------|-------------|---------|
| `--pr <number>` | Pull request number (required) | - |
| `--platform <github\|azure>` | Platform to use | From env or `github` |
| `--write` | Post comments to PR (otherwise dry-run) | `false` |
| `--verbose` | Enable verbose output | `true` |
| `--quiet` | Disable verbose output | `false` |

## How It Works

1. **Initialization**: Authenticates with the selected platform API
2. **PR Retrieval**: Fetches PR metadata and changed files
3. **File-by-File Review**: Analyzes each file using Copilot CLI with specialized prompts
4. **Cross-File Analysis**: Performs holistic analysis of all changes together
5. **Comment Management**: Compares findings with existing bot comments
6. **Feedback Delivery**: Posts inline comments and a summary report

## Review Categories

The bot analyzes code for:

- **Bug**: Potential bugs or logical errors
- **Security**: Security vulnerabilities
- **Performance**: Performance issues or inefficiencies
- **Quality**: Code quality and readability concerns
- **Documentation**: Missing or inadequate documentation

## Severity Levels

| Level | Emoji | Description |
|-------|-------|-------------|
| Critical | 🔴 | Severe issues that must be fixed |
| High | 🟠 | Important issues that should be addressed |
| Medium | 🟡 | Moderate concerns worth reviewing |
| Low | 🟢 | Minor suggestions for improvement |

## Development

### Project Structure

```
pr-bot/
├── src/
│   ├── cli.ts              # Command-line interface
│   ├── config.ts           # Configuration management
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
│       └── commentManager.ts # Comment lifecycle management
├── tests/                  # Unit tests
├── .env.example           # Example environment configuration
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
```

## Error Handling

The bot uses specific error types for different failure scenarios:

- `ConfigurationError` - Missing or invalid configuration
- `CopilotCliError` - Copilot CLI failures or unavailability
- `JsonParseError` - Malformed JSON responses from Copilot
- `ValidationError` - Invalid input parameters

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Review completed successfully (no critical issues) |
| 1 | Review completed with critical issues or error occurred |

## License

ISC
