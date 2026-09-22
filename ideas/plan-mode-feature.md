# Plan Mode Feature

## Summary

Add a new `plan` command that: fetches a PBI from Azure DevOps, ensures the
local repo is on a clean, up-to-date base branch, asks a higher-tier "planning"
model to generate a phased implementation plan grounded in the codebase, writes
it as a Markdown file with checkboxes, and (with `--write`) attaches that file
to the PBI.

## Decisions (from Q&A)

- **Azure DevOps only** — GitHub issues are rejected with a clear error.
- **Operates on `process.cwd()`** and **guards a dirty working tree** (abort
  unless `--allow-dirty`).
- **Planning model** via `MM_AI_PLAN_MODEL` + `--plan-model`, falling back to
  `MM_AI_MODEL`; same provider.
- **AI grounded in the full base-branch working directory** via
  `executePrompt(..., { workingDirectory })`.

## File-by-file changes

### 1. Config — `src/config.ts`

- Add `readonly aiPlanModel?: string` to `Config`.
- Add `aiPlanModel` to `CliOverrides` (field `planModel`).
- In `loadConfig`:
  `aiPlanModel: cliOverrides?.planModel ?? env.get("MM_AI_PLAN_MODEL") ?? cliOverrides?.aiModel ?? env.get("MM_AI_MODEL")`
  (fallback chain).
- Update `config.spec.ts`.

### 2. Env example — `.env.example`

- Add `MM_AI_PLAN_MODEL` under the "Unified AI Settings" section, documented as
  the higher-tier model used by `plan` (e.g. `gpt-5.6-sol`), falling back to
  `MM_AI_MODEL`.

### 3. Command options — `src/commands/types.ts`

- Add `PlanOptions` interface: `id`, `url`, `platform`, `base`, `write`,
  `allowDirty`, `planModel`, plus the standard Azure/AI/git/temp options
  (`azureToken`, `azureOrg`, `azureProject`, `azureRepo`, `provider`,
  `copilotToken`, `aiTimeout`, `aiBaseUrl`, `aiApiKey`, `tempPath`,
  `gitBackend`).

### 4. CLI registration — `src/program.ts`

- Import `executePlan` and `PlanOptions`.
- Register `plan [id]` mirroring the `pbi` command: `--id`, `--url`,
  `--base <branch>` (required), `--write`, `--allow-dirty`,
  `--plan-model <model>`, Azure config group, AI provider group,
  `--temp-path`, `--git-backend`.
- Action: `resolveWorkItemReference({ positionalId, ...options })`, then reject
  `platform === "github"`, then `executePlan(reference.id, {...options, ...reference})`.

### 5. New engine — `src/review/planEngine.ts` (+ `planEngine.spec.ts`)

Modeled on `PBIReviewEngine`/`ProjectReviewEngine`. Constructor
`(adapter, aiClient, gitClient, options)`.

Flow in `generatePlan(id, base, repoPath)`:

1. Fetch `adapter.getPBIDetails(id)`.
2. Guard + switch/pull (see §7) — or accept a pre-switched `repoPath` from the
   command.
3. Build prompt: PBI title/description/acceptance criteria/story points/
   MoSCoW/comments + instruction to inspect the repo (via `workingDirectory`)
   and produce phased tasks, assumptions, and open questions.
4. `aiClient.executePrompt(prompt, { workingDirectory: repoPath })`.
5. Parse with a zod schema; fall back to regex parse on drift (same pattern as
   existing engines).
6. Render deterministic Markdown (see §6) and return
   `{ markdown, status, planData }`.

Response schema:

```ts
{
  status: "ready" | "insufficient_information",
  title: string,
  phases: [{ name: string, goal: string, tasks: [{ description: string, acceptance_criteria: string }] }],
  assumptions: string[],
  unresolved_questions: string[],
  missing_information: string[]  // required when status === "insufficient_information"
}
```

### 6. Markdown output

- `status === "insufficient_information"`: document calls out that no plan could
  be produced, with a `## Missing Information` list and no task checkboxes.
- Otherwise: `# Implementation Plan — #<id> <title>`, one
  `## Phase N: <name>` section per phase, each task as `- [ ] <description>`
  (with indented acceptance criteria), then `## Assumptions`,
  `## Unresolved Questions`, and an HTML signature comment
  (e.g. `<!-- merge-mentor-plan -->`) for future idempotent updates.
- Filename: `plan-<id>-<slugified-title>.md`, saved to `{tempPath}/reports/` by
  default (like `pbi`/`project`).
- With `--write`: attach instead of (or in addition to) local save.

### 7. Git operations — `src/review/gitClient.ts` + `gitClients/*`

Add three methods to the `GitClient` interface (implement in `CliGitClient` +
`IsomorphicGitClient`, plus `cliGitClient.spec.ts`/`isomorphicGitClient.spec.ts`
updates):

- `hasUncommittedChanges(repoPath): Promise<boolean>` — `git status --porcelain`
  (cli) / `statusMatrix` (isomorphic).
- `switchBranch(repoPath, branch): Promise<void>` — plain `git checkout <branch>`
  (note: existing `checkout` is a reset-to-`origin/<branch>`; that semantic is
  wrong here, so we need a separate plain-switch).
- `pull(repoPath, branch): Promise<void>` — `git pull --ff-only origin <branch>`
  (cli); fetch + fast-forward merge (isomorphic), erroring on non-ff.

The `fix` command already has an `execSync("git status --porcelain")` dirty-check
pattern (`src/commands/fix.ts:52`); route the guard through `GitClient` for
testability, but reuse that logic if widening the interface is undesirable.

### 8. Platform adapter — `src/platforms/types.ts`, `azure.ts`, `github.ts`

- Add `attachWorkItemFile(id: string, fileName: string, content: string): Promise<void>`
  to `PlatformAdapter`.
- **Azure** (`azure.ts`): use
  `witApi.createAttachment(Readable.from([content]), fileName, "simple", this.project)`
  (already exposed by `azure-devops-node-api`, `WorkItemTrackingApi.d.ts:145`),
  then link it via `witApi.updateWorkItem` with a JSON-patch relation:
  `[{ op: "add", path: "/relations/-", value: { rel: "AttachedFile", url: attachmentRef.url } }]`.
- **GitHub** (`github.ts`): throw a `ConfigurationError`/`PlatformApiError`
  ("attaching files to issues is not supported").
- Add adapter unit tests.

### 9. Command orchestration — `src/commands/plan.ts` (+ `plan.spec.ts`)

`executePlan(id, options)` mirrors `executePBIReview`:

1. Resolve config (platform forced `azure`, plan model).
2. `validateConfig(config, "azure")`; build `AzureDevOpsAdapter`.
3. `createAIProvider(provider, { model: config.aiPlanModel, ... })`.
4. `createGitClient(gitBackend)`; resolve `repoPath = process.cwd()`.
5. Guard dirty tree (abort unless `options.allowDirty`); `switchBranch(base)`;
   `pull(base)`.
6. Run `PlanEngine.generatePlan(...)`; write/attach per `--write`.

### 10. Docs

- Add `docs/plan.md` and a link in `docs/index.md` (and README command list),
  matching existing per-command docs.

## Verification

- `pnpm check` (typecheck + lint + build + test).
- New specs: `planEngine.spec.ts`, `commands/plan.spec.ts`, `config.spec.ts`
  (plan model), `cliGitClient.spec.ts`/`isomorphicGitClient.spec.ts` (new git
  methods), `azure.ts` (attach).

## Risks / notes

- `pull --ff-only` will fail safely if the base branch has diverged or has local
  commits; surface that error clearly.
- Attaching via the two-step createAttachment + relation patch is the documented
  Azure REST flow; worth a manual smoke test against a real org before relying
  on it.
- The existing `GitClient.checkout` resets to `origin/<branch>`, so the new
  `switchBranch` is required to avoid clobbering a local base branch.

## Open items

- `--base` is currently required (no default); optionally default to the current
  branch or an `MM_PLAN_BASE` env var.
- With `--write`, attach _and_ still save locally (matching "otherwise save it
  locally").
