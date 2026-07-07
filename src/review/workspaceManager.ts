import path from "node:path";
import { createChildLogger } from "../logger.js";
import type { PlatformAdapter } from "../platforms/types.js";
import type { FileSystem, OutputWriter } from "../ports/index.js";
import type { DiffManifest } from "./diffStorage.js";
import type { RepoManager } from "./repoManager.js";

export interface WorkspaceManagerOptions {
  readonly tempPath?: string;
  readonly localWorkspacePath?: string;
  readonly verbose?: boolean;
  readonly ciMode?: boolean;
}

export class WorkspaceManager {
  private readonly platform: PlatformAdapter;
  private readonly repoManager: RepoManager;
  private readonly fileSystem: FileSystem;
  private readonly output: OutputWriter;
  private readonly options: WorkspaceManagerOptions;
  private readonly logger = createChildLogger({ component: "WorkspaceManager" });

  constructor(
    platform: PlatformAdapter,
    repoManager: RepoManager,
    fileSystem: FileSystem,
    output: OutputWriter,
    options?: WorkspaceManagerOptions
  ) {
    this.platform = platform;
    this.repoManager = repoManager;
    this.fileSystem = fileSystem;
    this.output = output;
    this.options = options ?? {};
  }

  /**
   * Returns the path to the repository workspace for CLI agent access.
   * Uses a pre-existing local checkout when available (e.g. in CI), otherwise
   * clones the repository to a local temp directory.
   */
  async resolveWorkspace(branch: string): Promise<string> {
    const localPath = this.options.localWorkspacePath;
    if (localPath) {
      try {
        await this.fileSystem.access(localPath);
      } catch {
        throw new Error(
          `CI workspace path does not exist or is not accessible: ${localPath}. ` +
            "Ensure the repository has been checked out before running merge-mentor."
        );
      }
      this.log(`📦 Using CI workspace: ${localPath}`);
      this.logger.info({ localPath }, "Using pre-existing CI workspace, skipping clone");
      return localPath;
    }
    return this.ensureRepoCloned(branch);
  }

  /**
   * Ensures repository is cloned for CLI agent workspace access.
   * Returns the path to the cloned repository.
   * @throws {Error} If repository cloning fails
   */
  async ensureRepoCloned(branch: string): Promise<string> {
    this.log("📦 Cloning repository for workspace access...");
    this.logger.debug({ branch }, "Ensuring repository is cloned");

    const repoInfo = this.platform.getRepoInfo();
    const token = this.platform.getToken();

    try {
      const repoPath = await this.repoManager.ensureRepo(repoInfo, branch, token);

      this.log(`  ✓ Repository ready at: ${repoPath}`);
      this.logger.info({ repoPath }, "Repository cloned successfully");
      return repoPath;
    } catch (error) {
      const errorMsg = `Failed to clone repository: ${(error as Error).message}`;
      this.log(`  ❌ ${errorMsg}`);
      this.logger.error(
        { error: (error as Error).message, branch },
        "Repository cloning failed, aborting review"
      );
      throw new Error(errorMsg);
    }
  }

  /**
   * Copies temporary diff files into the target repository directory under `.mergementor/`.
   */
  async copyDiffsToRepoDir(
    diffDir: string,
    manifest: DiffManifest,
    repoPath?: string
  ): Promise<{ paths: string[]; totalSize: number }> {
    // Use repo's .mergementor/diffs directory if repoPath provided, otherwise global temp
    const targetDir = repoPath
      ? path.join(repoPath, ".mergementor", "diffs")
      : path.join(this.options.tempPath ?? ".mergementor", "temp");

    // Ensure target directory exists
    await this.fileSystem.mkdir(targetDir, { recursive: true });

    this.logger.debug(
      { fileCount: manifest.files.length, targetDir },
      "Copying diff files to accessible directory"
    );

    const paths: string[] = [];
    let totalSize = 0;

    for (const fileEntry of manifest.files) {
      const sourcePath = path.join(diffDir, fileEntry.diffPath);
      const destPath = path.join(targetDir, fileEntry.diffPath);

      this.logger.debug(
        { diffPath: fileEntry.diffPath, sourcePath, destPath },
        "Copying diff file"
      );

      try {
        const content = await this.fileSystem.readFile(sourcePath, "utf-8");
        await this.fileSystem.writeFile(destPath, content, "utf-8");
        paths.push(destPath);
        totalSize += content.length;
        this.logger.debug(
          { diffPath: fileEntry.diffPath, contentLength: content.length },
          "Successfully copied diff file"
        );
      } catch (error) {
        this.logger.warn(
          { diffPath: fileEntry.diffPath, error: (error as Error).message },
          "Failed to copy diff file"
        );
        throw error;
      }
    }

    return { paths, totalSize };
  }

  private log(message: string): void {
    if (this.options.verbose !== false) {
      this.output.log(message);
      this.logger.debug(message);
    }
  }
}
