# 🎯 Golden-PR Eval Corpus & Quality Harness Plan

## Overview

As defined in the [Q3 2026 Roadmap](file:///root/merge-mentor/plans/roadmap-q3-2026.md), `merge-mentor` operates under a strict **no-telemetry policy**. To evaluate AI prompt effectiveness, review precision, and deduplication quality without sending data to third-party services, we require an offline benchmark suite: the **Golden-PR Eval Corpus & Harness**.

This document outlines the design, architecture, schemas, and step-by-step implementation for the Golden-PR Eval Corpus and automated quality harness, incorporating decisions from design reviews.

---

## High-Level Architecture

```mermaid
flowchart TD
    A[Corpus Test Cases\ntest/eval/corpus/] --> B[Eval Harness Engine\nsrc/eval/harness.ts]
    B --> C{Execution Mode}
    C -- Unit / Fixture Test Mode --> D[Mock AI Provider\nsrc/eval/mockProvider.ts\n(Loads mock-response.json)]
    C -- Live Benchmark Mode --> E[Live AI Provider\nCopilot / OpenCode]
    D --> F[ReviewEngine Output]
    E --> F
    F --> G[Grader & Metrics Evaluator\n(Flexible Keyword/Category Matching)]
    G --> H[Precision, Recall & Duplication Report]
    H --> I[Terminal Output & Optional JSON Export]
```

---

## Design Decisions Summary

1. **Flexible Finding Matching**: Evaluation matches finding output against expected ground truth using `filePath`, `category` / `minSeverity`, and `containsKeywords` in comment text. Line numbers are not strictly enforced to accommodate minor LLM line reference shifts.
2. **Multi-Pass Sequential Deduplication**: Scenarios can define an array of `passes` with sequential diffs and previous review comments to evaluate re-review deduplication and comment suppression across PR iterations.
3. **Fixture-Based Mock AI Provider**: In mock mode (`--provider mock`), `src/eval/mockProvider.ts` loads static model output from `<scenarioDir>/mock-response.json` for deterministic, fast, zero-cost unit testing.
4. **Opt-In CLI & CI Integration**: The evaluation harness is exposed via `pnpm eval` (`merge-mentor eval`) as an opt-in quality benchmark command rather than blocking standard local `pnpm check` validation runs.
5. **Rich Terminal & Machine Outputs**: Outputs a formatted, colorized terminal summary table (Recall, Precision, Duplicate Count, Pass/Fail status per scenario) with optional export via `--json` or `--output-file <path>`.

---

## Corpus Structure & Schemas

The corpus lives in `test/eval/corpus/` and contains curated, version-controlled PR scenarios with known ground truth expectations.

### Directory Layout

```
test/eval/corpus/
├── 01-sql-injection-auth/
│   ├── PR_MANIFEST.json        # Metadata about the scenario
│   ├── diffs/                  # Diff files (compatible with DiffStorage)
│   │   ├── manifest.json
│   │   └── src__auth__login.ts.diff
│   ├── ground-truth.json       # Expected & forbidden findings
│   └── mock-response.json      # Static AI provider output fixture for mock mode
├── 02-benign-refactor/         # False-positive reduction scenario
└── 03-reworded-duplicate/      # Multi-pass line-shift & rewording deduplication scenario
```

### Ground Truth Schema (`test/eval/corpus/*/ground-truth.json`)

```json
{
  "scenarioId": "01-sql-injection-auth",
  "name": "SQL Injection in User Authentication",
  "description": "Tests if critical SQL injection vulnerability is identified and benign logger refactor is ignored.",
  "expectedFindings": [
    {
      "id": "exp-01",
      "filePath": "src/auth/login.ts",
      "category": "security",
      "minSeverity": "critical",
      "containsKeywords": ["sql injection", "parameterized query"]
    }
  ],
  "forbiddenFindings": [
    {
      "id": "forbid-01",
      "filePath": "src/auth/logger.ts",
      "reason": "Standard console logger refactor should not trigger security or performance flags"
    }
  ],
  "maxAllowedDuplicates": 0,
  "passes": [
    {
      "passIndex": 1,
      "diffDir": "diffs/pass1"
    },
    {
      "passIndex": 2,
      "diffDir": "diffs/pass2",
      "expectedSuppressedCount": 1
    }
  ]
}
```

---

## Key Modules to Implement

### 1. Types & Interfaces (`src/eval/types.ts`)

Defines ground truth schemas, multi-pass configurations, evaluation metrics, and result reports:

```typescript
export interface ExpectedFinding {
  readonly id: string;
  readonly filePath: string;
  readonly category: string;
  readonly minSeverity?: string;
  readonly containsKeywords?: readonly string[];
}

export interface ForbiddenFinding {
  readonly id: string;
  readonly filePath: string;
  readonly reason: string;
}

export interface ScenarioPassConfig {
  readonly passIndex: number;
  readonly diffDir: string;
  readonly expectedSuppressedCount?: number;
}

export interface GroundTruth {
  readonly scenarioId: string;
  readonly name: string;
  readonly description: string;
  readonly expectedFindings: readonly ExpectedFinding[];
  readonly forbiddenFindings: readonly ForbiddenFinding[];
  readonly maxAllowedDuplicates: number;
  readonly passes?: readonly ScenarioPassConfig[];
}

export interface ScenarioEvalResult {
  readonly scenarioId: string;
  readonly passed: boolean;
  readonly recall: number;
  readonly precision: number;
  readonly duplicateCount: number;
  readonly caughtFindings: readonly string[];
  readonly missedFindings: readonly string[];
  readonly falsePositives: readonly string[];
}

export interface FullEvalReport {
  readonly timestamp: string;
  readonly overallPassed: boolean;
  readonly meanRecall: number;
  readonly meanPrecision: number;
  readonly totalDuplicates: number;
  readonly scenarioResults: readonly ScenarioEvalResult[];
}
```

### 2. Scenario Evaluator Engine (`src/eval/harness.ts`)

Executes corpus scenarios against [ReviewEngine](file:///root/merge-mentor/src/review/engine.ts) using [DiffStorage](file:///root/merge-mentor/src/review/diffStorage.ts):

- **Flexible Ground Truth Matcher**: Validates if generated findings match expected findings based on file path, category/minSeverity, and keyword inclusion.
- **Recall Calculation**:
  $$\text{Recall} = \frac{|\text{Expected Findings Caught}|}{|\text{Total Expected Findings}|}$$
- **Precision Calculation**:
  $$\text{Precision} = \frac{|\text{True Positives}|}{|\text{True Positives}| + |\text{False Positives}|}$$
- **Multi-Pass Deduplication Evaluator**: Simulates PR update iterations by carrying existing comments into subsequent passes and evaluating duplicate comment suppression.

### 3. Deterministic Mock Provider (`src/eval/mockProvider.ts`)

Implements the [AIProviderClient](file:///root/merge-mentor/src/ai/types.ts#L98-L142) interface to load and return static model responses from `<scenarioDir>/mock-response.json` for deterministic, zero-cost harness testing.

### 4. CLI Command (`src/commands/eval.ts`)

Adds the `eval` command to Commander:

```bash
pnpm merge-mentor eval [options]

Options:
  --corpus-dir <path>     Path to test corpus (default: "./test/eval/corpus")
  --provider <name>       AI provider: mock, copilot-sdk, opencode-sdk (default: "mock")
  --min-recall <number>   Minimum required recall threshold (default: 0.90)
  --min-precision <num>   Minimum required precision threshold (default: 0.85)
  --json                  Output evaluation report as JSON to stdout
  --output-file <path>    Write evaluation report to target JSON file path
```

---

## Step-by-Step Implementation Plan

| Step       | Action                                                             | Target Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| :--------- | :----------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Step 1** | Create type definitions and schemas for ground truth and reports   | `src/eval/types.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Step 2** | Create deterministic mock AI provider loading `mock-response.json` | `src/eval/mockProvider.ts`<br>`src/eval/mockProvider.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Step 3** | Implement evaluation harness engine, fuzzy matcher & metrics       | `src/eval/harness.ts`<br>`src/eval/harness.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Step 4** | Build initial Golden-PR corpus scenarios & fixtures                | `test/eval/corpus/01-sql-injection-auth/`<br>`test/eval/corpus/02-benign-refactor/`<br>`test/eval/corpus/03-reworded-duplicate/`<br>`test/eval/corpus/04-resource-leak/`<br>`test/eval/corpus/05-cross-file-breaking-change/`<br>`test/eval/corpus/06-generated-file-exclusion/`<br>`test/eval/corpus/07-moscow-prioritization/`<br>`test/eval/corpus/08-repo-rules-compliance/`<br>`test/eval/corpus/09-unhandled-async-error/`<br>`test/eval/corpus/10-hallucinated-line-exclusion/` |
| **Step 5** | Create CLI `eval` command with formatted summary & export          | `src/commands/eval.ts`<br>`src/commands/eval.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Step 6** | Register command in CLI entrypoint & add `pnpm eval` script        | `src/index.ts`<br>`package.json`                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Step 7** | Add opt-in CI runner workflow job                                  | `.github/workflows/eval.yml`                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Step 8** | Run full validation suite (`pnpm check`)                           | `pnpm check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

---

## Coding Rules & Guidelines Compliance

- **ES Modules**: All imports MUST include `.js` extensions (e.g. `import type { GroundTruth } from "./types.js"`).
- **Strict TypeScript**: Strict type guards, no `any`, no `!` non-null assertions.
- **Error Handling**: Explicit exception mapping using custom errors from [src/errors/](file:///root/merge-mentor/src/errors/).
- **Testing**: Co-located unit specs (`src/eval/*.spec.ts`) using Vitest.
