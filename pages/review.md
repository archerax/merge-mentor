---
layout: default
title: Review Command
---

# `review` Command

The `review` command reviews a pull request. This is the primary subcommand in Merge Mentor and accepts all general options, platform details, and review configurations.

## Usage

```bash
# Dry-run mode (preview only) - generates a detailed markdown report
merge-mentor review --pr 123

# Post comments to PR
merge-mentor review --pr 123 --write

# Specify a platform (default is github)
merge-mentor review --pr 456 --platform azure --write

# Use OpenCode SDK instead of Copilot SDK
merge-mentor review --pr 123 --provider opencode-sdk --write
```

---

## Options

### General Options

| Option                          | Description                                                               | Env Variable   | Default          |
| ------------------------------- | ------------------------------------------------------------------------- | -------------- | ---------------- |
| `--pr <number>`                 | Pull request number (required unless `--pr-url` or `--ci` is used)        | -              | -                |
| `--pr-url <url>`                | PR URL (automatically parses platform, repository details, and PR number) | -              | -                |
| `--ci`                          | CI mode: auto-detect platform and PR from environment variables           | -              | `false`          |
| `--platform <platform>`         | Platform to use (`github` or `azure`)                                     | `MM_PLATFORM`  | `github`         |
| `--write`                       | Post comments to PR (otherwise dry-run; CI mode defaults to write)        | -              | `false`          |
| `--temp-path <path>`            | Base path for temporary files (cache, diffs, logs, etc.)                  | `MM_TEMP_PATH` | `./.mergementor` |
| `--local-workspace-path <path>` | Path to a pre-existing local repository checkout                          | -              | -                |

### Review Configuration

| Option                    | Description                                                                                                            | Env Variable         | Default   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------- | --------- |
| `--review-type <type>`    | Type of review (`general`, `testing`, `security`, `performance`, `fast`, `custom`)                                     | `MM_REVIEW_TYPE`     | `general` |
| `--passes <passNames>`    | Comma-separated additive review passes (`scan`, `security`, `logic`, `performance`, `monorepo`, `testing`, `database`) | `MM_REVIEW_PASSES`   | -         |
| `--strategy <strategy>`   | Execution strategy (`deep` or `fast`)                                                                                  | `MM_REVIEW_STRATEGY` | `fast`    |
| `--git-backend <backend>` | Git backend for cloning/fetching (`cli` or `isomorphic`)                                                               | `MM_GIT_BACKEND`     | `cli`     |

### File Filtering

| Option               | Description                                   | Default           |
| -------------------- | --------------------------------------------- | ----------------- |
| `--ignore <pattern>` | Glob pattern for files to ignore (repeatable) | `**/generated/**` |

### Console Output Options

| Option                    | Description                                 | Env Variable           | Default |
| ------------------------- | ------------------------------------------- | ---------------------- | ------- |
| `--no-stream`             | Disable streaming output display            | `MM_STREAMING_ENABLED` | -       |
| `--stream-lines <number>` | Number of lines in streaming display (1-20) | `MM_STREAMING_LINES`   | `9`     |

---

## Review Profiles, Passes, and Strategies

Every review includes a **baseline review** running with the **fast** execution strategy by default. You can optionally switch to the **deep** execution strategy for higher coverage, or add ordered **passes** to increase attention in specific areas.

```bash
# Baseline review with deep strategy for maximum issues detection
merge-mentor review --pr 123 --strategy deep --write

# Baseline review plus testing attention (default fast strategy)
merge-mentor review --pr 123 --passes "testing" --write

# Baseline review plus multiple ordered passes with deep strategy
merge-mentor review --pr 123 --passes "security,database,performance" --strategy deep --write
```

### Choosing a Strategy

- **`fast` (default)**: Minimizes token/credit usage and gets faster results.
- **`deep`**: Highest issue detection rate. Uses multiple API calls. Under GitHub Copilot's usage-based billing, `deep` consumes roughly **2x the AI credits/tokens** compared to `fast`.

### Available Passes

- `scan`
- `security`
- `logic`
- `performance`
- `monorepo`
- `testing`
- `database`

### Common Profile Choices

| Profile                    | Use When                                                 | AI Calls | What It Emphasizes                                                   |
| -------------------------- | -------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| **Baseline**               | Standard development or unsure what to add               | 2        | Broad code review coverage                                           |
| **Baseline + fast**        | Routine PRs where cost or latency matters                | 1        | Same baseline coverage with a cheaper execution strategy             |
| **Baseline + testing**     | Adding/modifying tests or testable code                  | 2        | Test coverage, test quality, assertions, mocks                       |
| **Baseline + security**    | Handling sensitive data or auth flows                    | 2        | Vulnerabilities, auth flaws, data exposure, unsafe trust boundaries  |
| **Baseline + performance** | Performance-critical paths or scaling concerns           | 2        | Efficiency, resource usage, caching, expensive queries               |
| **Baseline + database**    | Changing schemas, queries, repositories, or transactions | 2        | Schema safety, query correctness, migrations, transaction boundaries |
| **Baseline + monorepo**    | Touching workspace structure or cross-package contracts  | 2        | Package boundaries, dependency ownership, shared tooling impacts     |

---

## Testing Pass Deep Dive

The `testing` pass adds specialist attention to four key areas:

### 1. Test Coverage Analysis

- Verifies new/modified functions have corresponding tests.
- Checks edge cases (null, empty, invalid input) and error paths.
- Validates all public methods and conditional branches are covered.
- Checks async operations have success and failure tests.

### 2. Test Naming Convention Validation

Checks for language-specific naming patterns.

- **C# Convention**: `MethodName_Scenario_ExpectedBehavior` (e.g. `GetUser_InvalidId_ThrowsException`). Test class naming should follow `ServiceNameTests`.
- **TypeScript Convention**: `describe`/`it` blocks with behavior descriptions (e.g. `it("should throw error when id is invalid", ...)`). Test file naming should be `.test.ts` or `.spec.ts`.

### 3. Assertion Verification

- Assertions match test names and behavior.
- Multiple assertions focus on the same logical concept.
- Assertions verify behavior outcomes rather than implementation details.
- Appropriate matchers are used (`toBe` vs `toEqual`, specific vs generic).

### 4. Mock Framework Usage

Verifies proper usage of mocking libraries like Moq, NSubstitute, or Vitest.

---

## Key Features

### Git Backends

Merge Mentor supports two backends for cloning/fetching repositories to extract coding standards:

- **`cli` (default)**: Uses the system `git` binary via child process.
- **`isomorphic`**: Uses [isomorphic-git](https://isomorphic-git.org/) (pure JS, no binary required, experimental).

```bash
# Use pure-JS git (no system git binary required)
merge-mentor review --pr 123 --git-backend isomorphic --write
```

### Pre-Existing Issue Detection

Merge Mentor automatically skips posting comments on issues that already existed in the target branch prior to the PR. This ensures only new issues introduced by the PR are flagged, keeping reviews noise-free.

### Ignoring Files and Directories

Exclude files using glob patterns:

```bash
# Ignore multiple patterns (repeatable flag)
merge-mentor review --pr 123 --ignore '*.test.ts' --ignore 'dist/**' --ignore 'coverage/**' --write
```

### Streaming Output Display

Shows the last N lines of AI model output in real-time, providing feedback during long reviews. Automatically disables in non-TTY environments (CI/CD).

```bash
# Disable streaming output
merge-mentor review --pr 123 --no-stream

# Show more lines
merge-mentor review --pr 123 --stream-lines 10
```

### Detailed Markdown Reports

In dry-run mode, Merge Mentor saves comprehensive markdown reports to `.mergementor/reports/`. They include metadata, severity indicators (🔴 Critical, 🟠 High, 🟡 Medium, 🟢 Low), file findings, and resolved issues from previous reviews.

### Incremental Reviews

Only analyzes changed files on re-reviews, saving time and cost. The cache is stored in `.mergementor/cache/`.

### Review Categories

Findings are classified into:

- 🐛 **Bug** - Potential bugs or logical errors
- 🔒 **Security** - Security vulnerabilities
- ⚡ **Performance** - Performance issues
- 📝 **Quality** - Code quality and readability
- 📚 **Documentation** - Missing or inadequate documentation
- 🏗️ **Architecture** - Architectural boundaries, coupling, and system structure concerns
- 🎨 **Design** - Software design patterns, clean code principles, and API design
- 🧪 **Testing** - Test quality, coverage gaps, assertions, and mock verification
