import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { ReviewStateCache } from "./reviewStateCache.js";
import type { FileReviewResult } from "../platforms/types.js";

describe("ReviewStateCache", () => {
  const testCacheDir = ".test-cache";
  let cache: ReviewStateCache;

  beforeEach(() => {
    cache = new ReviewStateCache(testCacheDir);
  });

  afterEach(async () => {
    // Clean up test cache directory
    try {
      await fs.rm(testCacheDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("getState", () => {
    it("returns undefined when no cached state exists", async () => {
      const state = await cache.getState(123);

      expect(state).toBeUndefined();
    });

    it("loads cached state successfully", async () => {
      const fileResults: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [
            {
              line: 10,
              severity: "high",
              category: "bug",
              message: "Test issue",
              suggestion: "Fix it",
            },
          ],
        },
      ];
      const fileShaMap = new Map([["test.ts", "abc123"]]);

      await cache.saveState(123, fileResults, fileShaMap);
      const state = await cache.getState(123);

      expect(state).toBeDefined();
      expect(state?.prNumber).toBe(123);
      expect(state?.files["test.ts"]).toBeDefined();
      expect(state?.files["test.ts"].sha).toBe("abc123");
      expect(state?.files["test.ts"].result.findings).toHaveLength(1);
    });

    it("returns undefined for corrupted cache file", async () => {
      await fs.mkdir(testCacheDir, { recursive: true });
      await fs.writeFile(path.join(testCacheDir, "pr-123.json"), "invalid json", "utf-8");

      const state = await cache.getState(123);

      expect(state).toBeUndefined();
    });
  });

  describe("saveState", () => {
    it("creates cache directory if not exists", async () => {
      const fileResults: FileReviewResult[] = [
        { filename: "test.ts", findings: [] },
      ];
      const fileShaMap = new Map([["test.ts", "def456"]]);

      await cache.saveState(456, fileResults, fileShaMap);

      const exists = await fs
        .access(testCacheDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it("saves review state with timestamp", async () => {
      const fileResults: FileReviewResult[] = [
        {
          filename: "src/test.ts",
          findings: [
            {
              line: 5,
              severity: "medium",
              category: "quality",
              message: "Code quality issue",
              suggestion: "Improve",
            },
          ],
        },
      ];
      const fileShaMap = new Map([["src/test.ts", "xyz789"]]);

      await cache.saveState(789, fileResults, fileShaMap);
      const state = await cache.getState(789);

      expect(state?.prNumber).toBe(789);
      expect(state?.lastReviewedAt).toBeDefined();
      expect(new Date(state!.lastReviewedAt)).toBeInstanceOf(Date);
    });

    it("saves cross-file analysis result when provided", async () => {
      const fileResults: FileReviewResult[] = [
        { filename: "test.ts", findings: [] },
      ];
      const fileShaMap = new Map([["test.ts", "sha123"]]);
      const crossFileResult = {
        overallAssessment: "Looks good",
        findings: [
          {
            severity: "low" as const,
            category: "documentation" as const,
            message: "Missing tests",
            affectedFiles: ["test.ts"],
          },
        ],
        recommendations: ["Add unit tests"],
      };

      await cache.saveState(999, fileResults, fileShaMap, crossFileResult);
      const state = await cache.getState(999);

      expect(state?.crossFileResult).toBeDefined();
      expect(state?.crossFileResult?.overallAssessment).toBe("Looks good");
      expect(state?.crossFileResult?.findings).toHaveLength(1);
      expect(state?.crossFileResult?.recommendations).toHaveLength(1);
    });

    it("saves without cross-file result when not provided", async () => {
      const fileResults: FileReviewResult[] = [
        { filename: "test.ts", findings: [] },
      ];
      const fileShaMap = new Map([["test.ts", "sha456"]]);

      await cache.saveState(888, fileResults, fileShaMap);
      const state = await cache.getState(888);

      expect(state?.crossFileResult).toBeUndefined();
    });

    it("only saves files with SHA information", async () => {
      const fileResults: FileReviewResult[] = [
        { filename: "with-sha.ts", findings: [] },
        { filename: "without-sha.ts", findings: [] },
      ];
      const fileShaMap = new Map([["with-sha.ts", "sha123"]]);

      await cache.saveState(100, fileResults, fileShaMap);
      const state = await cache.getState(100);

      expect(Object.keys(state!.files)).toHaveLength(1);
      expect(state!.files["with-sha.ts"]).toBeDefined();
      expect(state!.files["without-sha.ts"]).toBeUndefined();
    });

    it("overwrites existing state", async () => {
      const fileResults1: FileReviewResult[] = [
        { filename: "test.ts", findings: [] },
      ];
      const fileShaMap1 = new Map([["test.ts", "old-sha"]]);

      await cache.saveState(200, fileResults1, fileShaMap1);

      const fileResults2: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [
            {
              line: 1,
              severity: "low",
              category: "documentation",
              message: "New issue",
              suggestion: "Fix",
            },
          ],
        },
      ];
      const fileShaMap2 = new Map([["test.ts", "new-sha"]]);

      await cache.saveState(200, fileResults2, fileShaMap2);
      const state = await cache.getState(200);

      expect(state?.files["test.ts"].sha).toBe("new-sha");
      expect(state?.files["test.ts"].result.findings).toHaveLength(1);
    });
  });

  describe("getCachedFileReview", () => {
    it("returns cached review when SHA matches", async () => {
      const fileResults: FileReviewResult[] = [
        {
          filename: "match.ts",
          findings: [
            {
              line: 20,
              severity: "critical",
              category: "security",
              message: "Security issue",
              suggestion: "Urgent fix",
            },
          ],
        },
      ];
      const fileShaMap = new Map([["match.ts", "matching-sha"]]);

      await cache.saveState(300, fileResults, fileShaMap);
      const state = (await cache.getState(300))!;

      const result = cache.getCachedFileReview("match.ts", "matching-sha", state);

      expect(result).toBeDefined();
      expect(result?.filename).toBe("match.ts");
      expect(result?.findings).toHaveLength(1);
    });

    it("returns undefined when SHA does not match", async () => {
      const fileResults: FileReviewResult[] = [
        { filename: "changed.ts", findings: [] },
      ];
      const fileShaMap = new Map([["changed.ts", "old-sha"]]);

      await cache.saveState(400, fileResults, fileShaMap);
      const state = (await cache.getState(400))!;

      const result = cache.getCachedFileReview("changed.ts", "new-sha", state);

      expect(result).toBeUndefined();
    });

    it("returns undefined when file not in cache", async () => {
      const fileResults: FileReviewResult[] = [
        { filename: "cached.ts", findings: [] },
      ];
      const fileShaMap = new Map([["cached.ts", "sha123"]]);

      await cache.saveState(500, fileResults, fileShaMap);
      const state = (await cache.getState(500))!;

      const result = cache.getCachedFileReview("not-cached.ts", "any-sha", state);

      expect(result).toBeUndefined();
    });
  });

  describe("clearState", () => {
    it("removes cached state file", async () => {
      const fileResults: FileReviewResult[] = [
        { filename: "test.ts", findings: [] },
      ];
      const fileShaMap = new Map([["test.ts", "sha"]]);

      await cache.saveState(600, fileResults, fileShaMap);
      await cache.clearState(600);

      const state = await cache.getState(600);
      expect(state).toBeUndefined();
    });

    it("does not throw when clearing non-existent state", async () => {
      await expect(cache.clearState(999)).resolves.not.toThrow();
    });
  });
});
