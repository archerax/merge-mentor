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
   * > **Note for `IsomorphicGitClient`:** isomorphic-git has no direct
   * > equivalent to `git clean`. This method is a no-op in that adapter.
   * > Tracked files are still reset by `checkout({ force: true })`.
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
}
