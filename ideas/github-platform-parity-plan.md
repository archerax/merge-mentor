# Feature Plan: GitHub / Azure DevOps Platform Parity

## Overview

Version 4.2.0 made Azure DevOps the default platform, a breaking change. Several
commands still work on only one platform, which makes the other a second-class
citizen. This plan closes the gaps and eases the migration.

## Current State

- `docs/project.md`: "GitHub project review is not yet supported."
- `docs/plan.md`: `plan` is Azure DevOps only; GitHub issues are rejected.
- `pbi` supports both platforms (to confirm per feature when scoping).
- Default platform flipped to Azure DevOps in 4.2.0; existing GitHub users must
  set `MM_PLATFORM=github`.

## Proposal

1. **Audit** every command against both platforms and publish a support matrix
   in `docs/index.md`.
2. **`project` for GitHub:** map GitHub Projects / milestones / parent-child
   issues onto the existing hierarchy model.
3. **`plan` for GitHub issues:** reuse the planning engine with an issue adapter.
4. **Migration help:** a one-time warning when no platform is configured and
   GitHub environment variables are present (`MM_GITHUB_*` set, `MM_PLATFORM`
   unset), pointing to `MM_PLATFORM=github`. `doctor` surfaces the same hint.
5. Keep adapter changes behind the existing `PlatformAdapter` interface.

## Tests

- Adapter contract tests run against both adapters.
- Command tests for each newly supported platform path.
- Warning appears only for the ambiguous configuration.

## Open Decisions

- Which GitHub construct represents a "project" (Projects v2 vs milestones)?
- Is the migration warning acceptable given the default was changed deliberately?
