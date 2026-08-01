# Build Failure Analysis MVP Plan

## Objective

Add a `build analyze` command that explains failed CI builds for GitHub Actions
and Azure DevOps Pipelines. The MVP should produce a bounded, useful Markdown
post-mortem locally or in CI without changing the existing pull-request review
flow.

The first release optimizes for trustworthy diagnosis, predictable API usage,
and safe handling of build logs. It will not apply code changes or publish
inline suggestions automatically.

## Implementation Position

This feature should be implemented as a new build-analysis domain, not as an
extension of the pull-request `PlatformAdapter`. The existing adapter owns PR
and work-item operations; build providers have different identifiers, API
lifecycles, pagination, log formats, and failure states.

The implementation should follow these repository conventions:

- Add a `src/build/` module containing normalized contracts, providers, log
  processing, analysis orchestration, rendering, and audit metadata.
- Add a thin `src/commands/build.ts` command handler and register the nested
  `build analyze` command using the existing Commander patterns.
- Reuse `Config`, `Environment`, `OutputWriter`, logger, AI provider factory,
  repository workspace handling, retry behavior, and audit infrastructure.
- Keep platform SDK types inside `src/build/providers/github.ts` and
  `src/build/providers/azure.ts`; do not expose Octokit or Azure SDK response
  shapes to the domain layer.
- Keep the MVP read-only. `--write` must be rejected rather than silently
  ignored, and no PR comments, workflow summaries, reruns, branches, or file
  edits may be produced.

### Decisions for the MVP

1. **Build identity is explicit.** Local runs require `--run-id` for GitHub or
   `--build-id` for Azure. `--ci` may resolve the identity from environment
   variables, but the command must never select the latest build implicitly.
2. **One platform per invocation.** `--platform github|azure` is required when
   it cannot be inferred from the identifier or CI environment. Supplying both
   build identifiers is invalid.
3. **Existing credentials are preferred.** Reuse the current GitHub token and
   Azure configuration. Azure authentication may additionally use
   `SYSTEM_ACCESSTOKEN` in Azure Pipelines, with an explicit precedence rule
   documented in configuration.
4. **Deterministic preprocessing comes before AI.** Fetching, filtering,
   redaction, candidate extraction, truncation, and evidence IDs must be
   testable without a provider call.
5. **Evidence is bounded and attributable.** Every model claim must reference
   one or more evidence block IDs. Reports must state when evidence was
   truncated, unavailable, or redacted.
6. **A failed analysis is not a diagnosis.** API failures, incomplete build
   metadata, provider failures, and schema failures produce typed errors or a
   clearly labelled fallback report with uncertainty.
7. **PR correlation is deferred.** The MVP will not compare builds with PR
   changes. A future release may add conservative correlation using an
   explicit PR identifier and an evidence-based `related`, `unrelated`, or
   `uncertain` result.
8. **Both configured AI providers are first-class targets.** Copilot SDK and
   OpenCode SDK must receive equivalent MVP support, test coverage, and
   documentation. Neither provider is an optional follow-up integration.
9. **The release is normal, not hidden behind a feature flag.** Documentation
   may label the feature experimental while real-world diagnosis quality is
   being evaluated, but the command is released as a supported normal feature.

### Definition of Done

The feature is ready for release only when all of the following are true:

- GitHub and Azure explicit-ID invocations work against mocked platform APIs.
- `--ci` resolves build identity and repository context in both supported CI
  environments.
- Failed jobs, stages, and tasks are prioritized over successful output.
- Raw logs are normalized, bounded, redacted, and wrapped as untrusted content
  before reaching an AI provider.
- Structured provider output is schema-validated and rendered with evidence,
  uncertainty, and recommendations separated.
- The command has no external write side effects in the MVP.
- Tests cover parser fixtures, platform error cases, command validation,
  provider validation, output files, and secret/audit-log redaction.
- `pnpm check`, package build, and compiled CLI smoke tests pass on the
  repository's supported Node and operating-system matrix.

## User Outcome

Given a failed GitHub Actions workflow run or Azure DevOps build, a developer
can run one command and receive:

- The failed run/build identity and repository context.
- The failed jobs, stages, steps, and exit information available from the CI API.
- A filtered and size-bounded evidence section from the raw logs.
- A classification of the failure, such as compilation, test, lint, dependency,
  infrastructure, timeout, or unknown.
- A concise root-cause explanation grounded in the captured evidence.
  - Suggested next steps, clearly labelled as recommendations rather than
    executable patches.

If deterministic processing and the AI provider cannot establish a supported
failure classification, the report must explicitly say that the failure reason
could not be determined. It must include the evidence that was available, the
limitations encountered, and recommendations for manual investigation; it must
not invent a root cause.

## Scope

### In Scope

- New `build analyze` command.
- GitHub Actions workflow run lookup and failed-job log retrieval.
- Azure DevOps build lookup and failed-log retrieval.
- Automatic platform/context resolution in supported CI environments.
- Explicit identifiers for local use:
  - GitHub: `--run-id <id>`.
  - Azure DevOps: `--build-id <id>`.
- Reuse of an existing checkout when `GITHUB_WORKSPACE` or
  `BUILD_SOURCESDIRECTORY` is available.
- Deterministic log normalization and truncation before AI processing.
- Markdown output only, printed locally by default, with `--output <path>`
  support.
- Structured AI output validated with a Zod schema.
- Unit tests, parser fixtures, platform API mocks, and command-level tests.
- Audit events for retrieval, analysis, and output generation without logging
  tokens or raw log contents.

### Explicitly Out of Scope

- Automatically applying fixes or invoking the existing `fix` command.
- Native GitHub or Azure inline suggestions.
- Posting comments, checks, or summaries to pull requests or CI platforms.
- PR-to-build correlation and changed-file causality analysis.
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

# Write a local Markdown report instead of only displaying it
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
| `--ci`                    | Resolve platform, credentials, repository, and build identity from CI variables | `false`                            |
| `--output <path>`         | Write the Markdown report to a file                                             | Console output                     |
| `--format <format>`       | Reserved for future formats; only `markdown` is accepted in the MVP             | `markdown`                         |
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

### Proposed File Map

```text
src/build/
  types.ts                 # domain contracts and failure categories
  errors.ts                # typed build-analysis errors
  reference.ts             # identifier and platform validation
  engine.ts                # fetch -> normalize -> analyze -> render flow
  logNormalizer.ts         # deterministic normalization and redaction
  failureCandidates.ts     # recognizers and evidence-block extraction
  prompt.ts                # security-hardened analysis prompt
  parser.ts                # Zod response validation and fallback handling
  renderer.ts              # Markdown report rendering
  audit.ts                 # safe identifier/count-only audit events
  providers/
    github.ts              # Actions API mapping and log retrieval
    azure.ts               # Build/Timeline API mapping and log retrieval

src/commands/build.ts       # Commander handler for `build analyze`
src/commands/build.spec.ts  # command-level behavior and dependency seams
docs/build-analyze.md      # user-facing usage and CI setup
test/eval/corpus/build/     # sanitized platform-independent fixtures
```

The exact filenames may change, but the dependency direction must remain:

```text
command -> build engine -> BuildAnalysisProvider
                    -> AI provider
                    -> OutputWriter / audit ports
GitHub and Azure SDKs -> provider implementations only
```

The build engine should accept injected providers and ports so command tests do
not require network access, a checkout, or a real AI client.

### Delivery Work Breakdown

The implementation should be delivered in independently verifiable slices:

1. **Contracts and validation:** Add references, normalized summaries, log
   chunks, failure categories, typed errors, and option validation. Test all
   conflicting and missing-argument cases before adding API calls.
2. **Deterministic evidence pipeline:** Implement normalization, secret
   redaction, candidate scoring, deduplication, evidence IDs, and byte limits.
   Add fixtures for first-error selection and cascading failures.
3. **GitHub provider:** Map run and job metadata, select failed jobs, retrieve
   logs, preserve job/step metadata, and cover compressed or empty responses.
4. **Azure provider:** Map builds and timeline records, select failed tasks,
   retrieve relevant logs, support PAT and `SYSTEM_ACCESSTOKEN`, and cover
   paged/sequenced logs.
5. **Analysis contract:** Add the prompt, untrusted-content wrappers, Zod
   schema, evidence-reference validation, and deterministic fallback behavior.
6. **Report and audit output:** Render a stable Markdown report, include source
   links and truncation notices, support `--output`, and ensure audit records
   contain identifiers and counts only.
7. **CLI and CI wiring:** Register `build analyze`, add `--ci` resolution for
   `GITHUB_RUN_ID` and `BUILD_BUILDID`, reuse workspace paths, and reject
   unsupported `--write` explicitly.
8. **Release hardening:** Run the full check suite, cross-platform build and
   smoke tests, fixture evaluation, documentation review, and changelog work.

Each slice should land with its tests and should not require the next slice to
be present. In particular, the deterministic parser must be usable and
reviewable before either AI integration or platform publishing work begins.

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
7. Ask the configured provider for structured diagnosis using the security
   preamble and untrusted-content wrappers.
8. Validate and sanitize the provider response.
9. Render the report and write it to the console or requested output path.
10. Record an audit event with identifiers, counts, and outcome only.

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
- `recommendations`.
- `limitations`, including missing or truncated evidence.

Prompt requirements:

- Include the shared security preamble.
- Wrap all build logs and platform-provided metadata as untrusted content.
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
- Do not perform PR detection or PR correlation in the MVP.
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
- Wire local workspace reuse and reject unsupported options such as `--write`.
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
normal minor release. User documentation should label the feature
"experimental" while early diagnosis quality is being evaluated.

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
- Unknown failure causes are explicitly reported as undetermined with evidence
  and limitations; the system never invents a root cause.
- Reports can be printed and written to a requested path without repository
  working-directory side effects.
- No comments, suggestions, code edits, reruns, or external side effects occur
  in the MVP.
- Unit, command, platform-mock, fixture, typecheck, lint, build, and test
  coverage checks pass.

## Follow-Up Work

After real usage validates diagnosis quality, consider:

1. PR-to-build correlation using explicit PR context and conservative evidence.
2. Publishing reports to GitHub checks/workflow summaries and Azure build
   summaries.
3. Optional PR general comments with deduplication.
4. Native suggestions only when a diagnosis maps to a validated localized fix.
5. Historical flakiness detection and recurring-failure analytics.
6. A CI action/task wrapper for zero-install pipeline integration.
7. Safe integration with `fix` after explicit user confirmation.
