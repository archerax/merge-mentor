# AI Agent Instructions

This file contains instructions for AI agents working on this codebase.

## Project Overview

merge-mentor is an automated code review tool that supports multiple AI providers (GitHub Copilot CLI, OpenCode CLI, Cursor CLI) to perform comprehensive code reviews on pull requests from GitHub and Azure DevOps repositories. It provides inline comments, general feedback, and summary reports directly on PRs.

**Distribution**: Can be installed globally via npm/npx or used as a local development tool. Configuration (`.env` file) and logs are always relative to the current working directory, not the installation directory.

**Key Features**:
- Multi-provider support (Copilot CLI, OpenCode CLI, Cursor CLI)
- Confidence-based comment filtering (only posts high-confidence issues by default)
- Pre-existing issue detection (skips issues not introduced in this PR)
- Resolution comments (explains why comments are being resolved)
- Multi-run mode for increased thoroughness (aggregates findings from multiple review runs)
- Intelligent deduplication via existing comment context (prevents duplicate comments)

## Architecture

```
src/
├── cli.ts              # CLI entry point using Commander
├── config.ts           # Environment configuration loader (includes CommentFilterConfig, AI provider config)
├── constants.ts        # Application-wide constants (severity/confidence emojis)
├── logger.ts           # Pino logging setup
├── ai/                 # AI provider abstraction layer
│   ├── types.ts        # AIProviderClient interface, AIProviderType, AIResponse
│   ├── providerFactory.ts # Factory for creating AI provider instances
│   ├── index.ts        # Module exports
│   ├── prompts/
│   │   ├── prompts.ts      # Prompt templates for reviews (provider-agnostic)
│   │   └── commentContext.ts # Formats existing comments for LLM context
│   └── providers/
│       ├── copilot.ts  # GitHub Copilot CLI provider implementation
│       ├── cursor.ts   # Cursor CLI provider implementation
│       └── opencode.ts # OpenCode CLI provider implementation
├── audit/
│   ├── auditLogger.ts  # Audit logging for security/compliance tracking
│   └── index.ts        # Audit module exports
├── errors/
│   └── index.ts        # Custom error hierarchy
├── platforms/
│   ├── types.ts        # Shared interfaces (PlatformAdapter, etc.)
│   ├── github.ts       # GitHub API adapter (with audit logging)
│   └── azure.ts        # Azure DevOps API adapter (with audit logging)
├── review/
│   ├── engine.ts       # Review orchestration (supports single and multi-run modes, with audit logging)
│   ├── commentManager.ts # Comment lifecycle management (confidence filtering, resolution comments)
│   ├── findingAggregator.ts # Deduplication and merging of findings from multi-run mode
│   └── reviewStateCache.ts # SHA-based caching for incremental reviews
└── utils/
    ├── diffParser.ts   # Diff line validation
    └── rateLimitHandler.ts # Rate limit handling with backoff

tests/
└── integration/        # Integration tests with mocked dependencies
    ├── fixtures.ts     # Test fixtures and sample data
    ├── mocks.ts        # Mock factories for external dependencies
    ├── cli.integration.test.ts
    ├── platform-adapters.integration.test.ts
    └── review-engine.integration.test.ts
```

## AI Provider Architecture

### Provider Interface

All AI providers implement the `AIProviderClient` interface:

```typescript
interface AIProviderClient {
  executePrompt(prompt: string): Promise<AIResponse>;
  parseFileReview(filename: string, response: AIResponse): FileReviewResult;
  parseCrossFileReview(response: AIResponse): CrossFileReviewResult;
}
```

### Adding a New Provider

1. Create `src/ai/providers/newprovider.ts` implementing `AIProviderClient`
2. Add error class (e.g., `NewProviderCliError`)
3. Export from `src/ai/index.ts`
4. Add case to `createAIProvider()` in `src/ai/providerFactory.ts`
5. Add configuration in `src/config.ts` (model, timeout env vars)
6. Add CLI option validation in `src/cli.ts`
7. Add tests in `src/ai/providers/newprovider.spec.ts`

## Deduplication Strategy

### Problem
LLM non-determinism causes duplicate comments when:
- Running the same PR review multiple times (re-reviews)
- Using `--runs` mode with multiple passes

### Solution: Dual-Layer Deduplication

**Layer 1: LLM-Aware Context**
- Existing comments are fetched and formatted before each review
- LLM receives structured context showing already-identified issues
- Prompts explicitly instruct the model to avoid duplication
- In multi-run mode, findings from previous runs are added to context for subsequent runs

**Layer 2: Fingerprint-Based Fallback**
- `FindingAggregator` generates fingerprints (file + line + category + message prefix)
- Catches duplicates that slip through LLM-level deduplication
- Preserves findings with highest confidence when duplicates found

### Implementation Details

**Comment Context Format**:
```
EXISTING COMMENTS ON THIS PR:

File: src/app.ts
  - Line 10: [Bug] Null check missing for user input
  - Line 25: [Security] SQL injection risk [RESOLVED]
```

**Multi-Run Context Accumulation**:
- Run 1: Uses real existing comments
- Run 2: Real comments + synthetic comments from Run 1 findings
- Run 3: Real comments + synthetic comments from Run 1 + Run 2 findings

**Key Files**:
- `src/ai/prompts/commentContext.ts`: Formatting logic
- `src/ai/prompts/prompts.ts`: Prompt builders with context integration
- `src/review/engine.ts`: Context threading through review pipeline

## Model-Based Comment Resolution

The model actively evaluates existing comments to determine if issues have been resolved:

### How It Works
1. Existing comments are passed to the model with each file review
2. Model evaluates each existing comment against the current diff
3. For resolved issues, model returns `resolved_comments` array with:
   - `line`: Original line number of the comment
   - `reason`: Explanation of why the issue is resolved

### Resolution Comment Format
When an issue is resolved, the model's explanation is included:
```
✅ **Issue Resolved**: Null check was added in this commit
*Resolved at: 2025-12-25T21:00:00.000Z*
```

### Key Types
- `ResolvedComment`: `{line: number, reason: string}`
- `FileReviewResult.resolvedComments`: Optional array of resolved comments

## Audit Logging

Comprehensive audit logging is implemented for security and compliance requirements. All critical actions are logged with structured data.

### Audited Events

**PR Operations**:
- `pr.details.fetch` - Fetching PR metadata
- `pr.files.fetch` - Fetching changed files
- `pr.comments.fetch` - Fetching existing comments

**Comment Operations**:
- `comment.post.inline` - Posting inline code comments
- `comment.post.general` - Posting general PR comments
- `comment.update` - Updating existing comments
- `comment.resolve` - Resolving comment threads

**AI/LLM Operations**:
- `copilot.execute` - Executing Copilot CLI prompts (deprecated, use `ai.provider.execute`)
- `ai.provider.execute` - Executing AI provider CLI prompts (supports Copilot, OpenCode, Cursor)
  - Includes token usage statistics when available:
    - `inputTokens`: Number of input tokens consumed
    - `outputTokens`: Number of output tokens generated
    - `cachedTokens`: Number of cached tokens read (optional)
    - `premiumRequests`: Number of premium API requests (optional)
    - `model`: Model used for the request
    - `durationApiSeconds`: API processing time in seconds (optional)
    - `durationWallSeconds`: Total wall-clock time in seconds (optional)

**Review Lifecycle**:
- `review.start` - Starting a PR review
- `review.complete` - Completing a PR review
- `file.review.start` - Starting individual file review
- `file.review.complete` - Completing individual file review
- `crossfile.review.start` - Starting cross-file analysis
- `crossfile.review.complete` - Completing cross-file analysis

### Audit Log Structure

Each audit event includes:
- `eventType`: Type of event (see above)
- `timestamp`: ISO 8601 timestamp
- `severity`: `info`, `warn`, or `error`
- `actor`: Bot identifier (default: "merge-mentor-bot")
- `resource`: Object being acted upon (type, id, details)
- `action`: Human-readable action description
- `result`: `success`, `failure`, or `partial`
- `metadata`: Additional context (platform, counts, etc.)
- `error`: Error message if action failed

### Implementation Details

**Key Files**:
- `src/audit/auditLogger.ts`: Core audit logging implementation
- `src/platforms/github.ts`: Audit logging for GitHub operations
- `src/platforms/azure.ts`: Audit logging for Azure DevOps operations
- `src/ai/providers/copilot.ts`: Audit logging for Copilot executions
- `src/review/engine.ts`: Audit logging for review lifecycle

**Usage**:
```typescript
import { getAuditLogger } from "../audit/index.js";

const auditLogger = getAuditLogger();

// Log an action
auditLogger.logPRDetailsFetch(prNumber, "github", "success");

// Log a failure
auditLogger.logInlineCommentPost(
  prNumber, 
  path, 
  line, 
  "github", 
  "failure", 
  error.message
);
```

### Configuration

Audit logging is enabled by default. Configure via environment:
```bash
export AUDIT_LOGGING_ENABLED=true  # default
```

Logs are written to `.merge-mentor/logs/merge-mentor.log` with structured JSON format for easy parsing and analysis.

## Key Commands

```bash
# Global installation
npm install -g merge-mentor

# Or use directly with npx
npx merge-mentor review --pr <number>

# Local development
pnpm install          # Install dependencies
pnpm build            # Compile TypeScript
pnpm test             # Run unit tests
pnpm test:coverage    # Run unit tests with coverage
pnpm test:integration # Run integration tests
pnpm test:all         # Run all tests (unit + integration)
pnpm lint             # Run linter
pnpm lint:fix         # Fix lint issues
pnpm typecheck        # Type check without building
pnpm check            # Run all checks (typecheck, lint, test)

# When installed globally or via npx
merge-mentor review --pr <number> [--platform github|azure] [--write] [--runs 1-5]
npx merge-mentor review --pr <number> [--platform github|azure] [--write] [--runs 1-5]
```

## Development Guidelines

1. **Follow TypeScript strict mode** - All code must pass strict type checking
2. **Test first** - Write tests before implementing features
3. **Single responsibility** - Keep functions and classes focused
4. **Explicit over implicit** - Prefer clear, verbose code over clever shortcuts
5. **Handle errors explicitly** - Use proper error handling, avoid silent failures
6. **Support global installation** - Configuration and logs must use `process.cwd()`, never package installation directory

## Code Standards

Refer to `.github/instructions/` for detailed coding standards:

- `clean-typescript.instructions.md` - Code cleanliness principles
- `pragmatic-typescript.instructions.md` - Practical development guidelines
- `testing-typescript.instructions.md` - Testing best practices

## Testing

### Unit Tests
- Tests are colocated with source files (e.g., `cli.spec.ts` next to `cli.ts`)
- Use Vitest with `--pool=threads` for stability
- Follow arrange-act-assert pattern
- One concept per test
- Use descriptive test names
- Current coverage: 94%+ statements, 98%+ functions

### Integration Tests
- Located in `tests/integration/`
- Test complete workflows with mocked external dependencies
- Mock GitHub API, Azure DevOps API, and Copilot CLI
- Use `vi.mock()` with function constructors for class mocks
- Run separately with `pnpm test:integration`

**Integration test structure:**
```typescript
// Use function constructors for mocked classes
vi.mock("module", () => ({
  MyClass: function MyClass() {
    return mockInstance;
  },
}));
```

## Adding Features

1. Define interfaces in `platforms/types.ts`
2. Implement platform-specific code in adapters
3. Add business logic to the review engine
4. Write unit tests before implementation
5. Add integration tests for complete workflows
6. Update documentation (README.md, CHANGELOG.md)

## Common Patterns

### Dependency Injection

```typescript
class ReviewEngine {
  constructor(
    private platform: PlatformAdapter,
    botIdentifier: string,
    options?: ReviewEngineOptions,
  ) {}
}
```

### Error Handling

```typescript
if (!value) {
  throw new ValidationError("field", "Descriptive message with context");
}
```

### Type Safety

```typescript
// Prefer specific types over 'any'
type FindingSeverity = "critical" | "high" | "medium" | "low";
```

### Rate Limit Handling

```typescript
await withRateLimitHandling(() =>
  octokit.pulls.get({ owner, repo, pull_number }),
);
```

## Key Files

- `README.md` - User documentation and setup guide
- `REVIEW.md` - Comprehensive project review and analysis
- `SPEC.md` - Original project specification
- `DEBUGGING.md` - Troubleshooting guide
- `CHANGELOG.md` - Version history and release notes
- `LICENSE` - MIT license
