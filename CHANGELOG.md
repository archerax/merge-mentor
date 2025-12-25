# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2025-12-25

### Added

- **Model-based comment resolution**: The AI model now identifies when existing issues have been fixed
  - During file review, model evaluates each existing comment against current code
  - Returns `resolved_comments` array with line number and explanation of why issue is resolved
  - Resolution comments include the model's explanation (e.g., "Null check was added")
  - Falls back to presence-based resolution for comments not explicitly evaluated
- **Intelligent comment deduplication**: LLM now receives context about existing comments to avoid duplicate findings
  - New `commentContext.ts` module for formatting existing comments for LLM consumption
  - Existing comments are summarized by file, line, category, and issue description
  - LLM is explicitly instructed to avoid re-flagging already-identified issues
  - Dramatically reduces duplicate comments in re-reviews and multi-run mode
- **Multi-run context accumulation**: In `--runs` mode, each subsequent run receives findings from previous runs as context
  - Enables progressive focus on new issues not found in earlier runs
  - Improves efficiency and reduces redundancy across multiple passes
- **Synthetic comment generation**: Internal helper to convert findings into comment format for multi-run context

### Changed

- `FileReviewResult` now includes optional `resolvedComments` field
- New `ResolvedComment` interface added to `platforms/types.ts`
- `CopilotClient.parseFileReview()` now parses `resolved_comments` from model response
- `CommentManager.determineActions()` prioritizes model-identified resolutions
- File review prompt updated to include resolved comment detection instructions
- `FindingAggregator` now aggregates resolved comments across multi-run mode
- `buildFileReviewPrompt()` now accepts optional `existingCommentsContext` parameter
- `buildCrossFilePrompt()` now accepts optional `existingCommentsContext` parameter
- `ReviewEngine.reviewFiles()` now accepts `existingComments` parameter
- `ReviewEngine.reviewFile()` now accepts `existingComments` parameter and formats file-specific comment context
- `ReviewEngine.performCrossFileAnalysis()` now accepts `existingComments` parameter
- `ReviewEngine.reviewPRMultiRun()` now accepts `existingComments` and accumulates context across runs
- Prompts updated to include existing comment context section with deduplication instructions

### Fixed

- Reduced duplicate comments when running the same PR review multiple times
- Reduced duplicate comments when using `--runs` mode with multiple review passes
- Improved focus in multi-run mode by providing cumulative context to subsequent runs
- Resolution comments now include meaningful explanations instead of generic messages

### Technical Details

- Model returns `resolved_comments` array with `{line, reason}` objects
- Resolution reason used in the resolution comment posted before marking as resolved
- Comment context limited to inline comments (summary comments excluded)
- Issue summaries truncated to 80 characters for concise context
- Resolved status included in context to inform LLM of historical issues
- Synthetic comments use negative IDs to distinguish from real comments
- Fingerprint-based deduplication maintained as fallback safety net

## [1.3.0] - 2025-12-25

### Added

- **Multi-run review mode**: Run reviews multiple times and aggregate unique findings for increased thoroughness
  - New `--runs <number>` CLI option (1-5 runs)
  - New `REVIEW_RUNS` environment variable for default configuration
  - Automatic deduplication of findings across runs
  - Findings with highest confidence are preserved when duplicates found
- **Finding aggregator**: New `FindingAggregator` class for deduplicating and merging findings
  - Fingerprint-based deduplication (file + line + category + message prefix)
  - Cross-file finding aggregation with recommendation merging
- **Enhanced prompts for comprehensiveness**:
  - Added "multiple mental passes" instruction (logic → security → performance → quality)
  - Added systematic edge case consideration
  - Added "GOAL: Find ALL substantive issues" emphasis
  - Added systematic analysis checklist for cross-file reviews
- **CONSISTENCY.md**: New documentation explaining LLM non-determinism and mitigation strategies
- **Understanding Review Variance** section in README.md

### Changed

- `ReviewEngineOptions` now accepts `reviewRuns` parameter
- `Config` interface now includes `reviewRuns` field
- Updated prompts in `src/copilot/prompts.ts` for comprehensive single-run analysis
- `.env.example` now includes `REVIEW_RUNS` configuration

### Technical Details

- Multi-run mode includes 2-second delay between runs to respect rate limits
- Partial failures are handled gracefully (remaining runs continue)
- Multi-run mode bypasses incremental caching to ensure fresh analysis each run

## [1.2.0] - 2025-12-24

### Added

- **Confidence-based comment filtering**: AI now provides confidence scores (`high`, `medium`, `low`) for each finding
- **Pre-existing issue detection**: AI detects if issues existed before the PR and skips them by default
- **Resolution comments**: When resolving comments, a message is posted explaining the issue was fixed
- New environment variables:
  - `MIN_COMMENT_CONFIDENCE`: Set minimum confidence level for posting comments (default: `high`)
  - `SKIP_PREEXISTING_ISSUES`: Skip issues that existed before the PR (default: `true`)
  - `POST_RESOLUTION_COMMENTS`: Post explanation before resolving comments (default: `true`)
- Confidence level displayed in comment formatting with emoji indicator (🟢 High, 🟡 Medium, 🔴 Low)
- New `FileFinding` fields: `confidence` and `isPreExisting`
- New `CommentAction` field: `resolutionReason`
- 15 new unit tests for confidence filtering and duplicate prevention functionality
- 3 new integration tests for confidence filtering workflows

### Changed

- Updated Copilot prompts to request confidence scores and pre-existing issue detection
- Comment matching now case-insensitive for category comparison
- `CommentManager` now accepts configuration options for filtering behavior
- `ReviewEngine` passes filter configuration to `CommentManager`
- Default behavior is now more conservative (only high-confidence new issues are posted)
- **Improved comment matching**: Comments now include unique identifiers to prevent duplicate comments when running reviews multiple times

### Fixed

- Comment matching failed when category names had different casing
- **Duplicate comments created when running review twice with no changes**: Comments now include stable identifiers (hidden HTML comments) that survive content modifications, ensuring reliable matching across multiple review runs

## [1.1.0] - 2025-12-24

### Added

- **Global tool support**: Can now be used as a global CLI tool via `npx merge-mentor` or `npm install -g merge-mentor`
- Configuration file (`.env`) is now loaded from current working directory instead of package installation directory
- Log files are now written to current working directory (`.merge-mentor/logs/`) instead of package installation directory
- Enhanced documentation with global installation and usage examples
- Added `preferGlobal` flag to package.json

### Changed

- **Breaking**: `.env` file must be in the current working directory where the command is run, not in the package directory
- **Breaking**: Log files are written to `<current-dir>/.merge-mentor/logs/` instead of `<package-dir>/.merge-mentor/logs/`
- Updated documentation to prioritize global installation method
- Updated CI/CD examples to show both npx and local installation approaches

### Fixed

- Configuration loading now works correctly when installed globally
- Logger now writes to user's project directory instead of global installation directory

## [1.0.0] - 2025-12-24

### Added

- Initial production release
- Multi-platform support (GitHub and Azure DevOps)
- Comprehensive code review using GitHub Copilot CLI
- Inline comments with line-specific feedback
- Summary reports with statistics
- Comment lifecycle management (create, update, resolve)
- Cross-file analysis for architectural issues
- Incremental review caching (SHA-based)
- Rate limit handling with exponential backoff
- Structured logging with Pino
- Diff-aware line validation
- Rich markdown formatting with emojis
- CI/CD pipeline with GitHub Actions
- CodeQL security scanning
- Comprehensive test suite (315 tests: 261 unit + 54 integration)
- 94%+ code coverage
- TypeScript strict mode
- Dry-run mode (default)
- Verbose logging option
- Environment-based configuration
- Custom error types with context
- Retry logic for transient failures
- Documentation (README, SPEC, DEBUGGING, AGENTS)

### Features

#### Review Engine
- File-by-file review with caching
- Cross-file architectural analysis
- Skip patterns for binary/generated files
- Configurable Copilot model and timeout
- Finding categorization (bug, security, performance, quality, documentation)
- Severity levels (critical, high, medium, low)

#### Platform Adapters
- GitHub API integration with Octokit
- Azure DevOps API integration
- Unified platform interface
- Comment posting and updating
- Thread management
- Review resolution

#### Copilot Integration
- CLI wrapper with process management
- Custom prompt templates
- JSON response parsing
- Error handling and validation
- Configurable model selection
- Timeout management

#### Caching System
- SHA-based file change detection
- Per-PR state persistence
- Cross-file analysis caching
- Automatic cache directory creation
- Gitignored cache storage

#### Logging
- Pino structured logging
- JSON format for production
- Pretty-printed for development
- Component-level child loggers
- File output with rotation
- Configurable log levels

#### CI/CD
- Multi-node matrix testing (Node 18, 20, 22)
- Type checking
- Linting with Biome
- Format checking
- Unit and integration tests
- Code coverage with Codecov
- Security audit
- CodeQL analysis (weekly)

### Documentation

- Complete README with setup instructions
- Architecture documentation
- API documentation with TSDoc
- Troubleshooting guide (DEBUGGING.md)
- Project specification (SPEC.md)
- AI agent instructions (AGENTS.md)
- Comprehensive project review (REVIEW.md)
- Environment configuration examples

### Testing

- 261 unit tests with 94%+ coverage
- 54 integration tests with full mocked dependencies
- Fast execution (~4 seconds total)
- Arrange-Act-Assert pattern
- Comprehensive edge case coverage
- Mock isolation for external dependencies

### Configuration

- Environment variable support
- .env file configuration
- Platform selection (GitHub/Azure)
- Token management
- Bot identifier customization
- Copilot model selection
- Timeout configuration
- Log level control

### Security

- Token stored in environment only
- Input validation on all entry points
- Rate limit detection and handling
- HTTPS-only API calls
- No token exposure in logs
- CodeQL security scanning
- Dependency auditing

### Performance

- Incremental caching (85% speedup on re-reviews)
- Rate limit handling prevents throttling
- Efficient diff parsing
- Minimal memory footprint (~200MB peak)
- Fast build times (150ms)

---

[1.0.0]: https://github.com/archerax/merge-mentor/releases/tag/v1.0.0
