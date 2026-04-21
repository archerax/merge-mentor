/**
 * Repository management for coding standard extraction.
 *
 * Maintains persistent clones of repositories for extracting coding standards
 * and conventions used in code review context. The ReviewEngine uses RepoManager
 * to clone the PR's repository and extract patterns from existing code.
 *
 * Key responsibilities:
 * - Clone repositories from GitHub or Azure DevOps
 * - Update existing clones via `git fetch` (more efficient than re-cloning)
 * - Extract coding standards from repository contents
 * - Handle authentication tokens securely (redacted in logs)
 * - Support CI mode (repository already checked out)
 *
 * Clones are stored in `{tempPath}/repos/{platform}/{owner}/{repo}` for reuse
 * across multiple PR reviews. This avoids redundant cloning while keeping
 * credentials and temporary data isolated.
 *
 * @example
 * ```typescript
 * const manager = new RepoManager('.mergementor');
 *
 * const repoPath = await manager.ensureRepo(
 *   { owner: 'archerax', repo: 'merge-mentor', platform: 'github' },
 *   'main',
 *   githubToken
 * );
 *
 * const standards = await manager.extractCodingStandards(repoPath);
 * ```
 */

import path from "node:path";
import { createChildLogger } from "../logger.js";
import { type Clock, type FileSystem, nodeFs, systemClock } from "../ports/index.js";
import { redactToken } from "../utils/redact.js";
import type { GitAuth, GitClient } from "./gitClient.js";
import { createGitClient } from "./gitClients/factory.js";

/** Repository information for cloning. */
export interface RepoInfo {
  /** Repository owner or organization name */
  readonly owner: string;
  /** Repository name */
  readonly repo: string;
  /** Platform: 'github' for GitHub, 'azure' for Azure DevOps */
  readonly platform: "github" | "azure";
  /** Azure DevOps organization name (required if platform === 'azure') */
  readonly org?: string;
  /** Azure DevOps project name (required if platform === 'azure') */
  readonly project?: string;
}

/**
 * Configuration options for repository operations.
 *
 * Controls behavior for cloning and fetching repositories.
 * Timeout and git execution details are configured on the `GitClient`
 * (e.g. `CliGitClient`) and passed in via the `gitClient` constructor parameter.
 */
interface RepoManagerOptions {
  /** Whether running in CI mode (repository already configured with credentials) */
  readonly ciMode?: boolean;
}

/**
 * Manages persistent repository clones for context extraction.
 *
 * Handles cloning, updating, and extracting coding standards from repositories.
 * Supports both GitHub and Azure DevOps platforms with automatic authentication.
 */
export class RepoManager {
  private readonly logger = createChildLogger({ component: "RepoManager" });
  private readonly reposDir: string;
  private readonly ciMode: boolean;

  /**
   * Creates a new repository manager.
   *
   * @param tempPath   - Base temporary directory (will create `repos/` subdirectory)
   * @param options    - Configuration for CI mode
   * @param gitClient  - Git operations adapter (defaults to `CliGitClient` backed by system git)
   * @param fileSystem - File system operations (dependency injection, defaults to nodeFs)
   * @param clock      - Clock for timestamps (dependency injection, defaults to systemClock)
   */
  constructor(
    tempPath: string,
    options?: RepoManagerOptions,
    private readonly gitClient: GitClient = createGitClient("cli"),
    private readonly fileSystem: FileSystem = nodeFs,
    private readonly clock: Clock = systemClock
  ) {
    this.ciMode = options?.ciMode ?? false;
    this.reposDir = path.join(tempPath, "repos");
  }

  /**
   * Ensures the repository is cloned and up-to-date, then returns the path.
   *
   * Clones the repo if not present, or fetches updates if it exists (more efficient).
   * After cloning/updating, checks out the specified branch.
   *
   * Authentication is handled automatically via the token parameter (added to clone URL).
   * For CI mode, assumes credentials are already configured in the environment.
   *
   * @param repoInfo - Repository identification (owner, repo, platform, org, project)
   * @param branch - Branch to checkout after clone/fetch
   * @param token - Authentication token (GitHub token or Azure PAT)
   * @returns Absolute path to the cloned repository
   * @throws Error if clone fails, fetch fails, or branch doesn't exist
   *
   * @example
   * ```typescript
   * const manager = new RepoManager('.mergementor');
   *
   * // GitHub
   * const path = await manager.ensureRepo(
   *   { owner: 'archerax', repo: 'merge-mentor', platform: 'github' },
   *   'main',
   *   githubToken
   * );
   *
   * // Azure DevOps
   * const azurePath = await manager.ensureRepo(
   *   {
   *     owner: 'myorg',
   *     repo: 'my-repo',
   *     platform: 'azure',
   *     org: 'myorg',
   *     project: 'MyProject'
   *   },
   *   'develop',
   *   azurePAT
   * );
   * ```
   */
  async ensureRepo(repoInfo: RepoInfo, branch: string, token: string): Promise<string> {
    const repoPath = this.getRepoPath(repoInfo);

    try {
      const exists = await this.repoExists(repoPath);

      if (exists) {
        this.logger.info({ repoPath, branch }, "Updating existing repository");
        await this.updateRepo(repoPath, branch, token, repoInfo);
      } else {
        this.logger.info({ repoPath, branch }, "Cloning repository");
        await this.cloneRepo(repoInfo, branch, token, repoPath);
      }

      return repoPath;
    } catch (error) {
      this.logger.error(
        { repoPath, error: (error as Error).message },
        "Failed to ensure repository"
      );
      throw error;
    }
  }

  /**
   * Lists all cloned repositories.
   *
   * @returns Array of repository directory names
   */
  async listClonedRepos(): Promise<string[]> {
    try {
      await this.fileSystem.mkdir(this.reposDir, { recursive: true });
      const entries = await this.fileSystem.readdir(this.reposDir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  /**
   * Gets information about a cloned repository.
   *
   * @param repoName - Directory name of the repository
   * @returns Repository information or undefined if not found
   */
  async getRepoStats(repoName: string): Promise<{ size: number; lastUsed: Date } | undefined> {
    const repoPath = path.join(this.reposDir, repoName);

    try {
      const stats = await this.fileSystem.stat(repoPath);

      if (!stats.isDirectory()) {
        return undefined;
      }

      // Get directory size (approximate - just the .git directory)
      const gitPath = path.join(repoPath, ".git");
      const gitStats = await this.fileSystem.stat(gitPath);

      return {
        size: gitStats.size,
        lastUsed: stats.mtime,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Removes repositories older than the specified number of days.
   *
   * @param olderThanDays - Remove repos not accessed in this many days
   * @returns Number of repositories removed
   */
  async cleanOldRepos(olderThanDays: number): Promise<number> {
    const repos = await this.listClonedRepos();
    const cutoffDate = this.clock.now();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    let removed = 0;

    for (const repoName of repos) {
      const stats = await this.getRepoStats(repoName);

      if (stats && stats.lastUsed < cutoffDate) {
        const repoPath = path.join(this.reposDir, repoName);
        await this.fileSystem.rm(repoPath, { recursive: true, force: true });
        this.logger.info({ repoName, lastUsed: stats.lastUsed }, "Removed old repository");
        removed++;
      }
    }

    return removed;
  }

  /**
   * Generates the local path for a repository.
   */
  private getRepoPath(repoInfo: RepoInfo): string {
    if (repoInfo.platform === "azure") {
      return path.join(this.reposDir, `azure-${repoInfo.org}-${repoInfo.project}-${repoInfo.repo}`);
    }
    return path.join(this.reposDir, `github-${repoInfo.owner}-${repoInfo.repo}`);
  }

  /**
   * Checks if a repository already exists on disk.
   */
  private async repoExists(repoPath: string): Promise<boolean> {
    try {
      const gitPath = path.join(repoPath, ".git");
      const stats = await this.fileSystem.stat(gitPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Clones a repository.
   */
  private async cloneRepo(
    repoInfo: RepoInfo,
    branch: string,
    token: string,
    repoPath: string
  ): Promise<void> {
    const cloneUrl = this.buildCloneUrl(repoInfo);

    // Ensure parent directory exists
    await this.fileSystem.mkdir(path.dirname(repoPath), { recursive: true });

    try {
      const auth = this.buildGitAuth(token, repoInfo.platform);
      await this.gitClient.clone(cloneUrl, repoPath, auth, { branch });
      this.logger.info({ repoPath, branch }, "Repository cloned successfully");
    } catch (error) {
      // Clean up partial clone on failure
      await this.fileSystem.rm(repoPath, { recursive: true, force: true }).catch(() => {});
      throw new Error(
        `Failed to clone repository: ${redactToken((error as Error).message, token)}`
      );
    }
  }

  /**
   * Updates an existing repository.
   */
  private async updateRepo(
    repoPath: string,
    branch: string,
    token: string,
    repoInfo: RepoInfo
  ): Promise<void> {
    const remoteUrl = this.buildCloneUrl(repoInfo);

    try {
      const auth = this.buildGitAuth(token, repoInfo.platform);

      // Clean any leftover files from previous reviews
      await this.gitClient.clean(repoPath);

      // Update remote URL (keeps credentials out of stored config)
      await this.gitClient.setRemoteUrl(repoPath, remoteUrl);

      // Fetch the latest state of the branch
      await this.gitClient.fetch(repoPath, branch, auth);

      // Reset the working tree to the fetched branch
      await this.gitClient.checkout(repoPath, branch);

      this.logger.info({ repoPath, branch }, "Repository updated successfully");
    } catch (error) {
      throw new Error(
        `Failed to update repository: ${redactToken((error as Error).message, token)}`
      );
    }
  }

  /**
   * Builds the public clone URL for a repository (no embedded credentials).
   *
   * Credentials are passed separately via the `GitClient` auth mechanism,
   * which keeps tokens out of URLs, process listings, and .git/config.
   */
  private buildCloneUrl(repoInfo: RepoInfo): string {
    if (repoInfo.platform === "azure") {
      return `https://dev.azure.com/${repoInfo.org}/${repoInfo.project}/_git/${repoInfo.repo}`;
    }
    return `https://github.com/${repoInfo.owner}/${repoInfo.repo}.git`;
  }

  /**
   * Builds a `GitAuth` value from a raw token and platform, respecting CI mode.
   *
   * In CI mode the returned auth signals that the environment already has
   * credentials configured; the `GitClient` should not inject any extra auth.
   */
  private buildGitAuth(token: string, platform: "github" | "azure"): GitAuth {
    if (this.ciMode) {
      return { type: "ci" };
    }
    return { type: "token", token, platform };
  }
}
