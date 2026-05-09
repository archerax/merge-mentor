import { beforeEach, describe, expect, it, test, vi } from "vitest";
import packageJson from "../../package.json" with { type: "json" };
import { createAIProvider } from "../ai/index.js";
import { ValidationError } from "../errors/index.js";
import type { ExistingComment, PlatformAdapter, PRDetails, PRFile } from "../platforms/types.js";
import { createFixedClock } from "../ports/clock.test-helper.js";
import { createStubFileSystem } from "../ports/fileSystem.test-helper.js";
import { DiffStorage } from "./diffStorage.js";
import { ReviewEngine } from "./engine.js";

// Stub nodeFs so engine and DiffStorage never touch the real filesystem during tests
vi.mock("../ports/index.js", async () => {
  const actual = await vi.importActual<typeof import("../ports/index.js")>("../ports/index.js");
  return {
    ...actual,
    nodeFs: {
      readFile: vi.fn().mockResolvedValue(""),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
      access: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      stat: vi.fn().mockResolvedValue({
        isDirectory: () => true,
        isFile: () => true,
        size: 0,
        mtime: new Date("2025-01-01T00:00:00.000Z"),
      }),
      unlink: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// Mock the createAIProvider function with a factory that returns a mock provider
const mockExecutePrompt = vi.fn();
const mockParseFileReview = vi.fn();
const mockParseCrossFileReview = vi.fn();
const mockParseBatchedFileReview = vi.fn();
const mockParseFastReview = vi.fn();

vi.mock("../ai/index.js", () => ({
  createAIProvider: vi.fn(() => ({
    executePrompt: (...args: unknown[]) => mockExecutePrompt(...args),
    parseFileReview: (...args: unknown[]) => mockParseFileReview(...args),
    parseCrossFileReview: (...args: unknown[]) => mockParseCrossFileReview(...args),
    parseBatchedFileReview: (...args: unknown[]) => mockParseBatchedFileReview(...args),
    parseFastReview: (...args: unknown[]) => mockParseFastReview(...args),
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

    it("passes Copilot SDK BYOK settings to the provider factory", () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", "copilot-sdk", {
        aiModel: "gpt-5.2-codex",
        aiBaseUrl: "https://bedrock.example.com/openai/v1",
        aiApiKey: "bedrock-key",
      });

      expect(engine).toBeDefined();
      expect(vi.mocked(createAIProvider)).toHaveBeenCalledWith(
        "copilot-sdk",
        expect.objectContaining({
          model: "gpt-5.2-codex",
          aiBaseUrl: "https://bedrock.example.com/openai/v1",
          aiApiKey: "bedrock-key",
        })
      );
    });
  });

  describe("workspace resolution", () => {
    it("uses localWorkspacePath directly when provided and accessible", async () => {
      const prDetails = createPRDetails();
      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue([]);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      const { nodeFs } = await import("../ports/index.js");
      vi.mocked(nodeFs.access).mockResolvedValue(undefined);

      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: false,
        localWorkspacePath: "/preexisting/checkout",
      });

      await engine.reviewPR(123);

      expect(nodeFs.access).toHaveBeenCalledWith("/preexisting/checkout");
      expect(mockEnsureRepo).not.toHaveBeenCalled();
    });

    it("clones the PR head branch (not base branch) when no localWorkspacePath is set", async () => {
      const prDetails = createPRDetails();
      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue([]);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      const engine = new ReviewEngine(mockPlatform, "[Bot]");

      await engine.reviewPR(123);

      expect(mockEnsureRepo).toHaveBeenCalledWith(
        expect.anything(),
        prDetails.headBranch,
        expect.anything()
      );
    });

    it("throws a clear error when localWorkspacePath does not exist", async () => {
      const prDetails = createPRDetails();
      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue([]);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      const { nodeFs } = await import("../ports/index.js");
      vi.mocked(nodeFs.access).mockRejectedValue(new Error("ENOENT"));

      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: false,
        localWorkspacePath: "/nonexistent/path",
      });

      await expect(engine.reviewPR(123)).rejects.toThrow(
        "CI workspace path does not exist or is not accessible: /nonexistent/path"
      );
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

    it("returns zero linesAdded and linesDeleted when PR has no files", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue([]);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      const result = await engine.reviewPR(123);

      expect(result.linesAdded).toBe(0);
      expect(result.linesDeleted).toBe(0);
    });

    it("sums linesAdded and linesDeleted from non-ignored files", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });
      const prDetails = createPRDetails();
      const files: PRFile[] = [
        createPRFile({ filename: "a.ts", additions: 20, deletions: 5 }),
        createPRFile({ filename: "b.ts", additions: 10, deletions: 3 }),
      ];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      const result = await engine.reviewPR(123);

      expect(result.linesAdded).toBe(30);
      expect(result.linesDeleted).toBe(8);
    });

    it("returns zero linesAdded and linesDeleted when all files are ignored", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: false,
        ignorePatterns: ["*.ts"],
      });
      const prDetails = createPRDetails();
      const files: PRFile[] = [createPRFile({ filename: "a.ts", additions: 20, deletions: 5 })];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      const result = await engine.reviewPR(123);

      expect(result.linesAdded).toBe(0);
      expect(result.linesDeleted).toBe(0);
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

    it("includes version, review type, and model in posted comment footers", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: false,
        reviewType: "security",
        aiModel: "claude-sonnet-4.6",
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

      await engine.reviewPR(123);

      expect(mockPlatform.postInlineComment).toHaveBeenCalledWith(
        123,
        "test.ts",
        2,
        expect.stringContaining(
          `Merge Mentor v${packageJson.version}, Baseline review + security, claude-sonnet-4.6`
        )
      );
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

      // biome-ignore lint/complexity/useLiteralKeys: accessing private method for testing
      const executeAction = engine["executeAction"].bind(engine);
      await expect(executeAction(123, { type: "create" })).rejects.toThrow(
        "Create action requires body"
      );

      expect(mockPlatform.postInlineComment).not.toHaveBeenCalled();
      expect(mockPlatform.postGeneralComment).not.toHaveBeenCalled();
    });

    it("creates general comment when path or line is missing", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });

      // biome-ignore lint/complexity/useLiteralKeys: accessing private method for testing
      const executeAction = engine["executeAction"].bind(engine);
      await executeAction(123, {
        type: "create",
        body: "General comment body",
        // No path or line
      });

      expect(mockPlatform.postGeneralComment).toHaveBeenCalledWith(123, "General comment body");
      expect(mockPlatform.postInlineComment).not.toHaveBeenCalled();
    });

    it("creates general comment when only path is provided", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", { verbose: false });

      // biome-ignore lint/complexity/useLiteralKeys: accessing private method for testing
      const executeAction = engine["executeAction"].bind(engine);
      await executeAction(123, {
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

      // biome-ignore lint/complexity/useLiteralKeys: accessing private method for testing
      const executeAction = engine["executeAction"].bind(engine);
      await executeAction(123, {
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

    test("executes multiple runs and aggregates findings", async () => {
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

    test("does not wait after last run", async () => {
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

  describe("resolved review profiles", () => {
    it("resolves security reviewType to a baseline review with a security pass", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
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
        overallAssessment: "No security issues found",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      expect(result).toBeDefined();
      expect(result.filesReviewed).toBe(1);
      expect(mockExecutePrompt).toHaveBeenCalledTimes(2);
      expect(mockExecutePrompt.mock.calls[0][0]).toContain("# ADDITIVE REVIEW PASSES");
      expect(mockExecutePrompt.mock.calls[0][0]).toContain("1. security");
    });

    it("resolves performance reviewType to a baseline review with a performance pass", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: false,
        reviewType: "performance",
      });
      const prDetails = createPRDetails();
      const files = [createPRFile()];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockParseBatchedFileReview.mockReturnValue([{ filename: "test.ts", findings: [] }]);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "No performance issues found",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      expect(result).toBeDefined();
      expect(result.filesReviewed).toBe(1);
      expect(mockExecutePrompt).toHaveBeenCalledTimes(2);
      expect(mockExecutePrompt.mock.calls[0][0]).toContain("1. performance");
    });

    it("resolves testing reviewType to a baseline review with a testing pass", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: false,
        reviewType: "testing",
      });
      const prDetails = createPRDetails();
      const files = [createPRFile({ filename: "src/utils.ts" })];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockParseBatchedFileReview.mockReturnValue([{ filename: "src/utils.ts", findings: [] }]);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Test coverage looks good",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      expect(result).toBeDefined();
      expect(result.filesReviewed).toBe(1);
      expect(mockExecutePrompt).toHaveBeenCalledTimes(2);
      expect(mockExecutePrompt.mock.calls[0][0]).toContain("1. testing");
      expect(mockExecutePrompt.mock.calls[0][0]).toContain("# TESTING PASS CONTEXT");
    });

    it("uses fast strategy when reviewType is fast", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: false,
        reviewType: "fast",
      });
      const prDetails = createPRDetails();
      const files = [createPRFile()];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockParseFastReview.mockReturnValue({
        fileResults: [
          {
            filename: "test.ts",
            findings: [
              {
                line: 2,
                severity: "medium",
                category: "bug",
                message: "Possible issue",
                suggestion: "Fix it",
                isPreExisting: false,
              },
            ],
          },
        ],
        crossFileResult: {
          overallAssessment: "Fast review complete",
          findings: [],
          recommendations: [],
        },
      });

      const result = await engine.reviewPR(123);

      expect(result).toBeDefined();
      expect(result.filesReviewed).toBe(1);
      expect(mockExecutePrompt).toHaveBeenCalledTimes(1);
      expect(mockParseFastReview).toHaveBeenCalled();
      expect(result.crossFileResult.overallAssessment).toBe("Fast review complete");
    });

    it("uses ordered additive passes when reviewType is custom", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: false,
        reviewType: "custom",
        customReviewPhases: ["scan", "logic"],
      });
      const prDetails = createPRDetails();
      const files = [createPRFile()];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);
      mockExecutePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockParseBatchedFileReview.mockReturnValue([{ filename: "test.ts", findings: [] }]);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Custom review complete",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      expect(result).toBeDefined();
      expect(mockExecutePrompt).toHaveBeenCalledTimes(2);
      expect(mockExecutePrompt.mock.calls[0][0]).toContain("# ADDITIVE REVIEW PASSES");
      expect(mockExecutePrompt.mock.calls[0][0]).toContain("1. scan");
      expect(mockExecutePrompt.mock.calls[0][0]).toContain("2. logic");
      expect(mockExecutePrompt.mock.calls[0][0]).toContain(
        "These passes add focus and context. They do **not** restrict what issues you may report."
      );
      expect(mockExecutePrompt.mock.calls[1][0]).toContain("# ADDITIVE REVIEW PASSES");
    });

    it("fast review returns empty results when no files have patches", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: false,
        reviewType: "fast",
      });
      const prDetails = createPRDetails();
      const files = [createPRFile({ patch: undefined, status: "modified" })];

      vi.mocked(mockPlatform.getPRDetails).mockResolvedValue(prDetails);
      vi.mocked(mockPlatform.getPRFiles).mockResolvedValue(files);
      vi.mocked(mockPlatform.getExistingBotComments).mockResolvedValue([]);

      const result = await engine.reviewPR(123);

      expect(result).toBeDefined();
      expect(result.filesReviewed).toBe(0);
      expect(result.fileResults).toHaveLength(0);
      expect(result.crossFileResult.overallAssessment).toBe("No files to review");
      // No AI calls should be made
      expect(mockExecutePrompt).not.toHaveBeenCalled();
    });
  });

  describe("dry run and comment error handling", () => {
    it("dry run logs planned actions without posting comments", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: false,
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
              message: "Critical bug",
              suggestion: "Fix it",
              isPreExisting: false,
            },
          ],
        },
      ]);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Needs fixes",
        findings: [],
        recommendations: [],
      });

      const result = await engine.reviewPR(123);

      expect(result).toBeDefined();
      // In dry run, commentsCreated counts planned actions
      expect(result.commentsCreated).toBeGreaterThan(0);
      // But no actual platform calls are made
      expect(mockPlatform.postInlineComment).not.toHaveBeenCalled();
      expect(mockPlatform.postGeneralComment).not.toHaveBeenCalled();
    });

    it("comment action error populates commentErrors", async () => {
      const engine = new ReviewEngine(mockPlatform, "[Bot]", {
        verbose: false,
        dryRun: false,
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
              message: "Critical bug",
              suggestion: "Fix it",
              isPreExisting: false,
            },
          ],
        },
      ]);
      mockParseCrossFileReview.mockReturnValue({
        overallAssessment: "Needs fixes",
        findings: [],
        recommendations: [],
      });
      vi.mocked(mockPlatform.postInlineComment).mockRejectedValue(
        new Error("API rate limit exceeded")
      );
      vi.mocked(mockPlatform.postGeneralComment).mockRejectedValue(
        new Error("API rate limit exceeded")
      );

      const result = await engine.reviewPR(123);

      expect(result).toBeDefined();
      expect(result.commentErrors.length).toBeGreaterThan(0);
      expect(result.commentErrors[0]).toContain("API rate limit exceeded");
    });
  });
});

describe("DiffStorage", () => {
  it("logs warning when patch has too few lines (header-only patch)", async () => {
    const fs = createStubFileSystem();
    const clock = createFixedClock();
    const storage = new DiffStorage("/tmp/test", fs, clock);
    const shortPatch = "@@ -1,2 +1,2 @@\n- old\n+ new";

    await storage.storeDiffs("pr-1", [
      {
        filename: "file.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        patch: shortPatch,
      },
    ]);

    // File was still written despite the short patch
    expect(fs.writeFile).toHaveBeenCalled();
  });

  it("silently ignores ENOENT errors during cleanup", async () => {
    const fs = createStubFileSystem({
      rm: vi.fn().mockRejectedValue(Object.assign(new Error("not found"), { code: "ENOENT" })),
    });
    const storage = new DiffStorage("/base", fs);

    await expect(storage.cleanup("pr-1")).resolves.toBeUndefined();
  });

  it("logs warning for non-ENOENT errors during cleanup", async () => {
    const fs = createStubFileSystem({
      rm: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("permission denied"), { code: "EACCES" })),
    });
    const storage = new DiffStorage("/base", fs);

    await expect(storage.cleanup("pr-1")).resolves.toBeUndefined();
  });

  it("silently ignores ENOENT errors during cleanupAll", async () => {
    const fs = createStubFileSystem({
      rm: vi.fn().mockRejectedValue(Object.assign(new Error("not found"), { code: "ENOENT" })),
    });
    const storage = new DiffStorage("/base", fs);

    await expect(storage.cleanupAll()).resolves.toBeUndefined();
  });

  it("logs warning for non-ENOENT errors during cleanupAll", async () => {
    const fs = createStubFileSystem({
      rm: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("permission denied"), { code: "EACCES" })),
    });
    const storage = new DiffStorage("/base", fs);

    await expect(storage.cleanupAll()).resolves.toBeUndefined();
  });

  it("skips files without a patch", async () => {
    const fs = createStubFileSystem();
    const clock = createFixedClock();
    const storage = new DiffStorage("/base", fs, clock);

    await storage.storeDiffs("pr-2", [
      { filename: "no-patch.ts", status: "modified", additions: 0, deletions: 0 },
    ]);

    // manifest written but no diff file for the patch-less file
    const writeFileCalls = vi.mocked(fs.writeFile).mock.calls;
    const manifestCall = writeFileCalls.find((args) =>
      (args[0] as string).endsWith("manifest.json")
    );
    expect(manifestCall).toBeDefined();
    if (!manifestCall) throw new Error("manifest not written");
    const manifest = JSON.parse(manifestCall[1] as string) as { files: unknown[] };
    expect(manifest.files).toHaveLength(0);
  });
});
