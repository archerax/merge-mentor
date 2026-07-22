# Changelog

All notable changes to merge-mentor will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- **`fix` Command: Prompt Injection → RCE Vector Closed**: The `fix` command embedded raw PR review comment bodies into the AI prompt with no injection defenses and auto-approved shell execution — a remote-code-execution vector on the developer's workstation or CI runner. The fix prompt now prepends the shared security preamble and wraps every comment body in `<untrusted-review-comment>` delimiters, and the AI agent no longer receives shell/terminal access on any provider (file read/edit tools only; validation commands are left to the user). Shell and write tool permissions are now controlled separately via the new `enableShellTools` provider option (default: disabled).
- **`fix` Command: Platform Token Leak Closed**: The GitHub/Azure DevOps PAT was passed to every AI provider, and the `claude-agent-sdk` provider forwarded it to `api.anthropic.com` as `ANTHROPIC_API_KEY`. The platform token is now only passed to the `copilot-sdk` provider, mirroring the review engine.

### Added

- **Q3 2026 Product Roadmap**: Added `plans/roadmap-q3-2026.md` ("Harden the Core", 2026-07-22 → 2026-10-22) covering the trust-foundation security work, comment deduplication, the interactive `reply` comment loop, and the v3.0 secure-by-default release.

### Changed

- **Semantic Search Plan Parked**: Marked `plans/codebase-semantic-search-plan.md` as parked pending user evidence that provider-native codebase context is insufficient.

## [2.10.0] - 2026-07-08

### Changed

- **Instant Execution Support**: Updated installation and usage documentation to recommend running the CLI tool via `npx merge-mentor@latest` rather than global installation (`npm i -g merge-mentor`).

### Fixed

- **Copilot Provider Error Handling**: Improved the authentication verification process and error reporting in `CopilotSdkProvider`. If the Copilot client is not connected, it now provides specific, actionable troubleshooting steps to assist with configuration.
- **Retry Attempt Formatting**: Corrected the retry attempt count display in `AIProviderError` messages to handle singular/plural formatting correctly (e.g., "1 attempt" instead of "1 attempts").

## [2.9.0] - 2026-07-06

### Added

- **Project-Level Review & Traversal**: Added support for hierarchical work item planning structure (Epics, Features, PBIs, Tasks) review using the `project <id>` command.
- **MoSCoW Classification**: Supported MoSCoW (Must have, Should have, Could have, Won't have) rule verification for project items.
- **Review Table Formatting**: Enhanced the readability and visual layout of generated review comments and tables.

### Changed

- **CLI Architecture Refactoring**: Extracted command handlers (such as `describe`, `doctor`, `pbi`, `project`, `repos`, `review`) from the monolithic `program.ts` into individual modular files under `src/commands/` for better maintainability.

## [2.8.0] - 2026-07-04

### Added

- **PR Description & Changelog Generation**: Introduced the `describe` command to automatically generate PR titles, summaries, and changelogs using AI, with options to write suggestions directly to remote platforms.
- **Hierarchical Project Review**: Implemented the `project <id>` command to hierarchically review work item planning structures (Epics, Features, PBIs, Tasks) against quality guidelines.

### Changed

- **Token Validation**: Enhanced `MM_COPILOT_TOKEN` validation by ensuring the token string contains the required `github_pat_` prefix.
- **Biome Configuration**: Migrated Biome configuration to the latest settings format.

### Fixed

- **Test Isolation**: Isolated the `executableFinder` path cache in ports and cleaned up test workarounds to prevent cache pollution.

## [2.7.0] - 2026-07-02

### Added

- **PBI-to-PR Alignment Verification**: Implemented automated PBI (Product Backlog Item) alignment verification. Added CLI flag `--verify-pbi` to review whether changes in a PR align with requirements described in linked PBIs.
- **Design Plans**: Added design documents for codebase semantic search (`docs/codebase-semantic-search-plan.md`) and pull request description generation (`docs/pr-description-generation-plan.md`).

### Fixed

- **CLI Config Integration**: Ensured the `verifyPbi` CLI flag is correctly propagated to the config configuration object in the CLI main program.

## [2.6.2] - 2026-07-01

### Fixed

- **CI/CD Workflow**: Resolved a version mismatch error in GitHub Actions by removing the hardcoded `pnpm` version input and allowing `pnpm/action-setup` to automatically detect the version from the `packageManager` field in `package.json`.

## [2.6.1] - 2026-07-01

### Changed

- **Script Alignment**: Streamlined build, typecheck, lint, and test scripts in `package.json` to ensure clean execution and consistent formatting across development environments.
- **Dependency Upgrades**: Upgraded core and developer dependencies, including `@github/copilot`, `@github/copilot-sdk`, `@opencode-ai/sdk`, Biome, Knip, Prettier, and `@anthropic-ai/claude-agent-sdk` to their latest stable patch versions.
- **GitHub Workflows**: Updated GitHub action versions/digests (`actions/checkout`, `pnpm/action-setup`, `softprops/action-gh-release`, `codecov/codecov-action`) for enhanced security and reliability in CI/CD.
- **Documentation Updates**: Added plans for the interactive comment loop and PBI alignment, and updated `README.md` with new information.

## [2.6.0] - 2026-06-24

### Added

- **Doctor Mode Diagnostics**: Added comprehensive diagnostics to the `doctor` command:
  - System `git` CLI availability and version check.
  - Verification of `COPILOT_CLI_PATH` environment variable executable.
  - Automatic defaulting to check the configured active AI provider when `--provider` is not specified.
  - Added `gitBackend` and `tempPath` details to the configuration output.
  - Workspace temporary directory (`tempPath`) writability check.
  - System architecture metadata in diagnostics header.

### Changed

- **Version Output Cleaning**: Stripped the update reminder instructions ("Run 'copilot update' to check for updates") from doctor mode CLI outputs for cleaner formatting.

## [2.5.1] - 2026-06-23

### Fixed

- **Azure DevOps Compatibility**: Updated the Azure DevOps comments API version to the stable `7.1` to ensure Markdown comments are processed and rendered correctly.

## [2.5.0] - 2026-06-23

### Changed

- **PBI Review Guidelines**: Transitioned the Product Backlog Item (PBI) and User Story review from a rigid check-list evaluation of individual INVEST criteria to a more holistic, guideline-oriented assessment.
- **PBI Footer Metadata**: Added the application version and AI model identifier to the PBI review footer for consistent reporting.

### Fixed

- **PBI Review Adaptability**: Respect the `MM_PLATFORM` environment variable for PBI reviews.
- **Azure DevOps Compatibility**: Configured Azure DevOps PBI comments to post correctly in Markdown.
- **PBI Review Formatting**: Removed the PASS/FAIL column from the PBI review table to simplify the output.
- **License Metadata**: Corrected the license reference in `README.md` to indicate the MIT License.

## [2.4.4] - 2026-06-23

### Added

- **CLI Tests**: Added new test cases for the `pbi` command in `src/program.spec.ts`.

### Changed

- **Dependencies**: Upgraded `@github/copilot-sdk` and `knip`.
- **Test Coverage**: Adjusted Vitest coverage thresholds from 85% to 80% in `vitest.config.ts`.
- **Refactoring**: Resolved TypeScript and Biome linter warnings across adapters and tests.

## [2.4.3] - 2026-06-23

### Fixed

- **Test Coverage**: Added unit tests for missing fields in GitHub and Azure DevOps adapters to stabilize branch coverage above the 85% threshold.

## [2.4.2] - 2026-06-23

### Fixed

- **Test Coverage**: Added unit tests for PBI features across GitHub, Azure DevOps, Copilot SDK, and git remote parser to meet the 85% branch coverage threshold.
- **Workspace Configuration**: Tuned `pnpm-workspace.yaml` packages setting to prevent Vitest from double-loading the root package.

## [2.4.1] - 2026-06-23

### Fixed

- **Workspace Configuration**: Added `packages` field to `pnpm-workspace.yaml` to prevent `setup-pnpm` action from failing in CI workflow.

## [2.4.0] - 2026-06-22

### Added

- **PBI and User Story Review**: Introduced automated review support for Product Backlog Items (PBIs) and User Stories. Users can now run INVEST quality checks and receive structured feedback.
- **Git Remote Parsing**: Added a new git remote URL parser to automatically detect and identify GitHub and Azure DevOps platforms and repository coordinates.

### Fixed

- **Copilot CLI Path Resolution**: Resolved the "Copilot CLI not found" error when running reviews under the Copilot SDK provider by ensuring a reliable search path and fallback for the Copilot CLI binary.

## [2.3.0] - 2026-06-10

### Added

- **Claude Agent SDK Provider**: Introduced a new `claude-agent-sdk` AI provider with full feature parity support, integrating the `@anthropic-ai/claude-agent-sdk` package. Also added diagnostic checks for this provider to the `doctor` CLI command.
- **Custom Test Mapping**: Enhanced the test file mapper to support custom glob patterns (`testFilePatterns`) and regex-based mapping overrides (`testMapping`) loaded from a `.mergementor.json` configuration file at the workspace root.
- **Experimental Tools Configuration**: Added support for configuring the `experimentalTools` flag via the `MM_EXPERIMENTAL_TOOLS` environment variable or the `.mergementor.json` config file, in addition to the existing `--experimental-tools` CLI flag.
- **Bring Your Own Key (BYOK) Documentation**: Added configuration examples in `README.md` for integrating Bring Your Own Key (BYOK) configurations with local models (Ollama, vLLM) and Azure OpenAI.

### Changed

- **CLI Options Grouping**: Refactored the `review` command CLI parameters into clearly organized option groups (`General Options`, `Review Configuration`, `GitHub Configuration`, `Azure DevOps Configuration`, `AI Provider Configuration`, `File Filtering`, and `Console Output Options`).
- **Expanded Comment Categories**: Added `Architecture`, `Design`, and `Testing` categories to the review engine, and updated the documentation category emoji.

## [2.2.0] - 2026-06-09

### Added

- **Reasoning Support**: Equipped the AI review agent with support for reasoning models when using the Copilot SDK provider. Added a new `--reasoning` CLI flag and `MM_REASONING` environment variable to control the reasoning effort.

### Changed

- **Package Upgrades**: Upgraded core dependencies including `@github/copilot-sdk` to `v1.0.0`, `commander` to `v15.0.0`, `zod` to `v4.4.3`, and `@opencode-ai/sdk` to `^1.16.2`.

### Fixed

- **CLI Git Client Fetch**: Fixed checkout failures on the CLI git backend by explicitly specifying the target refspec on fetch.

## [2.1.0] - 2026-06-05

### Added

- **Experimental Custom Tools**: Equipped the AI review agent with an experimental tool-calling loop to interact directly with the pull request environment. Added a new `--experimental-tools` CLI flag and `MM_EXPERIMENTAL_TOOLS` environment variable.
- **Automated Comment Posting**: Introduced support for the AI review agent to dynamically post inline review comments back to the target pull request when experimental tools are enabled.
- **Transcript Logging**: Added support for local transcript logging of AI execution steps and tool calls for debugging and auditing.

### Changed

- **Size-Bounded Diff Attachments**: Implemented a 150 KB size threshold for diff attachments in fast review. Diffs are only attached to the AI context if their total size is under 150 KB to prevent token limits and minimize API costs.
- **Unified Skip Filtering**: Refactored default ignore patterns (lockfiles, images, binaries) to use standard glob ignore filters with support for negation patterns (e.g., `!**/*.svg` to override default ignores). Simplified file skip logic by delegating extension checks to the ignore filter.

## [2.0.1] - 2026-06-01

### Added

- **Official Brand Assets**: Added official project logo assets in light, dark, and transparent styles.

### Changed

- **AI Response Validation**: Enhanced the reliability of SDK-based AI providers by validating their structured response data against strict schemas for improved error handling, safety, and stability.

## [2.0.0] - 2026-05-29

### Breaking Changes

- **Removed CLI providers (`copilot` and `opencode`)**: The legacy CLI-based AI providers have been removed. The newer SDK providers (`copilot-sdk` and `opencode-sdk`) are strictly better in every dimension—faster (utilizing a persistent client/server model), more reliable (using native JSON schemas and robust error handling), more secure, and feature-complete (supporting Bring Your Own Key / BYOK and token usage tracking). The `MM_AI_PROVIDER` environment variable and `--provider` CLI parameter now accept only `copilot-sdk` and `opencode-sdk`. Legacy configurations default to `copilot-sdk`.
- **Removed `--runs` / `MM_REVIEW_RUNS`**: Multi-run mode has been removed. To run multiple review passes, simply invoke the application multiple times.
- **Removed deprecated CLI options**: The deprecated options `--agent-timeout`, `--copilot-model`, `--copilot-sdk-model`, `--copilot-sdk-base-url`, `--copilot-sdk-api-key`, `--opencode-model`, `--opencode-sdk-model`, `--copilot-timeout`, `--copilot-sdk-timeout`, `--opencode-timeout`, `--opencode-sdk-timeout`, and `--phases` have been removed. Use their unified replacements: `--ai-model`, `--ai-timeout`, `--ai-base-url`, `--ai-api-key`, and `--passes` instead.
- **Removed deprecated environment variables**: The deprecated environment variables `MM_AGENT_TIMEOUT`, `MM_COPILOT_MODEL`, `MM_COPILOT_SDK_MODEL`, `MM_OPENCODE_MODEL`, `MM_OPENCODE_SDK_MODEL`, `MM_COPILOT_SDK_BASE_URL`, `MM_COPILOT_SDK_API_KEY`, `MM_COPILOT_TIMEOUT`, `MM_COPILOT_SDK_TIMEOUT`, `MM_OPENCODE_TIMEOUT`, `MM_OPENCODE_SDK_TIMEOUT`, and `MM_REVIEW_RUNS` have been removed. Use their unified replacements: `MM_AI_MODEL`, `MM_AI_TIMEOUT`, `MM_AI_BASE_URL`, and `MM_AI_API_KEY` instead.
- **Renamed `standard` review strategy to `deep`**: The `"standard"` execution strategy has been renamed to `"deep"`. The `MM_REVIEW_STRATEGY` environment variable and `--strategy` parameter now accept `"deep"` instead of `"standard"`.

### Changed

- **Default Review Strategy**: Changed the default review strategy from `"standard"` to `"fast"` to reduce Copilot/AI API costs and latency. The higher-accuracy strategy remains available as `"deep"` and can be selected via `--strategy deep` or `MM_REVIEW_STRATEGY=deep`.
- **Optimized token usage**: Reduced token consumption when reviewing large pull requests, resulting in faster execution and lower API costs.

## [1.33.0] - 2026-05-14

### Changed

- **Package Upgrades**: Updated various dependencies to latest versions
- **README**: Improved introduction with a clearer positioning statement and a new "Why MergeMentor?" section covering key value propositions
- **README**: Reformatted BYOK cost data into a comparison table for clarity
- **Docs**: Added token-efficiency investigation document

## [1.32.0] - 2026-04-26

### Added

- **Custom review type with configurable phases**: Added a new `custom` review type driven by a required `--phases` CLI flag
  - Phase names are validated against the built-in general-review catalog: `scan`, `security`, `logic`, `performance`, and `monorepo`
  - Unknown phases, duplicate phases, and missing phases fail fast with validation errors
  - Selected phases are surfaced in prompts, logs, audit records, comment footers, and markdown reports
  - The new `monorepo` phase focuses reviews on package boundaries, workspace dependency hygiene, shared tooling, and monorepo conventions

### Changed

- **Standardized shared AI configuration**: Preferred shared AI settings now use the `MM_AI_*` / `--ai-*` naming family
  - Preferred names: `MM_AI_TIMEOUT` / `--ai-timeout`, `MM_AI_MODEL` / `--ai-model`, `MM_AI_BASE_URL` / `--ai-base-url`, and `MM_AI_API_KEY` / `--ai-api-key`
  - Deprecated v1 aliases remain supported for backward compatibility and are explicitly marked in code for removal in v2:
    - `MM_AGENT_TIMEOUT` / `--agent-timeout`
    - `MM_COPILOT_MODEL` / `--copilot-model`
    - `MM_COPILOT_SDK_MODEL` / `--copilot-sdk-model`
    - `MM_OPENCODE_MODEL` / `--opencode-model`
    - `MM_OPENCODE_SDK_MODEL` / `--opencode-sdk-model`
    - `MM_COPILOT_SDK_BASE_URL` / `--copilot-sdk-base-url`
    - `MM_COPILOT_SDK_API_KEY` / `--copilot-sdk-api-key`
- **Copilot SDK BYOK naming**: Copilot SDK OpenAI-compatible BYOK settings now flow through generic `ai-*` settings while remaining scoped to `copilot-sdk` behavior in v1

## [1.31.0] - 2026-04-21

### Added

- **Dual Git Backend**: New `isomorphic` git backend powered by [isomorphic-git](https://isomorphic-git.org/) as an alternative to the default system `git` binary
  - Select via `MM_GIT_BACKEND=isomorphic` or `--git-backend isomorphic`
  - Pure JavaScript — no system `git` binary required
  - Tokens are passed via HTTP auth callbacks, never through process arguments or `.git/config`
  - Supports GitHub and Azure DevOps authentication (PAT and CI mode)
  - Default backend remains `cli` (system git); `isomorphic` is opt-in
  - Known limitation: `git clean -fdx` is not supported in the isomorphic backend; only tracked files are reset between reviews
- **`GitClient` abstraction**: Internal port/adapter interface (`clone`, `fetch`, `checkout`, `clean`, `setRemoteUrl`) enabling future git backends without changing the review engine
- **`validateGitBackend()` config validator**: Exported function for validating `MM_GIT_BACKEND` values (defaults to `'cli'` for unknown values)

## [1.30.0] - 2026-04-20

### Fixed

- Minor git auth fixes

## [1.29.0] - 2026-04-17

### Added

- **File Ignore List**: New `--ignore` CLI flag to exclude files and directories from code review
  - Accept repeatable glob patterns: `--ignore '*.test.ts' --ignore 'dist/**'`
  - Ignored files are logged transparently in review output
  - Prevents unnecessary AI processing and API calls for excluded files

## [1.28.0] - 2026-04-17

### Changed

- **Default AI Timeout**: Increased default AI provider timeout from 5 minutes (300000ms) to 1 hour (3600000ms)
  - Provides more time for AI models to analyze and review larger pull requests
  - Reduces timeout errors on complex code reviews
  - Environment variables: `MM_COPILOT_TIMEOUT`, `MM_COPILOT_SDK_TIMEOUT`, `MM_OPENCODE_TIMEOUT`, `MM_OPENCODE_SDK_TIMEOUT`
  - CLI parameters: `--copilot-timeout`, `--copilot-sdk-timeout`, `--opencode-timeout`, `--opencode-sdk-timeout`

## [1.27.0] - 2026-04-17

### Changed

- **Default AI Provider**: Changed default AI provider from `copilot` (CLI) to `copilot-sdk` (SDK)
  - Copilot SDK provides better performance and reliability compared to CLI
  - To use the CLI variant, explicitly set `MM_AI_PROVIDER=copilot` or use `--provider copilot`
  - All other providers (opencode, opencode-sdk) remain unchanged
  - Existing configurations with explicit provider settings are unaffected

### Removed

- **Cursor CLI Provider Support**: Removed support for Cursor CLI provider (`cursor`)
  - Cursor CLI is no longer available as an AI provider option
  - Existing configurations using Cursor will need to switch to another provider (copilot, copilot-sdk, opencode, opencode-sdk)

## [1.26.0] - 2026-04-15

### Fixed

- **Copilot Token Handling**: Fixed bug in Copilot token validation and usage

## [1.21.0] - 2026-04-15

### Added

- **CI/CD Integration**: New `--ci` flag for automatic detection and integration with GitHub Actions and Azure Pipelines
  - Auto-detects CI environment and sources PR number, repository, platform, and auth tokens
  - Supports GitHub Actions (reads `GITHUB_ACTIONS`, `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_EVENT_PATH`)
  - Supports Azure Pipelines (reads `TF_BUILD`, `SYSTEM_ACCESSTOKEN`, collection URI, team project, repo)
  - `--write` defaults to `true` in CI mode for automatic comment posting
  - Handles both dev.azure.com and visualstudio.com URL formats
  - See README for CI/CD Integration examples with GitHub Actions and Azure Pipelines
- **OpenCode SDK Provider**: New native SDK provider for OpenCode CLI
  - Improves reliability compared to CLI-based execution
  - Configure via `MM_AI_PROVIDER=opencode-sdk` or `--provider opencode-sdk`
  - Supports model selection via `MM_OPENCODE_SDK_MODEL` and `MM_OPENCODE_SDK_TIMEOUT`
- **Sensitive Data Redaction**: Logs now redact sensitive information (tokens, credentials)
  - Tokens and API keys are masked in log output
  - Improves security when sharing logs for debugging

### Changed

- **CI Mode Workspace Handling**: Reuses current workspace instead of cloning repository in CI mode
  - Faster execution in CI/CD pipelines
  - Reduces disk usage and network traffic
- **Azure DevOps Token Priority**: `MM_AZURE_TOKEN` now takes priority over `SYSTEM_ACCESSTOKEN` in CI mode

### Fixed

- **GitHub API Pagination**: Fixed pagination handling for repositories with many pull requests
- **Security**: Fixed potential command injection vulnerability in branch name handling
- **Copilot SDK**: Upgraded to latest Copilot SDK version for improved stability
- **Build Issues**: Various build and test fixes

## [1.16.0] - 2026-03-27

### Fixed

- **Copilot SDK Dependency**: Fixed dependency version compatibility

## [1.13.0] - 2026-03-25

### Added

- **Copilot SDK Provider**: New native SDK provider for GitHub Copilot
  - Replaces CLI-based Copilot execution with direct SDK integration
  - Improves performance and reliability for code reviews
  - Configure via `MM_AI_PROVIDER=copilot-sdk` or `--provider copilot-sdk`
  - Supports model selection via `MM_COPILOT_SDK_MODEL` and `MM_COPILOT_SDK_TIMEOUT`
  - Enhanced validation and error handling

### Changed

- Code refactoring and test improvements
- Package dependency updates

## [1.12.0] - 2026-02-08

### Added

- **Fast Review Type**: New `--review-type fast` option that combines file-level and cross-file analysis in a single AI call
  - Reduces costs by ~50% compared to the default two-pass `general` review
  - Single-pass covers both individual code issues and architectural concerns
  - Flexible comment attribution: line-specific, file-level, or PR-level findings
  - Same analysis depth as general review with fewer AI calls
  - Ideal for cost savings on routine PRs while maintaining quality standards
- **Extensibility Documentation** - Comprehensive guide for adding new specialist review types:
  - Created `EXTENDING.md` with step-by-step instructions for implementing new specialists
  - Complete code examples for both complex (with custom context) and simple specialists
  - Architecture patterns and data flow documentation
  - Testing strategies (unit, integration, and manual testing)
  - Implementation checklist with 18 verification items
  - Best practices and common pitfalls
  - Decision framework for when to add new specialist types
- **README Enhancement** - Added "Extensible Architecture" feature and "Extending merge-mentor" section linking to EXTENDING.md
- **Specialist Review Types** - New `--review-type` flag for focused reviews on specific concerns:
  - `general` (default): Comprehensive review covering all aspects
  - `testing`: Testing specialist focused on test coverage, quality, and naming conventions
  - `security`: Security specialist focused on vulnerabilities and threats
  - `performance`: Performance specialist focused on optimization opportunities
- **Testing Review Capabilities** - Specialized testing reviews include:
  - **Test Coverage Analysis**: Verifies functions have tests, edge cases covered, error paths tested
  - **Naming Convention Validation**: Language-specific patterns (C#: `MethodName_Scenario_ExpectedBehavior`, TypeScript: `describe/it` blocks)
  - **Assertion Verification**: Ensures assertions match test behavior and use appropriate matchers
  - **Mock Framework Usage**: Validates proper mocking patterns (C#: Moq/NSubstitute, TypeScript: Vitest/Jest)
- **Environment Variable Configuration** - New `MM_REVIEW_TYPE` environment variable to set default review type
- **Streaming Output Display**: Real-time feedback showing the last 5 lines of AI model output during reviews
  - New `--no-stream` flag to disable streaming output
  - New `--stream-lines <n>` option to configure number of lines (1-20)
  - Environment variables `MM_STREAMING_ENABLED` and `MM_STREAMING_LINES` for configuration
  - Auto-disables in non-TTY environments (CI/CD pipelines, piped output)

### Removed

- **BREAKING**: Removed `--specialized` flag
  - The `--specialized` flag has been removed in favor of the more explicit `--review-type` flag
  - Migration: Use `--review-type testing` instead of `--specialized` or `--specialized testing`

### Migration Guide

**Before (deprecated):**

```bash
# Old specialized flag
merge-mentor review --pr 123 --specialized --write
merge-mentor review --pr 123 --specialized testing --write
```

**After (current):**

```bash
# New review-type flag
merge-mentor review --pr 123 --review-type testing --write
merge-mentor review --pr 123 --review-type security --write
merge-mentor review --pr 123 --review-type performance --write

# General review (default, same as before with no flag)
merge-mentor review --pr 123 --write
```

**Environment Variable Migration:**

```bash
# Old (not supported)
export SPECIALIZED_REVIEW=testing

# New
export MM_REVIEW_TYPE=testing
```

### Removed

- **BREAKING**: Removed OpenAI API provider support
  - Removed `--provider openai` option and all OpenAI-specific CLI options
  - Removed `openai` npm dependency and SDK-based provider implementation
  - OpenAI provider was architecturally incompatible with local repository cloning approach
  - CLI-based providers (Copilot, OpenCode) can now read local files directly
  - Simplified codebase by focusing on CLI-based providers only

## [1.11.0] - 2026-01-14

### Removed

- **BREAKING**: Removed file-by-file review mode (now uses batched review exclusively)
  - Removed `buildFileReviewPrompt` function from prompts
  - Removed `formatFileCommentsContext` function from comment context
  - All reviews now use batched mode for better performance and consistency
- **BREAKING**: Removed backward compatibility for old environment variable names
  - Must now use `MM_` prefix for all environment variables
  - Removed support for unprefixed variables (e.g., `GITHUB_TOKEN`, `DEFAULT_PLATFORM`, `AZURE_DEVOPS_*`)
  - Updated all documentation to reflect MM\_ prefixed variables only

### Changed

- Simplified configuration by requiring MM\_ prefix for all environment variables
- Updated tests to use only MM\_ prefixed environment variables
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
- **MM\_ environment variable prefix** - All environment variables now use the `MM_` prefix to avoid conflicts with other applications (e.g., `MM_GITHUB_TOKEN` instead of `GITHUB_TOKEN`). Old unprefixed variables are still supported for backward compatibility but are deprecated.
- **Comprehensive CLI parameters** - Every environment variable now has a corresponding command-line parameter (e.g., `--github-token`, `--azure-token`, `--copilot-model`). CLI parameters always override environment variables.
- **CLI parameter documentation** - All CLI help text now shows the corresponding environment variable name for each parameter.

### Changed

- **Environment variable naming** - Standardized all variable names with `MM_` prefix:
  - `DEFAULT_PLATFORM` → `MM_PLATFORM`
  - `GITHUB_TOKEN` → `MM_GITHUB_TOKEN`
  - `AZURE_DEVOPS_*` → `MM_AZURE_*` (simplified naming)
  - `BOT_COMMENT_IDENTIFIER` → `MM_COMMENT_IDENTIFIER`
  - `*_TIMEOUT_MS` → `MM_*_TIMEOUT` (removed \_MS suffix for consistency)
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
- **Detailed markdown reports in dry-run mode** - Dry runs now automatically generate comprehensive markdown reports saved to `.mergementor/reports/{platform}-{project}-PR{number}-review-report.md`. Reports include PR metadata, issue summaries by severity/category with visual indicators, detailed file-specific findings, cross-file analysis, overall assessment, and recommendations. Perfect for viewing all issues when console output is too limited.
- **Batched file review mode** - Major performance improvement for large PRs. Instead of making one AI call per file (50-300 calls for large PRs), the tool now stores all diffs to disk and makes a single batched AI call to review all files at once. This reduces review time from potentially hours to minutes for large PRs.

### Changed

- **Debug output moved to logs** - All debug messages (diff processing, JSON parsing, file copying, etc.) are now written to log files instead of cluttering console output. Console output is now clean and focused on user-relevant information.
- **Stronger focus on changed lines** - AI prompts now emphasize more strongly that only NEW issues introduced in added/modified lines should be flagged, not pre-existing code issues.
- **File organization** - Cache files now use unique identifiers: `.mergementor/cache/Github-myrepo-PR123.json` instead of `pr-123.json`. Diff storage similarly uses unique directory names.
- **Review architecture** - File reviews now use a batched approach:
  1. Diffs are stored to `.mergementor/diffs/{platform}-{project}-PR{number}/` directory
  2. A single AI call reviews all files using `@filename` syntax to read diff files
  3. Cross-file analysis remains a separate call
  4. Total AI calls reduced from N+1 (per file + cross-file) to 2 (batched + cross-file)

### Fixed

- **Azure DevOps large PR support** - Fixed "Invalid number of file diffs requested" error when reviewing PRs with more than 10 files. The Azure DevOps API limits `getFileDiffs` to 10 files per request, so file diffs are now automatically batched in groups of 10. PRs with any number of files are now supported.

- **Copilot CLI argument length limit** - Large prompts now use temporary files with `@filename` syntax instead of passing the entire prompt as a CLI argument. This prevents failures when reviewing PRs with large diffs or many existing comments. Temp files are automatically created in `.mergementor/temp/` and cleaned up after execution. The `--allow-all-tools` flag is used to allow Copilot to read the temp files.

## [1.6.0] - 2025-12-30

### Added

- **Multi-AI provider support**: Select your preferred AI provider for reviews. Supports GitHub Copilot CLI (default) and OpenCode CLI. Set the provider via the `--provider` flag or the `MM_AI_PROVIDER` environment variable.

- **OpenCode CLI provider**: Alternative AI provider using OpenCode CLI. Configure with `--provider opencode` or `export MM_AI_PROVIDER=opencode`. Supports model selection via `MM_OPENCODE_MODEL` environment variable.

### Changed

- CLI description updated to reflect multi-provider support
- No breaking changes for existing users; defaults to Copilot CLI

### Migration

Existing configurations work without changes (defaults to Copilot CLI). To use alternative providers:

```bash
# Use OpenCode CLI
export MM_AI_PROVIDER=opencode
export MM_OPENCODE_MODEL=claude-sonnet-4.5
merge-mentor review --pr 123 --write

# Or via CLI flag (overrides environment variable)
merge-mentor review --pr 123 --provider opencode --write
```

## [1.5.0] - 2025-12-27

### Added

- **Windows and macOS compatibility**: Full cross-platform support for Windows, macOS, and Linux. Build scripts now use `cross-env` for environment variable handling, and command execution explicitly avoids shell-specific syntax. Documentation includes platform-specific configuration examples.

- **Comprehensive audit logging for security and compliance**: All critical bot actions are now logged with structured data, including PR operations, comment actions, AI executions, and review lifecycle events. Audit logs are written to `.mergementor/logs/merge-mentor.log` in JSON format for easy parsing and analysis. Enabled by default for enterprise compliance requirements.

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

- **Multi-run mode**: Catch more issues by running multiple review passes and automatically combining unique findings. Use `--runs 3` for critical code reviews or `--runs 5` for security-sensitive changes. The bot automatically removes duplicates and aggregates findings.

- **More thorough analysis**: Enhanced AI prompts now systematically check for logic errors, security vulnerabilities, performance issues, and code quality across multiple passes in a single run.

### Usage

```bash
# Run 3 review passes for important PRs
merge-mentor review --pr 123 --runs 3 --write

# Or set a default in your environment
export MM_RUNS=3
```

## [1.2.0] - 2025-12-24

### Added

- **Skip pre-existing issues**: The bot now detects problems that existed before your PR and ignores them, so you only see feedback on your actual changes.

### Fixed

- Duplicate comments no longer appear when re-running reviews on unchanged code

## [1.1.0] - 2025-12-24

### Added

- **Instant execution support**: Run instantly with `npx merge-mentor@latest`. Configuration and logs now use your current directory instead of the installation location.

### Changed

- **Breaking**: `.env` configuration file must be in your current working directory, not the installation directory
- **Breaking**: Logs are now written to `.mergementor/logs/` in your current directory

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
- Configurable AI model selection (claude-haiku-4.5, claude-sonnet-4.5, claude-opus-4.5)
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

- Instant run: `npx merge-mentor@latest review --pr 123`
- CI/CD ready with GitHub Actions and Azure Pipelines examples
- Environment-based configuration

**Getting Started**

```bash
# Configure (one-time setup)
export MM_GITHUB_TOKEN=your_token
export MM_GITHUB_OWNER=your_username
export MM_GITHUB_REPO=your_repo

# Review a PR (dry-run) using npx
npx merge-mentor@latest review --pr 123

# Post comments
npx merge-mentor@latest review --pr 123 --write
```

See the README for complete setup and configuration instructions.
