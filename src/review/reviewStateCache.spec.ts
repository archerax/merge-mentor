import { beforeEach, describe, expect, it, type Mocked } from "vitest";
import type { FileReviewResult } from "../platforms/types.js";
import { createFixedClock } from "../ports/clock.test-helper.js";
import type { FileSystem } from "../ports/fileSystem.js";
import { createStubFileSystem } from "../ports/fileSystem.test-helper.js";
import { ReviewStateCache } from "./reviewStateCache.js";

describe("ReviewStateCache", () => {
  const testCacheDir = ".test-cache";
  let cache: ReviewStateCache;
  let fileStore: Map<string, string>;
  let fileSystem: Mocked<FileSystem>;

  beforeEach(() => {
    fileStore = new Map();
    fileSystem = createStubFileSystem() as Mocked<FileSystem>;

    fileSystem.writeFile.mockImplementation(async (filePath, data) => {
      fileStore.set(filePath as string, data as string);
    });

    fileSystem.readFile.mockImplementation(async (filePath) => {
      const data = fileStore.get(filePath as string);
      if (data !== undefined) return data;
      const err = Object.assign(new Error("ENOENT: no such file or directory"), {
        code: "ENOENT",
      });
      throw err;
    });

    fileSystem.unlink.mockImplementation(async (filePath) => {
      if (!fileStore.has(filePath as string)) {
        const err = Object.assign(new Error("ENOENT: no such file or directory"), {
          code: "ENOENT",
        });
        throw err;
      }
      fileStore.delete(filePath as string);
    });

    cache = new ReviewStateCache(testCacheDir, fileSystem, createFixedClock());
  });

  describe("getState", () => {
    it("returns undefined when no cached state exists", async () => {
      const state = await cache.getState("test-PR123");

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
              confidence: "high",
              category: "bug",
              message: "Test issue",
              suggestion: "Fix it",
              reasoning: "This is a bug because of X.",
            },
          ],
        },
      ];
      const fileShaMap = new Map([["test.ts", "abc123"]]);

      await cache.saveState("Github-testrepo-PR123", fileResults, fileShaMap);
      const state = await cache.getState("Github-testrepo-PR123");

      expect(state).toBeDefined();
      expect(state?.prIdentifier).toBe("Github-testrepo-PR123");
      expect(state?.files["test.ts"]).toBeDefined();
      expect(state?.files["test.ts"].sha).toBe("abc123");
      expect(state?.files["test.ts"].result.findings).toHaveLength(1);
    });

    it("returns undefined for corrupted cache file", async () => {
      fileSystem.readFile.mockResolvedValueOnce("invalid json");

      const state = await cache.getState("Github-testrepo-PR123");

      expect(state).toBeUndefined();
    });
  });

  describe("saveState", () => {
    it("creates cache directory if not exists", async () => {
      const fileResults: FileReviewResult[] = [{ filename: "test.ts", findings: [] }];
      const fileShaMap = new Map([["test.ts", "def456"]]);

      await cache.saveState("Github-testrepo-PR456", fileResults, fileShaMap);

      expect(fileSystem.mkdir).toHaveBeenCalledWith(expect.stringContaining("cache"), {
        recursive: true,
      });
    });

    it("saves review state with timestamp", async () => {
      const fileResults: FileReviewResult[] = [
        {
          filename: "src/test.ts",
          findings: [
            {
              line: 5,
              severity: "medium",
              confidence: "high",
              category: "quality",
              message: "Code quality issue",
              suggestion: "Improve",
              reasoning: "This affects code quality because of Y.",
            },
          ],
        },
      ];
      const fileShaMap = new Map([["src/test.ts", "xyz789"]]);

      await cache.saveState("Github-testrepo-PR789", fileResults, fileShaMap);
      const state = await cache.getState("Github-testrepo-PR789");

      expect(state?.prIdentifier).toBe("Github-testrepo-PR789");
      expect(state?.lastReviewedAt).toBeDefined();
      expect(new Date(state?.lastReviewedAt ?? "")).toBeInstanceOf(Date);
    });

    it("saves cross-file analysis result when provided", async () => {
      const fileResults: FileReviewResult[] = [{ filename: "test.ts", findings: [] }];
      const fileShaMap = new Map([["test.ts", "sha123"]]);
      const crossFileResult = {
        overallAssessment: "Looks good",
        findings: [
          {
            severity: "low" as const,
            confidence: "high" as const,
            category: "documentation" as const,
            message: "Missing tests",
            reasoning: "This file has no test coverage.",
            affectedFiles: ["test.ts"],
          },
        ],
        recommendations: ["Add unit tests"],
      };

      await cache.saveState("Github-testrepo-PR999", fileResults, fileShaMap, crossFileResult);
      const state = await cache.getState("Github-testrepo-PR999");

      expect(state?.crossFileResult).toBeDefined();
      expect(state?.crossFileResult?.overallAssessment).toBe("Looks good");
      expect(state?.crossFileResult?.findings).toHaveLength(1);
      expect(state?.crossFileResult?.recommendations).toHaveLength(1);
    });

    it("saves without cross-file result when not provided", async () => {
      const fileResults: FileReviewResult[] = [{ filename: "test.ts", findings: [] }];
      const fileShaMap = new Map([["test.ts", "sha456"]]);

      await cache.saveState("Github-testrepo-PR888", fileResults, fileShaMap);
      const state = await cache.getState("Github-testrepo-PR888");

      expect(state?.crossFileResult).toBeUndefined();
    });

    it("only saves files with SHA information", async () => {
      const fileResults: FileReviewResult[] = [
        { filename: "with-sha.ts", findings: [] },
        { filename: "without-sha.ts", findings: [] },
      ];
      const fileShaMap = new Map([["with-sha.ts", "sha123"]]);

      await cache.saveState("Github-testrepo-PR100", fileResults, fileShaMap);
      const state = await cache.getState("Github-testrepo-PR100");

      expect(Object.keys(state?.files ?? {})).toHaveLength(1);
      expect(state?.files["with-sha.ts"]).toBeDefined();
      expect(state?.files["without-sha.ts"]).toBeUndefined();
    });

    it("overwrites existing state", async () => {
      const fileResults1: FileReviewResult[] = [{ filename: "test.ts", findings: [] }];
      const fileShaMap1 = new Map([["test.ts", "old-sha"]]);

      await cache.saveState("Github-testrepo-PR200", fileResults1, fileShaMap1);

      const fileResults2: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [
            {
              line: 1,
              severity: "low",
              confidence: "high",
              category: "documentation",
              message: "New issue",
              suggestion: "Fix",
              reasoning: "Documentation is missing for this function.",
            },
          ],
        },
      ];
      const fileShaMap2 = new Map([["test.ts", "new-sha"]]);

      await cache.saveState("Github-testrepo-PR200", fileResults2, fileShaMap2);
      const state = await cache.getState("Github-testrepo-PR200");

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
              confidence: "high",
              category: "security",
              message: "Security issue",
              suggestion: "Urgent fix",
              reasoning: "This is a critical security vulnerability.",
            },
          ],
        },
      ];
      const fileShaMap = new Map([["match.ts", "matching-sha"]]);

      await cache.saveState("Github-testrepo-PR300", fileResults, fileShaMap);
      const state = await cache.getState("Github-testrepo-PR300");
      expect(state).toBeDefined();

      const result = cache.getCachedFileReview(
        "match.ts",
        "matching-sha",
        state ?? { prIdentifier: "", lastReviewedAt: "", files: {} }
      );

      expect(result).toBeDefined();
      expect(result?.filename).toBe("match.ts");
      expect(result?.findings).toHaveLength(1);
    });

    it("returns undefined when SHA does not match", async () => {
      const fileResults: FileReviewResult[] = [{ filename: "changed.ts", findings: [] }];
      const fileShaMap = new Map([["changed.ts", "old-sha"]]);

      await cache.saveState("Github-testrepo-PR400", fileResults, fileShaMap);
      const state = await cache.getState("Github-testrepo-PR400");
      expect(state).toBeDefined();

      const result = cache.getCachedFileReview(
        "changed.ts",
        "new-sha",
        state ?? { prIdentifier: "", lastReviewedAt: "", files: {} }
      );

      expect(result).toBeUndefined();
    });

    it("returns undefined when file not in cache", async () => {
      const fileResults: FileReviewResult[] = [{ filename: "cached.ts", findings: [] }];
      const fileShaMap = new Map([["cached.ts", "sha123"]]);

      await cache.saveState("Github-testrepo-PR500", fileResults, fileShaMap);
      const state = await cache.getState("Github-testrepo-PR500");
      expect(state).toBeDefined();

      const result = cache.getCachedFileReview(
        "not-cached.ts",
        "any-sha",
        state ?? { prIdentifier: "", lastReviewedAt: "", files: {} }
      );

      expect(result).toBeUndefined();
    });
  });

  describe("clearState", () => {
    it("removes cached state file", async () => {
      const fileResults: FileReviewResult[] = [{ filename: "test.ts", findings: [] }];
      const fileShaMap = new Map([["test.ts", "sha"]]);

      await cache.saveState("Github-testrepo-PR600", fileResults, fileShaMap);
      await cache.clearState("Github-testrepo-PR600");

      const state = await cache.getState("Github-testrepo-PR600");
      expect(state).toBeUndefined();
    });

    it("does not throw when clearing non-existent state", async () => {
      await expect(cache.clearState("Github-testrepo-PR999")).resolves.not.toThrow();
    });
  });
});
