/**
 * Integration tests for CLI commands with mocked dependencies.
 * Tests the complete CLI flow from command parsing to execution.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Create mock instances that can be shared
const mockGitHubAdapter = {
  getPRDetails: vi.fn().mockResolvedValue({
    number: 42,
    title: "Test PR",
    description: "Test description",
    author: "test-author",
    baseBranch: "main",
    headBranch: "feature/test",
  }),
  getPRFiles: vi.fn().mockResolvedValue([
    {
      filename: "src/test.ts",
      status: "modified",
      additions: 10,
      deletions: 5,
      sha: "abc123",
      patch: "@@ -1,5 +1,10 @@\n+const x = 1;",
    },
  ]),
  getExistingBotComments: vi.fn().mockResolvedValue([]),
  postInlineComment: vi.fn().mockResolvedValue(undefined),
  postGeneralComment: vi.fn().mockResolvedValue(undefined),
  updateComment: vi.fn().mockResolvedValue(undefined),
  resolveComment: vi.fn().mockResolvedValue(undefined),
};

const mockAzureAdapter = {
  getPRDetails: vi.fn().mockResolvedValue({
    number: 42,
    title: "Test PR",
    description: "Test description",
    author: "azure-author",
    baseBranch: "main",
    headBranch: "feature/test",
  }),
  getPRFiles: vi.fn().mockResolvedValue([]),
  getExistingBotComments: vi.fn().mockResolvedValue([]),
  postInlineComment: vi.fn().mockResolvedValue(undefined),
  postGeneralComment: vi.fn().mockResolvedValue(undefined),
  updateComment: vi.fn().mockResolvedValue(undefined),
  resolveComment: vi.fn().mockResolvedValue(undefined),
};

const mockCopilotInstance = {
  executePrompt: vi.fn().mockResolvedValue({ raw: "{}", parsed: {} }),
  parseFileReview: vi.fn().mockReturnValue({
    filename: "src/test.ts",
    findings: [],
  }),
  parseCrossFileReview: vi.fn().mockReturnValue({
    overallAssessment: "No issues found",
    findings: [],
    recommendations: [],
  }),
};

// Mock external dependencies before importing CLI modules
vi.mock("../../src/platforms/github.js", () => ({
  GitHubAdapter: function GitHubAdapter() {
    return mockGitHubAdapter;
  },
}));

vi.mock("../../src/platforms/azure.js", () => ({
  AzureDevOpsAdapter: function AzureDevOpsAdapter() {
    return mockAzureAdapter;
  },
}));

vi.mock("../../src/ai/index.js", () => ({
  createAIProvider: () => mockCopilotInstance,
}));

vi.mock("../../src/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    defaultPlatform: "github",
    aiProvider: "copilot",
    botCommentIdentifier: "[TestBot]",
    github: {
      token: "test-token",
      owner: "test-owner",
      repo: "test-repo",
    },
    azure: {
      token: "test-token",
      org: "test-org",
      project: "test-project",
      repo: "test-repo",
    },
    copilotModel: "gpt-4",
    copilotTimeoutMs: 30000,
  }),
  validateConfig: vi.fn(),
}));

vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("CLI Integration", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("executeReview", () => {
    it("executes review with GitHub platform", async () => {
      const { executeReview } = await import("../../src/cli.js");

      const result = await executeReview({
        pr: 42,
        platform: "github",
        write: false,
        verbose: false,
      });

      expect(result).toBeDefined();
      expect(result.prDetails.number).toBe(42);
    });

    it("executes review with Azure platform", async () => {
      const { executeReview } = await import("../../src/cli.js");

      const result = await executeReview({
        pr: 42,
        platform: "azure",
        write: false,
        verbose: false,
      });

      expect(result).toBeDefined();
      expect(result.prDetails.number).toBe(42);
    });

    it("throws error for invalid platform", async () => {
      const { executeReview } = await import("../../src/cli.js");

      await expect(
        executeReview({
          pr: 42,
          platform: "invalid",
          write: false,
          verbose: false,
        })
      ).rejects.toThrow('Invalid platform "invalid"');
    });

    it("uses default platform from config", async () => {
      const { executeReview } = await import("../../src/cli.js");

      const result = await executeReview({
        pr: 42,
        write: false,
        verbose: false,
      });

      expect(result).toBeDefined();
      // Default is github from mocked config
      expect(result.prDetails).toBeDefined();
    });
  });

  describe("displayResults", () => {
    it("displays results for dry-run mode", async () => {
      const { displayResults } = await import("../../src/cli.js");

      const result = {
        prDetails: {
          number: 42,
          title: "Test PR",
          description: "Description",
          author: "author",
          baseBranch: "main",
          headBranch: "feature",
        },
        filesReviewed: 5,
        filesSkipped: 1,
        fileResults: [
          {
            filename: "test.ts",
            findings: [
              {
                line: 10,
                severity: "high" as const,
                category: "security" as const,
                message: "Issue",
                suggestion: "Fix it",
              },
            ],
          },
        ],
        crossFileResult: {
          overallAssessment: "OK",
          findings: [],
          recommendations: [],
        },
        commentsCreated: 2,
        commentsUpdated: 1,
        commentsResolved: 0,
        commentErrors: [],
      };

      displayResults(result, true);

      expect(consoleSpy).toHaveBeenCalled();
      // Check that dry-run message was displayed
      const calls = consoleSpy.mock.calls.flat().join(" ");
      expect(calls).toContain("Dry-run mode");
    });

    it("displays results for write mode", async () => {
      const { displayResults } = await import("../../src/cli.js");

      const result = {
        prDetails: {
          number: 42,
          title: "Test PR",
          description: "Description",
          author: "author",
          baseBranch: "main",
          headBranch: "feature",
        },
        filesReviewed: 5,
        filesSkipped: 0,
        fileResults: [],
        crossFileResult: {
          overallAssessment: "OK",
          findings: [],
          recommendations: [],
        },
        commentsCreated: 2,
        commentsUpdated: 1,
        commentsResolved: 0,
        commentErrors: [],
      };

      displayResults(result, false);

      expect(consoleSpy).toHaveBeenCalled();
      const calls = consoleSpy.mock.calls.flat().join(" ");
      expect(calls).toContain("Comments Created");
    });

    it("displays comment errors when present", async () => {
      const { displayResults } = await import("../../src/cli.js");

      const result = {
        prDetails: {
          number: 42,
          title: "Test PR",
          description: "Description",
          author: "author",
          baseBranch: "main",
          headBranch: "feature",
        },
        filesReviewed: 5,
        filesSkipped: 0,
        fileResults: [],
        crossFileResult: {
          overallAssessment: "OK",
          findings: [],
          recommendations: [],
        },
        commentsCreated: 0,
        commentsUpdated: 0,
        commentsResolved: 0,
        commentErrors: ["Error 1", "Error 2"],
      };

      displayResults(result, false);

      const calls = consoleSpy.mock.calls.flat().join(" ");
      expect(calls).toContain("Comment Errors");
    });
  });

  describe("hasCriticalIssues", () => {
    it("returns true when critical issues exist", async () => {
      const { hasCriticalIssues } = await import("../../src/cli.js");

      const result = {
        prDetails: {
          number: 42,
          title: "Test",
          description: "",
          author: "",
          baseBranch: "",
          headBranch: "",
        },
        filesReviewed: 1,
        filesSkipped: 0,
        fileResults: [
          {
            filename: "test.ts",
            findings: [
              {
                line: 1,
                severity: "critical" as const,
                category: "security" as const,
                message: "Critical issue",
                suggestion: "Fix immediately",
              },
            ],
          },
        ],
        crossFileResult: {
          overallAssessment: "",
          findings: [],
          recommendations: [],
        },
        commentsCreated: 0,
        commentsUpdated: 0,
        commentsResolved: 0,
        commentErrors: [],
      };

      expect(hasCriticalIssues(result)).toBe(true);
    });

    it("returns false when no critical issues", async () => {
      const { hasCriticalIssues } = await import("../../src/cli.js");

      const result = {
        prDetails: {
          number: 42,
          title: "Test",
          description: "",
          author: "",
          baseBranch: "",
          headBranch: "",
        },
        filesReviewed: 1,
        filesSkipped: 0,
        fileResults: [
          {
            filename: "test.ts",
            findings: [
              {
                line: 1,
                severity: "medium" as const,
                category: "quality" as const,
                message: "Minor issue",
                suggestion: "Consider fixing",
              },
            ],
          },
        ],
        crossFileResult: {
          overallAssessment: "",
          findings: [],
          recommendations: [],
        },
        commentsCreated: 0,
        commentsUpdated: 0,
        commentsResolved: 0,
        commentErrors: [],
      };

      expect(hasCriticalIssues(result)).toBe(false);
    });
  });
});

describe("CLI Program", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("exports program for external use", async () => {
    const { program } = await import("../../src/cli.js");

    expect(program).toBeDefined();
    expect(program.name()).toBe("merge-mentor");
  });

  it("has review command configured", async () => {
    const { program } = await import("../../src/cli.js");

    const commands = program.commands.map((c) => c.name());
    expect(commands).toContain("review");
  });
});
