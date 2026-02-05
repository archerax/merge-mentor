# Changelog

All notable changes to merge-mentor will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed
- **BREAKING**: Removed OpenAI API provider support
  - Removed `--provider openai` option and all OpenAI-specific CLI options
  - Removed `openai` npm dependency and SDK-based provider implementation
  - OpenAI provider was architecturally incompatible with local repository cloning approach
  - CLI-based providers (Copilot, OpenCode, Cursor) can now read local files directly
  - Simplified codebase by focusing on CLI-based providers only

## [1.12.0] - 2026-01-30

### Added
- **Streaming Output Display**: Real-time feedback showing the last 5 lines of AI model output during reviews
  - New `--no-stream` flag to disable streaming output
  - New `--stream-lines <n>` option to configure number of lines (1-20)
  - Environment variables `MM_STREAMING_ENABLED` and `MM_STREAMING_LINES` for configuration
  - Auto-disables in non-TTY environments (CI/CD pipelines, piped output)

## [1.11.0] - 2026-01-14

### Removed
- **BREAKING**: Removed file-by-file review mode (now uses batched review exclusively)
  - Removed `buildFileReviewPrompt` function from prompts
  - Removed `formatFileCommentsContext` function from comment context
  - All reviews now use batched mode for better performance and consistency
- **BREAKING**: Removed backward compatibility for old environment variable names
  - Must now use `MM_` prefix for all environment variables
  - Removed support for unprefixed variables (e.g., `GITHUB_TOKEN`, `DEFAULT_PLATFORM`, `AZURE_DEVOPS_*`)
  - Updated all documentation to reflect MM_ prefixed variables only

### Changed
- Simplified configuration by requiring MM_ prefix for all environment variables
- Updated tests to use only MM_ prefixed environment variables
- Cleaned up integration tests by removing deprecated feature tests

## [1.10.0] - 2026-01-12

### Added

- **Chain of Thought (CoT) Reasoning** - AI prompts now instruct models to perform a step-by-step analysis of code changes before outputting structured results. This "thinking" phase improves review quality by reducing false positives and encouraging deeper architectural consideration.
- **Robust Markdown JSON Parsing** - Enhanced the AI response parser to prioritize extracting JSON from markdown code blocks (\`\`\`json ... \`\`\`). This enables a seamless mix of free-text analysis and structured findings, providing better support for advanced "reasoning" models.

## [1.9.0] - 2026-01-11

### Added

- **Token usage tracking** - Captures and logs detailed token usage statistics from AI provider executions. When using GitHub Copilot CLI, the audit logs now include:
  - Input tokens consumed
  - Output tokens generated
  - Cached tokens read (reduces costs)
  - Premium API requests count
  - Model used for the request
  - API processing time
  - Total wall-clock time
  This data helps track AI costs, identify optimization opportunities, and monitor performance across review runs.
- **MM_ environment variable prefix** - All environment variables now use the `MM_` prefix to avoid conflicts with other applications (e.g., `MM_GITHUB_TOKEN` instead of `GITHUB_TOKEN`). Old unprefixed variables are still supported for backward compatibility but are deprecated.
- **Comprehensive CLI parameters** - Every environment variable now has a corresponding command-line parameter (e.g., `--github-token`, `--azure-token`, `--copilot-model`). CLI parameters always override environment variables.
- **CLI parameter documentation** - All CLI help text now shows the corresponding environment variable name for each parameter.

### Changed

- **Environment variable naming** - Standardized all variable names with `MM_` prefix:
  - `DEFAULT_PLATFORM` → `MM_PLATFORM`
  - `GITHUB_TOKEN` → `MM_GITHUB_TOKEN`
  - `AZURE_DEVOPS_*` → `MM_AZURE_*` (simplified naming)
  - `BOT_COMMENT_IDENTIFIER` → `MM_COMMENT_IDENTIFIER`
  - `*_TIMEOUT_MS` → `MM_*_TIMEOUT` (removed _MS suffix for consistency)
  - `SKIP_PREEXISTING_ISSUES` → `MM_SKIP_EXISTING_ISSUES` (improved clarity)
  - And more (see README for complete mapping)

### Deprecated

- **Old environment variable names** - All unprefixed environment variables (e.g., `GITHUB_TOKEN`, `AZURE_DEVOPS_TOKEN`) are deprecated in favor of `MM_` prefixed versions. Old names still work for backward compatibility.

### Fixed

- **Comment line number accuracy** - Enhanced AI prompts with explicit, step-by-step instructions on how to calculate line numbers from git diffs. Includes concrete examples showing how to parse hunk headers (e.g., `@@ -80,5 +155,7 @@`) and count through diff lines correctly. This significantly reduces instances where comments are placed on incorrect line numbers (e.g., line 83 instead of line 158).
- **Azure DevOps diff accuracy** - Fixed issue where diffs were not being correctly parsed or displayed on Azure DevOps. Diffs are now properly formatted and aligned with line numbers, ensuring accurate code review feedback.

## [1.8.0] - 2026-01-06

### Added

- **Per-run log files** - Each review run now generates a unique timestamped log file (e.g., `merge-mentor_2025-01-06_18-40-30.log`) instead of overwriting a single log file. This preserves historical logs and makes debugging easier.
- **Unique PR identifiers** - Cache files, diff storage, and reports now use platform-aware unique identifiers (e.g., `Github-myrepo-PR123`, `Azure-MyProject-PR456`) instead of just PR numbers. This prevents conflicts when working with multiple platforms or projects.
- **Enhanced syntax tolerance** - AI prompts now explicitly instruct models not to flag syntax or compilation issues, assuming all code is valid. This reduces false positives for newer language features the model may not recognize.
- **Detailed markdown reports in dry-run mode** - Dry runs now automatically generate comprehensive markdown reports saved to `.merge-mentor/reports/{platform}-{project}-PR{number}-review-report.md`. Reports include PR metadata, issue summaries by severity/category with visual indicators, detailed file-specific findings, cross-file analysis, overall assessment, and recommendations. Perfect for viewing all issues when console output is too limited.
- **Batched file review mode** - Major performance improvement for large PRs. Instead of making one AI call per file (50-300 calls for large PRs), the tool now stores all diffs to disk and makes a single batched AI call to review all files at once. This reduces review time from potentially hours to minutes for large PRs.

### Changed

- **Debug output moved to logs** - All debug messages (diff processing, JSON parsing, file copying, etc.) are now written to log files instead of cluttering console output. Console output is now clean and focused on user-relevant information.
- **Stronger focus on changed lines** - AI prompts now emphasize more strongly that only NEW issues introduced in added/modified lines should be flagged, not pre-existing code issues.
- **File organization** - Cache files now use unique identifiers: `.merge-mentor/cache/Github-myrepo-PR123.json` instead of `pr-123.json`. Diff storage similarly uses unique directory names.
- **Review architecture** - File reviews now use a batched approach:
  1. Diffs are stored to `.merge-mentor/diffs/{platform}-{project}-PR{number}/` directory
  2. A single AI call reviews all files using `@filename` syntax to read diff files
  3. Cross-file analysis remains a separate call
  4. Total AI calls reduced from N+1 (per file + cross-file) to 2 (batched + cross-file)

### Fixed

- **Azure DevOps large PR support** - Fixed "Invalid number of file diffs requested" error when reviewing PRs with more than 10 files. The Azure DevOps API limits `getFileDiffs` to 10 files per request, so file diffs are now automatically batched in groups of 10. PRs with any number of files are now supported.

- **Copilot CLI argument length limit** - Large prompts now use temporary files with `@filename` syntax instead of passing the entire prompt as a CLI argument. This prevents failures when reviewing PRs with large diffs or many existing comments. Temp files are automatically created in `.merge-mentor/temp/` and cleaned up after execution. The `--allow-all-tools` flag is used to allow Copilot to read the temp files.

## [1.6.0] - 2025-12-30

### Added

- **Multi-AI provider support**: Select your preferred AI provider for reviews. Supports GitHub Copilot CLI (default), OpenCode CLI, and Cursor CLI. Set the provider via the `--provider` flag or the `AI_PROVIDER` environment variable.

- **Cursor CLI provider**: New AI provider option using Cursor's AI capabilities. Configure with `--provider cursor` or `export AI_PROVIDER=cursor`. Supports model selection via `CURSOR_MODEL` environment variable.

- **OpenCode CLI provider**: Alternative AI provider using OpenCode CLI. Configure with `--provider opencode` or `export AI_PROVIDER=opencode`. Supports model selection via `OPENCODE_MODEL` environment variable.

### Changed

- CLI description updated to reflect multi-provider support
- No breaking changes for existing users; defaults to Copilot CLI

### Migration

Existing configurations work without changes (defaults to Copilot CLI). To use alternative providers:

```bash
# Use OpenCode CLI
export AI_PROVIDER=opencode
export OPENCODE_MODEL=claude-sonnet-4.5
merge-mentor review --pr 123 --write

# Use Cursor CLI
export AI_PROVIDER=cursor
export CURSOR_MODEL=gpt-5
merge-mentor review --pr 123 --write

# Or via CLI flag (overrides environment variable)
merge-mentor review --pr 123 --provider cursor --write
```

## [1.5.0] - 2025-12-27

### Added

- **Windows and macOS compatibility**: Full cross-platform support for Windows, macOS, and Linux. Build scripts now use `cross-env` for environment variable handling, and command execution explicitly avoids shell-specific syntax. Documentation includes platform-specific configuration examples.

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
