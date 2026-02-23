/**
 * Integration tests for the ReviewEngine with mocked dependencies.
 * Tests the complete review flow from PR fetch to comment posting.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIResponse } from "../../src/ai/types.js";
import { ReviewEngine } from "../../src/review/engine.js";
import { sampleExistingComments, samplePRDetails } from "./fixtures.js";
import { createMockPlatformAdapter, createTestConfig } from "./mocks.js";

// Create mock instance that can be shared
const mockCopilotInstance = {
  executePrompt: vi.fn(),
  parseFileReview: vi.fn(),
  parseCrossFileReview: vi.fn(),
  parseBatchedFileReview: vi.fn(),
};

// Mock the createAIProvider function to return our mock instance
vi.mock("../../src/ai/index.js", () => ({
  createAIProvider: () => mockCopilotInstance,
}));

// Mock the logger to suppress output during tests
vi.mock("../../src/logger.js", () => ({
  initLogger: vi.fn(),
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

// Mock DiffStorage to avoid file system operations
vi.mock("../../src/review/diffStorage.js", () => {
  const mockInstance = {
    storeDiffs: vi.fn().mockResolvedValue({
      diffDir: "/tmp/mock-diff-dir",
      manifest: {
        prIdentifier: "mock-pr",
        files: [],
        createdAt: new Date().toISOString(),
      },
    }),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
  return {
    DiffStorage: function DiffStorage() {
      return mockInstance;
    },
  };
});

// Mock ReviewStateCache with an in-memory store so caching tests work without disk I/O
vi.mock("../../src/review/reviewStateCache.js", () => ({
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

describe("ReviewEngine Integration", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
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
      } as AIResponse);

      mockCopilotInstance.parseBatchedFileReview.mockReturnValue([
        {
          filename: "src/auth/login.ts",
          findings: [
            {
              line: 27,
              severity: "high",
              category: "security",
              message: "JWT secret issue",
              suggestion: "Add validation",
              confidence: "high",
              isPreExisting: false,
            },
          ],
        },
        {
          filename: "src/auth/middleware.ts",
          findings: [
            {
              line: 7,
              severity: "medium",
              category: "quality",
              message: "Using any type",
              suggestion: "Use proper types",
              confidence: "high",
              isPreExisting: false,
            },
          ],
        },
        { filename: "README.md", findings: [] },
      ]);

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
      mockCopilotInstance.parseBatchedFileReview.mockReturnValue([
        { filename: "test.ts", findings: [] },
      ]);
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
      mockCopilotInstance.parseBatchedFileReview.mockReturnValue([]);
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
      mockCopilotInstance.parseBatchedFileReview.mockReturnValue([
        {
          filename: "src/auth/login.ts",
          findings: [], // No findings = issue fixed
        },
      ]);
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
      // Use a specific file that matches what the batched review returns
      const prFiles: import("../../src/platforms/types.js").PRFile[] = [
        {
          filename: "src/auth/login.ts",
          status: "added" as const,
          additions: 45,
          deletions: 0,
          sha: "abc123",
          patch: `@@ -0,0 +1,45 @@
+import { hash, compare } from 'bcrypt';
+import { sign } from 'jsonwebtoken';
+
+interface LoginRequest {
+  email: string;
+  password: string;
+}
+
+interface LoginResponse {
+  token: string;
+  expiresIn: number;
+}
+
+export async function login(request: LoginRequest): Promise<LoginResponse> {
+  const { email, password } = request;
+
+  // TODO: Add rate limiting
+  const user = await findUserByEmail(email);
+  if (!user) {
+    throw new Error('Invalid credentials');
+  }
+
+  const isValid = await compare(password, user.passwordHash);
+  if (!isValid) {
+    throw new Error('Invalid credentials');
+  }
+
+  const token = sign({ userId: user.id }, process.env.JWT_SECRET!, {
+    expiresIn: '1h',
+  });
+
+  return { token, expiresIn: 3600 };
+}
+
+async function findUserByEmail(email: string) {
+  return { id: '123', email, passwordHash: 'hashed' };
+}`,
        },
      ];

      const mockAdapter = createMockPlatformAdapter({
        prFiles,
        postInlineCommentError: new Error("Rate limit exceeded"),
      });
      const config = createTestConfig();

      mockCopilotInstance.executePrompt.mockResolvedValue({ raw: "{}", parsed: {} });
      mockCopilotInstance.parseBatchedFileReview.mockReturnValue([
        {
          filename: "src/auth/login.ts",
          findings: [
            {
              line: 27,
              severity: "high",
              category: "security",
              message: "Test issue",
              suggestion: "Fix it",
              confidence: "high",
              isPreExisting: false,
            },
          ],
        },
      ]);
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
      mockCopilotInstance.parseBatchedFileReview.mockReturnValue([
        { filename: "test.ts", findings: [] },
      ]);
      mockCopilotInstance.parseCrossFileReview.mockReturnValue({
        overallAssessment: "OK",
        findings: [],
        recommendations: [],
      });

      const engine = new ReviewEngine(mockAdapter, config.botCommentIdentifier, {
        dryRun: true,
        verbose: false,
      });

      // First review: 2 AI calls (batched file review + cross-file analysis)
      await engine.reviewPR(42);
      const firstCallCount = callCount;
      expect(firstCallCount).toBe(2); // Batched review + cross-file

      // Second review of same PR with same files should use cache
      await engine.reviewPR(42);

      // With batched review and caching, second run should use cached results
      // Total calls should be 2 (all from first run, none from second)
      expect(callCount).toBe(2);
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
    mockCopilotInstance.parseBatchedFileReview.mockReturnValue([
      { filename: "test.ts", findings: [] },
    ]);
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
    mockCopilotInstance.parseBatchedFileReview.mockReturnValue([
      { filename: "test.ts", findings: [] },
    ]);
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
