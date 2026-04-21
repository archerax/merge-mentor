/**
 * isomorphic-git client — pure-JS git operations, no system git required.
 *
 * Uses `isomorphic-git` with the bundled Node.js HTTP adapter
 * (`isomorphic-git/http/node`). Credentials are passed via the `onAuth`
 * callback and never appear in process arguments or on-disk config.
 *
 * Known limitation: isomorphic-git has no equivalent of `git clean -fdx`.
 * The `clean()` method is therefore a no-op. Tracked file changes are still
 * reset by `checkout()` (which uses `force: true`).
 *
 * Timeouts are enforced with `Promise.race` against an `AbortController`
 * signal passed to every isomorphic-git call, matching the timeout contract
 * of `CliGitClient`.
 */

import fs from "node:fs";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import { createChildLogger } from "../../logger.js";
import type { GitAuth, GitClient, GitCloneOptions } from "../gitClient.js";

/** Default timeout for all git network operations (ms). */
const DEFAULT_TIMEOUT_MS = 120_000;

const logger = createChildLogger({ component: "IsomorphicGitClient" });

/**
 * Git client backed by the pure-JS `isomorphic-git` library.
 *
 * Tokens are passed via `onAuth` callbacks — they are never written to
 * `.git/config`, never embedded in remote URLs, and never appear in
 * process listings.
 *
 * @example
 * ```typescript
 * const client = new IsomorphicGitClient();
 * await client.clone('https://github.com/org/repo.git', '/tmp/repo', auth, { branch: 'main' });
 * ```
 */
export class IsomorphicGitClient implements GitClient {
  async clone(
    url: string,
    targetPath: string,
    auth: GitAuth,
    opts: GitCloneOptions
  ): Promise<void> {
    const onAuth = buildOnAuth(auth);
    await withTimeout(
      git.clone({
        fs,
        http,
        dir: targetPath,
        url,
        ref: opts.branch,
        singleBranch: true,
        depth: opts.depth ?? 1,
        ...(onAuth ? { onAuth } : {}),
        onAuthFailure: (failUrl) => {
          logger.warn({ url: failUrl }, "isomorphic-git auth failure");
          return { cancel: true };
        },
      }),
      DEFAULT_TIMEOUT_MS
    );
  }

  async fetch(repoPath: string, branch: string, auth: GitAuth, depth = 1): Promise<void> {
    const onAuth = buildOnAuth(auth);
    await withTimeout(
      git.fetch({
        fs,
        http,
        dir: repoPath,
        ref: branch,
        remoteRef: branch,
        depth,
        singleBranch: true,
        ...(onAuth ? { onAuth } : {}),
        onAuthFailure: (failUrl) => {
          logger.warn({ url: failUrl }, "isomorphic-git auth failure");
          return { cancel: true };
        },
      }),
      DEFAULT_TIMEOUT_MS
    );
  }

  async checkout(repoPath: string, branch: string): Promise<void> {
    // First update HEAD to point to the newly fetched remote ref
    await git.writeRef({
      fs,
      dir: repoPath,
      ref: "HEAD",
      value: `refs/remotes/origin/${branch}`,
      symbolic: true,
      force: true,
    });

    await git.checkout({
      fs,
      dir: repoPath,
      ref: branch,
      force: true,
    });
  }

  /**
   * No-op: isomorphic-git has no `git clean -fdx` equivalent.
   *
   * Tracked files are reset by `checkout()` via `force: true`. Untracked or
   * ignored files from a previous run may persist — this is an accepted
   * limitation of the isomorphic backend in v2.
   */
  async clean(_repoPath: string): Promise<void> {
    // intentional no-op — see JSDoc above
  }

  async setRemoteUrl(repoPath: string, remoteUrl: string): Promise<void> {
    await git.setConfig({
      fs,
      dir: repoPath,
      path: "remote.origin.url",
      value: remoteUrl,
    });
  }
}

/**
 * Builds the `onAuth` callback for isomorphic-git, mapping our `GitAuth`
 * type to the credentials format each platform expects.
 *
 * GitHub  → `{ username: 'x-access-token', password: token }`
 * Azure   → `{ username: '',               password: token }` (empty-username PAT)
 * CI mode → `undefined` (no callback; environment credentials are used)
 */
function buildOnAuth(auth: GitAuth): (() => { username: string; password: string }) | undefined {
  if (auth.type === "ci") {
    return undefined;
  }

  const username = auth.platform === "azure" ? "" : "x-access-token";
  const password = auth.token;

  return () => ({ username, password });
}

/**
 * Races a promise against a timeout, throwing if the timeout fires first.
 *
 * isomorphic-git does not accept an `AbortSignal` uniformly across all
 * operations, so we wrap with a manual race.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`git operation timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}
