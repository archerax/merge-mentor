import fs from "node:fs/promises";
import path from "node:path";
import { createChildLogger } from "../logger.js";
import type { PRFile } from "../platforms/types.js";

/** Entry for a single file in the diff manifest. */
export interface DiffFileEntry {
  /** Original filename from the PR */
  readonly filename: string;
  /** File status (added, modified, deleted, renamed) */
  readonly status: string;
  /** Relative path to the diff file within the diffs directory */
  readonly diffPath: string;
  /** Number of lines added */
  readonly additions: number;
  /** Number of lines deleted */
  readonly deletions: number;
}

/** Manifest describing all diffs stored for a PR. */
export interface DiffManifest {
  /** Unique PR identifier */
  readonly prIdentifier: string;
  /** List of files with their diff paths */
  readonly files: readonly DiffFileEntry[];
  /** ISO timestamp when diffs were stored */
  readonly createdAt: string;
}

/** Result of storing diffs to disk. */
export interface DiffStorageResult {
  /** Absolute path to the diffs directory */
  readonly diffDir: string;
  /** Manifest describing stored diffs */
  readonly manifest: DiffManifest;
}

/**
 * Handles storing PR diffs to the filesystem for batched review.
 * Diffs are stored in `.merge-mentor/diffs/{prIdentifier}/` directory.
 */
export class DiffStorage {
  private readonly baseDir: string;
  private readonly logger = createChildLogger({ component: "DiffStorage" });

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(process.cwd(), ".merge-mentor", "diffs");
  }

  /**
   * Stores all file diffs to disk for batched review.
   *
   * @param prIdentifier - The unique PR identifier
   * @param files - Array of PR files with patches
   * @returns The diff directory path and manifest
   */
  async storeDiffs(prIdentifier: string, files: readonly PRFile[]): Promise<DiffStorageResult> {
    const diffDir = path.join(this.baseDir, prIdentifier);

    // Clean up any existing diffs for this PR
    await this.cleanup(prIdentifier);

    // Create the diffs directory
    await fs.mkdir(diffDir, { recursive: true });

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
      if (parentDir !== diffDir) {
        await fs.mkdir(parentDir, { recursive: true });
      }

      // Write the diff content
      await fs.writeFile(fullPath, file.patch, "utf-8");

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
      createdAt: new Date().toISOString(),
    };

    // Write manifest
    await fs.writeFile(
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
   * Cleans up stored diffs for a PR.
   *
   * @param prIdentifier - The unique PR identifier to clean up
   */
  async cleanup(prIdentifier: string): Promise<void> {
    const diffDir = path.join(this.baseDir, prIdentifier);

    try {
      await fs.rm(diffDir, { recursive: true, force: true });
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
   */
  async cleanupAll(): Promise<void> {
    try {
      await fs.rm(this.baseDir, { recursive: true, force: true });
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
