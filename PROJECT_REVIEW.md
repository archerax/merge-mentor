# Merge Mentor project review

Reviewed on 2026-11-10 at commit `96b4ce7` (`main`, version 4.4.0 plus unreleased work).

## Summary

The project is in good health. Typecheck, lint, build and all 3,015 tests pass
on a clean checkout, coverage is well above its gates, there are no known
vulnerable production dependencies, and the security-sensitive parts (AI tool
permissions, the local dashboard, document uploads) are written defensively.

The review found no build or test failures. It found one credential-handling
defect worth fixing soon, one gap in CI, and a set of smaller correctness and
documentation issues. They are listed in priority order under
[Findings](#findings).

| Priority | Finding                                                                                                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| High     | [`fix` and `reply` hand the platform token to Copilot](#1-fix-and-reply-hand-the-platform-token-to-copilot)                               |
| Medium   | [CI does not typecheck the web app](#2-ci-does-not-typecheck-the-web-app)                                                                 |
| Medium   | [Invalid configuration values fall back silently](#3-invalid-configuration-values-fall-back-silently)                                     |
| Medium   | [`fix` write protection differs between AI providers](#4-fix-write-protection-differs-between-ai-providers)                               |
| Medium   | [`ui --host` cannot be reached by any name other than the bind host](#5-ui---host-cannot-be-reached-by-any-name-other-than-the-bind-host) |
| Low      | [`review` cannot fail a pipeline](#6-review-cannot-fail-a-pipeline)                                                                       |
| Low      | [Build target is newer than the supported Node version](#7-build-target-is-newer-than-the-supported-node-version)                         |
| Low      | [Documentation has drifted from the code](#8-documentation-has-drifted-from-the-code)                                                     |
| Low      | [Smaller code issues](#9-smaller-code-issues)                                                                                             |
| Low      | [Backlog hygiene](#10-backlog-hygiene)                                                                                                    |

## How this review was done

- Ran `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`,
  `pnpm build`, `pnpm test:coverage`, `pnpm audit --prod`, `pnpm outdated -r`,
  `pnpm pack --dry-run`, `node dist/cli.js --help` and
  `node dist/cli.js eval --provider mock`, on Node 22.23.4 and pnpm 12.16.1.
- Read the configuration loader, the CLI wiring, the comment-posting path, both
  AI providers' permission handling, the git client, and the dashboard's request
  guard, launcher, `.env` editor and upload route.
- Read the contributor docs, the workflows, the `ideas/` plans, and the open
  pull requests and issues on GitHub.

Not covered: no command was run against a real AI provider, GitHub or Azure
DevOps, so review quality and live API behaviour are untested here. Mutation
testing was not run. The larger engines (`engine.ts`, the PRD engines, the
Azure adapter) were sampled, not read line by line. The checkout is shallow, so
history before 2026-10-22 was not examined.

## Current state

### Size and shape

| Measure                      | Value                                 |
| ---------------------------- | ------------------------------------- |
| Tracked files                | 618                                   |
| TypeScript source (non-test) | 273 files, about 52,000 lines         |
| Test code                    | 190 spec files, about 48,600 lines    |
| Workspace packages           | 2 apps (`cli`, `web`), 5 libraries    |
| CLI commands                 | 17                                    |
| Bundled CLI (`dist/cli.js`)  | 503 KB, plus 7.9 MB for the dashboard |

The dependency direction documented in `.agents/AGENTS.md`
(`domain` ← `shared` ← `config` ← {`platforms`, `core`} ← `apps/cli`) is
reflected in the TypeScript project references. Libraries are consumed as
source, with no per-library build.

### Verification results

| Check                  | Result                                                         |
| ---------------------- | -------------------------------------------------------------- |
| `pnpm typecheck`       | Pass (19 s)                                                    |
| `pnpm lint`            | Pass. Knip reports two redundant entry patterns in `knip.json` |
| `pnpm build`           | Pass. Working tree stays clean afterwards                      |
| `pnpm test:coverage`   | 190 files, 3,015 tests, all pass (29 s)                        |
| Coverage               | 95.6% statements, 87.8% branches, 96.0% functions, 96.4% lines |
| Coverage gates         | 92% statements, 85% branches, 95% functions, 93% lines         |
| `pnpm audit --prod`    | No known vulnerabilities                                       |
| `eval --provider mock` | 10 of 10 scenarios pass                                        |
| CLI smoke test         | `--help` lists all 17 commands                                 |

Branch coverage has the least headroom (2.8 points). The weakest files by
branch coverage are `apps/web/src/components/review/TechnicalLog.tsx` (25%),
`libs/core/src/review/multiAgent/agents.ts` (50%),
`apps/cli/src/build/providers/azure.ts` (60%) and
`apps/web/src/server/review.server.ts` (68%).

### Strengths

- **Code hygiene.** No `TODO`/`FIXME` markers, no `@ts-ignore`, three lint
  suppressions in total, and no stray `console.*` calls in production code (the
  matches are in JSDoc examples and the output-writer ports).
- **AI tool permissions are deny-by-default.** The Copilot handler
  (`libs/core/src/ai/providers/copilot-sdk.ts:113`) approves only reads inside
  the working tree, resolves symlinks, and rejects unknown permission kinds.
  Shell tools are never enabled by any command; `fix` enables writes only.
- **The dashboard is guarded in depth.** `requestGuard.server.ts` checks the
  `Host` header, same-origin and content type for writes, and a per-launch token
  compared in constant time. Secrets are never sent to the browser.
- **Git credentials stay out of URLs and `.git/config`**, and git is always
  invoked with an argument array, not a shell string.
- **Supply chain.** Actions are pinned by commit SHA, Renovate waits three days
  before proposing a release, and CI runs on three operating systems and two
  Node versions.
- **GitHub batching is careful.** The new single-review posting
  (`libs/platforms/src/github.ts:888`) falls back to individual comments only
  on a 422, and treats any other failure as "may have posted", so comments are
  not duplicated.

## Findings

### 1. `fix` and `reply` hand the platform token to Copilot

`apps/cli/src/commands/fix.ts:186` and `apps/cli/src/commands/reply.ts:197`
build the Copilot provider with:

```ts
token: aiProvider === "copilot-sdk"
  ? platform === "github" ? config.github.token : config.azure.token
  : undefined,
```

Every other command (`review`, `describe`, `plan`, `prd`, `prd-breakdown`,
`build`) passes `config.copilotToken`. Two consequences:

- On Azure DevOps, the Azure DevOps personal access token is given to the
  Copilot client as its GitHub token (`config.gitHubToken`,
  `copilot-sdk.ts:191`). `SECURITY.md` lists "platform tokens sent to unintended
  third parties" as in scope. What the SDK does with the value was not traced.
- `--copilot-token` and `MM_COPILOT_TOKEN` are documented for both commands
  (`docs/fix.md:72`, `docs/reply.md:65`) but have no effect. `fix.ts` never
  reads the option; `reply.ts` loads it into the configuration and then ignores
  it.

`fix.spec.ts:293` asserts the current behaviour ("passes the platform token only
to the copilot-sdk provider"), so this was deliberate at some point. It looks
like it predates `MM_COPILOT_TOKEN`.

**Recommendation:** pass `config.copilotToken` in both commands, as the other
commands do, and update the two specs.

### 2. CI does not typecheck the web app

`CONTRIBUTING.md:22` says `pnpm check` "is exactly what CI runs". CI
(`.github/workflows/ci.yml`) runs lint, tests, build and a smoke test, but not
`pnpm typecheck`. The build's `tsc --build` covers the root project references,
which do not include `apps/web` (`tsconfig.json`), and `vite build` does not
typecheck. Type errors in the web app are therefore caught only by the local
pre-push hook, which Renovate branches and web-based edits never run.

**Recommendation:** add a `pnpm typecheck` step to the Linux/Node 24 job in
`ci.yml`, and to `release.yml`.

### 3. Invalid configuration values fall back silently

`libs/config/src/config.ts` uses `.catch(...)` on its enums, so a typo is
replaced by a default with no warning. Confirmed by running `loadConfig`:

| Input                           | Result                    |
| ------------------------------- | ------------------------- |
| `MM_PLATFORM=gitlab`            | `azure`                   |
| `MM_AI_PROVIDER=claude`         | `copilot-sdk`             |
| `MM_REVIEW_STRATEGY=deeep`      | `fast`                    |
| `MM_MULTI_AGENT_MAX_PARALLEL=0` | `2`                       |
| `MM_STREAMING_LINES=abc`        | `NaN` (not the default 9) |

The platform and provider cases matter most: the user gets a confusing "missing
Azure token" error, or a review from a different provider than intended.
`MM_STREAMING_LINES` is also never checked against its documented range of
1 to 20.

**Recommendation:** throw a `ConfigurationError` naming the variable and the
allowed values, or at least log a warning. Reject non-finite
`MM_STREAMING_LINES`.

### 4. `fix` write protection differs between AI providers

With `copilot-sdk`, each write is checked against the working tree and a
denylist (`permissionPolicy.ts`). With `opencode-sdk`, `fix` sets
`edit: "allow"` (`opencode-sdk.ts:297`) and the path policy is not applied, so
the protected paths (`.git`, `.github`, `.husky`, `.vscode`, `package.json`,
`.npmrc`) are not protected by Merge Mentor's own code on that provider.

Two limits of the denylist itself:

- Directories are matched only as the first path segment
  (`permissionPolicy.ts:76`), so `packages/app/.vscode/tasks.json` or a
  submodule's `.git` is writable.
- It is a denylist. Files such as `Makefile`, `.gitattributes`,
  `pnpm-workspace.yaml` and `conftest.py` also run code or change behaviour the
  next time a tool runs.

This matters because `fix` feeds untrusted review comments to the agent.

**Recommendation:** match denied directories at any depth, and document the
OpenCode difference in `docs/fix.md` until the same policy can be applied
there.

### 5. `ui --host` cannot be reached by any name other than the bind host

`apps/cli/src/commands/ui.ts:165` sets `MM_UI_ALLOWED_HOSTS` to the `--host`
value, replacing anything the user set. From the code, with `--host 0.0.0.0`
(the documented container case) the guard accepts only `localhost`,
`127.0.0.1`, `[::1]` and `0.0.0.0` as `Host`, so reaching the dashboard by
machine name or LAN address returns 403 and there is no way to add a name.
This was not exercised against a running server.

Related, in the same file:

- `--host ::1` produces the URL `http://::1:3000/...` (line 150), which is not
  a valid URL; IPv6 literals need brackets.
- The startup message calls the token "one-time", but it is valid for the whole
  launch.
- The comment on `DEFAULT_UI_HOST` (line 18) still describes the dashboard as
  unauthenticated.

**Recommendation:** merge the user's `MM_UI_ALLOWED_HOSTS` with the bind host,
bracket IPv6 hosts, and correct the two texts.

### 6. `review` cannot fail a pipeline

`review` exits 0 whenever the review completes; `hasCriticalIssues` is only
logged (`apps/cli/src/program.ts:305`). Only `stage --exit-code` gates on
findings. Teams that want a required check cannot get one from `review --ci`.
`ideas/severity-gating-and-suppressions-plan.md` already proposes this; the
gating half does not depend on the open suppressions decision.

### 7. Build target is newer than the supported Node version

`build.mjs:16` targets `node24`, while `package.json` declares
`engines.node >= 22` and CI tests Node 22. It works today because the source
uses nothing Node 22 lacks, but esbuild will not down-level a newer syntax
feature if one is introduced. Set the target to `node22`.

### 8. Documentation has drifted from the code

- `CONTRIBUTING.md:58` gives the coverage thresholds as 80%; they are 92 to 95%
  (85% for branches) in `vitest.config.ts`.
- `README.md` omits the `stage`, `build` and `eval` commands. `docs/index.md`
  omits `build`, `stats`, `outcomes` and `ui`, and still describes the product
  as a code review tool only.
- `README.md` and `docs/index.md` name Amazon Bedrock as a supported provider.
  Nothing else in the docs or code mentions Bedrock; support is through the
  generic OpenAI-compatible endpoint settings. Say so, or add a setup example.
- `README.md:107` says the Copilot SDK requires `MM_COPILOT_TOKEN`, while the
  provider falls back to local credentials when no token is given
  (`copilot-sdk.ts:181`).
- `config.ts:106` documents the multi-agent parallel default as 4; it is 2.
  `config.ts:335` lists the strategies as "deep, fast" and omits `multi-agent`.
- `ideas/README.md` lists outcome tracking as "Proposed (revised)". The
  display-only version is implemented and in the changelog.
- `knip.json` points at the Knip 5 schema; Knip 6 is installed, and it reports
  both `apps/web` entry patterns as redundant.

### 9. Smaller code issues

- **`.env` editor and duplicate keys.** `writeEnvValues`
  (`apps/web/src/server/env.server.ts:158`) rewrites only the first line for a
  key. If the file defines the key twice, the later line still wins when the
  file is read back, so the saved value does not take effect.
- **`doctor` reports Copilot as available without checking.**
  `apps/cli/src/commands/doctor.ts:55` hard-codes the status. The same file
  builds shell strings for `execSync`, including one from `COPILOT_CLI_PATH`;
  the value is the user's own, but it bypasses the `ProcessRunner` port that
  `CONTRIBUTING.md` asks for.
- **Secrets as command-line flags.** `--github-token`, `--azure-token`,
  `--ai-api-key` and `--copilot-token` are visible in process listings and shell
  history. The docs should recommend the environment variables.
- **Large files.** `engine.ts` (2,321 lines), `azure.ts` (1,737),
  `program.ts` (1,252) and `breakdownEngine.ts` (1,236) are the main
  maintainability risk. `program.ts` is excluded from coverage although it holds
  real logic, such as the `--pr-url` conflict checks.
- **Pre-release dependency.** The dashboard server ships on a Nitro beta
  (`nitro 3.0.260903-beta`); a release candidate is available.

### 10. Backlog hygiene

- **Unreleased work is piling up.** The `[Unreleased]` changelog section holds
  about 100 lines covering outcome tracking, PRD re-review and Word
  annotation, the dashboard state rework and GitHub review batching. That is
  enough for a 4.5.0 release.
- **Eight Renovate pull requests are open**, two of them major upgrades
  (TypeScript 7 in #126, Node 26 in #125). The rest are routine and could be
  merged or grouped.
- **PR #116** ("cover interactive UI with React Testing Library") has been open
  since 2026-10-25. It would address the weak component coverage noted above;
  it needs rebasing onto the TanStack Query rework or closing.
- **Issues #103 and #104** are partly delivered by unreleased work (single
  batched review; display-only outcome tracking) and could be updated to show
  what remains.
- **The eval corpus is small.** Ten scenarios, each passing at 100% with the
  mock provider, show the harness works but say little about review quality.
  Issue #98 already tracks growing it and measuring on a real provider.

## Suggested order of work

1. Fix the token passed by `fix` and `reply` (finding 1).
2. Add `pnpm typecheck` to CI (finding 2).
3. Make invalid configuration values fail loudly (finding 3).
4. Tighten the write denylist and fix `ui --host` (findings 4 and 5).
5. Cut 4.5.0 and clear the routine Renovate pull requests (finding 10).
6. Bring the docs back in line (finding 8), then the remaining low items.
