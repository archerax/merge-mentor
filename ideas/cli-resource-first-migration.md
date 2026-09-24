# Plan: Resource-First CLI Migration (`merge-mentor <resource> <action>`)

## Goal

Make the first CLI parameter name the **thing you are interacting with**
(resource-first, noun+verb), replacing the current mix of verb commands
(`review`, `describe`, `fix`, `reply`, `stage`, `plan`) and noun commands
(`pbi`, `project`, `build`, `repos`).

Existing invocations keep working through hidden deprecation shims, so the
migration ships as a non-breaking minor. Removal of the shims is reserved for a
future major.

## Final CLI taxonomy

```
merge-mentor
├── pr
│   ├── review (--pr/--pr-url)
│   ├── describe
│   ├── fix
│   └── reply
├── pbi
│   ├── review [id]
│   └── plan [id]              (Azure DevOps only)
├── project [id]               (aliases: epic, feature)
│   └── review
├── local
│   └── review                 (was stage; --staged narrows to index)
├── build
│   └── diagnose
├── repo
│   ├── list
│   └── clean [name]
├── doctor                     (unchanged)
└── eval                       (unchanged)
```

### Rationale / verified behavior

- `project` accepts any container work-item type —
  `ContainerWorkItemTypes = new Set(["Project", "Epic", "Feature"])`
  (`src/platforms/azure.ts:1585`) — so it is the canonical name with `epic` and
  `feature` as first-class aliases via `.aliases(["epic", "feature"])`.
  Commander resolves parent aliases for nested subcommands
  (`node_modules/commander/lib/command.js:1661-1664`, `:1880`), so both
  `merge-mentor epic review 99` and `merge-mentor feature review 99` work. Only
  the first alias shows in auto-generated help.
- `local review` is accurate: the default `stage` mode calls
  `workingTreeDiff` (`src/platforms/local.ts:325`), which diffs **staged +
  unstaged + untracked** files against the base ref
  (`src/review/gitClients/cliGitClient.ts:213-225`). `--staged` is the only mode
  that narrows to the index.
- `pbi plan` matches the codebase vocabulary: `PlanEngine` generates plans "for
  a Product Backlog Item" (`src/review/planEngine.ts:70`) and calls
  `adapter.getPBIDetails(id)` (`src/review/planEngine.ts:102`). `pbi` already
  spans "Product Backlog Item / User Story / Issue" (`docs/pbi.md:8`). Note:
  `plan` is Azure DevOps only and rejects GitHub (`docs/plan.md:10`).

## Legacy compatibility

| Legacy invocation                           | New                               | Mechanism                                                               |
| ------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------- |
| `review` / `describe` / `fix` / `reply`     | `pr <action>`                     | hidden `{ hidden: true }` shims + deprecation warning                   |
| `stage`                                     | `local review`                    | hidden shim + warning                                                   |
| `plan [id]`                                 | `pbi plan [id]`                   | hidden shim + warning                                                   |
| `repos --list` / `--clean` / `--clean-repo` | `repo list` / `repo clean [name]` | hidden shim + warning                                                   |
| `pbi [id]`                                  | `pbi review [id]`                 | dual action+subcommand on same `pbi` command (warning on flat form)     |
| `project [id]`                              | `project review [id]`             | dual action+subcommand on same `project` command (warning on flat form) |
| `build`                                     | `build diagnose`                  | dual action+subcommand on same `build` command (warning on flat form)   |

Reused names (`pbi`, `project`, `build`) must carry both the legacy action and
the new subcommands on one Commander command object (a name collision prevents
separate shims); Commander matches known subcommand names before positional
args.

Warning text:

```
⚠️ 'merge-mentor <old>' is deprecated; use 'merge-mentor <new>' (removal planned for a future major).
```

## Implementation steps

1. **`src/program.ts`** — extract option wiring into reusable helpers
   (`addPrReviewOptions`, `addPrReplyOptions`, `addPbiPlanOptions`,
   `addLocalReviewOptions`, `addProjectReviewOptions`, `addBuildDiagnoseOptions`,
   `addRepoOptions`, …); extract inline action bodies into named runners; wire
   new groups + aliases + legacy shims.
2. **`src/commands/shared/prTarget.ts`** (new) — extract the duplicated
   `--pr-url` conflict/parse block from `review`, `describe`, `fix`, and `reply`
   (mirrors `shared/ci.ts` / `resolveWorkItemReference`).
3. **`src/commands/repos.ts`** — map `repo list` / `repo clean [name]`; update
   the usage text at `:84-89`.
4. **Tests**
   - `src/program.spec.ts`: move `review` / `describe` cases to `pr review` /
     `pr describe`; add alias (`epic review`), new-path, and legacy-shim
     deprecation assertions.
   - `src/commands/repos.spec.ts`: `repos …` → `repo list` / `repo clean [name]`;
     update the usage assertion (`:51`); add a legacy test.
   - Other command specs call `executeX` directly and are untouched.
5. **Workflows**
   - `.github/workflows/ci.yml:72` → `pr --help`, `pr review --help`,
     `pr fix --help`, `doctor --help`.
   - `.github/workflows/self-review.yml:45` →
     `pnpm start pr review --ci --write --strategy fast`.
6. **Docs** — update command examples/mappings in `README.md`, `docs/index.md`,
   `docs/review.md`, `docs/describe.md`, `docs/fix.md`, `docs/reply.md`,
   `docs/stage.md`, `docs/build-analyze.md`, `docs/pbi.md`, `docs/project.md`,
   `docs/plan.md`, `docs/repos.md`, `docs/ci-cd.md`. Note that `pbi plan` is
   Azure-only and document the `epic` / `feature` aliases. Keep existing doc
   filenames. `docs/doctor.md` and `docs/eval.md` are unchanged.
7. **Comment** — `src/platforms/local.ts:5` → `merge-mentor local review`.
8. **`CHANGELOG.md`** — add an `Unreleased → Changed` entry with the migration
   table. Ship as a minor (shims keep it non-breaking); alias removal reserved
   for a major.

## Verification

- `pnpm check` (typecheck, lint, build, test).
- Manual smoke tests:
  - `node dist/cli.js --help`
  - `node dist/cli.js pr review --help`
  - `node dist/cli.js epic review --help`
  - `node dist/cli.js repo --help`
  - `node dist/cli.js review --pr 1` (legacy: confirms deprecation warning and
    that the command still executes)

## Decisions (locked)

- Shape: two-level `pr <action>` (noun + verb).
- Scope: all resources migrated in one pass.
- Backward compatibility: hidden aliases + deprecation warnings.
- PR number: keep `--pr` / `--pr-url` flags (no positional).
- `stage` → `local review`.
- `plan` → `pbi plan`.
- `project` canonical with `epic` / `feature` aliases.
