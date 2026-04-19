# API Documentation

This project uses **TypeDoc** to generate API documentation from comprehensive TypeScript JSDoc comments.

## Quick Start

### Generate Documentation
```bash
pnpm docs
```

### View Documentation
Documentation is generated in markdown format in the `docs/api/` directory. Start with:
- `docs/api/README.md` - Full API homepage and overview
- `docs/api/modules.md` - Module index

### Watch Mode (Development)
```bash
pnpm docs:watch
```

Auto-regenerates documentation whenever you change source files.

## What's Documented

**95%+ of codebase** with comprehensive documentation including:

- ✅ Module overviews explaining architecture and purpose
- ✅ Complete function signatures with `@param` and `@returns` tags
- ✅ Error handling documentation with `@throws` tags
- ✅ Practical examples with `@example` blocks
- ✅ Security considerations and best practices
- ✅ Platform-specific notes (GitHub vs Azure DevOps)
- ✅ Dependency injection patterns for testing
- ✅ Performance optimization documentation

## Key Modules

### Review Module (`docs/api/review/`)
- **ReviewEngine** - Central orchestrator for PR reviews
- **CommentManager** - PR comment deduplication
- **DiffStorage** - Diff persistence
- **RepoManager** - Repository cloning
- **ReviewStateCache** - Caching by file SHA
- **FindingAggregator** - Multi-run deduplication

### Ports Module (`docs/api/ports/`)
Hexagonal Architecture abstractions:
- **ProcessRunner** - Command execution (security emphasis)
- **FileSystem** - File operations
- **Clock** - Time abstraction
- **Environment** - Environment variables
- **OutputWriter** - Console output
- **ExecutableFinder** - PATH lookup

### Utilities Module (`docs/api/utils/`)
Performance-critical utilities:
- **rateLimitHandler** - Exponential backoff with jitter
- **diffParser** - GitHub diff parsing
- **languageDetector** - Language detection
- **testFileMapper** - Test file discovery
- **ignoreFilter** - Glob-based filtering
- **streamingDisplay** - Terminal streaming
- **redact** - Secure token redaction

## Documentation Statistics

| Module | Files | Coverage |
|--------|-------|----------|
| utils/ | 9 | 100% |
| ports/ | 7 | 100% |
| review/ | 6 | 100% |
| ci/ | 5 | 100% |
| errors/ | 1 | 100% |
| audit/ | 2 | 100% |
| **Total** | **61** | **95%+** |

## Configuration

See `typedoc.json` for settings:
- `entryPoints` - Source files to document (src/)
- `out` - Output directory (docs/api/)
- `plugin` - Markdown output format
- `excludePrivate` - Only public API
- `categorizeByGroup` - Groups by Classes, Functions, Interfaces

## Examples

### ReviewEngine Usage
```bash
open docs/api/review/engine/README.md
```
Comprehensive overview and examples of the core review orchestrator.

### ProcessRunner Security
```bash
open docs/api/ports/processRunner/README.md
```
Detailed security documentation on command execution safety.

### RateLimitHandler
```bash
open docs/api/utils/rateLimitHandler/README.md
```
Algorithm documentation and exponential backoff formula.

## Next Steps

### Publish Documentation Website
```bash
npm install --save-dev typedoc-theme-hierarchy
# Update typedoc.json theme setting
# Deploy docs/ to GitHub Pages or web server
```

### Extract Examples as Tests
Parse `@example` blocks and run as automated integration tests to verify documentation examples work.

### Generate JSON Schemas
Export port interfaces as OpenAPI/JSON schemas for runtime validation.

## Maintenance

- Regenerate docs when adding new public APIs
- Keep JSDoc comments in sync with code changes
- Use `pnpm docs:watch` during development
- Generated `docs/api/` is auto-ignored by git (see .gitignore)

## Documentation Guide

See `docs/GENERATION.md` for detailed information on:
- How documentation is generated
- File structure and organization
- Configuration options
- Troubleshooting

## Files

- **typedoc.json** - TypeDoc configuration
- **docs/README.template.md** - Overview and architecture
- **docs/GENERATION.md** - Generation guide
- **docs/api/** - Generated markdown documentation (auto-ignored)
- **package.json** - `docs` and `docs:watch` scripts

---

**Generated from comprehensive TypeScript JSDoc comments ensuring documentation stays in sync with code.**
