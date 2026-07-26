---
layout: default
title: Eval Command
---

# `eval` Command

The `eval` command runs the Golden-PR evaluation harness against a test corpus. It measures the precision and recall of Merge Mentor review findings against benchmark expected issues to validate prompt changes or provider performance.

## Usage

```bash
# Run evaluation with the default mock provider
merge-mentor eval

# Evaluate using a specific AI provider against custom corpus directory
merge-mentor eval --provider copilot-sdk --corpus-dir ./test/eval/corpus

# Set custom quality gate thresholds for recall and precision
merge-mentor eval --min-recall 0.85 --min-precision 0.80

# Save JSON evaluation report to a file
merge-mentor eval --json --output-file ./eval-report.json
```

---

## Options

| Option                     | Description                                                | Default              |
| -------------------------- | ---------------------------------------------------------- | -------------------- |
| `--corpus-dir <path>`      | Path to test corpus directory                              | `./test/eval/corpus` |
| `--provider <name>`        | AI provider to use (`mock`, `copilot-sdk`, `opencode-sdk`) | `mock`               |
| `--min-recall <number>`    | Minimum required recall threshold (0.0 - 1.0)              | `0.9` (90%)          |
| `--min-precision <number>` | Minimum required precision threshold (0.0 - 1.0)           | `0.85` (85%)         |
| `--json`                   | Output raw JSON report to stdout                           | `false`              |
| `--output-file <path>`     | Path to write JSON evaluation report                       | -                    |

---

## Benchmark Metrics

The evaluation harness compares detected findings against expected findings in the test corpus:

- **Recall**: Percentage of expected issues in the corpus correctly identified by the review process.
- **Precision**: Percentage of detected findings that correspond to genuine expected issues (minimizing false positives).
- **Quality Gate**: The command returns exit code `0` if overall recall and precision meet or exceed the specified thresholds (`--min-recall` and `--min-precision`), or exit code `1` if thresholds are violated.
