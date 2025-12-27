# Changelog

All notable changes to merge-mentor will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Comprehensive audit logging for security and compliance**: All critical bot actions are now logged with structured data, including PR operations, comment actions, AI executions, and review lifecycle events. Audit logs are written to `.merge-mentor/logs/merge-mentor.log` in JSON format for easy parsing and analysis. Enabled by default for enterprise compliance requirements.

## [1.4.0] - 2025-12-25

### Added

- **Smarter comment resolution**: The AI now explains why issues are resolved instead of just marking them as fixed. When you update code to address feedback, the bot automatically detects the fix and posts a comment explaining what changed (e.g., "Null check was added to handle edge case").

- **Duplicate prevention**: No more seeing the same comment twice. The bot now remembers what it's already flagged and won't repeat itself when you re-run reviews or use multi-run mode.

- **Improved multi-run focus**: When using `--runs` mode, each review pass builds on previous findings, focusing on new issues instead of repeating the same feedback.

### Fixed

- Eliminated duplicate comments when running reviews multiple times on the same PR
- Eliminated duplicate comments when using `--runs` mode
- Resolution comments now provide meaningful explanations instead of generic messages

## [1.3.0] - 2025-12-25

### Added

- **Multi-run mode**: Catch more issues by running multiple review passes and automatically combining unique findings. Use `--runs 3` for critical code reviews or `--runs 5` for security-sensitive changes. The bot automatically removes duplicates and keeps the highest-confidence findings.

- **More thorough analysis**: Enhanced AI prompts now systematically check for logic errors, security vulnerabilities, performance issues, and code quality across multiple passes in a single run.

### Usage

```bash
# Run 3 review passes for important PRs
merge-mentor review --pr 123 --runs 3 --write

# Or set a default in your environment
export REVIEW_RUNS=3
```

## [1.2.0] - 2025-12-24

### Added

- **Confidence filtering**: Only high-confidence issues are posted by default, reducing noise in your reviews. Each comment shows its confidence level with an emoji indicator (🟢 High, 🟡 Medium, 🔴 Low).

- **Skip pre-existing issues**: The bot now detects problems that existed before your PR and ignores them, so you only see feedback on your actual changes.

- **Resolution explanations**: When issues are fixed, the bot posts a comment explaining what was resolved before closing the thread.

### Configuration

Control filtering behavior with environment variables:

```bash
# Only post high-confidence issues (default)
export MIN_COMMENT_CONFIDENCE=high

# Skip issues that existed before the PR (default: true)
export SKIP_PREEXISTING_ISSUES=true

# Post explanations when resolving (default: true)
export POST_RESOLUTION_COMMENTS=true
```

### Fixed

- Duplicate comments no longer appear when re-running reviews on unchanged code

## [1.1.0] - 2025-12-24

### Added

- **Global installation support**: Use merge-mentor anywhere with `npm install -g merge-mentor` or run instantly with `npx merge-mentor`. Configuration and logs now use your current directory instead of the installation location.

### Changed

- **Breaking**: `.env` configuration file must be in your current working directory, not the installation directory
- **Breaking**: Logs are now written to `.merge-mentor/logs/` in your current directory

### Migration

If you have an existing `.env` file in the package directory, move it to your project root:

```bash
mv /path/to/global/merge-mentor/.env ./
```

## [1.0.0] - 2025-12-24

### Initial Release

Welcome to merge-mentor, your automated code review assistant powered by GitHub Copilot CLI.

### What's Included

**Platform Support**
- GitHub pull requests
- Azure DevOps pull requests

**Review Features**
- Intelligent code analysis for bugs, security issues, performance problems, code quality, and documentation
- Inline comments on specific lines of code
- Summary reports with review statistics
- Cross-file architectural analysis
- Automatic comment resolution when issues are fixed
- Dry-run mode for previewing changes before posting

**Smart Optimization**
- Incremental caching: Only reviews changed files on subsequent runs (85% faster)
- Rate limit handling with automatic retry
- Configurable AI model selection (GPT-4, Claude, etc.)
- Timeout controls for large PRs

**Review Categories**
- 🐛 **Bugs**: Logic errors and potential crashes
- 🔒 **Security**: Vulnerabilities and security risks
- ⚡ **Performance**: Inefficiencies and optimization opportunities
- 📝 **Quality**: Code readability and maintainability
- 📖 **Documentation**: Missing or unclear documentation

**Severity Levels**
- 🔴 **Critical**: Must be fixed before merge
- 🟠 **High**: Should be addressed soon
- 🟡 **Medium**: Worth reviewing
- 🟢 **Low**: Minor suggestions

**Easy Integration**
- Global CLI tool: `npm install -g merge-mentor`
- Instant run: `npx merge-mentor review --pr 123`
- CI/CD ready with GitHub Actions and Azure Pipelines examples
- Environment-based configuration

**Getting Started**

```bash
# Install globally
npm install -g merge-mentor

# Configure (one-time setup)
export GITHUB_TOKEN=your_token
export GITHUB_REPO_OWNER=your_username
export GITHUB_REPO_NAME=your_repo

# Review a PR (dry-run)
merge-mentor review --pr 123

# Post comments
merge-mentor review --pr 123 --write
```

See the README for complete setup and configuration instructions.
