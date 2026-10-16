# Merge Mentor — Full Application Review (2026-10-16)

Scope: CLI, core review engine, AI providers, platform adapters, web dashboard, CI/release pipeline.
Reviewed at commit `970b930` (v3.1.1 package, post-v4 hardening work).

## Health check

| Check                                               | Result                                      |
| --------------------------------------------------- | ------------------------------------------- |
| `pnpm typecheck`                                    | Pass                                        |
| `pnpm lint` (oxfmt, oxlint, knip)                   | Pass                                        |
| `pnpm test`                                         | Pass — 2,160 tests, 132 files, ~23 s        |
| `pnpm build`                                        | Pass                                        |
| Packed tarball installed in a clean dir + `ui` boot | Pass (HTTP 200)                             |
| `pnpm audit --prod --audit-level=high`              | **Fail** — 1 high (`braces`, see finding 5) |

Strengths: clear package boundaries and dependency direction, injected ports that keep the code testable, git credentials passed as per-command headers rather than URLs, OpenCode tools denied by default, report reads protected against `../` traversal, no raw-HTML sinks in the dashboard, and a healthy web test suite (22 spec files).

## 🔴 Critical

### 1. Any website can drive the dashboard using the user's tokens

The `/api/*` routes (`apps/web/src/routes/api/review/post.ts`, `review/stream.ts`, `pbi/stream.ts`, `project/stream.ts`) call `request.json()` without checking where the request came from. TanStack Start's built-in CSRF middleware only covers server functions, not these routes.

Reproduced against the built server (`dist/web/server/index.mjs`):

- A `Content-Type: text/plain` POST with `Origin: https://evil.example` to `/api/review/post` was accepted, and the server called the GitHub API with the configured token against an attacker-chosen repo. Browsers send this kind of request from any page without a preflight.
- The same kind of request to `/api/review/stream` with `{"pr":1,"write":true}` started a write-mode review.
- The server accepts any `Host` header (`Host: attacker.example` → 200), so DNS rebinding makes a malicious page appear same-origin and also defeats the CSRF protection on server functions.

Impact: comments posted as the user on any repo or work item their token reaches (including overwriting existing work item comments via `existingCommentId`), AI budget burn, reading private reports/audit logs, and — via `saveConfig` — setting `MM_AI_BASE_URL` to an attacker server so later reviews exfiltrate code and the AI key.

Fix:

- Add a request middleware (`src/start.ts`) that rejects any `Host` other than `127.0.0.1:<port>` / `localhost:<port>`.
- Apply CSRF/origin checks to every non-GET request, not just server functions, and require `Content-Type: application/json`.
- Preferably also require a per-launch random token printed at startup (Jupyter-style).

## 🟠 High

### 2. `fix` lets a prompt injection write arbitrary files (→ code execution)

`apps/cli/src/commands/fix.ts:180` enables write tools; `libs/core/src/ai/providers/copilot-sdk.ts:138` approves every `write` request without checking the path. Without `--interactive`, `fix.ts:222` processes every unresolved thread, including comments from anyone able to comment on the PR. One malicious comment could make the agent write `.husky/pre-push`, `.git/hooks/*`, `package.json` scripts, `.vscode/tasks.json` or shell profiles. The code comment already (correctly) treats shell access as RCE; unrestricted writes reach the same place.

Fix: only allow writes that resolve inside the working tree, deny `.git/`, `.husky/`, `.github/`, `.vscode/` and `package.json` scripts, and by default only act on comments from the bot or collaborators.

### 3. Copilot permission handler is block-list based

`createReviewPermissionHandler` rejects a fixed list of kinds and approves everything else (`copilot-sdk.ts:138`). SDK kinds not on the list (`workflow`, `extension-management`, `extension-permission-access`, `extension-env-access`) and any future kinds are auto-approved. `read` is approved for any path, including requests flagged `requestSandboxBypass`, so an injected PR could have the agent read `../.env` and echo it into a finding that is then posted as a PR comment. The OpenCode provider is already deny-by-default; this is inconsistent.

Fix: approve only `read` (and `write` when enabled) for paths inside `workingDirectory`, reject everything else, and never approve sandbox-bypass requests.

### 4. Release job will likely fail to publish

Root `package.json` has `"private": true` (since the 2026-10-06 monorepo scaffold) while `.github/workflows/release.yml:90` runs `npm publish`. Publishing a private package fails with `EPRIVATE`. Not proven end to end — `npm publish --dry-run` does not apply that check — but no publish has occurred since the change. Remove `private` from the root package (keeping workspace packages private) before the next tag.

### 5. CI `Security Audit` job fails today

`pnpm audit --prod --audit-level=high` reports GHSA-vfj7-8cjw-p6xm in `braces` (via `micromatch`, used only in `libs/shared/src/utils/ignoreFilter.ts`); no patched version exists. Patterns come from the user's own config so real risk is low. Either ignore the advisory with a written reason or replace `micromatch` with `picomatch`.

## 🟡 Medium

6. **PRs from forks review the wrong code.** `engine.ts` resolves the workspace by `headBranch` against the base repo (`repoManager.ts` builds `owner/repo.git`). For a fork PR the branch does not exist there, so the clone fails; if the fork branch is named `main`, the agent reads upstream `main` while the diff is from the fork. Fetch `refs/pull/<n>/head` (GitHub) or the PR merge ref (Azure) instead.
7. **Untrusted-content wrapper is escapable.** `wrapUntrustedContent` (`libs/core/src/ai/prompts/securityPreamble.ts:46`) does not strip a matching closing tag, so a PR description containing `</untrusted-pr-metadata>` breaks out. Escape the tag or use a random per-run delimiter.
8. **Bot comments can be impersonated.** `libs/platforms/src/github.ts:172` and `:193` treat any comment whose body contains the bot identifier as a bot comment, with no author check. A PR author can plant fake "existing findings" that suppress real ones and are fed to the model as prior context.
9. **Inline comments can attach to the wrong lines.** `github.ts:604` re-fetches the PR for `head.sha` on each inline comment. A push mid-review attaches old-diff line numbers to the new commit, and it costs an extra API call per comment. Capture the SHA once at review start.
10. **Comment writes are retried on 5xx/connection resets** (`libs/shared/src/utils/rateLimitHandler.ts`). If GitHub created the comment but the response timed out (e.g. 504), the retry posts a duplicate. Retry writes only on 429/rate-limit errors.
11. **Token visible in process listings.** `libs/core/src/review/gitClients/cliGitClient.ts:424` passes the auth header as a `-c` argument, visible to other local users via `ps`, contradicting the comment at `repoManager.ts:346`. Use `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` / `GIT_CONFIG_VALUE_0` env vars.
12. **Review cache ignores strategy/model/passes** (`libs/core/src/review/reviewStateCache.ts`). A `deep` run after a `fast` run silently reuses the `fast` results for unchanged files. Include these in the cache key or compare them on read.

## 🟢 Low / hygiene

- `eval.yml`: actions not pinned to commit SHAs (other workflows are), no `permissions:` block, and `${{ github.event.inputs.* }}` is interpolated directly into `run:` — pass via `env:`.
- `self-review.yml`: runs only on `opened`, so later pushes are never re-reviewed; it also builds and runs PR code with secrets (same-repo branches only, but any writer can read the Copilot token).
- `apps/web/src/server/reviewRuns.server.ts:134`: if a disk write throws inside `record()`, the `finally` block's `done` frame throws too, `activeByTarget` is never cleared, and that PR stays "running" until restart.
- Atomic writes use a fixed `.tmp` filename (`reviewRunStore.server.ts`, `postedComments.server.ts`, `env.server.ts`), so concurrent writers to one file can clobber each other. Use a unique temp name.
- Inline comments are posted one at a time rather than as a single `pulls.createReview`, producing one notification per finding.

## Suggested order of work

1. Finding 1 (dashboard host/origin guard + token) — exploitable from any web page while `merge-mentor ui` runs.
2. Findings 2–3 (Copilot permission allowlist, `fix` write scoping) — triggerable by a stranger's PR or comment.
3. Findings 4–5 (unblock release and CI).
4. Findings 6–12, then the hygiene items.

## Method and limits

Static review of the source plus runtime verification: the repo's own checks, a production build, a packed-tarball install, and live probes of the built dashboard on loopback with a dummy token. No real credentials or third-party systems were used. Finding 4 is inferred from npm semantics and not confirmed by a real publish. Not reviewed in depth: Azure DevOps adapter internals (`libs/platforms/src/azure.ts`), the `build`/`stage`/`plan` commands, and the multi-agent prompt quality.
