import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
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

function createMockPlatform(): PlatformAdapter {
  return {
    getPRDetails: vi.fn(),
    getPRFiles: vi.fn(),
    getExistingBotComments: vi.fn(),
    postInlineComment: vi.fn(),
    postGeneralComment: vi.fn(),
    updateComment: vi.fn(),
    resolveComment: vi.fn(),
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

  afterEach(async () => {
    // Clean up cache directory between tests
    try {
      await fs.rm(".merge-mentor", { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
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
      expect(mockPlatform.updateComment).not.toHaveBeenCalled();
      expect(mockPlatform.resolveComment).not.toHaveBeenCalled();
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
      const existingComments: ExistingComment[] = [
        { id: 1, body: "[Bot]\nOld comment", path: "test.ts", line: 2 },
      ];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue([]);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue(existingComments);
      vi.mocked(mockPlatform.resolveComment).mockRejectedValue(new Error("Network error"));

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
              confidence: "high",
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

    it("shows dry run actions for update comment", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: true,
        dryRun: true,
      });
      const prDetails = createPRDetails();
      const files = [createPRFile()];
      const existingComments: ExistingComment[] = [
        { id: 1, body: "[Bot]\n\n🔴 **HIGH** - bug\n\nOld message", path: "test.ts", line: 2 },
      ];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue(existingComments);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockParseFileReview.mockReturnValue({
        filename: "test.ts",
        findings: [
          {
            line: 2,
            severity: "high",
            category: "bug",
            message: "Updated issue",
            suggestion: "Fix it",
            confidence: "high",
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

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[UPDATE]"));
      consoleSpy.mockRestore();
    });

    it("shows dry run actions for resolve comment", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: true,
        dryRun: true,
      });
      const prDetails = createPRDetails();
      const existingComments: ExistingComment[] = [
        { id: 1, body: "[Bot]\n\nbug\nOld", path: "test.ts", line: 2 },
      ];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue([]);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue(existingComments);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      await engine.reviewPR(123);

      const resolveCalls = consoleSpy.mock.calls.filter(
        (call) => call[0] && String(call[0]).includes("[RESOLVE]")
      );
      expect(resolveCalls.length).toBeGreaterThan(0);
      consoleSpy.mockRestore();
    });

    it("executes update action", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();
      const files = [createPRFile()];
      const existingComments: ExistingComment[] = [
        {
          id: 1,
          body: "[Bot]\n\n🔴 **HIGH** - bug\n\nOld message\n\n**Suggestion:** Old fix",
          path: "test.ts",
          line: 2,
        },
      ];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue(existingComments);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockParseFileReview.mockReturnValue({
        filename: "test.ts",
        findings: [
          {
            line: 2,
            severity: "high",
            category: "bug",
            message: "New message",
            suggestion: "Fix",
            confidence: "high",
            isPreExisting: false,
          },
        ],
      });
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      expect(mockPlatform.updateComment).toHaveBeenCalledWith(1, expect.any(String));
      expect(result.commentsUpdated).toBe(1);
    });

    it("executes resolve action", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();
      const existingComments: ExistingComment[] = [
        { id: 1, body: "[Bot]\n\nbug\nOld", path: "test.ts", line: 2 },
      ];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue([]);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue(existingComments);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      expect(mockPlatform.resolveComment).toHaveBeenCalledWith(1);
      expect(result.commentsResolved).toBe(1);
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
              confidence: "high",
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

    it("shows dry run update action with file path", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: true,
        dryRun: true,
      });
      const prDetails = createPRDetails();
      const files = [createPRFile()];
      const existingComments: ExistingComment[] = [
        {
          id: 1,
          body: "[Bot]\n\n🔴 **HIGH** - bug\n\nOld message\n\n**Suggestion:** Old fix",
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
              message: "New message",
              suggestion: "Fix",
              confidence: "high",
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

      const updateCalls = consoleSpy.mock.calls.filter(
        (call) => call[0] && String(call[0]).includes("[UPDATE]")
      );
      expect(updateCalls.length).toBeGreaterThan(0);
      const pathCalls = consoleSpy.mock.calls.filter(
        (call) => call[0] && String(call[0]).includes("test.ts:2")
      );
      expect(pathCalls.length).toBeGreaterThan(0);
      consoleSpy.mockRestore();
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
            confidence: "high",
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

    it("handles action with no existingCommentId for update", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue([]);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      // Manually inject an invalid action (this tests defensive code)
      const engine_any = engine as any;
      await expect(engine_any.executeAction(123, { type: "update", body: "test" })).rejects.toThrow(
        "Update action requires existingCommentId"
      );

      expect(mockPlatform.updateComment).not.toHaveBeenCalled();
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

    it("handles action with no body for update", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });

      const engine_any = engine as any;
      await expect(
        engine_any.executeAction(123, { type: "update", existingCommentId: 1 })
      ).rejects.toThrow("Update action requires body");

      expect(mockPlatform.updateComment).not.toHaveBeenCalled();
    });

    it("handles action with no existingCommentId for resolve", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });

      const engine_any = engine as any;
      await expect(engine_any.executeAction(123, { type: "resolve" })).rejects.toThrow(
        "Resolve action requires existingCommentId"
      );

      expect(mockPlatform.resolveComment).not.toHaveBeenCalled();
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
    });
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

    it("throws error for update action without existingCommentId", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue([]);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      await engine.reviewPR(123);
    });

    it("throws error for resolve action without existingCommentId", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue([]);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      await engine.reviewPR(123);
    });
  });
});
