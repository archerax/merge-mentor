# Merge Mentor — Product Roadmap (Next 3–6 Months)

Written 2026-10-18 from a read of the README, changelog, `docs/eval.md`, the
other plans in `ideas/`, and `ideas/app-review-2026-10-16.md`. It is a product
view, not a code audit. Assumptions are listed at the end.

## Where the product stands

- **Broad.** 10 commands, GitHub and Azure DevOps, four AI providers, a
  multi-agent review strategy, and a web dashboard that survives a refresh.
- **Healthy engineering.** About 2,160 tests pass and there is an eval harness.
- **Foundations not yet safe.** The last app review found a critical dashboard
  CSRF/DNS-rebinding hole, prompt-injection file writes via `fix` and the
  Copilot permission handler, a release job that probably cannot publish, and
  a failing CI audit.
- **Version drift.** The package is 3.1.1 while the work is branded v4.
- **No feedback loop.** Findings are posted and never scored. The real
  false-positive rate is unknown. The eval corpus is about 10 synthetic PRs, and
  the "recall-first" multi-agent change is unmeasured.
- **Focus risk.** `pbi`, `project`, `plan`, `describe` and `build` have
  widened the surface while the core promise (a trustworthy first-pass PR
  review) is less proven than the breadth suggests.

## Principles

1. Trust before features. A reviewer bot that is unsafe or noisy gets turned off.
2. Measure the mentor. Every quality claim needs a number behind it.
3. Stay self-hosted and zero-telemetry. That is the differentiator.
4. Earn each command its place. No new commands until the quality loop exists.

## Phase 1 (months 0–1): make it safe and shippable

| # | Work | Source |
| - | ---- | ------ |
| 1 | Dashboard guard: reject unexpected `Host`, enforce origin/CSRF on all non-GET routes, require `application/json`, add a per-launch token | app review #1 |
| 2 | Copilot permission handler to an allowlist; scope `fix` writes to the working tree and deny `.git/`, `.husky/`, `.github/`, `.vscode/`; act only on bot/collaborator comments by default | app review #2, #3 |
| 3 | Unblock release: drop `private` from the root package and prove a real `npm publish`; resolve the `braces` audit failure | app review #4, #5 |
| 4 | Ship v4 with a security note and fix the version drift | — |
| 5 | Fix fork-PR workspace resolution, bot-comment impersonation, and duplicate comments on write retries | app review #6, #8, #10 |
| 6 | Remaining medium items (#7, #9, #11, #12) and hygiene items | app review |

**Exit criteria:** no open critical or high findings, a published v4, CI green.
No new commands this phase.

## Phase 2 (months 1–3): prove quality and close the loop

1. **Outcome tracking.** Build `outcomes` per `ideas/outcome-tracking-plan.md`:
   fixed, dismissed or ignored per finding and per category. Resolution rate is
   the north-star metric. If only one feature ships, it is this one.
2. **Credible eval set.** Grow the corpus from about 10 synthetic PRs to 50–100
   cases from real, anonymised bugs. Track precision, recall and cost per
   review in CI as a regression gate for prompt and model changes.
3. **Noise control.** Severity floor, per-PR comment cap, learning from
   dismissals, and one batched review (`pulls.createReview`) instead of one
   notification per finding.
4. **Pick the default strategy with data.** Compare `fast`, `deep` and
   `multi-agent` on quality and cost, choose a default, and document the
   trade-off.
5. **Design partners.** Recruit 3–5 teams on GitHub or Azure DevOps running it
   in CI. Interview them every two weeks.

**Exit criteria:** an outcomes report on real PRs, an eval gate in CI, a
documented default strategy, and at least 3 partners onboarded.

## Phase 3 (months 3–6): reach and compounding value

1. **Repo intelligence.** Build `analyze` per
   `ideas/repo-intelligence-and-team-coaching-plan.md` to mine past review
   comments and generate `AGENTS.md` rules, so reviews improve per repo. It
   shares the history pipeline with outcome tracking. Add `coach` only if
   partners ask for it.
2. **Easier adoption.** A first-class GitHub Action and Azure Pipelines task
   with copy-paste setup, sensible defaults, and a `doctor`-led path from
   install to first review in under 5 minutes.
3. **Enterprise basics.** Policy controls, audit export, and a data-handling
   document for security reviews.
4. **Prune.** Commit to the planning commands (`pbi`, `project`, `plan`) or
   mark them experimental and stop investing, based on partner usage.
5. **Trust docs.** What leaves the machine, what gets posted, how dry-run works.

**Exit criteria:** repo-intelligence rules measurably improving a partner repo,
a documented onboarding path, and a prune decision made.

## Explicitly not doing

- New platforms (GitLab, Bitbucket) before the quality loop exists. Revisit at
  month 6 if partners ask.
- A hosted SaaS version. It contradicts the self-hosted, zero-telemetry pitch.
- More AI providers beyond the existing four.
- New commands in general.

## Success metrics at six months

| Metric | Target |
| ------ | ------ |
| Resolution rate (findings acted on) | above 40–50% and rising |
| False-positive rate (dismissed as wrong) | below 20% |
| Adoption | 3–5 teams running it on every PR in CI |
| Time to first review for a new user | under 5 minutes |
| Security and release health | zero open critical/high findings; working release automation |

## Risks

- **Outcome data needs volume.** Few reviewed PRs means noisy metrics.
  Mitigation: design partners, and backfill from historical PRs.
- **Recall-first multi-agent may raise noise and cost.** Mitigation: the eval
  gate and noise controls in phase 2.
- **Prompt-injection surface keeps growing** with each tool the agent gets.
  Mitigation: deny-by-default permissions as policy.
- **Capacity.** Three phases assume a small team. If capacity is lower, drop
  Phase 3 items 2–3 first, not Phase 2.

## Assumptions

- The product's users and commercial intent are not stated in the repo. If it is
  mainly a personal or portfolio project, cut enterprise basics and keep the
  quality loop. If it is heading toward a paid offering, move design partners and
  enterprise basics earlier.
- Team capacity is unknown.
- Not reviewed in depth: the Azure adapter internals, `build`/`stage`/`plan`,
  and multi-agent prompt quality.
