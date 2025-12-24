# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
