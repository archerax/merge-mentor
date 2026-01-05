# Automated Code Review Bot - Project Specification

## Overview

An automated code review bot that leverages GitHub Copilot CLI to perform comprehensive code reviews on pull requests from GitHub and Azure DevOps repositories. The bot provides inline comments, general feedback, and summary reports directly on PRs.

## MVP Scope

A command-line tool that can be run manually from a development machine to review specified pull requests.

## Tech Stack

- **Runtime**: Node.js
- **Language**: TypeScript
- **Key Dependencies**:
  - `@octokit/rest` - GitHub API client
  - `azure-devops-node-api` - Azure DevOps API client
  - `commander` - CLI argument parsing
  - `dotenv` - Environment variable management
  - `child_process` - Execute Copilot CLI commands

## Features

### 1. Multi-Platform PR Support

- Review pull requests from GitHub repositories
- Review pull requests from Azure DevOps repositories
- Single unified interface for both platforms

### 2. Comprehensive Code Review

The bot analyzes code for:

- Code quality and readability
- Adherence to coding standards
- Potential bugs or logical errors
- Performance considerations
- Security vulnerabilities
- Test coverage and adequacy
- Documentation and comments
- Overall design and architecture

### 3. GitHub Copilot CLI Integration

- Executes Copilot CLI with custom prompts
- Uses file-by-file review strategy with final cross-file summary pass
- Parses JSON output from Copilot responses
- Captures and processes console output

### 4. Intelligent Feedback Delivery

- Posts inline comments on specific lines of code when issues are identified
- Posts general comments when specific lines cannot be pinpointed
- Creates a comprehensive summary comment at the end of the review
- Updates existing bot comments on subsequent runs if still relevant
- Closes/resolves comments that have been addressed

## Architecture

### Command-Line Interface

```bash
npm run review -- --pr <PR_NUMBER> [--platform <github|azure>]
```

### Configuration (.env)

```
# Platform Selection (default)
DEFAULT_PLATFORM=github

# GitHub Configuration
GITHUB_TOKEN=<personal_access_token>
GITHUB_REPO_OWNER=<username_or_org>
GITHUB_REPO_NAME=<repository_name>

# Azure DevOps Configuration
AZURE_DEVOPS_TOKEN=<personal_access_token>
AZURE_DEVOPS_ORG=<organization_name>
AZURE_DEVOPS_PROJECT=<project_name>
AZURE_DEVOPS_REPO=<repository_name>

# Bot Configuration
BOT_COMMENT_IDENTIFIER=[merge-mentor]
```

### Core Components

#### 1. CLI Handler (`src/cli.ts`)

- Parses command-line arguments using Commander
- Validates inputs
- Orchestrates the review process
- Displays progress and results

#### 2. Platform Adapters

##### GitHub Adapter (`src/platforms/github.ts`)

- Fetches PR details and diff
- Posts inline and general comments
- Creates summary comment
- Manages existing bot comments
- Updates/resolves comments as needed

##### Azure DevOps Adapter (`src/platforms/azure.ts`)

- Fetches PR details and diff
- Posts threads with comments
- Creates summary comment
- Manages existing bot threads
- Updates/resolves threads as needed

#### 3. AI Provider Integration (`src/ai/providers/`)

- Executes AI provider CLI commands via child_process
- Manages custom prompts for different review aspects
- Parses JSON responses from CLI output
- Handles errors and retries
- Supports multiple providers (Copilot, OpenCode, Cursor)

#### 4. Review Engine (`src/review/engine.ts`)

- Coordinates the review workflow
- Implements file-by-file review strategy
- Performs final cross-file summary analysis
- Aggregates results from Copilot
- Maps findings to specific lines/files

#### 5. Comment Manager (`src/review/commentManager.ts`)

- Tracks existing bot comments
- Determines which comments to update, close, or create
- Ensures comments are properly attributed to the bot
- Handles comment threading and replies

### Review Workflow

1. **Initialization**
   - Parse CLI arguments (PR number, optional platform)
   - Load environment configuration
   - Authenticate with selected platform API

2. **PR Data Retrieval**
   - Fetch PR metadata (title, description, author)
   - Retrieve PR diff/changes
   - Get list of changed files
   - Fetch existing bot comments

3. **File-by-File Review**
   - For each changed file:
     - Extract file diff
     - Generate file-specific Copilot prompt
     - Execute Copilot CLI: `copilot -p "<prompt>"`
     - Parse JSON output
     - Map findings to line numbers

4. **Cross-File Analysis**
   - Generate summary of all changes
   - Create cross-file review prompt
   - Execute Copilot CLI for holistic analysis
   - Identify architectural or design issues

5. **Comment Management**
   - Compare new findings with existing bot comments
   - Update comments that are still relevant
   - Close/resolve comments for fixed issues
   - Create new comments for new findings

6. **Feedback Delivery**
   - Post inline comments on specific lines
   - Post general comments when line can't be determined
   - Create comprehensive summary comment with:
     - Overall assessment
     - Key findings by category
     - Statistics (files reviewed, issues found)
     - Recommendations

7. **Completion**
   - Display summary in terminal
   - Exit with appropriate status code

### Copilot Prompt Structure

#### File Review Prompt Template

```
You are an expert code reviewer. Analyze the following code changes and provide a detailed review.

FILE: {filename}
DIFF:
{file_diff}

Review the code for:
- Code quality and readability
- Adherence to coding standards
- Potential bugs or logical errors
- Performance considerations
- Security vulnerabilities
- Test coverage and adequacy
- Documentation and comments

Respond ONLY with valid JSON in this exact format:
{
  "findings": [
    {
      "line": <line_number>,
      "severity": "critical|high|medium|low",
      "category": "bug|security|performance|quality|documentation",
      "message": "Description of the issue",
      "suggestion": "Recommended fix or improvement"
    }
  ]
}

If there are no issues, return: {"findings": []}
```

#### Cross-File Summary Prompt Template

```
You are an expert code reviewer performing a holistic analysis of a pull request.

PR TITLE: {pr_title}
PR DESCRIPTION: {pr_description}

CHANGED FILES SUMMARY:
{files_summary}

Analyze the overall changes for:
- Design and architectural issues
- Cross-file dependencies and coupling
- Missing tests or documentation
- Overall code organization

Respond ONLY with valid JSON in this exact format:
{
  "overall_assessment": "Summary of the PR quality",
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "category": "architecture|design|testing|documentation",
      "message": "Description of the issue",
      "affected_files": ["file1.ts", "file2.ts"]
    }
  ],
  "recommendations": ["Recommendation 1", "Recommendation 2"]
}
```

### Error Handling

- Invalid PR numbers or platform selection
- API authentication failures
- Network errors during API calls
- Copilot CLI not installed or accessible
- Malformed JSON responses from Copilot
- Rate limiting on API requests
- Permission errors when posting comments

### Future Enhancements (Post-MVP)

- Webhook integration for automatic reviews
- Configuration file for custom review criteria
- Support for GitLab and Bitbucket
- Parallel file processing
- Review caching to avoid re-reviewing unchanged files
- Custom rule sets and severity thresholds
- Integration with CI/CD pipelines
- Web dashboard for review history
- Team-specific review profiles

## Development Phases

### Phase 1: Foundation (Week 1)

- Project setup with TypeScript and dependencies
- CLI interface with Commander
- Environment configuration with dotenv
- Basic platform adapter interfaces

### Phase 2: Platform Integration (Week 2)

- GitHub API integration (fetch PR, post comments)
- Azure DevOps API integration (fetch PR, post comments)
- Comment management system

### Phase 3: Copilot Integration (Week 3)

- Copilot CLI execution wrapper
- Prompt template system
- JSON response parsing
- Error handling and retries

### Phase 4: Review Engine (Week 4)

- File-by-file review workflow
- Cross-file analysis
- Finding aggregation and deduplication
- Comment update/close logic

### Phase 5: Testing & Polish (Week 5)

- Unit tests for core components
- Integration tests with mock APIs
- End-to-end testing with real PRs
- Documentation and README
- Error handling improvements

## Success Criteria

- Successfully reviews PRs from both GitHub and Azure DevOps
- Provides actionable inline comments with line numbers
- Generates comprehensive summary reports
- Properly manages comment lifecycle (create/update/close)
- Handles errors gracefully with helpful messages
- Executes in under 5 minutes for PRs with <50 files
- JSON parsing success rate >95%

## Constraints & Assumptions

- GitHub Copilot CLI is installed and accessible in PATH
- User has valid tokens for GitHub and/or Azure DevOps
- Node.js version 18+ is available
- PRs are text-based code changes (not binary files)
- Copilot CLI supports custom prompts and JSON output
- User's machine has internet connectivity for API calls
