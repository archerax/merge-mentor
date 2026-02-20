import fs from "node:fs/promises";
import path from "node:path";
import { createChildLogger } from "../logger.js";
import type { FileReviewResult } from "../platforms/types.js";

/** Cached state for a single file review. */
interface CachedFileReview {
  readonly sha: string;
  readonly result: FileReviewResult;
}

/** Cached review state for a pull request. */
interface ReviewState {
  readonly prIdentifier: string;
  readonly lastReviewedAt: string;
  readonly files: Record<string, CachedFileReview>;
  readonly crossFileResult?: import("../platforms/types.js").CrossFileReviewResult;
}

/** Manages caching of review results to skip re-reviewing unchanged files. */
export class ReviewStateCache {
  private readonly cacheDir: string;
  private readonly logger = createChildLogger({ component: "ReviewStateCache" });

  constructor(tempPath: string) {
    this.cacheDir = path.join(tempPath, "cache");
  }

  /**
   * Gets the cached review state for a PR.
   *
   * @param prIdentifier - The unique PR identifier
   * @returns Cached state or undefined if not found
   */
  async getState(prIdentifier: string): Promise<ReviewState | undefined> {
    try {
      const filePath = this.getCachePath(prIdentifier);
      const data = await fs.readFile(filePath, "utf-8");
      const state = JSON.parse(data) as ReviewState;
      this.logger.debug(
        { prIdentifier, filesCount: Object.keys(state.files).length },
        "Loaded cached review state"
      );
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.logger.debug({ prIdentifier }, "No cached review state found");
        return undefined;
      }
      this.logger.warn(
        { prIdentifier, error: (error as Error).message },
        "Failed to load cached review state"
      );
      return undefined;
    }
  }

  /**
   * Saves the review state for a PR.
   *
   * @param prIdentifier - The unique PR identifier
   * @param fileResults - Results from file reviews with SHA information
   * @param fileShaMap - Map of filenames to their SHA values
   * @param crossFileResult - Optional cross-file analysis result
   */
  async saveState(
    prIdentifier: string,
    fileResults: readonly FileReviewResult[],
    fileShaMap: Map<string, string>,
    crossFileResult?: import("../platforms/types.js").CrossFileReviewResult
  ): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });

      const files: Record<string, CachedFileReview> = {};
      for (const result of fileResults) {
        const sha = fileShaMap.get(result.filename);
        if (sha) {
          files[result.filename] = { sha, result };
        }
      }

      const state: ReviewState = {
        prIdentifier,
        lastReviewedAt: new Date().toISOString(),
        files,
        crossFileResult,
      };

      const filePath = this.getCachePath(prIdentifier);
      await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
      this.logger.info(
        { prIdentifier, filesCount: Object.keys(files).length },
        "Saved review state to cache"
      );
    } catch (error) {
      this.logger.error(
        { prIdentifier, error: (error as Error).message },
        "Failed to save review state"
      );
    }
  }

  /**
   * Gets cached review result for a file if SHA matches.
   *
   * @param filename - The file path
   * @param sha - Current file SHA
   * @param cachedState - The cached PR state
   * @returns Cached review result or undefined if not found or SHA doesn't match
   */
  getCachedFileReview(
    filename: string,
    sha: string,
    cachedState: ReviewState
  ): FileReviewResult | undefined {
    const cached = cachedState.files[filename];
    if (cached && cached.sha === sha) {
      this.logger.debug({ filename, sha }, "Cache hit: file unchanged since last review");
      return cached.result;
    }
    return undefined;
  }

  /**
   * Clears the cache for a specific PR.
   *
   * @param prIdentifier - The unique PR identifier
   */
  async clearState(prIdentifier: string): Promise<void> {
    try {
      const filePath = this.getCachePath(prIdentifier);
      await fs.unlink(filePath);
      this.logger.info({ prIdentifier }, "Cleared cached review state");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.warn(
          { prIdentifier, error: (error as Error).message },
          "Failed to clear cached review state"
        );
      }
    }
  }

  private getCachePath(prIdentifier: string): string {
    return path.join(this.cacheDir, `${prIdentifier}.json`);
  }
}
