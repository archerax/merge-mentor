/**
 * Git client port — abstraction over git operations used by RepoManager.
 *
 * Two adapters are provided:
 * - `CliGitClient`       — delegates to the system `git` binary via ProcessRunner
 * - `IsomorphicGitClient` — pure-JS implementation via the `isomorphic-git` library
 *
 * The active backend is selected by `GitBackendType` (`'cli'` | `'isomorphic'`),
 * configurable via `MM_GIT_BACKEND` or `--git-backend`.
 *
 * @module
 */

/** Supported git backend implementations. */
export type GitBackendType = "cli" | "isomorphic";

/**
 * Authentication context passed to every git network operation.
 *
 * - `token` — caller supplies a PAT or OAuth token; the adapter handles
 *   the platform-specific encoding (GitHub vs Azure DevOps).
 * - `ci`    — the CI environment already has credentials configured;
 *   the adapter should not inject any auth.
 */
export type GitAuth =
  | {
      readonly type: "token";
      readonly token: string;
      readonly platform: "github" | "azure";
    }
  | { readonly type: "ci" };

/** Options controlling how a repository is cloned. */
export interface GitCloneOptions {
  /** Branch (or tag / commit ref) to check out immediately after cloning. */
  readonly branch: string;
  /**
   * Depth for a shallow clone (number of commits to fetch).
   * Defaults to `1` in all adapters.
   */
  readonly depth?: number;
}

/** Status of a file within a local diff (mirrors `FileStatus`). */
type GitFileStatus = "added" | "modified" | "deleted" | "renamed";

/** A single file change produced by a local git diff. */
export interface GitFileChange {
  readonly path: string;
  readonly status: GitFileStatus;
  readonly additions: number;
  readonly deletions: number;
  /** Unified diff hunk for this file (absent for binary or content-less changes). */
  readonly patch?: string;
  /** Stable content hash of the file's "new" side (absent for deletions). */
  readonly sha?: string;
}

/**
 * Minimal git operations required by RepoManager.
 *
 * Implementations must be safe to call concurrently from different
 * `RepoManager` instances operating on different directories.
 */
export interface GitClient {
  /**
   * Clones a remote repository into `targetPath`.
   *
   * The directory at `targetPath` must not exist prior to calling this method.
   * On failure the adapter should leave no partial clone behind.
   *
   * @param url        - Public remote URL (no embedded credentials).
   * @param targetPath - Absolute path for the new working tree.
   * @param auth       - Authentication context.
   * @param opts       - Clone options (branch, depth).
   * @throws On network failure, auth failure, or unknown ref.
   */
  clone(url: string, targetPath: string, auth: GitAuth, opts: GitCloneOptions): Promise<void>;

  /**
   * Fetches the latest state of `branch` from `origin` into an existing clone.
   *
   * @param repoPath - Absolute path to the working tree.
   * @param branch   - Remote branch name to fetch.
   * @param auth     - Authentication context.
   * @param depth    - Shallow depth (defaults to `1`).
   * @throws On network failure or unknown ref.
   */
  fetch(repoPath: string, branch: string, auth: GitAuth, depth?: number): Promise<void>;

  /**
   * Checks out `branch` in an existing clone, resetting tracked files.
   *
   * Equivalent to `git checkout -B <branch> origin/<branch>`.
   *
   * @param repoPath - Absolute path to the working tree.
   * @param branch   - Branch name to check out.
   */
  checkout(repoPath: string, branch: string): Promise<void>;

  /**
   * Removes untracked and ignored files from the working tree.
   *
   * Equivalent to `git clean -fdx`.
   *
   * > **Note for `IsomorphicGitClient`:** this is approximated with
   * > `statusMatrix({ ignored: true })` and filesystem removal. Tracked files
   * > are still reset by `checkout({ force: true })`.
   *
   * @param repoPath - Absolute path to the working tree.
   */
  clean(repoPath: string): Promise<void>;

  /**
   * Updates the `origin` remote URL in an existing clone.
   *
   * Used to refresh the stored remote URL without embedding credentials.
   *
   * @param repoPath  - Absolute path to the working tree.
   * @param remoteUrl - New public remote URL.
   */
  setRemoteUrl(repoPath: string, remoteUrl: string): Promise<void>;

  /**
   * Compares the working tree (staged + unstaged, including untracked files)
   * against a base ref.
   *
   * @param repoPath - Absolute path to the working tree.
   * @param baseRef  - Base ref to diff against (defaults to `HEAD`).
   * @returns File changes with patches relative to the base ref.
   */
  workingTreeDiff(repoPath: string, baseRef?: string): Promise<GitFileChange[]>;

  /**
   * Compares the index (staged changes) against a base ref.
   *
   * @param repoPath - Absolute path to the working tree.
   * @param baseRef  - Base ref to diff against (defaults to `HEAD`).
   * @returns Staged file changes with patches relative to the base ref.
   */
  stagedDiff(repoPath: string, baseRef?: string): Promise<GitFileChange[]>;

  /**
   * Compares two refs against each other.
   *
   * @param repoPath - Absolute path to the working tree.
   * @param baseRef  - Base ref (older side of the diff).
   * @param headRef  - Head ref (newer side of the diff).
   * @returns File changes between the two refs.
   */
  diff(repoPath: string, baseRef: string, headRef: string): Promise<GitFileChange[]>;

  /**
   * Returns the current branch name, or `"HEAD"` when the working tree is in a
   * detached state.
   *
   * @param repoPath - Absolute path to the working tree.
   */
  currentBranch(repoPath: string): Promise<string>;

  /**
   * Returns the configured `origin` remote URL, or `undefined` when the
   * repository has no `origin` remote.
   *
   * @param repoPath - Absolute path to the working tree.
   */
  getRemoteUrl(repoPath: string): Promise<string | undefined>;
}
