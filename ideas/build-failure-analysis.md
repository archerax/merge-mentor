# Feature Idea: Automated Build Failure Analysis & Remediation Post-Mortem

## Executive Summary

**Merge Mentor** expands its capabilities from pull request review and user story verification to continuous integration build failure intelligence.

When a CI/CD build or workflow run fails in GitHub Actions or Azure Pipelines, `merge-mentor` can automatically trigger (via webhook, CI step action, or CLI command `merge-mentor build`), download and parse the raw build/test execution logs, pinpoint root causes (compilation errors, failed assertions, environment issues, missing dependencies, or flaky tests), and generate a comprehensive **Build Failure Post-Mortem**.

Crucially, it posts automated inline remediation suggestions (` ```suggestion ```` blocks) or a detailed diagnostic report directly on the associated PR or workflow run summary, enabling developers to resolve build breaks instantly.

---

## 🎯 Target Persona & User Story

- **Target Users:** Software Engineers, DevOps/SRE Engineers, CI Maintainers, and Engineering Leads.
- **Problem:**
  - Build and pipeline failures stall PR merging and interrupt developer velocity.
  - Parsing thousands of lines of raw CI console output to locate the root cause (e.g. nested TypeScript error, hidden stack trace, or environment timeout) is tedious and time-consuming.
  - Retrying failed builds blindly without understanding root causes wastes CI compute time and developer focus.
- **Goal:**
  - Instantly isolate root cause failure snippets from dense CI logs.
  - Auto-generate a structured post-mortem explaining _why_ the build failed and how the failure relates to recent PR code changes.
  - Provide actionable, 1-click executable remediation suggestions (`fix` command or native platform code suggestions) to fix the build immediately.

---

## 🛠 MVP Scope & Key Capabilities

### 1. Triggering & Integration Mechanisms

- **CI Workflow Action / Webhook:** Trigger `merge-mentor build` automatically upon `failure()` status in GitHub Actions or Azure Pipelines.
- **CLI Command:** `merge-mentor build --run-id <id>` or `--pr <id>` to run on-demand locally or in CI pipelines.
- **Platform Log Extraction:** Connect to GitHub REST API (`/repos/{owner}/{repo}/actions/runs/{run_id}/logs`) or Azure DevOps Build API (`_apis/build/builds/{buildId}/logs`) to fetch raw log streams.

### 2. Log Ingestion & Noise Filtering Engine

- **Chunking & Anomaly Detection:** Strip repetitive noise (verbose setup steps, dependency downloads, standard output) and isolate error sections (`stderr`, stack traces, non-zero exit codes, test framework output like Vitest, Jest, PyTest, or compiler errors like `tsc`/`cargo`/`mvn`).
- **Diff Context Correlation:** Map stack traces and file/line numbers back to the exact code changes introduced in the Pull Request diff.

### 3. Automated Post-Mortem Report Generation

Generates a markdown report containing:

- **Failure Classification:** Categorize failure type (e.g., _TypeScript Compilation Error_, _Unit Test Assertion Failure_, _Missing Dependency / Lockfile Drift_, _Environment / Timeout Flake_, _Linting / Formatting Error_).
- **Root Cause Summary:** Clear, developer-friendly explanation of why the build broke.
- **Affected Code & Diff Mapping:** Links directly to the relevant file and line range in the PR diff.
- **Flakiness Indicator:** Checks historical run data to flag if the failure is a known flaky test rather than a code regression.

### 4. Remediation & Code Patch Generation

- **Native Platform Suggestions:** Post inline replacement code blocks (` ```suggestion ````) directly to PR files when the fix is localized (e.g. missing import, typo, missing mock parameter).
- **Interactive Remediation:** Integration with `merge-mentor fix --build-failure`, enabling developers to pull down the post-mortem analysis and auto-apply code fixes locally.

---

## 📐 Technical Architecture & CLI Design

### Command Interface (`merge-mentor build`)

```bash
# Analyze a specific build run on GitHub Actions
MM_GITHUB_TOKEN=your_token merge-mentor build --run-id 987654321 --pr 123

# Analyze Azure DevOps build failure in CI
MM_AZURE_DEVOPS_TOKEN=your_token merge-mentor build --build-id 456 --write

# Generate post-mortem output as local Markdown file or JSON report
merge-mentor build --run-id 987654321 --format markdown --output ./post-mortem.md
```

### Modular Pipeline Architecture

1. **Log Adapter (`src/ci/`):**
   - Ingests raw zip or multi-file log streams from CI platform APIs.
   - Extracts relevant job logs corresponding to failed steps.
2. **Log Parser (`src/build/parser.ts`):**
   - Applies heuristics and regex filters to extract error blocks (stack traces, exit codes, compiler output).
   - Constrains payload size before sending context to AI providers.
3. **Correlation Engine (`src/build/correlator.ts`):**
   - Cross-references stack traces with the PR file diff using `src/platforms/`.
4. **AI Diagnostic & Post-Mortem Generator (`src/build/prompts/`):**
   - Prompts AI provider (Copilot / OpenCode SDK) to synthesize root cause, failure classification, and remediation patch.
5. **Publisher Port (`src/review/` / `src/platforms/`):**
   - Writes post-mortem summary comment to PR / Workflow Run step summary, and attaches native inline suggestions.

---

## 💡 Example Post-Mortem Output

```markdown
## ❌ CI Build Failure Post-Mortem

**Workflow Run:** `#987654321` | **PR:** `#123` | **Failure Type:** `TypeScript Compilation Error`

### 🔍 Root Cause Analysis

The build failed during the `pnpm typecheck` step due to a missing property in `src/ports/logger.ts`. Line 42 references `logger.trace()`, but `LogLevel` enum does not declare `trace`.

### 📍 Failed Execution Log Snippet
```

src/ports/logger.ts:42:15 - error TS2339: Property 'trace' does not exist on type 'Logger'.
42 this.logger.trace(message);

`````

````

### 🛠 Proposed Remediation

Apply the following fix to extend `Logger` interface:

```suggestion
  debug(message: string, meta?: Record<string, unknown>): void;
  trace(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
````

```

---

## 🔮 Future Enhancements & Strategic Value

- **Auto-Retry Flaky Tests:** Automatically trigger a job re-run if post-mortem determines the failure was an infrastructure flake (network timeout, 503 HTTP error) rather than a code issue.
- **Build Failure Analytics:** Aggregate build failure root causes across teams to identify weak test suites, unstable third-party dependencies, or recurring build environment friction.
```
`````
