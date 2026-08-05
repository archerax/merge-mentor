/**
 * isomorphic-git client — pure-JS git operations, no system git required.
 *
 * Uses `isomorphic-git` with the bundled Node.js HTTP adapter
 * (`isomorphic-git/http/node`). Credentials are passed via the `onAuth`
 * callback and never appear in process arguments or on-disk config.
 *
 * isomorphic-git has no equivalent of `git clean -fdx`. The `clean()` method
 * approximates it with `statusMatrix()` and Node's filesystem APIs. Tracked
 * file changes are still reset by `checkout()` (which uses `force: true`).
 *
 * Timeouts are enforced with `Promise.race` against an `AbortController`
 * signal passed to every isomorphic-git call, matching the timeout contract
 * of `CliGitClient`.
 */

import fs from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
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
    // Point the local branch at the freshly fetched remote tip so the working
    // tree reflects the latest remote state (e.g. after a force-push). Without
    // this, `git.checkout` resolves the stale `refs/heads/<branch>` because it
    // is preferred over `refs/remotes/origin/<branch>` during ref resolution.
    const oid = await withTimeout(
      git.resolveRef({ fs, dir: repoPath, ref: `refs/remotes/origin/${branch}` }),
      DEFAULT_TIMEOUT_MS
    );
    await git.writeRef({
      fs,
      dir: repoPath,
      ref: `refs/heads/${branch}`,
      value: oid,
      force: true,
    });

    // Update HEAD to point to the freshly synced local branch
    await git.writeRef({
      fs,
      dir: repoPath,
      ref: "HEAD",
      value: `refs/heads/${branch}`,
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
   * Approximates `git clean -fdx` by removing every ignored or untracked path
   * reported by isomorphic-git's status matrix.
   */
  async clean(repoPath: string): Promise<void> {
    const status = await withTimeout(
      git.statusMatrix({ fs, dir: repoPath, ignored: true }),
      DEFAULT_TIMEOUT_MS
    );

    for (const [filepath, head, workdir] of status) {
      // HEAD=0 identifies an untracked path. A present workdir entry excludes
      // paths that are absent from disk and tracked files removed by a user.
      if (head === 0 && workdir !== 0) {
        await rm(path.join(repoPath, filepath), { recursive: true, force: true });
      }
    }
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
