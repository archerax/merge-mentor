import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "../errors/index.js";
import type { ExistingComment, PlatformAdapter, PRDetails, PRFile } from "../platforms/types.js";
import { ReviewEngine } from "./engine.js";

const mockExecutePrompt = vi.fn();
const mockParseFileReview = vi.fn();
const mockParseCrossFileReview = vi.fn();

vi.mock("../copilot/client.js", () => {
  class MockCopilotClient {
    executePrompt = mockExecutePrompt;
    parseFileReview = mockParseFileReview;
    parseCrossFileReview = mockParseCrossFileReview;
  }

  return {
    CopilotClient: MockCopilotClient,
  };
});

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
    patch: '@@ -1,3 +1,4 @@\n+console.log("test");',
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
        { id: 1, body: "[Bot]\nOld comment", path: "test.ts", line: 10 },
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
      mockParseFileReview.mockReturnValue({
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
      });
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      await engine.reviewPR(123);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[CREATE]"));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("test.ts:10"));
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
        { id: 1, body: "[Bot]\n\n🔴 **HIGH** - bug\n\nOld message", path: "test.ts", line: 10 },
      ];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue(existingComments);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockParseFileReview.mockReturnValue({
        filename: "test.ts",
        findings: [
          {
            line: 10,
            severity: "high",
            category: "bug",
            message: "Updated issue",
            suggestion: "Fix it",
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
        { id: 1, body: "[Bot]\n\nbug\nOld", path: "test.ts", line: 10 },
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
          line: 10,
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
            line: 10,
            severity: "high",
            category: "bug",
            message: "New message",
            suggestion: "Fix",
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
        { id: 1, body: "[Bot]\n\nbug\nOld", path: "test.ts", line: 10 },
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
      mockParseFileReview.mockReturnValue({
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
      });
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Good",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      expect(mockPlatform.postInlineComment).toHaveBeenCalledWith(
        123,
        "test.ts",
        10,
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
          line: 10,
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
            line: 10,
            severity: "high",
            category: "bug",
            message: "New message",
            suggestion: "Fix",
          },
        ],
      });
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
        (call) => call[0] && String(call[0]).includes("test.ts:10")
      );
      expect(pathCalls.length).toBeGreaterThan(0);
      consoleSpy.mockRestore();
    });

    it("handles action with no existingCommentId for update", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue([]);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      // Manually inject an invalid action (this tests defensive code)
      const engine_any = engine as any;
      await engine_any.executeAction(123, { type: "update", body: "test" });

      expect(mockPlatform.updateComment).not.toHaveBeenCalled();
    });

    it("handles action with no existingCommentId for resolve", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });

      const engine_any = engine as any;
      await engine_any.executeAction(123, { type: "resolve" });

      expect(mockPlatform.resolveComment).not.toHaveBeenCalled();
    });
  });
});
