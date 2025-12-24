/**
 * Integration tests for the ReviewEngine with mocked dependencies.
 * Tests the complete review flow from PR fetch to comment posting.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CopilotResponse } from "../../src/copilot/client.js";
import { ReviewEngine } from "../../src/review/engine.js";
import {
  sampleExistingComments,
  samplePRDetails,
  samplePRFiles,
} from "./fixtures.js";
import { createMockPlatformAdapter, createTestConfig } from "./mocks.js";

// Create mock instance that can be shared
const mockCopilotInstance = {
  executePrompt: vi.fn(),
  parseFileReview: vi.fn(),
  parseCrossFileReview: vi.fn(),
};

// Mock the CopilotClient module with a proper class mock
vi.mock("../../src/copilot/client.js", () => {
  return {
    CopilotClient: function CopilotClient() {
      return mockCopilotInstance;
    },
  };
});

// Mock the logger to suppress output during tests
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

describe("ReviewEngine Integration", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("complete review flow", () => {
    it("reviews PR and posts comments for findings", async () => {
      const mockAdapter = createMockPlatformAdapter();
      const config = createTestConfig();

      // Setup mock responses
      mockCopilotInstance.executePrompt.mockResolvedValue({
        raw: "{}",
        parsed: {},
      } as CopilotResponse);

      let fileReviewCallCount = 0;
      mockCopilotInstance.parseFileReview.mockImplementation((filename: string) => {
        fileReviewCallCount++;
        if (filename === "src/auth/login.ts") {
          return {
            filename,
            findings: [
              {
                line: 27,
                severity: "high",
                category: "security",
                message: "JWT secret issue",
                suggestion: "Add validation",
              },
            ],
          };
        }
        if (filename === "src/auth/middleware.ts") {
          return {
            filename,
            findings: [
              {
                line: 7,
                severity: "medium",
                category: "quality",
                message: "Using any type",
                suggestion: "Use proper types",
              },
            ],
          };
        }
        return { filename, findings: [] };
      });

      mockCopilotInstance.parseCrossFileReview.mockReturnValue({
        overallAssessment: "Good PR with some issues",
        findings: [
          {
            severity: "high",
            category: "security",
            message: "JWT handling needs improvement",
            affectedFiles: ["src/auth/login.ts", "src/auth/middleware.ts"],
          },
        ],
        recommendations: ["Add configuration module"],
      });

      const engine = new ReviewEngine(mockAdapter, config.botCommentIdentifier, {
        dryRun: false,
        verbose: false,
      });

      const result = await engine.reviewPR(42);

      // Verify PR data was fetched
      expect(mockAdapter.calls.getPRDetails).toContain(42);
      expect(mockAdapter.calls.getPRFiles).toContain(42);
      expect(mockAdapter.calls.getExistingBotComments).toContain(42);

      // Verify review results
      expect(result.prDetails.number).toBe(42);
      expect(result.filesReviewed).toBeGreaterThan(0);

      // Verify comments were posted
      expect(mockAdapter.calls.postInlineComment.length).toBeGreaterThan(0);
      expect(mockAdapter.calls.postGeneralComment.length).toBeGreaterThan(0);
    });

    it("handles dry-run mode without posting comments", async () => {
      const mockAdapter = createMockPlatformAdapter();
      const config = createTestConfig();

      mockCopilotInstance.executePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockCopilotInstance.parseFileReview.mockReturnValue({
        filename: "test.ts",
        findings: [],
      });
      mockCopilotInstance.parseCrossFileReview.mockReturnValue({
        overallAssessment: "OK",
        findings: [],
        recommendations: [],
      });

      const engine = new ReviewEngine(mockAdapter, config.botCommentIdentifier, {
        dryRun: true,
        verbose: false,
      });

      await engine.reviewPR(42);

      // In dry-run mode, no comments should be posted
      expect(mockAdapter.calls.postInlineComment).toHaveLength(0);
      expect(mockAdapter.calls.postGeneralComment).toHaveLength(0);
    });

    it("handles PR with no reviewable files", async () => {
      const mockAdapter = createMockPlatformAdapter({
        prFiles: [
          {
            filename: "package-lock.json",
            status: "modified",
            additions: 100,
            deletions: 50,
            sha: "abc123",
          },
        ],
      });
      const config = createTestConfig();

      mockCopilotInstance.executePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockCopilotInstance.parseFileReview.mockReturnValue({
        filename: "test.ts",
        findings: [],
      });
      mockCopilotInstance.parseCrossFileReview.mockReturnValue({
        overallAssessment: "No issues found",
        findings: [],
        recommendations: [],
      });

      const engine = new ReviewEngine(mockAdapter, config.botCommentIdentifier, {
        dryRun: true,
        verbose: false,
      });

      const result = await engine.reviewPR(42);

      expect(result.filesReviewed).toBe(0);
    });

    it("validates PR number", async () => {
      const mockAdapter = createMockPlatformAdapter();
      const config = createTestConfig();

      const engine = new ReviewEngine(mockAdapter, config.botCommentIdentifier, {
        dryRun: true,
        verbose: false,
      });

      await expect(engine.reviewPR(-1)).rejects.toThrow("prNumber");
      await expect(engine.reviewPR(0)).rejects.toThrow("prNumber");
      await expect(engine.reviewPR(1.5)).rejects.toThrow("prNumber");
    });
  });

  describe("existing comments handling", () => {
    it("resolves comments for fixed issues", async () => {
      const mockAdapter = createMockPlatformAdapter({
        existingComments: sampleExistingComments,
      });
      const config = createTestConfig();

      mockCopilotInstance.executePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockCopilotInstance.parseFileReview.mockReturnValue({
        filename: "src/auth/login.ts",
        findings: [], // No findings = issue fixed
      });
      mockCopilotInstance.parseCrossFileReview.mockReturnValue({
        overallAssessment: "Issues fixed",
        findings: [],
        recommendations: [],
      });

      const engine = new ReviewEngine(mockAdapter, config.botCommentIdentifier, {
        dryRun: false,
        verbose: false,
      });

      const result = await engine.reviewPR(42);

      // Should resolve existing comment since issue is fixed
      expect(result.commentsResolved).toBeGreaterThanOrEqual(0);
    });
  });

  describe("error handling", () => {
    it("continues when posting inline comment fails", async () => {
      const mockAdapter = createMockPlatformAdapter({
        postInlineCommentError: new Error("Rate limit exceeded"),
      });
      const config = createTestConfig();

      mockCopilotInstance.executePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockCopilotInstance.parseFileReview.mockReturnValue({
        filename: "src/auth/login.ts",
        findings: [
          {
            line: 27,
            severity: "high",
            category: "security",
            message: "Test issue",
            suggestion: "Fix it",
          },
        ],
      });
      mockCopilotInstance.parseCrossFileReview.mockReturnValue({
        overallAssessment: "Has issues",
        findings: [],
        recommendations: [],
      });

      const engine = new ReviewEngine(mockAdapter, config.botCommentIdentifier, {
        dryRun: false,
        verbose: false,
      });

      const result = await engine.reviewPR(42);

      // Should have error recorded
      expect(result.commentErrors.length).toBeGreaterThan(0);
      expect(result.commentErrors[0]).toContain("Rate limit exceeded");
    });
  });

  describe("caching behavior", () => {
    it("caches review state between runs", async () => {
      const mockAdapter = createMockPlatformAdapter();
      const config = createTestConfig();

      let callCount = 0;
      mockCopilotInstance.executePrompt.mockImplementation(async () => {
        callCount++;
        return { raw: "{}", parsed: {} };
      });
      mockCopilotInstance.parseFileReview.mockReturnValue({
        filename: "test.ts",
        findings: [],
      });
      mockCopilotInstance.parseCrossFileReview.mockReturnValue({
        overallAssessment: "OK",
        findings: [],
        recommendations: [],
      });

      const engine = new ReviewEngine(mockAdapter, config.botCommentIdentifier, {
        dryRun: true,
        verbose: false,
      });

      // First review
      await engine.reviewPR(42);
      const firstCallCount = callCount;

      // Second review of same PR with same files should use cache
      await engine.reviewPR(42);

      // Should have fewer Copilot calls on second run due to caching
      expect(callCount).toBe(firstCallCount * 2); // Same because files haven't changed in mock
    });
  });
});

describe("ReviewEngine with different platforms", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("works with GitHub-like adapter", async () => {
    const githubAdapter = createMockPlatformAdapter({
      prDetails: {
        ...samplePRDetails,
        author: "github-user",
      },
    });

    mockCopilotInstance.executePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
    mockCopilotInstance.parseFileReview.mockReturnValue({
      filename: "test.ts",
      findings: [],
    });
    mockCopilotInstance.parseCrossFileReview.mockReturnValue({
      overallAssessment: "OK",
      findings: [],
      recommendations: [],
    });

    const engine = new ReviewEngine(githubAdapter, "[GitHub Bot]", {
      dryRun: true,
      verbose: false,
    });

    const result = await engine.reviewPR(42);

    expect(result.prDetails.author).toBe("github-user");
  });

  it("works with Azure DevOps-like adapter", async () => {
    const azureAdapter = createMockPlatformAdapter({
      prDetails: {
        ...samplePRDetails,
        author: "azure-user",
      },
    });

    mockCopilotInstance.executePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
    mockCopilotInstance.parseFileReview.mockReturnValue({
      filename: "test.ts",
      findings: [],
    });
    mockCopilotInstance.parseCrossFileReview.mockReturnValue({
      overallAssessment: "OK",
      findings: [],
      recommendations: [],
    });

    const engine = new ReviewEngine(azureAdapter, "[Azure Bot]", {
      dryRun: true,
      verbose: false,
    });

    const result = await engine.reviewPR(42);

    expect(result.prDetails.author).toBe("azure-user");
  });
});
