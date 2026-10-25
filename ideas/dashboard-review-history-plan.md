# Feature Plan: Dashboard Review History and Outcomes View

## Overview

The local dashboard (`merge-mentor ui`) runs reviews and shows reports and the
audit log. It has no view of how reviews have fared over time.

## Dependencies

Builds on `outcome-tracking-plan.md` (data) and the shared history cache; do not
start before that pipeline exists.

## Proposal

- History page: reviewed PRs, findings posted, resolved vs dismissed vs ignored.
- Trend of resolution rate; list of recurring finding categories.
- Link each row to the stored report and audit entries.
- Local-only, same token protection as the rest of the dashboard.

## Tests

- Rendering with empty history, partial data, and large histories.

## Open Decisions

- Show per-author data? Recommendation: no, keep everything PR- and
  category-level (see anonymisation concerns in the coaching plan).
