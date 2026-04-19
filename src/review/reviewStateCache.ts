/**
 * Review state caching for optimization.
 *
 * Caches review results by file SHA to avoid re-reviewing unchanged files.
 * When a file's SHA hasn't changed since the last review, the cached result is
 * returned instead of sending to the AI provider again.
 *
 * Cache structure:
 * ```json
 * {
 *   "prIdentifier": "GitHub-owner-repo-PR42",
 *   "lastReviewedAt": "2024-04-18T12:34:56Z",
 *   "files": {
 *     "src/main.ts": {
 *       "sha": "abc123...",
 *       "result": { ... file review result ... }
 *     },
 *     "src/utils/helper.ts": { ... }
 *   },
 *   "crossFileResult": { ... }
 * }
 * ```
 *
 * Cache files are stored in `{tempPath}/cache/{prIdentifier}.json`.
 *
 * @example
 * ```typescript
 * const cache = new ReviewStateCache('.mergementor');
 *
 * // Load cached state for a PR
 * const state = await cache.getState('GitHub-owner-repo-PR42');
 *
 * if (state) {
 *   // Check if a file was already reviewed
 *   const cached = cache.getCachedFileReview('src/main.ts', currentSHA, state);
 *   if (cached) {
 *     console.log('Using cached review for main.ts');
 *     return cached;
 *   }
 * }
 *
 * // File changed, need to re-review
 * const newResult = await reviewFile(file);
 * ```
 */

import path from "node:path";
import { createChildLogger } from "../logger.js";
import type { FileReviewResult } from "../platforms/types.js";
import { type Clock, type FileSystem, nodeFs, systemClock } from "../ports/index.js";

/** Cached state for a single file review. */
interface CachedFileReview {
  /** SHA256 hash of the file content when reviewed */
  readonly sha: string;
  /** The cached review result for this file */
  readonly result: FileReviewResult;
}

/**
 * Cached review state for a pull request.
 *
 * Contains all cached file reviews and optional cross-file analysis result.
 */
interface ReviewState {
  /** Unique identifier for this PR */
  readonly prIdentifier: string;
  /** ISO 8601 timestamp when this state was last updated */
  readonly lastReviewedAt: string;
  /** Map of filename to cached review (keyed by filename for quick lookup) */
  readonly files: Record<string, CachedFileReview>;
  /** Cached cross-file analysis result (if available) */
  readonly crossFileResult?: import("../platforms/types.js").CrossFileReviewResult;
}

/**
 * Manages caching of review results to skip re-reviewing unchanged files.
 *
 * Uses file SHA256 hashes to determine if a file needs re-review. SHA matching
 * ensures cache safety: even if line numbers change due to other edits, a different
 * SHA triggers re-review.
 */
export class ReviewStateCache {
  private readonly cacheDir: string;
  private readonly logger = createChildLogger({ component: "ReviewStateCache" });

  /**
   * Creates a new review state cache.
   *
   * @param tempPath - Base temporary directory (will create `cache/` subdirectory)
   * @param fileSystem - File system operations (dependency injection, defaults to nodeFs)
   * @param clock - Clock for timestamps (dependency injection, defaults to systemClock)
   */
  constructor(
    tempPath: string,
    private readonly fileSystem: FileSystem = nodeFs,
    private readonly clock: Clock = systemClock
  ) {
    this.cacheDir = path.join(tempPath, "cache");
  }

  /**
   * Gets the cached review state for a PR.
   *
   * Loads and parses the cache file for the given PR. Returns undefined if:
   * - Cache file doesn't exist (ENOENT)
   * - Cache file is corrupted (JSON parse error)
   *
   * Errors are logged but don't throw, allowing graceful degradation.
   *
   * @param prIdentifier - The unique PR identifier
   * @returns Cached review state, or undefined if not found or error
   *
   * @example
   * ```typescript
   * const state = await cache.getState('GitHub-owner-repo-PR42');
   * if (state) {
   *   console.log(`Loaded cache from ${state.lastReviewedAt}`);
   * }
   * ```
   */
  async getState(prIdentifier: string): Promise<ReviewState | undefined> {
    try {
      const filePath = this.getCachePath(prIdentifier);
      const data = await this.fileSystem.readFile(filePath, "utf-8");
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
   * Writes all file results and the cross-file result to a cache file.
   * Each file entry is keyed by filename with its SHA and review result.
   *
   * Only successful writes preserve cached state. Failures are logged but don't throw.
   *
   * @param prIdentifier - The unique PR identifier
   * @param fileResults - Results from file reviews (source of truth)
   * @param fileShaMap - Map of filenames to their SHA256 hashes
   * @param crossFileResult - Optional cross-file analysis result
   *
   * @example
   * ```typescript
   * await cache.saveState(
   *   'GitHub-owner-repo-PR42',
   *   fileReviewResults,
   *   new Map([
   *     ['src/main.ts', 'abc123...'],
   *     ['src/utils/helper.ts', 'def456...'],
   *   ]),
   *   crossFileResult
   * );
   * ```
   */
  async saveState(
    prIdentifier: string,
    fileResults: readonly FileReviewResult[],
    fileShaMap: Map<string, string>,
    crossFileResult?: import("../platforms/types.js").CrossFileReviewResult
  ): Promise<void> {
    try {
      await this.fileSystem.mkdir(this.cacheDir, { recursive: true });

      const files: Record<string, CachedFileReview> = {};
      for (const result of fileResults) {
        const sha = fileShaMap.get(result.filename);
        if (sha) {
          files[result.filename] = { sha, result };
        }
      }

      const state: ReviewState = {
        prIdentifier,
        lastReviewedAt: this.clock.timestamp(),
        files,
        crossFileResult,
      };

      const filePath = this.getCachePath(prIdentifier);
      await this.fileSystem.writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
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
   * Returns the cached review result if and only if:
   * 1. The file exists in the cache
   * 2. The cached SHA matches the current file SHA
   *
   * If SHA doesn't match, the file has changed and needs re-review (returns undefined).
   *
   * @param filename - The file path
   * @param sha - Current file SHA256 hash
   * @param cachedState - The cached PR state (from getState)
   * @returns Cached review result if SHA matches, undefined otherwise
   *
   * @example
   * ```typescript
   * const cached = cache.getCachedFileReview('src/main.ts', currentSHA, state);
   * if (cached) {
   *   console.log('Cache hit - skipping review');
   *   return cached;
   * }
   * console.log('Cache miss or SHA mismatch - need to review');
   * ```
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
   * Deletes the cache file for this PR. Safe to call even if cache doesn't exist.
   *
   * @param prIdentifier - The unique PR identifier
   *
   * @example
   * ```typescript
   * await cache.clearState('GitHub-owner-repo-PR42');
   * ```
   */
  async clearState(prIdentifier: string): Promise<void> {
    try {
      const filePath = this.getCachePath(prIdentifier);
      await this.fileSystem.unlink(filePath);
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
