/**
 * Differential storage for batched PR review.
 *
 * Stores PR file diffs to disk in a structured format for later retrieval and analysis.
 * This enables:
 * - Batched review workflows (collect diffs, analyze later)
 * - Caching of processed diffs (avoid re-parsing)
 * - Audit trail (what was reviewed, when)
 * - Testing without live PR data
 *
 * Storage structure:
 * ```
 * {tempPath}/diffs/
 * ├── {prIdentifier}/
 * │   ├── manifest.json          (metadata about this PR's diffs)
 * │   ├── file1.ts.diff           (numbered diff for file1)
 * │   ├── src__utils__helper.ts.diff
 * │   └── ...
 * ```
 *
 * Filenames are sanitized by replacing path separators with `__` to ensure
 * single-level filesystem storage while preserving path information.
 *
 * Diffs are numbered (prepended with line numbers) for easier AI analysis and
 * line-number matching in comments.
 *
 * @example
 * ```typescript
 * const storage = new DiffStorage('.mergementor');
 *
 * const { diffDir, manifest } = await storage.storeDiffs(
 *   'GitHub-owner-repo-PR42',
 *   prFiles
 * );
 *
 * console.log(`Stored ${manifest.files.length} diffs in ${diffDir}`);
 *
 * // Later: clean up
 * await storage.cleanup('GitHub-owner-repo-PR42');
 * ```
 */

import path from "node:path";
import { createChildLogger } from "../logger.js";
import type { PRFile } from "../platforms/types.js";
import { type Clock, type FileSystem, nodeFs, systemClock } from "../ports/index.js";
import { convertToNumberedDiff } from "../utils/diffFormatter.js";

/** Entry for a single file in the diff manifest. */
interface DiffFileEntry {
  /** Original filename from the PR (e.g., "src/utils/helper.ts") */
  readonly filename: string;
  /** File status (added, modified, deleted, renamed) */
  readonly status: string;
  /** Relative path to the diff file within the diffs directory (sanitized filename) */
  readonly diffPath: string;
  /** Number of lines added in this file */
  readonly additions: number;
  /** Number of lines deleted from this file */
  readonly deletions: number;
}

/** Manifest describing all diffs stored for a PR. */
export interface DiffManifest {
  /** Unique PR identifier (e.g., "GitHub-owner-repo-PR42") */
  readonly prIdentifier: string;
  /** List of files with their diff paths and metadata */
  readonly files: readonly DiffFileEntry[];
  /** ISO 8601 timestamp when diffs were stored */
  readonly createdAt: string;
}

/** Result of storing diffs to disk. */
interface DiffStorageResult {
  /** Absolute path to the diffs directory (where all files were written) */
  readonly diffDir: string;
  /** Manifest describing stored diffs (metadata and file list) */
  readonly manifest: DiffManifest;
}

/**
 * Handles storing PR diffs to the filesystem for batched review.
 *
 * Stores diffs in `{tempPath}/diffs/{prIdentifier}/` with a manifest file
 * describing what was stored. Each file gets a numbered diff for easier
 * line-number matching in AI analysis.
 */
export class DiffStorage {
  private readonly baseDir: string;
  private readonly logger = createChildLogger({ component: "DiffStorage" });

  /**
   * Creates a new diff storage manager.
   *
   * @param tempPath - Base temporary directory (will create `diffs/` subdirectory)
   * @param fileSystem - File system operations (default: nodeFs)
   * @param clock - Clock for timestamps (default: systemClock)
   */
  constructor(
    tempPath: string,
    private readonly fileSystem: FileSystem = nodeFs,
    private readonly clock: Clock = systemClock
  ) {
    this.baseDir = path.join(tempPath, "diffs");
  }

  /**
   * Stores all file diffs to disk for batched review.
   *
   * Sanitizes filenames (replaces `/` with `__`) and writes numbered diffs.
   * Creates a manifest.json describing what was stored.
   *
   * Cleans up any existing diffs for the same PR before writing new ones.
   *
   * @param prIdentifier - The unique PR identifier
   * @param files - Array of PR files with patches (diff content)
   * @returns The diff directory path and manifest describing stored files
   * @throws Error if file write fails
   *
   * @example
   * ```typescript
   * const storage = new DiffStorage('.mergementor');
   *
   * const { diffDir, manifest } = await storage.storeDiffs(
   *   'GitHub-owner-repo-PR123',
   *   [
   *     { filename: 'src/main.ts', status: 'modified', patch: '...' },
   *     { filename: 'tests/main.test.ts', status: 'added', patch: '...' },
   *   ]
   * );
   *
   * console.log(`Stored ${manifest.files.length} diffs in ${diffDir}`);
   * ```
   */
  async storeDiffs(prIdentifier: string, files: readonly PRFile[]): Promise<DiffStorageResult> {
    const diffDir = path.join(this.baseDir, prIdentifier);

    // Clean up any existing diffs for this PR
    await this.cleanup(prIdentifier);

    // Create the diffs directory
    await this.fileSystem.mkdir(diffDir, { recursive: true });

    const entries: DiffFileEntry[] = [];

    this.logger.debug(
      {
        prIdentifier,
        files: files.map((f) => ({
          filename: f.filename,
          patchLength: f.patch?.length || 0,
          status: f.status,
        })),
      },
      "Storing diffs"
    );

    for (const file of files) {
      if (!file.patch) {
        this.logger.debug({ filename: file.filename }, "Skipping file - no patch");
        continue;
      }

      // Check if patch only contains headers (< 150 chars is suspicious)
      const hasContent = file.patch.split("\n").length > 4;
      if (!hasContent) {
        this.logger.warn(
          {
            filename: file.filename,
            patchLength: file.patch.length,
            patch: file.patch,
          },
          "Patch appears to have no content (only headers)"
        );
      }

      this.logger.debug(
        {
          filename: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          patchLength: file.patch.length,
          patchPreview: file.patch.substring(0, 300),
        },
        "Processing file"
      );

      // Sanitize filename for filesystem (replace path separators with underscores)
      const sanitizedName = this.sanitizeFilename(file.filename);
      const diffPath = `${sanitizedName}.diff`;
      const fullPath = path.join(diffDir, diffPath);

      // Ensure parent directory exists for nested paths
      const parentDir = path.dirname(fullPath);
      await this.fileSystem.mkdir(parentDir, { recursive: true });

      // Write the diff content with pre-calculated line numbers
      const numberedDiff = convertToNumberedDiff(file.patch);
      await this.fileSystem.writeFile(fullPath, numberedDiff, "utf-8");

      entries.push({
        filename: file.filename,
        status: file.status,
        diffPath,
        additions: file.additions,
        deletions: file.deletions,
      });
    }

    const manifest: DiffManifest = {
      prIdentifier,
      files: entries,
      createdAt: this.clock.timestamp(),
    };

    // Write manifest
    await this.fileSystem.writeFile(
      path.join(diffDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8"
    );

    this.logger.info(
      {
        prIdentifier,
        fileCount: entries.length,
        diffDir,
      },
      "Stored diffs to disk"
    );

    return { diffDir, manifest };
  }

  /**
   * Cleans up stored diffs for a specific PR.
   *
   * Removes the entire diffs directory for the given PR identifier.
   * Safe to call even if the directory doesn't exist.
   *
   * @param prIdentifier - The unique PR identifier to clean up
   *
   * @example
   * ```typescript
   * await storage.cleanup('GitHub-owner-repo-PR123');
   * ```
   */
  async cleanup(prIdentifier: string): Promise<void> {
    const diffDir = path.join(this.baseDir, prIdentifier);

    try {
      await this.fileSystem.rm(diffDir, { recursive: true, force: true });
      this.logger.debug({ prIdentifier, diffDir }, "Cleaned up diff directory");
    } catch (error) {
      // Ignore errors if directory doesn't exist
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.warn(
          { prIdentifier, error: (error as Error).message },
          "Failed to cleanup diff directory"
        );
      }
    }
  }

  /**
   * Cleans up all stored diffs (used for startup cleanup).
   *
   * Removes the entire diffs directory and all its contents.
   * Safe to call even if nothing exists yet.
   *
   * @example
   * ```typescript
   * // Clean up any stale diffs from previous runs
   * await storage.cleanupAll();
   * ```
   */
  async cleanupAll(): Promise<void> {
    try {
      await this.fileSystem.rm(this.baseDir, { recursive: true, force: true });
      this.logger.debug({ baseDir: this.baseDir }, "Cleaned up all diff directories");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.warn(
          { error: (error as Error).message },
          "Failed to cleanup all diff directories"
        );
      }
    }
  }

  /**
   * Sanitizes a filename for safe filesystem storage.
   * Replaces path separators with double underscores to preserve structure info.
   */
  private sanitizeFilename(filename: string): string {
    // Replace forward slashes with double underscores
    // This preserves the ability to reconstruct the path while being filesystem-safe
    return filename.replace(/\//g, "__");
  }
}
