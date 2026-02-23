import path from "node:path";
import { createChildLogger } from "../logger.js";
import {
  type Clock,
  type FileSystem,
  nodeFs,
  nodeProcessRunner,
  type ProcessRunner,
  systemClock,
} from "../ports/index.js";

/** Repository information for cloning. */
export interface RepoInfo {
  readonly owner: string;
  readonly repo: string;
  readonly platform: "github" | "azure";
  /** For Azure DevOps: organization name */
  readonly org?: string;
  /** For Azure DevOps: project name */
  readonly project?: string;
}

/** Options for repository operations. */
export interface RepoManagerOptions {
  /** Clone timeout in milliseconds (default: 120000 - 2 minutes) */
  readonly cloneTimeoutMs?: number;
  /** Fetch timeout in milliseconds (default: 30000 - 30 seconds) */
  readonly fetchTimeoutMs?: number;
}

/** Default timeouts */
const DEFAULT_CLONE_TIMEOUT_MS = 120_000; // 2 minutes
const DEFAULT_FETCH_TIMEOUT_MS = 30_000; // 30 seconds

/**
 * Manages persistent repository clones for context extraction.
 * Handles cloning, updating, and extracting coding standards from repositories.
 */
export class RepoManager {
  private readonly logger = createChildLogger({ component: "RepoManager" });
  private readonly cloneTimeoutMs: number;
  private readonly fetchTimeoutMs: number;
  private readonly reposDir: string;

  constructor(
    tempPath: string,
    options?: RepoManagerOptions,
    private readonly fileSystem: FileSystem = nodeFs,
    private readonly runner: ProcessRunner = nodeProcessRunner,
    private readonly clock: Clock = systemClock
  ) {
    this.cloneTimeoutMs = options?.cloneTimeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS;
    this.fetchTimeoutMs = options?.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    this.reposDir = path.join(tempPath, "repos");
  }

  /**
   * Ensures the repository is cloned and up-to-date, then returns the path.
   * Clones the repo if not present, or fetches updates if it exists.
   *
   * @param repoInfo - Repository information
   * @param branch - Branch to checkout
   * @param token - Authentication token
   * @returns Path to the cloned repository
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
    const cloneUrl = this.buildCloneUrl(repoInfo, token);

    // Ensure parent directory exists
    await this.fileSystem.mkdir(path.dirname(repoPath), { recursive: true });

    const cloneCmd = `git clone --depth 1 --single-branch --branch ${branch} "${cloneUrl}" "${repoPath}"`;

    try {
      await this.execWithTimeout(cloneCmd, this.cloneTimeoutMs);
      this.logger.info({ repoPath, branch }, "Repository cloned successfully");
    } catch (error) {
      // Clean up partial clone on failure
      await this.fileSystem.rm(repoPath, { recursive: true, force: true }).catch(() => {});
      throw new Error(`Failed to clone repository: ${(error as Error).message}`);
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
    // First, update the remote URL with token (in case token changed)
    const remoteUrl = this.buildCloneUrl(repoInfo, token);

    try {
      // Clean any leftover files from previous reviews
      await this.execWithTimeout(`git -C "${repoPath}" clean -fdx`, this.fetchTimeoutMs);

      // Update remote URL
      await this.execWithTimeout(
        `git -C "${repoPath}" remote set-url origin "${remoteUrl}"`,
        this.fetchTimeoutMs
      );

      // Fetch and checkout branch
      await this.execWithTimeout(
        `git -C "${repoPath}" fetch --depth 1 origin ${branch}`,
        this.fetchTimeoutMs
      );

      // Reset to the fetched branch
      await this.execWithTimeout(
        `git -C "${repoPath}" checkout -B ${branch} origin/${branch}`,
        this.fetchTimeoutMs
      );

      this.logger.info({ repoPath, branch }, "Repository updated successfully");
    } catch (error) {
      throw new Error(`Failed to update repository: ${(error as Error).message}`);
    }
  }

  /**
   * Builds the authenticated clone URL for a repository.
   */
  private buildCloneUrl(repoInfo: RepoInfo, token: string): string {
    if (repoInfo.platform === "azure") {
      // Azure DevOps URL format: https://{token}@dev.azure.com/{org}/{project}/_git/{repo}
      return `https://${token}@dev.azure.com/${repoInfo.org}/${repoInfo.project}/_git/${repoInfo.repo}`;
    }

    // GitHub URL format: https://{token}@github.com/{owner}/{repo}.git
    return `https://${token}@github.com/${repoInfo.owner}/${repoInfo.repo}.git`;
  }

  /**
   * Executes a command with a timeout.
   */
  private async execWithTimeout(command: string, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await this.runner.exec(command, {
        signal: controller.signal,
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer
      });
      return result.stdout;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new Error(`Command timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
