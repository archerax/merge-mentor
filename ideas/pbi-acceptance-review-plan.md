# Feature Plan: PBI Acceptance Criteria Verification

## Overview

Add a mode that checks whether the code delivered for a PBI actually satisfies
the PBI's acceptance criteria (AC). Today `pbi` reviews the _quality of the
backlog item_ before work starts, and `review` reviews a _single PR_. Nothing
answers the question teams ask at the end: "is this PBI really done?"

The new mode starts from a PBI, finds every PR that delivered it (however
indirectly it is linked), inspects those PRs for evidence of each acceptance
criterion, and reports a per-criterion verdict.

## Current State

- `pbi` (`apps/cli/src/commands/pbi.ts`) fetches a PBI via
  `PlatformAdapter.getPBIDetails` and reviews its quality. It can post a
  comment on the PBI with `--write`.
- `PlatformAdapter.getLinkedPBIIds(prNumber)` goes **PR → PBI** only, using
  `getPullRequestWorkItemRefs`. There is no **PBI → PR** traversal.
- `AzureDevOpsAdapter` is constructed from a single `config.azure`
  (`token`, `org`, `project`, `repo`) and builds one `azdev.WebApi` against
  `https://dev.azure.com/{org}`. It cannot read work items or PRs in a second
  organization.
- Config is single-valued: `MM_AZURE_TOKEN`, `MM_AZURE_ORG`,
  `MM_AZURE_PROJECT`, `MM_AZURE_REPO`.
- `getProjectDetails` already walks work item relations (parent/child), so
  relation parsing has precedent, but it only follows hierarchy links.

## Proposal

### New command: `merge-mentor pbi-verify`

Decision: this is its own mode/command, separate from `pbi` (the inputs, cost
and outputs differ from the backlog-quality review).

```bash
merge-mentor pbi-verify 1024                       # dry run, console report
merge-mentor pbi-verify 1024 --write               # post report to the PR(s)
merge-mentor pbi-verify --url https://dev.azure.com/org-a/proj/_workitems/edit/1024
```

Scope decision: **Azure DevOps only** for now.

### Pipeline

1. **Gather PBI context.** Title, description, acceptance criteria (the ADO
   `Microsoft.VSTS.Common.AcceptanceCriteria` field), and comments, via the
   existing `getPBIDetails`. Split the AC into discrete, individually
   checkable criteria (AI-assisted when AC is free text; deterministic when it
   is a clear list or Given/When/Then blocks). Each criterion gets a stable ID
   (`AC1`, `AC2`, ...).
2. **Resolve delivery PRs** by walking the work item link graph (below).
3. **Collect evidence.** For each PR, load details and diff via the existing
   `getPRDetails` / `getPRFiles`, including tests added or changed.
4. **Assess.** Ask the AI provider, per criterion, whether the combined PR
   changes provide evidence the criterion is met. Use the existing
   multi-file / cross-file review machinery where it fits rather than a new
   engine.
5. **Report.** Per-criterion verdict plus an overall summary (see Output).

### Link traversal

Three supported shapes, all resolved by one traversal that returns a set of
`(org, project, repo, prId)` PR references, each tagged with the path that led
to it (for the report and for debugging):

| Shape | Path                                                           |
| ----- | -------------------------------------------------------------- |
| A     | PBI → PR (artifact link on the PBI)                            |
| B     | PBI → child Task → PR                                          |
| C     | PBI → child Task → **remote related** Task (other org) → PR    |

Traversal rules:

- Read the PBI with `$expand=relations`. Classify each relation:
  - `ArtifactLink` whose `url` is `vstfs:///Git/PullRequestId/{project}%2F{repo}%2F{prId}`
    → a PR reference (shape A).
  - `System.LinkTypes.Hierarchy-Forward` → child work item; recurse (shape B).
  - The "Remote Related" link type → a work item in another organization;
    resolve the target org from the relation (shape C) and recurse using
    **that org's credentials**.
- Generic recursion over children and remote links with a **depth limit**
  (default 3) and a **visited set** keyed by `(org, workItemId)` to prevent
  cycles. The three shapes fall out of the same loop instead of being
  special-cased.
- Traverse Tasks **and Bugs** under the PBI (and any tasks reached via remote
  links); ignore other work item types.
- **All completed PRs reached by any path are pooled** and assessed together as
  the delivery of the PBI. A PBI is normally split into tasks, so no single PR
  is expected to satisfy every criterion; a criterion is judged against the
  combined evidence from all of them.
- Deduplicate PRs. **Only completed (merged) PRs count as delivered**, because
  the goal is to verify the PBI is done. Active, draft and abandoned PRs are
  excluded from evidence but listed in the report as "linked, not completed"
  so a user can see why expected work is missing.
- If a link cannot be followed (no credentials for the target org, 403, 404),
  **do not fail the run**. Record it as an _unresolved link_ and surface it
  prominently in the report, because missing PRs make a "not met" verdict
  unreliable.
- A PR may be linked to several PBIs. Only the diff relevant to _this_ PBI's
  criteria is assessed, but the whole PR is available as context.

The PBI and the code may be in the same org or in different orgs, depending on
the project. Same-org setups only need shapes A and B; the Remote Related link
(shape C) is only used when the code lives in another org.

> **To verify during implementation:** the exact reference name and payload of
> the Remote Related link (target org/project identification, and whether the
> relation URL is directly fetchable with a PAT for the remote org). This
> determines how the target org is resolved. Spike this first.

### Multi-organization credentials

Today one PAT/org pair is configured. The feature needs a credential per ADO
organization, because PBIs/Tasks and code can live in different orgs and a PAT
is scoped to one org.

Proposed config shape:

```jsonc
// .mergementor/config.json (shape illustrative)
{
  "azure": {
    "default": "org-code",
    "orgs": {
      "org-code": { "token": "env:MM_AZURE_TOKEN_CODE" },
      "org-work": { "token": "env:MM_AZURE_TOKEN_WORK" }
    }
  }
}
```

And a per-org env-var convention with the org name as a suffix, which works in
CI with no config file: `MM_AZURE_TOKEN_<ORG>`, e.g. `MM_AZURE_TOKEN_MYORG`.
The existing `MM_AZURE_TOKEN` remains the token for `MM_AZURE_ORG`. (Proposed
name keeps the existing `MM_` prefix instead of `ADO_PAT_`.) The org name is
upper-cased and any character other than letters/digits becomes `_`, so org
`my-org` reads `MM_AZURE_TOKEN_MY_ORG`; `doctor` should warn if two orgs
normalize to the same suffix.

Design points:

- **Backwards compatible.** `MM_AZURE_TOKEN` + `MM_AZURE_ORG` keep working
  unchanged and are treated as the default org entry. No existing command
  changes behaviour.
- **Token resolution by org name**, not by command. A new
  `AzureConnectionPool` (or similar) hands out one `azdev.WebApi` per org,
  lazily created and cached. `AzureDevOpsAdapter` receives the pool instead of
  creating its own single connection; existing call sites keep using the
  default org.
- **Secrets stay out of files.** Tokens are referenced by environment variable
  name or supplied via env only, never written to the config file or to
  `.mergementor` logs/caches. Extend the existing audit-log redaction to cover
  all configured tokens.
- **`doctor` support.** `merge-mentor doctor` checks each configured org's
  token (reachable, scopes sufficient: Work Items read, Code read) and lists
  orgs referenced by links that have no credentials.
- **Web dashboard.** The config viewer (`apps/web/src/server/config.*`) must
  mask every org token, not only the single current one.
- **Least privilege.** Read-only scopes for remote orgs. Only the org that
  receives the report needs write scope.

### Output

Dry run is the default, consistent with the rest of the tool. Two destinations:

- **Console / web UI:** the full report. The dashboard gets a "PBI
  verification" view.
- **`--write`:** post the report as a comment on the delivery **PR(s)**.
  Repeat runs update the existing bot comment instead of adding a new one.
  (Nothing is posted on the PBI.)

Each acceptance criterion gets one of two outcomes:

- **Likely met**, with supporting evidence the reader can follow. Every Met verdict
  must cite where it was seen, for example:
  _"AC2: Button text updated: PR 12334, `Button.js`, line 123."_
  Evidence is PR number (linked), file path and line, plus a one-line
  explanation. A criterion with no citable evidence cannot be reported as Likely met.
- **No evidence found that this has been met.** Used whenever the code
  does not give enough certainty: no matching change found, the criterion is
  not verifiable from code (performance, UX, sign-off), or some links could not
  be followed. This is _not_ a claim that the criterion is unmet, and the
  report wording says so. When links were unresolved, the report names the
  unresolved links as a likely reason.

The report header shows the PBI, the PRs considered (and how each was
reached), PRs excluded as not completed, unresolved links, and the work item
revision the criteria were read from. The overall status is "all criteria met"
only when every criterion is Likely met; otherwise it lists how many remain
undetermined.

### Architecture sketch

| Area                | Change                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------- |
| `libs/config`       | Multi-org Azure credential model; env + file resolution; validation                     |
| `libs/platforms`    | `AzureConnectionPool`; cross-org work item/PR fetch; PBI→PR traversal                    |
| `libs/domain`       | New optional interface, e.g. `PBIDeliveryResolver` (`resolveDeliveryPRs(pbiId)`), so the `PlatformAdapter` stays small; `AcceptanceCriterion`, `CriterionVerdict`, `EvidenceCitation` types |
| `libs/core`         | `pbiVerifyEngine` (AC splitting, evidence prompts, evidence validation, aggregation)                 |
| `apps/cli`          | New command + options; reuse CI detection and `--write` semantics                       |
| `apps/web`          | Verification result view; mask multiple tokens                                          |
| `docs`              | `docs/pbi-verify.md`; update `configuration.md`, `doctor.md`, `index.md`                 |

GitHub is out of scope for now. A simple variant (issue → closing-referenced
PRs) can follow later and belongs in the platform parity plan.

## Phasing

1. **Spike:** confirm the Remote Related link payload and cross-org fetch
   behaviour with two real orgs.
2. **Multi-org credentials:** config model, connection pool, `doctor`, token
   masking. Ships independently and has no user-visible behaviour change for
   single-org users.
3. **Traversal:** PBI → PRs for shapes A, B and C, with depth limit, cycle
   protection and unresolved-link reporting. Reusable on its own (e.g. a
   `--list-prs` debug flag).
4. **Verification engine + console output.**
5. **`--write` to PR comments and the dashboard view.**
6. **Docs, eval corpus cases, mutation/coverage.**

## Tests

- Traversal: fixtures for each shape; cycles; depth limit; duplicate PRs; PR
  linked to multiple PBIs; unresolved link (no creds / 403 / 404).
- Credentials: single-org backwards compatibility; multi-org resolution; token
  never appears in logs, caches, config viewer or error messages.
- Engine: AC splitting for bullets, numbered lists, Given/When/Then and prose;
  every Likely met verdict carries a valid citation (PR, file, line exists in the
  diff; hallucinated citations are rejected and downgraded to "No evidence
  found"); "No evidence found" when links are unresolved.
- Only completed PRs are used; active/abandoned PRs are listed, not assessed.
- Eval corpus: PBIs with known AC and diffs that clearly meet, partially meet,
  and miss them, to measure false "Likely met" rates (the costly failure mode).
- Adapter contract tests extended for the new resolver interface.

## Risks

- **False confidence.** A "Likely met" verdict on code that does not work is worse
  than no verdict. Mitigate with mandatory, validated citations, a
  conservative default to "No evidence found", and explicit "static review,
  not a test run" framing.
- **Cost and context size.** A PBI with many tasks/PRs can exceed context.
  Mitigate by summarizing per PR first, then assessing criteria against
  summaries plus targeted file excerpts; surface a cost estimate in dry run.
- **Non-code criteria.** Many AC (performance, UX, "stakeholder approves") are
  not verifiable from a diff; these are reported as "No evidence found".
- **Credential sprawl.** More long-lived PATs raise the blast radius; keep to
  read-only scopes and document rotation.
- **Link hygiene.** Teams that don't link work consistently will get
  incomplete results; the unresolved/empty-link reporting is the safety net.
- **Stale AC.** AC may have been edited after the PR merged; report the work
  item revision/time the criteria were read.

## Decisions Made

- Separate `pbi-verify` command.
- Only completed/merged PRs count as delivered.
- PBIs and code may be in the same or different orgs; remote related links are
  used for the cross-org case.
- Report goes on the PR(s) or in the web UI (not on the PBI).
- Per-org tokens via an env-var suffix (`MM_AZURE_TOKEN_<ORG>`).
- Azure DevOps only.
- Two outcomes only: "Likely met" (with cited evidence) or "No evidence found". A positive "Not met" is too hard to establish from code and is out of scope.
- All completed PRs, whether linked directly or via tasks, bugs or remote tasks, are pooled into one PBI-level assessment.
- Bugs are traversed along with Tasks.
- Starting from a PR (`--pr`) is out of scope here and will get its own plan.

## Open Questions

- With `--write`, the single PBI-level report is posted on the delivery PRs.
  Should it go on every contributing PR, or only on the most recently
  completed one to avoid repeating the same long comment across many PRs? The
  web UI always shows the one report in full.
