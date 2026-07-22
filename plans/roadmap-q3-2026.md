# Merge Mentor — Q3 2026 Roadmap: "Harden the Core"

|                    |                                                               |
| ------------------ | ------------------------------------------------------------- |
| **Period**         | 2026-07-22 → 2026-10-22                                       |
| **North star**     | Quality & trust                                               |
| **Status**         | Approved by CEO (2026-07-22)                                  |
| **Owner**          | Product Owner                                                 |
| **Team capacity**  | Solo + AI-assisted engineering                                |
| **Roadmap shape**  | Steady incremental (weekly patches, monthly release train)    |
| **Business model** | Pure open source (MIT) — no monetization surface this quarter |

## Locked decisions (CEO sign-off, 2026-07-22)

- **No telemetry.** Sending data to third parties is a red flag for enterprise adoption; holding off builds trust. All quality measurement must be local or from public data.
- **v3.0 breaking release is acceptable** around October.
- **GitLab support is not a requirement** in the short or medium term.
- **Codebase semantic search is cut** from this quarter (see [Parking lot](#parking-lot)).
- The critical security findings in the independent code review (2026-07-22) are **fixed first**, before any new feature work.

## Quarter overview

| Month   | Theme                        | Release                  | Headline outcome                                                         |
| ------- | ---------------------------- | ------------------------ | ------------------------------------------------------------------------ |
| Jul–Aug | Trust Foundation             | `2.10.1` (wk 1) → `2.11` | Critical RCE patched ≤ 7 days; all Critical+High audit findings closed   |
| Sep     | Reliability & Signal Quality | `2.12`                   | Comment dedup shipped; structural debt burned down; eval corpus started  |
| Oct     | Conversation & Confidence    | **`3.0`**                | `reply` command; secure-by-default becomes the only mode; eval gate live |

## Month 1 — Trust Foundation (2026-07-22 → 2026-08-31)

**Week 1 — security patch `2.10.1`:**

- Fix the `fix`-command prompt-injection → RCE vector: apply the review path's existing defenses (security preamble, untrusted-content delimiters, human confirmation before shell/file-write tools).
- Fix the platform-token leak to a third-party API.
- Ship `SECURITY.md` with a disclosure policy in the same release.

**Weeks 2–5 — close the audit (`2.11`):**

- Remaining High findings: Azure review-state cache never persisting (silent functional defect), broken Codecov upload, inconsistent untrusted-content handling.
- CI hardening: `permissions`/`concurrency`/`timeout` on the main workflow, OS/Node matrix, e2e smoke tests for `review` + `fix` paths.
- Governance: `CONTRIBUTING.md`, `CODEOWNERS`, fix the 12 broken `pages/` links in the README.

**Exit criteria:** zero Critical/High findings open; patch shipped ≤ 7 days; CI green across OS matrix.

## Month 2 — Reliability & Signal Quality (Sep, `2.12`)

- Ship [hybrid zero-dependency comment deduplication](./hybrid-zero-dependency-deduplication-plan.md) (line-shift + rewording resilient) — the top perceived-quality win.
- Burn down structural debt incrementally (no big-bang refactor): staged split of the `ReviewEngine` god object, de-duplicate the three-way CLI/provider copy-paste, bring the CLI layer to test parity.
- False-positive tuning pass on review prompts.
- Start the golden-PR eval corpus (known-issue PRs used to measure review quality locally).
- Deprecation warnings for anything v3.0 will remove.

**Exit criteria:** dedup shipped; branch coverage ≥ 85%; no release-blocking refactor in flight.

## Month 3 — Conversation & Confidence (Oct, `3.0`)

- Ship the [interactive comment loop](./interactive-comment-loop-plan.md) (`reply` command): respond to PR comment threads on both GitHub and Azure DevOps, auto-resolve threads when fixed.
  - **Security gate:** `reply` ingests the same untrusted-input class as `fix` (PR comments) and must be built on Month 1's security framework; a threat-model review is required before merge.
- v3.0 removes the insecure auto-approve path entirely — secure-by-default becomes the only mode. Migration guide in the release notes.
- Eval harness becomes a CI regression gate on all prompt/engine changes.
- Community flywheel: good-first-issues labeled, issue templates, first external-contributor push.

**Exit criteria:** `reply` shipped on both platforms; eval gate blocking; v3.0 migration guide published.

## Metrics (local/public only — no telemetry)

- **Security:** 0 open Critical/High findings, sustained all quarter.
- **Quality:** eval-corpus false-positive and duplicate-comment rates (measured before/after dedup); branch coverage ≥ 85%.
- **Adoption proxies (public data):** npm weekly downloads +30% vs. July baseline, upgrade velocity to latest version, median issue time-to-close < 7 days, first external contributor PR merged.

## Explicitly cut this quarter

- Codebase semantic search (parked — see below)
- GitLab platform adapter
- Any monetization surface (hosted dashboard, paid tiers)
- Enterprise-segment-specific features (SSO, audit dashboards)

## Parking lot

- **Codebase semantic search** ([plan](./codebase-semantic-search-plan.md)): cut 2026-07-22. Rationale: full-codebase context is table stakes among competitors (Greptile, CodeRabbit, Copilot) rather than a differentiator; it partially duplicates provider-native capabilities (Copilot SDK repo context; agent SDK read tools); and the maintenance surface (local ONNX embeddings, SQLite vector store, index freshness) is wrong for a solo team right now. **Revisit only with user evidence** that provider-native context is insufficient (e.g., self-hosted small models via Ollama/vLLM).
- **Interactive comment loop** was the runner-up that replaced it as the Month 3 headline.

## Top risks

1. **Solo capacity / AI-assisted velocity variance** — Month 3 polish flexes first; headlines don't.
2. **`reply` reintroducing an injection vector** — gated on the Month 1 security framework + pre-merge threat-model review.
3. **AI SDK churn** — providers bump weekly; renovate + the CI audit job stay non-negotiable.
4. **v3.0 breaking-change communication** — deprecation warnings in `2.12`, migration guide at release.

## Operating cadence

- Weekly: triage + patch releases as needed.
- Monthly: release train (`2.11` → `2.12` → `3.0`) + 30-min CEO/PO review against the exit criteria above.
- CHANGELOG discipline continues (Keep a Changelog + semver).

## This week's first moves

1. Cut the `2.10.1` security patch branch.
2. Open a tracking issue for audit remediation.
3. Draft `SECURITY.md`.
4. Pull the npm/GitHub baseline numbers for the metrics above.
