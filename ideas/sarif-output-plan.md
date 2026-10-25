# Feature Plan: SARIF / Code-Scanning Output

## Overview

Emit review findings as SARIF so they appear in GitHub's code-scanning (Security
tab), Azure DevOps SARIF viewers and other tooling, alongside inline comments.

## Current State

- Findings are posted as inline PR comments and written as Markdown reports in
  `.mergementor/reports`.
- No machine-readable output format is documented.

## Proposal

- `merge-mentor review --format sarif --output findings.sarif`.
- Map file, line, severity, category and the finding fingerprint to SARIF
  `results` (fingerprint in `partialFingerprints` so alerts de-duplicate across
  runs).
- Document uploading with `github/codeql-action/upload-sarif` and the Azure
  Pipelines equivalent in `docs/ci-cd.md`.
- Read-only: does not change what is posted to the PR.

## Tests

- Schema validation of the produced SARIF; stable fingerprints between runs;
  empty findings produce a valid empty run.

## Open Decisions

- Should low-confidence findings be included, or only those posted?
- Severity-to-SARIF `level` mapping.
