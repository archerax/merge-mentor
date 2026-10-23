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
| `--ai-model <model>`       | Model name for the AI provider (`MM_AI_MODEL`)             | provider default     |
| `--ai-base-url <url>`      | OpenAI-compatible BYOK base URL (`MM_AI_BASE_URL`)         | -                    |
| `--ai-api-key <key>`       | BYOK API key (`MM_AI_API_KEY`)                             | -                    |
| `--min-recall <number>`    | Minimum required recall threshold (0.0 - 1.0)              | `0.9` (90%)          |
| `--min-precision <number>` | Minimum required precision threshold (0.0 - 1.0)           | `0.85` (85%)         |
| `--runs <number>`          | Samples per scenario; recall and precision are averaged    | `1`                  |
| `--json`                   | Output raw JSON report to stdout                           | `false`              |
| `--output-file <path>`     | Path to write JSON evaluation report                       | -                    |

---

## Benchmark Metrics

The evaluation harness compares detected findings against expected findings in the test corpus:

- **Recall**: Percentage of expected issues in the corpus correctly identified by the review process.
- **Precision**: Percentage of detected findings that correspond to genuine expected issues (minimizing false positives).
- **Quality Gate**: The command returns exit code `0` if overall recall and precision meet or exceed the specified thresholds (`--min-recall` and `--min-precision`), or exit code `1` if thresholds are violated.

Model output varies from run to run, so use `--runs 3` or more with a real provider. Each scenario's recall and precision are averaged over its runs, and misses and false positives are listed with how many runs they appeared in. Scenarios below 100% print what was expected but missed and every finding the model reported.

If the AI provider fails on a scenario (for example, it returns no content), that scenario is recorded as failed with 0% recall and the error message, and the remaining scenarios still run. The report is always written, so the quality gate fails but you can see every scenario's result.

---

## Corpus Format

Each scenario directory holds `ground-truth.json`, `mock-response.json` and a `diffs/` folder with a `manifest.json`. Every manifest entry needs a `diffPath` pointing to a file in `diffs/`; an entry without one is an error.

`ground-truth.json` classifies reported findings:

- `expectedFindings`: must be caught. Missing one lowers recall.
- `forbiddenFindings`: must not be reported for the given file. Reporting one is a false positive.
- `acceptableFindings` (optional): genuine issues in the diff that are not required, for example a second real bug in the same change. A matching finding is neutral: it is neither a catch nor a false positive.
- Any other finding is a false positive when the scenario lists at least one expected finding.

Real providers run in a temporary directory that holds only the scenario's diffs, so they cannot read the ground truth.
