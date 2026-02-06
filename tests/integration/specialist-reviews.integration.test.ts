/**
 * Integration tests for specialist review modes.
 * Tests the complete flow from CLI to review execution with specialized prompts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PRFile } from "../../src/platforms/types.js";

// Create mock instances
const mockGitHubAdapter = {
  getProjectIdentifier: vi.fn().mockReturnValue("test-project"),
  getPRDetails: vi.fn().mockResolvedValue({
    number: 42,
    title: "Add test coverage",
    description: "Adds unit tests for user service",
    author: "test-author",
    baseBranch: "main",
    headBranch: "feature/testing",
  }),
  getPRFiles: vi.fn().mockResolvedValue([]),
  getExistingBotComments: vi.fn().mockResolvedValue([]),
  postInlineComment: vi.fn().mockResolvedValue(undefined),
  postGeneralComment: vi.fn().mockResolvedValue(undefined),
  updateComment: vi.fn().mockResolvedValue(undefined),
  resolveComment: vi.fn().mockResolvedValue(undefined),
};

// Mock AI provider
let mockFileResults: any[] = [];

const mockAIProvider = {
  executePrompt: vi.fn().mockResolvedValue({
    output: JSON.stringify({
      findings: [],
      summary: "Looks good",
    }),
  }),
  parseFileReview: vi.fn().mockReturnValue({
    findings: [],
    resolvedComments: [],
    summary: "Looks good",
  }),
  parseBatchedFileReview: vi.fn().mockImplementation(() => {
    // Return mock file results set by individual tests
    return mockFileResults.length > 0
      ? mockFileResults
      : [
          {
            filename: "default-file.ts",
            findings: [],
            resolvedComments: [],
            summary: "Looks good",
          },
        ];
  }),
  parseCrossFileReview: vi.fn().mockReturnValue({
    overallAssessment: "Good test coverage",
    findings: [],
    recommendations: [],
  }),
};

// Mock factories
vi.mock("../../src/platforms/github.js", () => ({
  GitHubAdapter: function GitHubAdapter() {
    return mockGitHubAdapter;
  },
}));

vi.mock("../../src/ai/providerFactory.js", () => ({
  createAIProvider: vi.fn().mockReturnValue(mockAIProvider),
}));

// Mock config with all required fields
vi.mock("../../src/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    defaultPlatform: "github",
    platform: "github",
    githubToken: "test-token",
    githubRepo: "test/repo",
    github: {
      token: "test-token",
      repoOwner: "test",
      repoName: "repo",
    },
    azure: {
      token: "test-token",
      organization: "test-org",
      project: "test-project",
      repository: "test-repo",
    },
    aiProvider: "copilot",
    copilotModel: "gpt-4o",
    copilotTimeoutMs: 120000,
    opencodeModel: "gpt-4o",
    opencodeTimeoutMs: 120000,
    cursorModel: "gpt-4o",
    cursorTimeoutMs: 120000,
    copilotToken: undefined,
    botCommentIdentifier: "merge-mentor-test",
    skipPreExisting: false,
    reviewRuns: 1,
    reviewType: "general",
    streamingEnabled: true,
    streamingLines: 5,
    reviewEngineOptions: {
      minConfidence: "medium",
      postGeneralComments: true,
      skipCrossFileAnalysis: false,
      skipExistingIssueCheck: false,
      skipResolutionComments: false,
    },
  }),
  validateConfig: vi.fn(),
}));

describe("Specialist Reviews Integration", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.clearAllMocks();
    mockFileResults = []; // Reset mock file results
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
    mockFileResults = []; // Reset mock file results
  });

  describe("Testing Review Mode", () => {
    describe("C# test file review", () => {
      it("reviews C# test file with specialized testing prompts", async () => {
        const csharpTestFiles: PRFile[] = [
          {
            filename: "src/Services/UserService.cs",
            status: "modified",
            additions: 15,
            deletions: 5,
            sha: "abc123",
            patch: "@@ -1,5 +1,15 @@\n+public class UserService { }",
          },
          {
            filename: "tests/UserServiceTests.cs",
            status: "modified",
            additions: 30,
            deletions: 0,
            sha: "def456",
            patch: "@@ -1,0 +1,30 @@\n+[Fact]\n+public void TestMethod() { }",
          },
        ];

        mockGitHubAdapter.getPRFiles.mockResolvedValue(csharpTestFiles);

        // Set up mock results for each file
        mockFileResults = csharpTestFiles.map((file) => ({
          filename: file.filename,
          findings: [],
          resolvedComments: [],
          summary: "Looks good",
        }));

        const { executeReview } = await import("../../src/program.js");

        const result = await executeReview({
          pr: 42,
          platform: "github",
          reviewType: "testing",
          write: false,
          verbose: false,
        });

        expect(result).toBeDefined();
        expect(mockAIProvider.executePrompt).toHaveBeenCalled();

        // Verify testing-specific prompt was used
        const promptCalls = mockAIProvider.executePrompt.mock.calls;
        const testingPromptCall = promptCalls.find((call) =>
          call[0].includes("Test Quality Expert")
        );
        expect(testingPromptCall).toBeDefined();
        expect(testingPromptCall?.[0]).toContain("C# TESTING STANDARDS");
        expect(testingPromptCall?.[0]).toContain("xUnit, NUnit, or MSTest");
      });
    });

    describe("TypeScript test file review", () => {
      it("reviews TypeScript test file with specialized testing prompts", async () => {
        const tsTestFiles: PRFile[] = [
          {
            filename: "src/services/UserService.ts",
            status: "modified",
            additions: 20,
            deletions: 5,
            sha: "abc123",
            patch: "@@ -1,5 +1,20 @@\n+export class UserService { }",
          },
          {
            filename: "src/services/UserService.test.ts",
            status: "modified",
            additions: 40,
            deletions: 0,
            sha: "def456",
            patch: "@@ -1,0 +1,40 @@\n+describe('UserService', () => { })",
          },
        ];

        mockGitHubAdapter.getPRFiles.mockResolvedValue(tsTestFiles);

        // Set up mock results for each file
        mockFileResults = tsTestFiles.map((file) => ({
          filename: file.filename,
          findings: [],
          resolvedComments: [],
          summary: "Looks good",
        }));

        const { executeReview } = await import("../../src/program.js");

        const result = await executeReview({
          pr: 42,
          platform: "github",
          reviewType: "testing",
          write: false,
          verbose: false,
        });

        expect(result).toBeDefined();
        expect(mockAIProvider.executePrompt).toHaveBeenCalled();

        // Verify testing-specific prompt was used
        const promptCalls = mockAIProvider.executePrompt.mock.calls;
        const testingPromptCall = promptCalls.find((call) =>
          call[0].includes("Test Quality Expert")
        );
        expect(testingPromptCall).toBeDefined();
        expect(testingPromptCall?.[0]).toContain("TYPESCRIPT TESTING STANDARDS");
        expect(testingPromptCall?.[0]).toContain("Vitest");
      });
    });

    describe("production file without tests", () => {
      it("flags production file without associated test file", async () => {
        const prodOnlyFiles: PRFile[] = [
          {
            filename: "src/services/OrderService.ts",
            status: "added",
            additions: 50,
            deletions: 0,
            sha: "abc123",
            patch: "@@ -1,0 +1,50 @@\n+export class OrderService { }",
          },
        ];

        mockGitHubAdapter.getPRFiles.mockResolvedValue(prodOnlyFiles);

        // Set up mock results with finding for missing test coverage
        mockFileResults = [
          {
            filename: "src/services/OrderService.ts",
            findings: [
              {
                line: 1,
                severity: "medium" as const,
                confidence: "high" as const,
                category: "testing" as const,
                message: "Missing test coverage for new production file",
                suggestion: "Add tests for OrderService",
                reasoning: "No test file found for this production code",
              },
            ],
            resolvedComments: [],
            summary: "Missing test coverage",
          },
        ];

        const { executeReview } = await import("../../src/program.js");

        const result = await executeReview({
          pr: 42,
          platform: "github",
          reviewType: "testing",
          write: false,
          verbose: false,
        });

        expect(result).toBeDefined();
        expect(result.result.fileResults[0].findings).toHaveLength(1);
        expect(result.result.fileResults[0].findings[0].category).toBe("testing");
        expect(result.result.fileResults[0].findings[0].message).toContain("test coverage");
      });
    });

    describe("cross-file testing analysis", () => {
      it("performs holistic test coverage analysis", async () => {
        const mixedFiles: PRFile[] = [
          {
            filename: "src/UserService.ts",
            status: "modified",
            additions: 10,
            deletions: 5,
            sha: "abc123",
            patch: "@@ -1,5 +1,10 @@\n+export class UserService { }",
          },
          {
            filename: "src/UserService.test.ts",
            status: "modified",
            additions: 20,
            deletions: 0,
            sha: "def456",
            patch: "@@ -1,0 +1,20 @@\n+test('works', () => { })",
          },
          {
            filename: "src/OrderService.ts",
            status: "added",
            additions: 30,
            deletions: 0,
            sha: "ghi789",
            patch: "@@ -1,0 +1,30 @@\n+export class OrderService { }",
          },
        ];

        mockGitHubAdapter.getPRFiles.mockResolvedValue(mixedFiles);

        // Set up mock results for each file
        mockFileResults = mixedFiles.map((file) => ({
          filename: file.filename,
          findings: [],
          resolvedComments: [],
          summary: "Looks good",
        }));

        const { executeReview } = await import("../../src/program.js");

        const result = await executeReview({
          pr: 42,
          platform: "github",
          reviewType: "testing",
          write: false,
          verbose: false,
        });

        expect(result).toBeDefined();

        // Verify cross-file analysis was performed
        const promptCalls = mockAIProvider.executePrompt.mock.calls;
        const crossFileCall = promptCalls.find((call) =>
          call[0].includes("holistic test coverage analysis")
        );
        expect(crossFileCall).toBeDefined();
        expect(crossFileCall?.[0]).toContain("TEST COVERAGE ANALYSIS");
        expect(crossFileCall?.[0]).toContain("Coverage Statistics");
      });
    });
  });

  describe("CLI Flag Integration", () => {
    describe("review-type flag", () => {
      it("accepts testing review type", async () => {
        const { executeReview } = await import("../../src/program.js");

        const result = await executeReview({
          pr: 42,
          platform: "github",
          reviewType: "testing",
          write: false,
          verbose: false,
        });

        expect(result).toBeDefined();
      });

      it("accepts general review type", async () => {
        const { executeReview } = await import("../../src/program.js");

        const result = await executeReview({
          pr: 42,
          platform: "github",
          reviewType: "general",
          write: false,
          verbose: false,
        });

        expect(result).toBeDefined();
      });

      it("defaults to general when review-type not provided", async () => {
        const { executeReview } = await import("../../src/program.js");

        const result = await executeReview({
          pr: 42,
          platform: "github",
          write: false,
          verbose: false,
        });

        expect(result).toBeDefined();
        // Should use general review prompts by default
      });

      it("defaults to general for invalid review types", async () => {
        const { executeReview } = await import("../../src/program.js");

        // Invalid review type should default to "general"
        const result = await executeReview({
          pr: 42,
          platform: "github",
          reviewType: "invalid" as any,
          write: false,
          verbose: false,
        });

        expect(result).toBeDefined();

        // Verify it used general prompts, not testing prompts
        const promptCalls = mockAIProvider.executePrompt.mock.calls;
        const hasTestingPrompt = promptCalls.some((call) =>
          call[0].includes("Test Quality Expert")
        );
        expect(hasTestingPrompt).toBe(false);
      });
    });

    describe("review-type with multi-run mode", () => {
      it("works with --runs flag for testing reviews", async () => {
        const { executeReview } = await import("../../src/program.js");

        const result = await executeReview({
          pr: 42,
          platform: "github",
          reviewType: "testing",
          runs: 2,
          write: false,
          verbose: false,
        });

        expect(result).toBeDefined();
        // Verify multiple runs were executed
        const executePromptCalls = mockAIProvider.executePrompt.mock.calls.length;
        expect(executePromptCalls).toBeGreaterThan(1);
      });

      it("works with --runs flag for general reviews", async () => {
        const { executeReview } = await import("../../src/program.js");

        const result = await executeReview({
          pr: 42,
          platform: "github",
          reviewType: "general",
          runs: 3,
          write: false,
          verbose: false,
        });

        expect(result).toBeDefined();
      });
    });
  });

  describe("Testing Categories in Reports", () => {
    it("includes testing category in findings", async () => {
      const testFiles: PRFile[] = [
        {
          filename: "src/service.test.ts",
          status: "modified",
          additions: 20,
          deletions: 0,
          sha: "abc123",
          patch: "@@ -1,0 +1,20 @@\n+test('works', () => { })",
        },
      ];

      mockGitHubAdapter.getPRFiles.mockResolvedValue(testFiles);

      // Set up mock results with testing category finding
      mockFileResults = [
        {
          filename: "src/service.test.ts",
          findings: [
            {
              line: 10,
              severity: "medium" as const,
              confidence: "high" as const,
              category: "testing" as const,
              message: "Test lacks edge case coverage",
              suggestion: "Add test for null input",
              reasoning: "No test for null case",
            },
          ],
          resolvedComments: [],
          summary: "Missing edge case tests",
        },
      ];

      const { executeReview } = await import("../../src/program.js");

      const result = await executeReview({
        pr: 42,
        platform: "github",
        reviewType: "testing",
        write: false,
        verbose: false,
      });

      expect(result).toBeDefined();
      expect(result.result.fileResults[0].findings[0].category).toBe("testing");

      // Verify display shows testing category
      const { displayResults } = await import("../../src/program.js");
      displayResults(result.result, true);

      const output = consoleSpy.mock.calls.flat().join(" ");
      expect(output).toContain("testing");
    });
  });

  describe("Backward Compatibility", () => {
    it("maintains compatibility when no review-type specified", async () => {
      const standardFiles: PRFile[] = [
        {
          filename: "src/app.ts",
          status: "modified",
          additions: 10,
          deletions: 5,
          sha: "abc123",
          patch: "@@ -1,5 +1,10 @@\n+const x = 1;",
        },
      ];

      mockGitHubAdapter.getPRFiles.mockResolvedValue(standardFiles);

      // Set up mock results for the file
      mockFileResults = standardFiles.map((file) => ({
        filename: file.filename,
        findings: [],
        resolvedComments: [],
        summary: "Looks good",
      }));

      const { executeReview } = await import("../../src/program.js");

      const result = await executeReview({
        pr: 42,
        platform: "github",
        write: false,
        verbose: false,
      });

      expect(result).toBeDefined();

      // Should use general prompts, not testing prompts
      const promptCalls = mockAIProvider.executePrompt.mock.calls;
      const hasTestingPrompt = promptCalls.some((call) => call[0].includes("Test Quality Expert"));
      expect(hasTestingPrompt).toBe(false);
    });

    it("supports all existing CLI flags without review-type", async () => {
      const { executeReview } = await import("../../src/program.js");

      const result = await executeReview({
        pr: 42,
        platform: "github",
        write: true,
        verbose: true,
        runs: 2,
      });

      expect(result).toBeDefined();
    });
  });
});
