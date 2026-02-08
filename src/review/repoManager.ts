import { exec as execCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createChildLogger } from "../logger.js";

const exec = promisify(execCallback);

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
  /** Base directory for storing repos (default: .merge-mentor/repos) */
  readonly reposDir?: string;
}

/** Context extracted from repository. */
export interface RepoContext {
  /** Combined content of all context files found. */
  readonly content: string;
  /** List of files that were loaded. */
  readonly filesLoaded: readonly string[];
  /** Path to the repository on disk. */
  readonly repoPath: string;
}

/** Default timeouts */
const DEFAULT_CLONE_TIMEOUT_MS = 120_000; // 2 minutes
const DEFAULT_FETCH_TIMEOUT_MS = 30_000; // 30 seconds

/** Context files to look for in repositories. */
const CONTEXT_FILES = [
  "AGENTS.md",
  ".github/instructions/clean-typescript.instructions.md",
  ".github/instructions/pragmatic-typescript.instructions.md",
  ".github/instructions/testing-typescript.instructions.md",
  ".github/copilot-instructions.md",
  "CONTRIBUTING.md",
  "docs/CODING_STANDARDS.md",
  "docs/ARCHITECTURE.md",
];

/**
 * Manages persistent repository clones for context extraction.
 * Handles cloning, updating, and extracting coding standards from repositories.
 */
export class RepoManager {
  private readonly logger = createChildLogger({ component: "RepoManager" });
  private readonly cloneTimeoutMs: number;
  private readonly fetchTimeoutMs: number;
  private readonly reposDir: string;

  constructor(options?: RepoManagerOptions) {
    this.cloneTimeoutMs = options?.cloneTimeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS;
    this.fetchTimeoutMs = options?.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    this.reposDir = options?.reposDir ?? path.join(process.cwd(), ".merge-mentor", "repos");
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
   * Loads context files from the repository (AGENTS.md, .github/instructions/, etc.).
   *
   * @param repoPath - Path to the cloned repository
   * @returns Context extracted from the repository
   */
  async loadRepoContext(repoPath: string): Promise<RepoContext> {
    const filesLoaded: string[] = [];
    const contentParts: string[] = [];

    this.logger.debug({ repoPath }, "Loading repository context files");

    for (const relativePath of CONTEXT_FILES) {
      const fullPath = path.join(repoPath, relativePath);

      try {
        const content = await fs.readFile(fullPath, "utf-8");

        if (content.trim().length > 0) {
          filesLoaded.push(relativePath);
          contentParts.push(`# Source: ${relativePath}\n\n${content.trim()}`);
          this.logger.debug({ file: relativePath, size: content.length }, "Loaded context file");
        }
      } catch {
        // File doesn't exist or can't be read - skip silently
        this.logger.trace({ file: relativePath }, "Context file not found");
      }
    }

    // Also check for any additional .instructions.md files in .github/instructions/
    try {
      const instructionsDir = path.join(repoPath, ".github", "instructions");
      const entries = await fs.readdir(instructionsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".instructions.md")) {
          // Normalize to forward slashes for cross-platform consistency
          const relativePath = path.join(".github", "instructions", entry.name).replace(/\\/g, "/");

          // Skip if already loaded
          if (filesLoaded.includes(relativePath)) {
            continue;
          }

          const fullPath = path.join(instructionsDir, entry.name);
          const content = await fs.readFile(fullPath, "utf-8");

          if (content.trim().length > 0) {
            filesLoaded.push(relativePath);
            contentParts.push(`# Source: ${relativePath}\n\n${content.trim()}`);
            this.logger.debug({ file: relativePath, size: content.length }, "Loaded context file");
          }
        }
      }
    } catch {
      // .github/instructions directory doesn't exist - skip
      this.logger.trace("No .github/instructions directory found");
    }

    const content = contentParts.join("\n\n---\n\n");

    this.logger.info(
      {
        repoPath,
        filesLoaded: filesLoaded.length,
        totalSize: content.length,
      },
      "Repository context loaded"
    );

    return {
      content,
      filesLoaded,
      repoPath,
    };
  }

  /**
   * Lists all cloned repositories.
   *
   * @returns Array of repository directory names
   */
  async listClonedRepos(): Promise<string[]> {
    try {
      await fs.mkdir(this.reposDir, { recursive: true });
      const entries = await fs.readdir(this.reposDir, { withFileTypes: true });
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
      const stats = await fs.stat(repoPath);

      if (!stats.isDirectory()) {
        return undefined;
      }

      // Get directory size (approximate - just the .git directory)
      const gitPath = path.join(repoPath, ".git");
      const gitStats = await fs.stat(gitPath);

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
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    let removed = 0;

    for (const repoName of repos) {
      const stats = await this.getRepoStats(repoName);

      if (stats && stats.lastUsed < cutoffDate) {
        const repoPath = path.join(this.reposDir, repoName);
        await fs.rm(repoPath, { recursive: true, force: true });
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
      const stats = await fs.stat(gitPath);
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
    await fs.mkdir(path.dirname(repoPath), { recursive: true });

    const cloneCmd = `git clone --depth 1 --single-branch --branch ${branch} "${cloneUrl}" "${repoPath}"`;

    try {
      await this.execWithTimeout(cloneCmd, this.cloneTimeoutMs);
      this.logger.info({ repoPath, branch }, "Repository cloned successfully");
    } catch (error) {
      // Clean up partial clone on failure
      await fs.rm(repoPath, { recursive: true, force: true }).catch(() => {});
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
      await this.execWithTimeout(
        `git -C "${repoPath}" clean -fdx`,
        this.fetchTimeoutMs
      );

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
      const { stdout } = await exec(command, {
        signal: controller.signal,
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer
      });
      return stdout;
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
