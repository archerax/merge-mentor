import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "./config.js";
import { generateMarkdownReport } from "./program.js";
import type { ReviewResult } from "./review/engine.js";

const mockReviewPR = vi.fn();
const mockAdapter = {
  getPRDetails: vi.fn(),
  getPRFiles: vi.fn(),
  getExistingBotComments: vi.fn(),
  postInlineComment: vi.fn(),
  postGeneralComment: vi.fn(),
  updateComment: vi.fn(),
  resolveComment: vi.fn(),
};

// Mock dependencies with factory functions
vi.mock("./config.js", () => ({
  loadConfig: vi.fn(),
  validateConfig: vi.fn(),
}));

vi.mock("./platforms/github.js", () => {
  return {
    GitHubAdapter: vi.fn(function GitHubAdapter() {
      return mockAdapter;
    }),
  };
});

vi.mock("./platforms/azure.js", () => {
  return {
    AzureDevOpsAdapter: vi.fn(function AzureDevOpsAdapter() {
      return mockAdapter;
    }),
  };
});

vi.mock("./review/engine.js", () => {
  return {
    ReviewEngine: vi.fn(function ReviewEngine() {
      return { reviewPR: mockReviewPR };
    }),
  };
});

// Import after mocks are set up
import { loadConfig, validateConfig } from "./config.js";
import { AzureDevOpsAdapter } from "./platforms/azure.js";
import { GitHubAdapter } from "./platforms/github.js";
import { displayResults, executeReview, hasCriticalIssues, type ReviewOptions } from "./program.js";
import { ReviewEngine } from "./review/engine.js";

function createMockConfig(overrides: Partial<Config> = {}): Config {
  return {
    defaultPlatform: "github" as const,
    github: { token: "gh-token", owner: "test-owner", repo: "test-repo" },
    azure: { token: "az-token", org: "test-org", project: "test-project", repo: "test-repo" },
    botCommentIdentifier: "[merge-mentor]",
    aiProvider: "copilot",
    copilotModel: "gpt-4",
    skipPreExisting: true,
    reviewRuns: 1,
    reviewType: "general",
    streamingEnabled: true,
    streamingLines: 5,
    ...overrides,
  };
}

function createMockReviewResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    prDetails: {
      number: 42,
      title: "Test PR",
      description: "Test description",
      author: "testuser",
      baseBranch: "main",
      headBranch: "feature/test",
    },
    filesReviewed: 3,
    fileResults: [
      {
        filename: "file1.ts",
        findings: [
          {
            severity: "medium",
            confidence: "high",
            category: "quality",
            message: "Issue 1",
            line: 10,
            suggestion: "Fix it",
            reasoning: "This issue affects code quality.",
          },
        ],
      },
      {
        filename: "file2.ts",
        findings: [
          {
            severity: "low",
            confidence: "high",
            category: "quality",
            message: "Issue 2",
            line: 20,
            suggestion: "Improve",
            reasoning: "This could be improved for better readability.",
          },
        ],
      },
    ],
    crossFileResult: {
      overallAssessment: "Good",
      findings: [],
      recommendations: [],
    },
    commentsCreated: 2,
    commentsUpdated: 1,
    commentsResolved: 0,
    commentErrors: [],
    filesSkipped: 0,
    ...overrides,
  };
}

describe("CLI", () => {
  let _consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    _consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    vi.mocked(loadConfig).mockReturnValue(createMockConfig());
    vi.mocked(validateConfig).mockImplementation(() => {});
    mockReviewPR.mockResolvedValue(createMockReviewResult());
  });

  describe("executeReview", () => {
    it("executes review with default GitHub platform in dry-run mode", async () => {
      const options: ReviewOptions = {
        pr: 42,
        write: false,
        verbose: true,
      };

      const result = await executeReview(options);

      expect(loadConfig).toHaveBeenCalled();
      expect(validateConfig).toHaveBeenCalledWith(expect.any(Object), "github");
      expect(GitHubAdapter).toHaveBeenCalled();
      expect(ReviewEngine).toHaveBeenCalledWith(
        expect.any(Object),
        "[merge-mentor]",
        "copilot",
        expect.objectContaining({
          dryRun: true,
          verbose: true,
          aiModel: "gpt-4",
          reviewRuns: 1,
        })
      );
      expect(mockReviewPR).toHaveBeenCalledWith(42);
      expect(result).toEqual({
        result: createMockReviewResult(),
        adapter: expect.any(Object),
        platform: "github",
      });
    });

    it("executes review with Azure platform", async () => {
      const options: ReviewOptions = {
        pr: 42,
        platform: "azure",
        write: false,
        verbose: true,
      };

      await executeReview(options);

      expect(validateConfig).toHaveBeenCalledWith(expect.any(Object), "azure");
      expect(AzureDevOpsAdapter).toHaveBeenCalled();
      expect(GitHubAdapter).not.toHaveBeenCalled();
    });

    it("executes review in write mode", async () => {
      const options: ReviewOptions = {
        pr: 42,
        write: true,
        verbose: false,
      };

      await executeReview(options);

      expect(ReviewEngine).toHaveBeenCalledWith(
        expect.any(Object),
        "[merge-mentor]",
        "copilot",
        expect.objectContaining({
          dryRun: false,
          verbose: false,
          aiModel: "gpt-4",
          reviewRuns: 1,
        })
      );
    });

    it("uses config default platform when not specified", async () => {
      vi.mocked(loadConfig).mockReturnValue(
        createMockConfig({ defaultPlatform: "azure" as const })
      );

      const options: ReviewOptions = {
        pr: 42,
        write: false,
        verbose: true,
      };

      await executeReview(options);

      expect(validateConfig).toHaveBeenCalledWith(expect.any(Object), "azure");
      expect(AzureDevOpsAdapter).toHaveBeenCalled();
      expect(GitHubAdapter).not.toHaveBeenCalled();
    });

    it("throws error for invalid platform", async () => {
      const options: ReviewOptions = {
        pr: 42,
        platform: "invalid",
        write: false,
        verbose: true,
      };

      await expect(executeReview(options)).rejects.toThrow(
        'Invalid platform "invalid". Must be "github" or "azure".'
      );
    });

    it("validates configuration for selected platform", async () => {
      const options: ReviewOptions = {
        pr: 42,
        platform: "github",
        write: false,
        verbose: true,
      };

      await executeReview(options);

      expect(validateConfig).toHaveBeenCalledWith(expect.any(Object), "github");
    });

    it("creates GitHub adapter when platform is github", async () => {
      const options: ReviewOptions = {
        pr: 42,
        platform: "github",
        write: false,
        verbose: true,
      };

      await executeReview(options);

      expect(GitHubAdapter).toHaveBeenCalledWith(createMockConfig());
    });

    it("creates Azure adapter when platform is azure", async () => {
      const options: ReviewOptions = {
        pr: 42,
        platform: "azure",
        write: false,
        verbose: true,
      };

      await executeReview(options);

      expect(AzureDevOpsAdapter).toHaveBeenCalledWith(createMockConfig());
    });

    it("logs starting message with dry-run label", async () => {
      const options: ReviewOptions = {
        pr: 42,
        write: false,
        verbose: true,
      };

      await executeReview(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Starting code review for PR #42")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("(dry-run)"));
    });

    it("logs starting message without dry-run label in write mode", async () => {
      const options: ReviewOptions = {
        pr: 42,
        write: true,
        verbose: true,
      };

      await executeReview(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Starting code review for PR #42")
      );
      const dryRunCalls = consoleLogSpy.mock.calls.filter((call: any[]) =>
        call[0]?.toString().includes("(dry-run)")
      );
      expect(dryRunCalls.length).toBe(0);
    });

    it("passes --runs option to ReviewEngine", async () => {
      const options: ReviewOptions = {
        pr: 42,
        write: false,
        verbose: true,
        runs: 3,
      };

      await executeReview(options);

      expect(ReviewEngine).toHaveBeenCalledWith(
        expect.any(Object),
        "[merge-mentor]",
        "copilot",
        expect.objectContaining({
          reviewRuns: 3,
        })
      );
    });

    it("uses config default for runs when --runs not specified", async () => {
      vi.mocked(loadConfig).mockReturnValue(createMockConfig({ reviewRuns: 2 }));

      const options: ReviewOptions = {
        pr: 42,
        write: false,
        verbose: true,
      };

      await executeReview(options);

      expect(ReviewEngine).toHaveBeenCalledWith(
        expect.any(Object),
        "[merge-mentor]",
        "copilot",
        expect.objectContaining({
          reviewRuns: 2,
        })
      );
    });

    it("passes skipPreExisting config to ReviewEngine", async () => {
      const customConfig = createMockConfig({
        skipPreExisting: false,
      });
      vi.mocked(loadConfig).mockReturnValue(customConfig);

      const options: ReviewOptions = {
        pr: 42,
        write: false,
        verbose: true,
      };

      await executeReview(options);

      expect(ReviewEngine).toHaveBeenCalledWith(
        expect.any(Object),
        "[merge-mentor]",
        "copilot",
        expect.objectContaining({
          skipPreExisting: false,
        })
      );
    });

    it("uses opencode provider when specified via --provider", async () => {
      vi.mocked(loadConfig).mockReturnValue(
        createMockConfig({
          opencodeModel: "claude-3.5-sonnet",
          opencodeTimeoutMs: 120000,
        })
      );

      const options: ReviewOptions = {
        pr: 42,
        provider: "opencode",
        write: false,
        verbose: true,
      };

      await executeReview(options);

      expect(ReviewEngine).toHaveBeenCalledWith(
        expect.any(Object),
        "[merge-mentor]",
        "opencode",
        expect.objectContaining({
          aiModel: "claude-3.5-sonnet",
          aiTimeoutMs: 120000,
        })
      );
    });

    it("uses cursor provider when specified via --provider", async () => {
      vi.mocked(loadConfig).mockReturnValue(
        createMockConfig({
          cursorModel: "gpt-5",
          cursorTimeoutMs: 180000,
        })
      );

      const options: ReviewOptions = {
        pr: 42,
        provider: "cursor",
        write: false,
        verbose: true,
      };

      await executeReview(options);

      expect(ReviewEngine).toHaveBeenCalledWith(
        expect.any(Object),
        "[merge-mentor]",
        "cursor",
        expect.objectContaining({
          aiModel: "gpt-5",
          aiTimeoutMs: 180000,
        })
      );
    });

    it("throws error for invalid provider", async () => {
      const options: ReviewOptions = {
        pr: 42,
        provider: "invalid",
        write: false,
        verbose: true,
      };

      await expect(executeReview(options)).rejects.toThrow(
        'Invalid AI provider "invalid". Must be "copilot", "opencode", or "cursor".'
      );
    });
  });

  describe("displayResults", () => {
    it("displays comprehensive review summary", () => {
      const result = createMockReviewResult();

      displayResults(result, true);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Review Complete"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("PR: #42 - Test PR"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Author: testuser"));
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Branch: feature/test → main")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Files Reviewed: 3"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Total Issues Found: 2"));
    });

    it("displays dry-run specific output", () => {
      const result = createMockReviewResult();

      displayResults(result, true);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Dry-run mode - showing what would be posted")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Comments to Create: 2"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Comments to Update: 1"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Comments to Resolve: 0"));
    });

    it("generates markdown report in dry-run mode with AI provider", () => {
      const result = createMockReviewResult();
      const mockAdapterWithId = {
        ...mockAdapter,
        getProjectIdentifier: () => "test-owner-test-repo",
      };

      displayResults(result, true, mockAdapterWithId as any, "github", "copilot");

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Detailed markdown report generated:")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Github-test-owner-test-repo-PR42-general-review-report.md")
      );
    });

    it("displays write mode specific output", () => {
      const result = createMockReviewResult();

      displayResults(result, false);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Comments Created: 2"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Comments Updated: 1"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Comments Resolved: 0"));
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Dry-run mode - showing what would be posted")
      );
    });

    it("generates markdown report in write mode with AI provider", () => {
      const result = createMockReviewResult();
      const mockAdapterWithId = {
        ...mockAdapter,
        getProjectIdentifier: () => "test-owner-test-repo",
      };

      displayResults(result, false, mockAdapterWithId as any, "github", "copilot");

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Detailed markdown report generated:")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Github-test-owner-test-repo-PR42-general-review-report.md")
      );
    });

    it("displays comment errors in write mode", () => {
      const result = createMockReviewResult({
        commentErrors: ["Failed to post comment on line 10", "Network error"],
      });

      displayResults(result, false);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Comment Errors: 2"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to post comment"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Network error"));
    });

    it("does not display comment errors when empty", () => {
      const result = createMockReviewResult();

      displayResults(result, false);

      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining("Comment Errors"));
    });

    it("calculates total issues correctly", () => {
      const result = createMockReviewResult({
        fileResults: [
          {
            filename: "file1.ts",
            findings: [
              {
                severity: "critical",
                confidence: "high",
                category: "security",
                message: "Issue 1",
                line: 1,
                suggestion: "Fix",
                reasoning: "Critical security issue that needs immediate attention.",
              },
              {
                severity: "high",
                confidence: "high",
                category: "quality",
                message: "Issue 2",
                line: 2,
                suggestion: "Fix",
                reasoning: "High priority quality issue.",
              },
            ],
          },
          {
            filename: "file2.ts",
            findings: [
              {
                severity: "medium",
                confidence: "high",
                category: "quality",
                message: "Issue 3",
                line: 3,
                suggestion: "Fix",
                reasoning: "Medium priority quality issue.",
              },
            ],
          },
        ],
      });

      displayResults(result, true);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Total Issues Found: 3"));
    });
  });

  describe("hasCriticalIssues", () => {
    it("returns true when critical issues exist", () => {
      const result = createMockReviewResult({
        fileResults: [
          {
            filename: "file1.ts",
            findings: [
              {
                severity: "critical",
                confidence: "high",
                category: "security",
                message: "Critical issue",
                line: 10,
                suggestion: "Fix now",
                reasoning: "This is a critical security vulnerability.",
              },
            ],
          },
        ],
      });

      expect(hasCriticalIssues(result)).toBe(true);
    });

    it("returns false when no critical issues exist", () => {
      const result = createMockReviewResult({
        fileResults: [
          {
            filename: "file1.ts",
            findings: [
              {
                severity: "high",
                confidence: "high",
                category: "quality",
                message: "High issue",
                line: 10,
                suggestion: "Fix",
                reasoning: "High priority issue.",
              },
              {
                severity: "medium",
                confidence: "high",
                category: "quality",
                message: "Medium issue",
                line: 20,
                suggestion: "Fix",
                reasoning: "Medium priority issue.",
              },
            ],
          },
        ],
      });

      expect(hasCriticalIssues(result)).toBe(false);
    });

    it("returns false when no findings exist", () => {
      const result = createMockReviewResult({
        fileResults: [
          {
            filename: "file1.ts",
            findings: [],
          },
        ],
      });

      expect(hasCriticalIssues(result)).toBe(false);
    });

    it("returns false when fileResults is empty", () => {
      const result = createMockReviewResult({
        fileResults: [],
      });

      expect(hasCriticalIssues(result)).toBe(false);
    });

    it("returns false when only cross-file findings have critical issues", () => {
      // Note: Current implementation only checks fileResults, not crossFileResult
      const result = createMockReviewResult({
        fileResults: [],
        crossFileResult: {
          overallAssessment: "Has critical issues",
          findings: [
            {
              severity: "critical",
              confidence: "high",
              category: "architecture",
              message: "Critical cross-file issue",
              reasoning: "Multiple modules are tightly coupled in a problematic way.",
              affectedFiles: ["file1.ts", "file2.ts"],
            },
          ],
          recommendations: [],
        },
      });

      expect(hasCriticalIssues(result)).toBe(false);
    });

    it("returns true when critical issues exist among multiple files", () => {
      const result = createMockReviewResult({
        fileResults: [
          {
            filename: "file1.ts",
            findings: [
              {
                severity: "medium",
                confidence: "high",
                category: "quality",
                message: "Medium",
                line: 1,
                suggestion: "Fix",
                reasoning: "Medium priority issue.",
              },
            ],
          },
          {
            filename: "file2.ts",
            findings: [
              {
                severity: "critical",
                confidence: "high",
                category: "security",
                message: "Critical",
                line: 2,
                suggestion: "Fix",
                reasoning: "Critical security vulnerability.",
              },
            ],
          },
          {
            filename: "file3.ts",
            findings: [
              {
                severity: "low",
                confidence: "high",
                category: "quality",
                message: "Low",
                line: 3,
                suggestion: "Fix",
                reasoning: "Low priority issue.",
              },
            ],
          },
        ],
      });

      expect(hasCriticalIssues(result)).toBe(true);
    });
  });

  describe("generateMarkdownReport", () => {
    it("generates a complete markdown report", () => {
      const result = createMockReviewResult({
        prDetails: {
          number: 123, // Override to use 123 for this specific test
          title: "Test PR",
          author: "test-author",
          headBranch: "feature/test",
          baseBranch: "main",
          description: "Test description",
        },
        filesReviewed: 2,
        filesSkipped: 1,
        fileResults: [
          {
            filename: "test.ts",
            findings: [
              {
                line: 10,
                severity: "high",
                confidence: "high",
                category: "bug",
                message: "Potential null pointer exception",
                suggestion: "Add null check",
                reasoning: "The variable may be null at this point and is not checked.",
              },
            ],
          },
        ],
        crossFileResult: {
          overallAssessment: "Code quality looks good overall",
          findings: [
            {
              severity: "medium",
              confidence: "high",
              category: "architecture",
              message: "Consider extracting common logic",
              reasoning: "Similar logic appears in multiple files.",
              affectedFiles: ["file1.ts", "file2.ts"],
            },
          ],
          recommendations: ["Use consistent naming", "Add more tests"],
        },
      });

      const report = generateMarkdownReport(result, "copilot", true);

      expect(report).toContain("# Code Review Report - PR #123");
      expect(report).toContain("**PR Title:** Test PR");
      expect(report).toContain("**Author:** test-author");
      expect(report).toContain("**AI Provider:** copilot");
      expect(report).toContain("- **Files Reviewed:** 2");
      expect(report).toContain("- **Files Skipped:** 1");
      expect(report).toContain("- **Total Issues Found:** 2");
      expect(report).toContain("## 📊 Review Summary");
      expect(report).toContain("### 📝 Planned Actions (Dry-Run)");
      expect(report).toContain("### Issues by Severity");
      expect(report).toContain("🟠 **High:** 1");
      expect(report).toContain("🟡 **Medium:** 1");
      expect(report).toContain("### Issues by Category");
      expect(report).toContain("🐛 **Bug:** 1");
      expect(report).toContain("🏗️ **Architecture:** 1");
      expect(report).toContain("## 📁 File-Specific Issues");
      expect(report).toContain("### `test.ts`");
      expect(report).toContain("#### 1. Line 10 🟠 🐛");
      expect(report).toContain("**Severity:** HIGH");
      expect(report).toContain("**Category:** bug");
      expect(report).toContain("**Issue:** Potential null pointer exception");
      expect(report).toContain("**Suggestion:** Add null check");
      expect(report).toContain("## 🔗 Cross-File Issues");
      expect(report).toContain("### 1. 🟡 🏗️ ARCHITECTURE");
      expect(report).toContain("**Affected Files:** `file1.ts`, `file2.ts`");
      expect(report).toContain("## 🎯 Overall Assessment");
      expect(report).toContain("Code quality looks good overall");
      expect(report).toContain("## 💡 Recommendations");
      expect(report).toContain("1. Use consistent naming");
      expect(report).toContain("2. Add more tests");
    });

    it("handles empty results gracefully", () => {
      const result = createMockReviewResult({
        fileResults: [],
        crossFileResult: {
          overallAssessment: "",
          findings: [],
          recommendations: [],
        },
      });

      const report = generateMarkdownReport(result, "opencode", true);

      expect(report).toContain("# Code Review Report - PR #42"); // Use the actual PR number from mock
      expect(report).toContain("**AI Provider:** opencode");
      expect(report).toContain("- **Total Issues Found:** 0");
      expect(report).not.toContain("## 📁 File-Specific Issues");
      expect(report).not.toContain("## 🔗 Cross-File Issues");
      expect(report).not.toContain("## 🎯 Overall Assessment");
      expect(report).not.toContain("## 💡 Recommendations");
    });

    it("generates a report with correct header for non-dry-run mode", () => {
      const result = createMockReviewResult({});
      const report = generateMarkdownReport(result, "cursor", false);

      expect(report).toContain("### 📝 Review Actions");
      expect(report).not.toContain("### 📝 Planned Actions (Dry-Run)");
    });
  });
});
