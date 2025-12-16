# PR Bot - Automated Code Review Bot

An automated code review bot that leverages GitHub Copilot CLI to perform comprehensive code reviews on pull requests from GitHub and Azure DevOps repositories.

## Features

- **Multi-Platform Support**: Review PRs from both GitHub and Azure DevOps
- **Comprehensive Analysis**: Reviews code for quality, bugs, security, performance, and documentation
- **Inline Comments**: Posts specific feedback on exact lines of code
- **Summary Reports**: Generates detailed summary comments with statistics
- **Comment Management**: Updates/resolves existing bot comments as issues are addressed
- **Cross-File Analysis**: Identifies architectural and design issues across the PR

## Prerequisites

- Node.js 18+
- GitHub Copilot CLI installed and accessible in PATH
- Personal access tokens for GitHub and/or Azure DevOps

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd pr-bot

# Install dependencies
npm install

# Build the project
npm run build
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
# Review a GitHub PR (using default platform)
npm run review -- --pr 123

# Review a GitHub PR explicitly
npm run review -- --pr 123 --platform github

# Review an Azure DevOps PR
npm run review -- --pr 456 --platform azure

# Dry run (don't post comments)
npm run review -- --pr 123 --dry-run

# Quiet mode (minimal output)
npm run review -- --pr 123 --quiet
```

### Command Options

| Option | Description | Default |
|--------|-------------|---------|
| `--pr <number>` | Pull request number (required) | - |
| `--platform <github\|azure>` | Platform to use | From env or `github` |
| `--dry-run` | Run without posting comments | `false` |
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
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### Scripts

```bash
# Build the project
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Running Tests

```bash
npm test
```

## Error Handling

The bot handles various error scenarios:

- Invalid PR numbers or platform selection
- API authentication failures
- Network errors during API calls
- Copilot CLI not installed or accessible
- Malformed JSON responses from Copilot
- Rate limiting on API requests
- Permission errors when posting comments

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Review completed successfully (no critical issues) |
| 1 | Review completed with critical issues or error occurred |

## License

ISC
