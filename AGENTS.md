# AI Agent Instructions

This file contains instructions for AI agents working on this codebase.

## Project Overview

merge-mentor is an automated code review tool that leverages GitHub Copilot CLI to perform comprehensive code reviews on pull requests from GitHub and Azure DevOps repositories. It provides inline comments, general feedback, and summary reports directly on PRs.

## Architecture

```
src/
├── cli.ts              # CLI entry point using Commander
├── config.ts           # Environment configuration loader
├── constants.ts        # Application-wide constants
├── logger.ts           # Pino logging setup
├── errors/
│   └── index.ts        # Custom error hierarchy
├── copilot/
│   ├── client.ts       # Copilot CLI wrapper with retry logic
│   └── prompts.ts      # Prompt templates for reviews
├── platforms/
│   ├── types.ts        # Shared interfaces (PlatformAdapter, etc.)
│   ├── github.ts       # GitHub API adapter
│   └── azure.ts        # Azure DevOps API adapter
├── review/
│   ├── engine.ts       # Review orchestration
│   ├── commentManager.ts # Comment lifecycle management
│   └── reviewStateCache.ts # SHA-based caching for incremental reviews
└── utils/
    ├── diffParser.ts   # Diff line validation
    └── rateLimitHandler.ts # Rate limit handling with backoff
```

## Key Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Compile TypeScript
pnpm test             # Run tests
pnpm test:coverage    # Run tests with coverage
pnpm lint             # Run linter
pnpm lint:fix         # Fix lint issues
pnpm typecheck        # Type check without building
pnpm check            # Run all checks (typecheck, lint, test)
pnpm review -- --pr <number> [--platform github|azure] [--write]
```

## Development Guidelines

1. **Follow TypeScript strict mode** - All code must pass strict type checking
2. **Test first** - Write tests before implementing features
3. **Single responsibility** - Keep functions and classes focused
4. **Explicit over implicit** - Prefer clear, verbose code over clever shortcuts
5. **Handle errors explicitly** - Use proper error handling, avoid silent failures

## Code Standards

Refer to `.github/instructions/` for detailed coding standards:

- `clean-typescript.instructions.md` - Code cleanliness principles
- `pragmatic-typescript.instructions.md` - Practical development guidelines
- `testing-typescript.instructions.md` - Testing best practices

## Testing

- Tests are colocated with source files (e.g., `cli.spec.ts` next to `cli.ts`)
- Use Vitest with `--pool=threads` for stability
- Follow arrange-act-assert pattern
- One concept per test
- Use descriptive test names
- Current coverage: 94%+ statements, 98%+ functions

## Adding Features

1. Define interfaces in `platforms/types.ts`
2. Implement platform-specific code in adapters
3. Add business logic to the review engine
4. Write tests before implementation
5. Update documentation (README.md, CHANGELOG.md)

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
