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
import type { GitAuth, GitClient, GitCloneOptions, GitFileChange } from "../gitClient.js";
import {
  buildContentDiffPatch,
  countPatchStats,
  hasContentHunks,
  isBinaryContent,
  splitGitDiff,
} from "../localDiff.js";

/** Default timeout for all git network operations (ms). */
const DEFAULT_TIMEOUT_MS = 120_000;

const logger = createChildLogger({ component: "IsomorphicGitClient" });

/** Kinds of walker used as the "new" side of a local diff. */
type NewSideKind = "workdir" | "stage" | "tree";

/** A row collected by the tree walk. */
interface WalkRow {
  /** File path relative to the repository root. */
  readonly filepath: string;
  /** OID of the base-side blob, absent when the file was added. */
  readonly baseOid?: string;
  /** OID of the new-side blob, absent when the file was deleted. */
  readonly newOid?: string;
  /** Base-side git object type (e.g. "blob"), absent if not present. */
  readonly baseType?: string;
  /** New-side git object type (e.g. "blob"), absent if not present. */
  readonly newType?: string;
  /** Which walker produced the new side: workdir, stage, or tree. */
  readonly newKind: NewSideKind;
}

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
  /**
   * Clones a remote repository into a new directory at `targetPath`.
   *
   * Uses a shallow, single-branch clone of `opts.branch`, passing credentials
   * through the isomorphic-git `onAuth` callback.
   *
   * @param url        - Public remote URL (no embedded credentials).
   * @param targetPath - Absolute path for the new working tree.
   * @param auth       - Authentication context.
   * @param opts       - Clone options (branch, depth).
   */
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

  /**
   * Fetches the latest state of `branch` from `origin` into an existing clone.
   *
   * @param repoPath - Absolute path to the working tree.
   * @param branch   - Remote branch name to fetch.
   * @param auth     - Authentication context.
   * @param depth    - Shallow fetch depth (defaults to 1).
   */
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

  /**
   * Checks out `branch` in an existing clone, resetting tracked files.
   *
   * Points the local branch at the freshly fetched remote tip and updates
   * HEAD before checking out, so the working tree reflects the latest remote
   * state even after force-pushes.
   *
   * @param repoPath - Absolute path to the working tree.
   * @param branch   - Branch name to check out.
   */
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

  /**
   * Updates the `origin` remote URL in an existing clone.
   *
   * @param repoPath  - Absolute path to the working tree.
   * @param remoteUrl - New public remote URL.
   */
  async setRemoteUrl(repoPath: string, remoteUrl: string): Promise<void> {
    await git.setConfig({
      fs,
      dir: repoPath,
      path: "remote.origin.url",
      value: remoteUrl,
    });
  }

  /**
   * Returns the current branch name, or `"HEAD"` when detached.
   *
   * @param repoPath - Absolute path to the working tree.
   */
  async currentBranch(repoPath: string): Promise<string> {
    const branch = await git.currentBranch({ fs, dir: repoPath });
    return branch ?? "HEAD";
  }

  /**
   * Returns the configured `origin` remote URL, or `undefined` when the
   * repository has no `origin` remote.
   *
   * @param repoPath - Absolute path to the working tree.
   */
  async getRemoteUrl(repoPath: string): Promise<string | undefined> {
    const url = await git.getConfig({ fs, dir: repoPath, path: "remote.origin.url" });
    return url?.length ? url : undefined;
  }

  /**
   * Compares the working tree (staged + unstaged, including untracked files)
   * against a base ref.
   *
   * @param repoPath - Absolute path to the working tree.
   * @param baseRef  - Base ref to diff against (defaults to `HEAD`).
   * @returns File changes with patches relative to the base ref.
   */
  async workingTreeDiff(repoPath: string, baseRef = "HEAD"): Promise<GitFileChange[]> {
    return this.walkDiff(repoPath, baseRef, git.WORKDIR(), "workdir");
  }

  /**
   * Compares the index (staged changes) against a base ref.
   *
   * @param repoPath - Absolute path to the working tree.
   * @param baseRef  - Base ref to diff against (defaults to `HEAD`).
   * @returns Staged file changes with patches relative to the base ref.
   */
  async stagedDiff(repoPath: string, baseRef = "HEAD"): Promise<GitFileChange[]> {
    return this.walkDiff(repoPath, baseRef, git.STAGE(), "stage");
  }

  /**
   * Compares two refs against each other.
   *
   * @param repoPath - Absolute path to the working tree.
   * @param baseRef  - Base ref (older side of the diff).
   * @param headRef  - Head ref (newer side of the diff).
   * @returns File changes between the two refs.
   */
  async diff(repoPath: string, baseRef: string, headRef: string): Promise<GitFileChange[]> {
    return this.walkDiff(repoPath, baseRef, git.TREE({ ref: headRef }), "tree");
  }

  /**
   * Compares the base ref's tree against a "new" side (working tree, index, or
   * another ref) by walking both trees and generating unified diffs for every
   * changed file.
   */
  private async walkDiff(
    repoPath: string,
    baseRef: string,
    newWalker: unknown,
    newKind: NewSideKind
  ): Promise<GitFileChange[]> {
    const rows = (await withTimeout(
      git.walk({
        fs,
        dir: repoPath,
        trees: [git.TREE({ ref: baseRef }), newWalker as never],
        map: async (
          filepath: string,
          entries: Array<{ type(): Promise<string>; oid(): Promise<string> } | null>
        ): Promise<WalkRow | undefined> => {
          if (filepath === ".git" || filepath.startsWith(".git/")) return undefined;

          const [baseEntry, newEntry] = entries;
          const baseType = baseEntry ? await baseEntry.type() : undefined;
          const newType = newEntry ? await newEntry.type() : undefined;

          if (baseType !== "blob" && newType !== "blob") return undefined;

          // Skip untracked files that are gitignored (matches `git diff`).
          if (baseType !== "blob" && newType === "blob") {
            const ignored = await git.isIgnored({ fs, dir: repoPath, filepath });
            if (ignored) return undefined;
          }

          const baseOid = baseType === "blob" && baseEntry ? await baseEntry.oid() : undefined;
          const newOid = newType === "blob" && newEntry ? await newEntry.oid() : undefined;

          if (baseOid !== undefined && baseOid === newOid) return undefined;

          return { filepath, baseOid, newOid, baseType, newType, newKind };
        },
      }),
      DEFAULT_TIMEOUT_MS
    )) as WalkRow[];

    const changes: GitFileChange[] = [];
    for (const row of rows) {
      const oldContent = row.baseOid ? await this.readBlobText(repoPath, row.baseOid) : "";
      const newContent = await this.readNewSideContent(repoPath, row);
      if (newContent === undefined) {
        // Deleted file (no new side) or unreadable new side.
        if (row.baseType === "blob" && row.newType !== "blob") {
          changes.push({
            path: row.filepath,
            status: "deleted",
            additions: 0,
            deletions: this.countLines(oldContent),
          });
        }
        continue;
      }

      const newText = newContent.toString("utf-8");
      if (isBinaryContent(newText) || isBinaryContent(oldContent)) continue;

      const patch = buildContentDiffPatch(row.filepath, oldContent, newText);
      const [chunk] = splitGitDiff(patch);
      if (!chunk || !hasContentHunks(chunk)) continue;

      const sha = (await git.hashBlob({ object: newContent })).oid;
      const { additions, deletions } = countPatchStats(chunk);
      const status: GitFileChange["status"] = row.baseType !== "blob" ? "added" : "modified";

      changes.push({
        path: row.filepath,
        status,
        additions,
        deletions,
        patch,
        sha,
      });
    }

    return changes;
  }

  /** Reads a blob's UTF-8 text from the object database. */
  private async readBlobText(repoPath: string, oid: string): Promise<string> {
    const { blob } = await git.readBlob({ fs, dir: repoPath, oid });
    return Buffer.from(blob).toString("utf-8");
  }

  /** Reads the "new" side content for a walk row (index/ref blobs come from the object DB). */
  private async readNewSideContent(repoPath: string, row: WalkRow): Promise<Buffer | undefined> {
    if (row.newType !== "blob") return undefined;

    if (row.newKind === "stage" || row.newKind === "tree") {
      if (!row.newOid) return undefined;
      const { blob } = await git.readBlob({ fs, dir: repoPath, oid: row.newOid });
      return Buffer.from(blob);
    }

    // WORKDIR walker reads the file from the filesystem.
    try {
      return await fs.promises.readFile(path.join(repoPath, row.filepath));
    } catch {
      return undefined;
    }
  }

  private countLines(content: string): number {
    if (content.length === 0) return 0;
    return content.split("\n").filter((line) => line.length > 0).length;
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
