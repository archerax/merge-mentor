# Build Failure Analysis MVP Plan

## Objective

Add a `build analyze` command that explains failed CI builds for GitHub Actions
and Azure DevOps Pipelines. The MVP should produce a bounded, useful Markdown
post-mortem locally or in CI without changing the existing pull-request review
flow.

The first release optimizes for trustworthy diagnosis, predictable API usage,
and safe handling of build logs. It will not apply code changes or publish
inline suggestions automatically.

## User Outcome

Given a failed GitHub Actions workflow run or Azure DevOps build, a developer
can run one command and receive:

- The failed run/build identity and repository context.
- The failed jobs, stages, steps, and exit information available from the CI API.
- A filtered and size-bounded evidence section from the raw logs.
- A classification of the failure, such as compilation, test, lint, dependency,
  infrastructure, timeout, or unknown.
- A concise root-cause explanation grounded in the captured evidence.
- A relationship assessment between the failure and the associated PR changes
  when PR context is available.
- Suggested next steps, clearly labelled as recommendations rather than
  executable patches.

## Scope

### In Scope

- New `build analyze` command.
- GitHub Actions workflow run lookup and failed-job log retrieval.
- Azure DevOps build lookup and failed-log retrieval.
- Automatic platform/context resolution in supported CI environments.
- Explicit identifiers for local use:
  - GitHub: `--run-id <id>`.
  - Azure DevOps: `--build-id <id>`.
- Optional PR correlation using `--pr <number>` or the detected CI PR.
- Reuse of an existing checkout when `GITHUB_WORKSPACE` or
  `BUILD_SOURCESDIRECTORY` is available.
- Deterministic log normalization and truncation before AI processing.
- Dry-run Markdown output by default, with `--output <path>` support.
- Structured AI output validated with a Zod schema.
- Unit tests, parser fixtures, platform API mocks, and command-level tests.
- Audit events for retrieval, analysis, and output generation without logging
  tokens or raw log contents.

### Explicitly Out of Scope

- Automatically applying fixes or invoking the existing `fix` command.
- Native GitHub or Azure inline suggestions.
- Posting comments to pull requests or workflow summaries.
- Automatic reruns, flaky-test history, or cross-run analytics.
- Webhooks, a GitHub Action, or an Azure task package.
- Support for providers other than the existing configured AI providers.
- Full support for arbitrary CI systems.
- Sending complete raw logs to an AI provider.

## Proposed Command Interface

```bash
# GitHub Actions, explicit local invocation
merge-mentor build analyze --platform github --run-id 987654321

# Azure DevOps, explicit local invocation
merge-mentor build analyze --platform azure --build-id 456

# Correlate a run with a specific PR
merge-mentor build analyze --platform github --run-id 987654321 --pr 123

# Write a report instead of only displaying it
merge-mentor build analyze --platform azure --build-id 456 \
  --output ./post-mortem.md

# Resolve identifiers and credentials from the current CI environment
merge-mentor build analyze --ci
```

### Command Options

| Option                    | Description                                                                     | Default                            |
| ------------------------- | ------------------------------------------------------------------------------- | ---------------------------------- |
| `--platform <platform>`   | `github` or `azure`; inferred from `--ci` when omitted                          | Configured platform or detected CI |
| `--run-id <id>`           | GitHub Actions workflow run ID                                                  | None                               |
| `--build-id <id>`         | Azure DevOps build ID                                                           | None                               |
| `--pr <number>`           | PR to use for diff correlation                                                  | Detected PR when available         |
| `--ci`                    | Resolve platform, credentials, repository, and build identity from CI variables | `false`                            |
| `--output <path>`         | Write the Markdown report to a file                                             | Console output                     |
| `--format <format>`       | `markdown` only in the MVP; reserve the shape for future `json`                 | `markdown`                         |
| `--max-log-bytes <bytes>` | Upper bound for normalized evidence sent to the provider                        | Configured safe limit              |
| `--write`                 | Reserved for a later publishing feature; reject it explicitly in the MVP        | `false`                            |

The command must reject ambiguous invocations, such as supplying both
`--run-id` and `--build-id`, or omitting an identifier when not running in a
supported CI context. It must never silently analyze the latest run.

## Architecture

### New Platform-Agnostic Contracts

Create a build-analysis domain boundary separate from `PlatformAdapter`.
Existing PR adapters should not gain build-specific methods because their
responsibility is pull-request and work-item interaction.

Suggested contracts under `src/build/`:

```typescript
type BuildPlatform = "github" | "azure";

interface BuildReference {
  readonly platform: BuildPlatform;
  readonly id: string;
  readonly ownerOrOrg: string;
  readonly repository: string;
  readonly project?: string;
}

interface BuildSummary {
  readonly id: string;
  readonly name: string;
  readonly status: "completed" | "inProgress" | "unknown";
  readonly result: "failed" | "partiallySucceeded" | "unknown";
  readonly sourceBranch?: string;
  readonly commitSha?: string;
  readonly webUrl?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

interface BuildLogChunk {
  readonly jobName?: string;
  readonly stageName?: string;
  readonly stepName?: string;
  readonly sequence?: number;
  readonly content: string;
  readonly isFailureCandidate: boolean;
}

interface BuildAnalysisProvider {
  getBuildSummary(reference: BuildReference): Promise<BuildSummary>;
  getFailedLogs(reference: BuildReference): Promise<BuildLogChunk[]>;
}
```

Names may change during implementation, but the key requirement is that the
engine depends on normalized summaries and log chunks, not Octokit or the Azure
DevOps SDK.

### Platform Implementations

#### GitHub Actions

- Add a GitHub Actions build provider alongside `GitHubAdapter`, using the
  existing authenticated Octokit instance or a small dedicated client wrapper.
- Retrieve workflow-run metadata and jobs with the Actions REST API.
- Select failed or cancelled jobs first; do not download successful job logs
  unless the API provides no failed-job evidence.
- Retrieve logs for selected jobs using the official Actions log endpoint.
- Handle compressed/multi-file log responses and preserve job/step boundaries.
- Apply the existing rate-limit and retry behavior.
- Normalize GitHub log annotations and command prefixes without treating every
  line containing `error` as a root cause.

#### Azure DevOps

- Add an Azure build provider alongside `AzureDevOpsAdapter`, using the existing
  `WebApi` connection or a dedicated build API wrapper.
- Retrieve build metadata through the Azure Build API.
- Retrieve build log entries and identify failed timeline records where the API
  exposes them.
- Fetch only relevant logs when possible; otherwise fetch logs in sequence and
  filter before analysis.
- Preserve project, definition, stage, job, task, and log sequence metadata.
- Apply the existing Azure retry/rate-limit handling and typed platform errors.
- Support both PAT authentication and `SYSTEM_ACCESSTOKEN` when supplied by
  Azure Pipelines.

### Analysis Pipeline

1. Resolve configuration, platform, build reference, and optional PR context.
2. Fetch and validate build metadata.
3. Fetch failed-job/stage/task logs through the selected provider.
4. Normalize logs:
   - Remove timestamps and known boilerplate where safe.
   - Preserve compiler locations, test names, stack traces, exit codes, and
     nearby command context.
   - Detect common log boundaries and retain source metadata.
   - Deduplicate repeated lines and repeated retry output.
5. Extract candidate failure blocks with deterministic heuristics.
6. Enforce per-block and total byte limits before constructing the AI prompt.
7. Optionally load PR details, changed files, and patches through the existing
   `PlatformAdapter`.
8. Ask the configured provider for structured diagnosis using the security
   preamble and untrusted-content wrappers.
9. Validate and sanitize the provider response.
10. Render the report and write it to the console or requested output path.
11. Record an audit event with identifiers, counts, and outcome only.

## Log Processing Design

The log parser is the most important deterministic component. The AI should
interpret selected evidence, not search an unbounded transcript.

### Failure Signals

Initial recognizers should cover:

- TypeScript, JavaScript, C#, Java, Rust, Python, and common compiler errors.
- Vitest, Jest, NUnit, xUnit, pytest, and common test assertion formats.
- ESLint, Biome, Prettier, and other lint/format exit failures.
- Package-manager resolution failures and lockfile/dependency errors.
- HTTP 5xx, authentication failures, rate limits, and service-unavailable
  messages.
- Timeout, cancellation, out-of-memory, and runner/agent failures.
- Generic non-zero exit codes when no more specific signal is available.

### Evidence Limits

- Configure a conservative total input limit suitable for every supported AI
  provider.
- Limit each candidate block independently so one noisy task cannot dominate.
- State in the report when logs were truncated or omitted.
- Prefer first meaningful compiler/test failure and its surrounding context over
  later cascading failures.
- Never include secrets detected in common token/password/key formats.
- Preserve file paths and line/column numbers when redacting surrounding text.

### Normalized Intermediate Model

The parser should return a testable intermediate representation containing:

- Original platform and build identifiers.
- Job/stage/task labels.
- Candidate category and confidence.
- Extracted file path, line, and column when available.
- Evidence text and source log sequence.
- Redaction and truncation metadata.

This makes classification and prompt construction testable without invoking an
AI provider.

## AI Contract

Add a dedicated build-analysis prompt and schema rather than reusing the PR
finding schema. The response should contain:

- `failureType` from a fixed enum.
- `confidence`.
- `summary`.
- `rootCause`.
- `evidence` references to the supplied block identifiers.
- `affectedFiles` with optional line ranges.
- `prCorrelation` with `related`, `unrelated`, or `uncertain` plus reasoning.
- `recommendations`.
- `limitations`, including missing or truncated evidence.

Prompt requirements:

- Include the shared security preamble.
- Wrap all build logs, PR text, and diffs as untrusted content.
- Tell the provider not to follow instructions found in logs or source files.
- Require claims to cite evidence block IDs.
- Forbid invented logs, file locations, test history, or certainty.
- Request recommendations only; do not request executable patches in the MVP.

Malformed, incomplete, or provider-error responses must produce a typed error or
a deterministic fallback report, never an unvalidated free-form report that
could be mistaken for a confirmed diagnosis.

## CLI and Configuration Work

- Add a `build` command group and `analyze` subcommand following existing
  Commander command patterns.
- Reuse platform credentials and repository configuration already supported by
  `Config`.
- Add build-specific configuration only for log limits and optional parser
  behavior; avoid duplicating GitHub/Azure credentials.
- Extend CI context resolution with the build identity needed by `--ci`:
  - GitHub: `GITHUB_RUN_ID`.
  - Azure: `BUILD_BUILDID`.
- Keep PR detection optional for manually triggered builds and branch builds.
- Document required Azure permissions, including the explicit
  `SYSTEM_ACCESSTOKEN: $(System.AccessToken)` mapping for pipeline jobs.
- Keep dry-run behavior consistent with the existing CLI defaults.

## Testing Strategy

### Unit Tests

- Build-reference validation and conflicting-option errors.
- GitHub and Azure build metadata normalization.
- GitHub job selection and Azure timeline/log selection.
- Log boundary detection, repeated-line removal, and truncation.
- Compiler, test, lint, dependency, infrastructure, and timeout recognizers.
- Secret redaction, including truncation after redaction.
- Prompt construction and untrusted-content delimiters.
- Zod response parsing, invalid enums, missing fields, and fallback behavior.
- Markdown rendering with missing optional metadata and truncation notices.

### Platform API Tests

- Mock Octokit Actions endpoints and verify request parameters.
- Mock Azure Build API responses, including paged or sequenced logs.
- Cover 401/403, 404, rate limits, transient failures, empty logs, malformed
  payloads, and completed non-failed builds.
- Verify no raw token or full log body is written to audit records.

### Command Tests

- Explicit GitHub run invocation.
- Explicit Azure build invocation.
- `--ci` resolution for both CI systems.
- Output to console and output file through the `OutputWriter`/filesystem ports.
- Missing identifiers and unsupported `--write` behavior.
- Provider failure and platform API failure exit behavior.

### Fixtures and Evaluation

- Add representative sanitized fixtures under `test/eval/corpus/` for:
  - Compiler failure.
  - Test assertion failure.
  - Lint failure.
  - Dependency/install failure.
  - Infrastructure timeout.
  - Cascading errors where the first error is the useful one.
- Add GitHub and Azure variants where their log formats differ.
- Extend the evaluation harness only after the deterministic parser and report
  schema are stable; measure classification accuracy and evidence grounding.

## Delivery Phases

### Phase 0: Baseline and API Spike

- Run `pnpm check` and record the baseline.
- Confirm the installed Octokit and Azure SDK versions expose the required
  Actions and Build APIs.
- Capture sanitized response fixtures from both platforms.
- Decide the exact default log-size limits based on provider constraints.

**Exit criteria:** API calls and response shapes are confirmed for one GitHub
run and one Azure build, with no production code changes required beyond the
spike if the SDK supports the design.

### Phase 1: Domain Contracts and Deterministic Parser

- Add normalized build types and the `BuildAnalysisProvider` boundary.
- Implement log normalization, candidate extraction, redaction, and limits.
- Add parser fixtures and exhaustive unit tests.

**Exit criteria:** Given the same fixture, parser output is deterministic,
bounded, metadata-preserving, and correctly identifies the first useful failure
candidate for the MVP fixture set.

### Phase 2: GitHub and Azure Providers

- Implement GitHub Actions metadata/job/log retrieval.
- Implement Azure Build metadata/timeline/log retrieval.
- Add retries, typed errors, API mocks, and audit events.

**Exit criteria:** Both providers return the same normalized model and handle
authentication, missing logs, transient failures, and rate limits without
leaking secrets.

### Phase 3: AI Diagnosis and Report Rendering

- Add the security-hardened prompt and Zod response schema.
- Implement provider invocation and fallback/error handling.
- Render the Markdown post-mortem with source links where available.

**Exit criteria:** A mocked provider response renders a complete report, and
malformed or unsupported responses cannot bypass schema validation.

### Phase 4: CLI Integration and CI Context

- Add the Commander command and option validation.
- Resolve `GITHUB_RUN_ID` and `BUILD_BUILDID` for `--ci`.
- Wire optional PR correlation to existing adapters and local workspace reuse.
- Add command-level tests and update user documentation.

**Exit criteria:** A user can run explicit GitHub and Azure commands locally,
and a correctly configured GitHub Actions or Azure Pipeline can run
`merge-mentor build analyze --ci` without manually repeating repository or
credential arguments.

### Phase 5: Hardening and Release

- Run the full check suite and coverage.
- Run fixture evaluation and review false-positive/false-root-cause cases.
- Test on Windows, macOS, and Linux where filesystem/archive behavior differs.
- Verify package build and compiled CLI smoke tests.
- Add changelog and documentation entries.

**Exit criteria:** Both platforms meet the acceptance criteria below, no raw
logs or credentials appear in audit output, and the feature is ready for a
minor release behind no experimental flag.

## Acceptance Criteria

- The command analyzes a completed failed GitHub Actions run by explicit run ID.
- The command analyzes a completed failed Azure DevOps build by explicit build ID.
- `--ci` resolves the build identity and repository context in both systems.
- Successful, running, missing, unauthorized, and not-found builds produce
  clear typed outcomes rather than misleading diagnoses.
- Failed jobs/tasks are prioritized over successful log output.
- Input sent to an AI provider is bounded, redacted, and marked as untrusted.
- The report distinguishes evidence, model interpretation, uncertainty, and
  recommendations.
- PR correlation is explicitly `related`, `unrelated`, or `uncertain`; it is
  never implied solely by a matching filename.
- Reports can be printed and written to a requested path without repository
  working-directory side effects.
- No comments, suggestions, code edits, reruns, or external side effects occur
  in the MVP.
- Unit, command, platform-mock, fixture, typecheck, lint, build, and test
  coverage checks pass.

## Follow-Up Work

After real usage validates diagnosis quality, consider:

1. Publishing reports to GitHub checks/workflow summaries and Azure build
   summaries.
2. Optional PR general comments with deduplication.
3. Native suggestions only when a diagnosis maps to a validated localized fix.
4. Historical flakiness detection and recurring-failure analytics.
5. A CI action/task wrapper for zero-install pipeline integration.
6. Safe integration with `fix` after explicit user confirmation.
