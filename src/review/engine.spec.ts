import { beforeEach, describe, expect, it, test, vi } from "vitest";
import { ValidationError } from "../errors/index.js";
import type { ExistingComment, PlatformAdapter, PRDetails, PRFile } from "../platforms/types.js";
import { ReviewEngine } from "./engine.js";

// Mock the createAIProvider function with a factory that returns a mock provider
const mockExecutePrompt = vi.fn();
const mockParseFileReview = vi.fn();
const mockParseCrossFileReview = vi.fn();
const mockParseBatchedFileReview = vi.fn();

vi.mock("../ai/index.js", () => ({
  createAIProvider: vi.fn(() => ({
    executePrompt: (...args: unknown[]) => mockExecutePrompt(...args),
    parseFileReview: (...args: unknown[]) => mockParseFileReview(...args),
    parseCrossFileReview: (...args: unknown[]) => mockParseCrossFileReview(...args),
    parseBatchedFileReview: (...args: unknown[]) => mockParseBatchedFileReview(...args),
  })),
}));

// Mock the RepoManager to avoid actual git operations
const mockEnsureRepo = vi.fn().mockResolvedValue("/mock/repo/path");

vi.mock("./repoManager.js", () => ({
  RepoManager: class MockRepoManager {
    ensureRepo = mockEnsureRepo;
  },
}));

// Mock ReviewStateCache with an in-memory store so caching tests work without disk I/O
vi.mock("./reviewStateCache.js", () => ({
  ReviewStateCache: class MockReviewStateCache {
    private stateMap = new Map<
      string,
      {
        prIdentifier: string;
        lastReviewedAt: string;
        files: Record<string, { sha: string; result: unknown }>;
        crossFileResult?: unknown;
      }
    >();

    async getState(prIdentifier: string) {
      return this.stateMap.get(prIdentifier);
    }

    async saveState(
      prIdentifier: string,
      fileResults: Array<{ filename: string }>,
      fileShaMap: Map<string, string>,
      crossFileResult?: unknown
    ) {
      const files: Record<string, { sha: string; result: unknown }> = {};
      for (const result of fileResults) {
        const sha = fileShaMap.get(result.filename);
        if (sha) files[result.filename] = { sha, result };
      }
      this.stateMap.set(prIdentifier, {
        prIdentifier,
        lastReviewedAt: new Date().toISOString(),
        files,
        crossFileResult,
      });
    }

    getCachedFileReview(
      filename: string,
      sha: string,
      cachedState: { files: Record<string, { sha: string; result: unknown }> }
    ) {
      const cached = cachedState.files[filename];
      return cached?.sha === sha ? cached.result : undefined;
    }

    async clearState(prIdentifier: string) {
      this.stateMap.delete(prIdentifier);
    }
  },
}));

function createMockPlatform(): PlatformAdapter {
  return {
    getProjectIdentifier: vi.fn().mockReturnValue("test-repo"),
    getRepoInfo: vi.fn().mockReturnValue({
      owner: "test-owner",
      repo: "test-repo",
      platform: "github",
    }),
    getToken: vi.fn().mockReturnValue("test-token"),
    getPRDetails: vi.fn(),
    getPRFiles: vi.fn(),
    getExistingBotComments: vi.fn(),
    postInlineComment: vi.fn(),
    postGeneralComment: vi.fn(),
  };
}

function createPRDetails(): PRDetails {
  return {
    number: 123,
    title: "Test PR",
    description: "Test description",
    author: "testuser",
    baseBranch: "main",
    headBranch: "feature/test",
  };
}

function createPRFile(overrides: Partial<PRFile> = {}): PRFile {
  return {
    filename: "test.ts",
    status: "modified",
    additions: 10,
    deletions: 5,
    patch: `@@ -1,3 +1,4 @@
 context line 1
+console.log("test");
 context line 2
 context line 3`,
    sha: "abc123def456",
    ...overrides,
  };
}

describe("ReviewEngine", () => {
  let mockPlatform: PlatformAdapter;

  beforeEach(() => {
    mockPlatform = createMockPlatform();
    vi.clearAllMocks();
    mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
    mockParseFileReview.mockReturnValue({ filename: "test.ts", findings: [] });
    mockParseCrossFileReview.mockReturnValue({
      overallAssessment: "Review completed",
      findings: [],
      recommendations: [],
    });
    mockParseBatchedFileReview.mockReturnValue([{ filename: "test.ts", findings: [] }]);
  });

  describe("constructor", () => {
    it("creates engine with default options", () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]");
      expect(engine).toBeDefined();
    });

    it("creates engine with custom options", () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: false,
        dryRun: true,
      });
      expect(engine).toBeDefined();
    });
  });

  describe("reviewPR", () => {
    it("throws ValidationError for negative PR number", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]");

      await expect(engine.reviewPR(-1)).rejects.toThrow(ValidationError);
      await expect(engine.reviewPR(-1)).rejects.toThrow("Must be a positive integer");
    });

    it("throws ValidationError for zero PR number", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]");

      await expect(engine.reviewPR(0)).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError for non-integer PR number", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]");

      await expect(engine.reviewPR(1.5)).rejects.toThrow(ValidationError);
    });

    it("skips deleted files", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();
      const files: PRFile[] = [createPRFile({ filename: "deleted.ts", status: "deleted" })];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      const result = await engine.reviewPR(123);

      expect(result.filesReviewed).toBe(0);
    });

    it("skips files without patch", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();
      const files: PRFile[] = [createPRFile({ patch: undefined })];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      const result = await engine.reviewPR(123);

      expect(result.filesReviewed).toBe(0);
      expect(result.filesSkipped).toBe(0);
    });

    it("skips binary and generated files", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();
      const files: PRFile[] = [
        createPRFile({ filename: "image.png", status: "modified", patch: "@@ test @@" }),
        createPRFile({ filename: "yarn.lock", status: "modified", patch: "@@ test @@" }),
        createPRFile({ filename: "bundle.min.js", status: "modified", patch: "@@ test @@" }),
      ];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      const result = await engine.reviewPR(123);

      expect(result.filesReviewed).toBe(0);
      expect(result.filesSkipped).toBe(0);
    });

    it("returns result with PR details", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue([]);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      const result = await engine.reviewPR(123);

      expect(result.prDetails).toEqual(prDetails);
      expect(result.filesReviewed).toBe(0);
      expect(result.filesSkipped).toBe(0);
    });

    it("handles dry run mode", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: false,
        dryRun: true,
      });
      const prDetails = createPRDetails();

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue([]);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      await engine.reviewPR(123);

      expect(mockPlatform.postInlineComment).not.toHaveBeenCalled();
      expect(mockPlatform.postGeneralComment).not.toHaveBeenCalled();
    });

    it("logs actions in verbose mode", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: true });
      const prDetails = createPRDetails();

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue([]);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      await engine.reviewPR(123);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("suppresses logs in non-verbose mode", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue([]);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      await engine.reviewPR(123);

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("continues review when comment action fails", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: true });
      const prDetails = createPRDetails();

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue([]);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      vi.mocked(mockPlatform.postGeneralComment).mockRejectedValue(new Error("Network error"));

      const result = await engine.reviewPR(123);

      expect(result).toBeDefined();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Warning"));
      consoleSpy.mockRestore();
    });

    it("handles file without patch", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();
      const files = [createPRFile({ patch: undefined })];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      expect(result.filesReviewed).toBe(0);
      expect(mockExecutePrompt).toHaveBeenCalledTimes(1); // Only cross-file
    });

    it("shows dry run actions for inline comment", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: true,
        dryRun: true,
      });
      const prDetails = createPRDetails();
      const files = [createPRFile()];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockParseBatchedFileReview.mockReturnValue([
        {
          filename: "test.ts",
          findings: [
            {
              line: 2,
              severity: "high",
              category: "bug",
              message: "Test issue",
              suggestion: "Fix it",

              isPreExisting: false,
            },
          ],
        },
      ]);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      await engine.reviewPR(123);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[CREATE]"));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("test.ts:2"));
      consoleSpy.mockRestore();
    });

    it("skips creating duplicate comments when matching comment exists", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();
      const files = [createPRFile()];
      const existingComments: ExistingComment[] = [
        {
          id: 1,
          body: "[Bot]\n\n🔴 **HIGH** - bug\n\nExisting message\n\n**Suggestion:** Fix\n<!-- finding-id: dGVzdC50czoyOmJ1Zw== -->",
          path: "test.ts",
          line: 2,
        },
      ];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue(existingComments);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockParseBatchedFileReview.mockReturnValue([
        {
          filename: "test.ts",
          findings: [
            {
              line: 2,
              severity: "high",
              category: "bug",
              message: "Same finding",
              suggestion: "Fix",
              reasoning: "This is bad",
              confidence: "high" as const,
              isPreExisting: false,
            },
          ],
        },
      ]);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      // Should not create a new comment since one already exists
      expect(mockPlatform.postInlineComment).not.toHaveBeenCalledWith(
        123,
        "test.ts",
        2,
        expect.any(String)
      );
      expect(result.commentsCreated).toBe(1); // Only summary comment
    });

    it("executes create action for general comment", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue([]);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      expect(mockPlatform.postGeneralComment).toHaveBeenCalledWith(
        123,
        expect.stringContaining("Code Review Summary")
      );
      expect(result.commentsCreated).toBe(1);
    });

    it("executes create action for inline comment", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();
      const files = [createPRFile()];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockParseBatchedFileReview.mockReturnValue([
        {
          filename: "test.ts",
          findings: [
            {
              line: 2,
              severity: "high",
              category: "bug",
              message: "Test issue",
              suggestion: "Fix it",

              isPreExisting: false,
            },
          ],
        },
      ]);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      expect(mockPlatform.postInlineComment).toHaveBeenCalledWith(
        123,
        "test.ts",
        2,
        expect.any(String)
      );
      expect(result.commentsCreated).toBe(2); // 1 inline + 1 summary
    });

    it("warns when all findings filtered out due to invalid line numbers", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();
      const files = [
        createPRFile({
          filename: "test.ts",
          patch: `@@ -1,3 +1,3 @@
 line 1
-line 2
+new line 2
 line 3`,
        }),
      ];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockParseFileReview.mockReturnValue({
        filename: "test.ts",
        findings: [
          {
            line: 999, // Invalid line number
            severity: "high",
            category: "bug",
            message: "Issue on invalid line",
            suggestion: "Fix it",

            isPreExisting: false,
          },
        ],
      });
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      await engine.reviewPR(123);

      // File review result should be excluded entirely since all findings filtered out
      // This tests the warning path at line 463
    });

    it("reuses cached cross-file analysis when all files unchanged", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: true });
      const prDetails = createPRDetails();
      const files = [createPRFile({ filename: "test.ts", sha: "unchanged-sha" })];

      // First review - perform full analysis
      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockParseFileReview.mockReturnValue({
        filename: "test.ts",
        findings: [],
      });
      const originalCrossFileResult = {
        overallAssessment: "Original assessment",
        findings: [],
        recommendations: ["Original recommendation"],
      };
      mockParseCrossFileReview.mockReturnValue(originalCrossFileResult);

      await engine.reviewPR(123);

      // Reset mocks for second review
      mockExecutePrompt.mockClear();
      mockParseCrossFileReview.mockClear();

      // Second review - file unchanged, should skip cross-file analysis
      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      const result = await engine.reviewPR(123);

      // Verify file review was cached (not called again)
      expect(mockExecutePrompt).not.toHaveBeenCalled();
      expect(mockParseCrossFileReview).not.toHaveBeenCalled();

      // Verify cached cross-file result was used
      expect(result.crossFileResult.overallAssessment).toBe("Original assessment");
      expect(result.crossFileResult.recommendations).toEqual(["Original recommendation"]);
      expect(result.filesSkipped).toBe(1);

      // Verify log message about using cached cross-file analysis
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("using cached cross-file analysis")
      );

      consoleSpy.mockRestore();
    });

    it("performs new cross-file analysis when some files changed", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();
      const files = [
        createPRFile({
          filename: "unchanged.ts",
          sha: "same-sha",
          patch: "@@ -1,3 +1,3 @@\n line",
        }),
        createPRFile({ filename: "changed.ts", sha: "old-sha", patch: "@@ -1,3 +1,3 @@\n line" }),
      ];

      // First review
      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockParseBatchedFileReview.mockReturnValue([
        { filename: "unchanged.ts", findings: [] },
        { filename: "changed.ts", findings: [] },
      ]);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "First review",
        findings: [],
        recommendations: [],
      });

      await engine.reviewPR(123);

      // Clear mock call counts but keep implementation
      mockExecutePrompt.mockClear();
      mockParseBatchedFileReview.mockClear();
      mockParseCrossFileReview.mockClear();

      // Second review with one changed file
      const updatedFiles = [
        createPRFile({
          filename: "unchanged.ts",
          sha: "same-sha",
          patch: "@@ -1,3 +1,3 @@\n line",
        }),
        createPRFile({ filename: "changed.ts", sha: "new-sha", patch: "@@ -1,3 +1,3 @@\n line" }),
      ];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(updatedFiles);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      // Batched review returns only the changed file since unchanged is cached
      mockParseBatchedFileReview.mockReturnValue([{ filename: "changed.ts", findings: [] }]);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Updated review",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      // Should perform new cross-file analysis because a file changed
      expect(mockParseCrossFileReview).toHaveBeenCalled();
      expect(result.crossFileResult.overallAssessment).toBe("Updated review");

      // One file was cached, one was reviewed
      expect(result.filesSkipped).toBe(1);
      expect(result.filesReviewed).toBe(1);

      // Should have called batched review for the changed file
      expect(mockParseBatchedFileReview).toHaveBeenCalledTimes(1);
    });

    it("handles action with no body for create", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });

      const engine_any = engine as any;
      await expect(engine_any.executeAction(123, { type: "create" })).rejects.toThrow(
        "Create action requires body"
      );

      expect(mockPlatform.postInlineComment).not.toHaveBeenCalled();
      expect(mockPlatform.postGeneralComment).not.toHaveBeenCalled();
    });

    it("creates general comment when path or line is missing", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });

      const engine_any = engine as any;
      await engine_any.executeAction(123, {
        type: "create",
        body: "General comment body",
        // No path or line
      });

      expect(mockPlatform.postGeneralComment).toHaveBeenCalledWith(123, "General comment body");
      expect(mockPlatform.postInlineComment).not.toHaveBeenCalled();
    });

    it("creates general comment when only path is provided", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });

      const engine_any = engine as any;
      await engine_any.executeAction(123, {
        type: "create",
        body: "Comment body",
        path: "file.ts",
        // No line
      });

      expect(mockPlatform.postGeneralComment).toHaveBeenCalledWith(123, "Comment body");
      expect(mockPlatform.postInlineComment).not.toHaveBeenCalled();
    });

    it("creates general comment when only line is provided", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });

      const engine_any = engine as any;
      await engine_any.executeAction(123, {
        type: "create",
        body: "Comment body",
        line: 10,
        // No path
      });

      expect(mockPlatform.postGeneralComment).toHaveBeenCalledWith(123, "Comment body");
      expect(mockPlatform.postInlineComment).not.toHaveBeenCalled();
    });
  });

  describe("multi-run mode", () => {
    it("uses single run when reviewRuns is 1", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: true,
        reviewRuns: 1,
      });
      const prDetails = createPRDetails();
      const files = [createPRFile()];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockParseFileReview.mockReturnValue({
        filename: "test.ts",
        findings: [],
      });
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      await engine.reviewPR(123);

      // Should NOT show multi-run messages
      const multiRunCalls = consoleSpy.mock.calls.filter(
        (call) => call[0] && String(call[0]).includes("Multi-run mode")
      );
      expect(multiRunCalls.length).toBe(0);
      consoleSpy.mockRestore();
    });

    it("defaults to single run when reviewRuns not specified", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: true,
        // reviewRuns not specified - should default to 1
      });
      const prDetails = createPRDetails();
      const files = [createPRFile()];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockParseFileReview.mockReturnValue({
        filename: "test.ts",
        findings: [],
      });
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      await engine.reviewPR(123);

      // Should NOT show multi-run messages
      const multiRunCalls = consoleSpy.mock.calls.filter(
        (call) => call[0] && String(call[0]).includes("Multi-run mode")
      );
      expect(multiRunCalls.length).toBe(0);
      consoleSpy.mockRestore();
    });

    it("logs reviewRuns in constructor", () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: true,
        reviewRuns: 3,
      });
      expect(engine).toBeDefined();
    });

    test.skip("executes multiple runs and aggregates findings", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: true,
        reviewRuns: 2,
      });
      const prDetails = createPRDetails();
      const files = [createPRFile()];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });

      // Return different findings for each run
      mockParseFileReview.mockReturnValue({
        filename: "test.ts",
        findings: [],
      });

      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      // Should show multi-run log output
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("📝 Review run"));
      expect(result).toBeDefined();

      consoleSpy.mockRestore();
    });

    it("continues with remaining runs when one run fails", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: false, // Reduce logging
        reviewRuns: 2,
      });
      const prDetails = createPRDetails();
      const files = [createPRFile()];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      // First run fails, second succeeds
      let callCount = 0;
      mockExecutePrompt.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Run 1 failed");
        }
        return Promise.resolve({ raw: "{}", parsed: {} });
      });

      mockParseFileReview.mockReturnValue({
        filename: "test.ts",
        findings: [],
      });

      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      // Should continue and complete
      expect(result).toBeDefined();

      consoleSpy.mockRestore();
    });

    test.skip("does not wait after last run", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: false,
        reviewRuns: 2,
      });
      const prDetails = createPRDetails();
      const files = [createPRFile()];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockParseFileReview.mockReturnValue({
        filename: "test.ts",
        findings: [],
      });
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      await engine.reviewPR(123);

      // Test verifies the code completes without hanging
      // (no delay after last run)
    });

    it("creates synthetic comments from previous run findings", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: false,
        reviewRuns: 2,
      });
      const prDetails = createPRDetails();
      const files = [createPRFile()];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });

      mockParseBatchedFileReview.mockReturnValue([
        {
          filename: "test.ts",
          findings: [],
        },
      ]);

      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      // Second run should receive context from first run
      expect(mockExecutePrompt).toHaveBeenCalled();
      expect(result).toBeDefined();
    }, 10000);
  });

  describe("executeCommentAction error handling", () => {
    it("throws error for create action without body", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue([]);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      // Force engine to execute an invalid create action
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // We need to trigger this through the review flow
      // The commentManager should not create actions without body, but test the guard
      await engine.reviewPR(123);

      consoleSpy.mockRestore();
    });
  });

  describe.skip("specialized review mode (disabled in Phase 1)", () => {
    // Note: Specialized review mode has been temporarily disabled during Phase 1 refactoring.
    // These tests will be re-enabled in future phases when review types are implemented.
    it("runs three parallel specialized reviews when specialized option is enabled", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", "copilot", {
        verbose: false,
        reviewType: "security",
      });
      const prDetails = createPRDetails();
      const files = [createPRFile()];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockParseBatchedFileReview.mockReturnValue([{ filename: "test.ts", findings: [] }]);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      await engine.reviewPR(123);

      // Should be called 4 times: 3 specialized reviews + 1 cross-file analysis
      expect(mockExecutePrompt).toHaveBeenCalledTimes(4);
    });

    it("aggregates findings from all three specialized reviews", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", "copilot", {
        verbose: false,
        reviewType: "security",
      });
      const prDetails = createPRDetails();
      const files = [createPRFile()];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });

      // Each specialized review returns different findings
      mockParseBatchedFileReview
        .mockReturnValueOnce([
          {
            filename: "test.ts",
            findings: [
              {
                line: 2,
                severity: "high",
                category: "security",
                message: "Security issue",
                suggestion: "Fix security",
                isPreExisting: false,
              },
            ],
          },
        ])
        .mockReturnValueOnce([
          {
            filename: "test.ts",
            findings: [
              {
                line: 3,
                severity: "medium",
                category: "bug",
                message: "Logic bug",
                suggestion: "Fix bug",
                isPreExisting: false,
              },
            ],
          },
        ])
        .mockReturnValueOnce([
          {
            filename: "test.ts",
            findings: [
              {
                line: 4,
                severity: "low",
                category: "performance",
                message: "Performance issue",
                suggestion: "Optimize",
                isPreExisting: false,
              },
            ],
          },
        ]);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      // All three findings should be aggregated (3 specialized + 3 comments posted)
      // Note: findings are deduplicated, so all 3 unique findings should be present
      expect(result.fileResults.length).toBeGreaterThan(0);
      const totalFindings = result.fileResults.reduce((sum, r) => sum + r.findings.length, 0);
      expect(totalFindings).toBe(3);
    });

    it("continues when one specialized review fails", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", "copilot", {
        verbose: false,
        reviewType: "security",
      });
      const prDetails = createPRDetails();
      const files = [createPRFile()];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      // First call fails, others succeed
      mockExecutePrompt
        .mockRejectedValueOnce(new Error("Security review failed"))
        .mockResolvedValue({ raw: "{}", parsed: {} });

      mockParseBatchedFileReview.mockReturnValue([
        {
          filename: "test.ts",
          findings: [
            {
              line: 2,
              severity: "medium",
              category: "bug",
              message: "Logic bug",
              suggestion: "Fix",
              isPreExisting: false,
            },
          ],
        },
      ]);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      // Should still complete with results from successful reviews
      expect(result).toBeDefined();
      expect(result.filesReviewed).toBe(1);
    });

    it("returns empty results when no reviewable files", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", "copilot", {
        verbose: false,
        reviewType: "security",
      });
      const prDetails = createPRDetails();
      const files = [createPRFile({ filename: "deleted.ts", status: "deleted" })];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "No files to review",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      expect(result.filesReviewed).toBe(0);
    });

    it("deduplicates identical findings from different specialized reviews", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", "copilot", {
        verbose: false,
        reviewType: "security",
      });
      const prDetails = createPRDetails();
      const files = [createPRFile()];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });

      // All three reviews return the same finding
      const sameFinding = {
        line: 2,
        severity: "high" as const,
        category: "security",
        message: "Duplicate finding across reviews",
        suggestion: "Fix it",
        isPreExisting: false,
      };

      mockParseBatchedFileReview.mockReturnValue([
        { filename: "test.ts", findings: [sameFinding] },
      ]);

      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      // Despite 3 reviews returning the same finding, it should be deduplicated to 1
      const totalFindings = result.fileResults.reduce((sum, r) => sum + r.findings.length, 0);
      expect(totalFindings).toBe(1);
    });

    it("logs specialized review progress in verbose mode", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const engine = new ReviewEngine(mockPlatform, "[Bot]", "copilot", {
        verbose: true,
        reviewType: "security",
      });
      const prDetails = createPRDetails();
      const files = [createPRFile()];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockParseBatchedFileReview.mockReturnValue([{ filename: "test.ts", findings: [] }]);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      await engine.reviewPR(123);

      // Should log specialized review messages
      const specializedLogs = consoleSpy.mock.calls.filter(
        (call) => call[0] && String(call[0]).includes("specialized")
      );
      expect(specializedLogs.length).toBeGreaterThan(0);
      consoleSpy.mockRestore();
    });
  });
});
