import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { resolveReviewProfile } from "../review/reviewSelection.js";
import { AzureDevOpsAdapter } from "./azure.js";

const mockWitApiInstance = {
  getWorkItem: vi.fn(),
  getComments: vi.fn(),
  addComment: vi.fn(),
  updateComment: vi.fn(),
  vsoClient: {
    getVersioningData: vi.fn(),
  },
  rest: {
    create: vi.fn(),
    update: vi.fn(),
  },
  createRequestOptions: vi.fn(),
};

const mockGitApiInstance = {
  getPullRequestById: vi.fn(),
  getPullRequestIterations: vi.fn(),
  getPullRequestIterationChanges: vi.fn(),
  getFileDiffs: vi.fn(),
  getThreads: vi.fn(),
  createThread: vi.fn(),
  getItemText: vi.fn(),
  getBlobContent: vi.fn(),
  getItem: vi.fn(),
  getPullRequestWorkItemRefs: vi.fn(),
  createComment: vi.fn(),
  updateThread: vi.fn(),
};

vi.mock("azure-devops-node-api", () => ({
  WebApi: class {
    async getGitApi() {
      return mockGitApiInstance;
    }
    async getWorkItemTrackingApi() {
      return mockWitApiInstance;
    }
  },
  getPersonalAccessTokenHandler: vi.fn(() => ({})),
}));

// Mock fetch for REST API calls
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Helper to create mock Response
function createMockResponse(ok: boolean, status: number, data: unknown) {
  return Promise.resolve({
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => data,
    text: async () => JSON.stringify(data),
  });
}

function createTestConfig(): Config {
  const reviewProfile = resolveReviewProfile({ reviewType: "general" });

  return {
    defaultPlatform: "azure",
    github: {
      token: "",
      owner: "",
      repo: "",
    },
    azure: {
      token: "test-token",
      org: "test-org",
      project: "test-project",
      repo: "test-repo",
    },
    botCommentIdentifier: "<!-- merge-mentor -->",
    aiProvider: "copilot-sdk",
    gitBackend: "cli",
    skipPreExisting: true,
    reviewType: "general",
    reviewPasses: reviewProfile.passes,
    reviewStrategy: reviewProfile.strategy,
    reviewProfile,
    streamingEnabled: true,
    streamingLines: 5,
    tempPath: "./.mergementor",
    longContext: false,
    experimentalTools: false,
    verifyPbi: false,
  };
}

describe("AzureDevOpsAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getPlatformName", () => {
    it("returns azure", () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      expect(adapter.getPlatformName()).toBe("azure");
    });
  });

  describe("getPRDetails", () => {
    it("retrieves PR details successfully", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: 123,
        title: "Test PR",
        description: "Test description",
        createdBy: { displayName: "Test User" },
        targetRefName: "refs/heads/main",
        sourceRefName: "refs/heads/feature",
      });

      const result = await adapter.getPRDetails(123);

      expect(result).toEqual({
        number: 123,
        title: "Test PR",
        description: "Test description",
        author: "Test User",
        baseBranch: "main",
        headBranch: "feature",
      });
    });

    it("handles missing optional fields", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: null,
        title: null,
        description: null,
        createdBy: null,
        targetRefName: null,
        sourceRefName: null,
      });

      const result = await adapter.getPRDetails(123);

      expect(result).toEqual({
        number: 123,
        title: "",
        description: "",
        author: "unknown",
        baseBranch: "",
        headBranch: "",
      });
    });
  });

  describe("getPRFiles", () => {
    it("retrieves PR files successfully", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      // Mock getPullRequestById to return repository ID
      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: 123,
        repository: { id: "repo-uuid-123" },
      });

      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([
        {
          id: 1,
          sourceRefCommit: { commitId: "source123" },
          commonRefCommit: { commitId: "base123" },
        },
        {
          id: 2,
          sourceRefCommit: { commitId: "source456" },
          commonRefCommit: { commitId: "base456" },
        },
      ]);

      // Mock fetch for PR Iteration Changes API (changeEntries with numeric changeType)
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          changeEntries: [
            {
              item: {
                path: "/src/test.ts",
                objectId: "obj123",
                gitObjectType: "blob",
              },
              changeType: 2, // Edit
            },
            {
              item: {
                path: "/README.md",
                objectId: "obj456",
                gitObjectType: "blob",
              },
              changeType: 1, // Add
            },
          ],
        })
      );

      // Mock fetch for Items API (file contents)
      // First call: base version of src/test.ts
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          content: "const x = 1;\nconst y = 2;\nconst z = 3;\n",
        })
      );

      // Second call: target version of src/test.ts
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          content:
            "const x = 1;\nconst y = 2;\nconst z = 3;\nconst updated = 4;\nconst newVar = 5;\n",
        })
      );

      // Third call: target version of README.md (no base version fetch for added files)
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          content:
            "# README\n\nThis is a test file.\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\n",
        })
      );

      const result = await adapter.getPRFiles(123);

      expect(result).toHaveLength(2);
      expect(result[0].filename).toBe("src/test.ts");
      expect(result[0].status).toBe("modified");
      expect(result[0].patch).toContain("diff --git");
      expect(result[0].patch).toContain("@@");
      expect(result[0].patch).toContain("+const updated = 4;");
      expect(result[0].additions).toBe(2);
      expect(result[0].deletions).toBe(0);

      expect(result[1].filename).toBe("README.md");
      expect(result[1].status).toBe("added");
      expect(result[1].patch).toContain("diff --git");
      expect(result[1].patch).toContain("@@");
      expect(result[1].patch).toContain("+# README");
      expect(result[1].additions).toBeGreaterThan(0);
      expect(result[1].deletions).toBe(0);
    });

    it("handles empty iterations", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([]);

      const result = await adapter.getPRFiles(123);

      expect(result).toEqual([]);
    });

    it("handles null iterations", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue(null);

      const result = await adapter.getPRFiles(123);

      expect(result).toEqual([]);
    });

    it("handles missing iteration id", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: 123,
        repository: { id: "repo-uuid-123" },
      });

      // Missing id field returns empty result
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([
        {
          sourceRefCommit: { commitId: "source123" },
          commonRefCommit: { commitId: "base123" },
        },
      ]);

      const result = await adapter.getPRFiles(123);

      expect(result).toEqual([]);
    });

    it("skips changes without item path", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: 123,
        repository: { id: "repo-uuid-123" },
      });

      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([
        {
          id: 1,
          sourceRefCommit: { commitId: "source123" },
          commonRefCommit: { commitId: "base123" },
        },
      ]);

      // Mock PR Iteration Changes API to return changes with invalid items
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          changeEntries: [
            { item: null },
            { item: { path: null } },
            {
              item: {
                path: "/valid.ts",
                objectId: "obj789",
                gitObjectType: "blob",
              },
              changeType: 2, // Edit
            },
          ],
        })
      );

      // Mock Items API for base version
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          content: "const x = 1;",
        })
      );

      // Mock Items API for target version
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          content: "const x = 1;",
        })
      );

      const result = await adapter.getPRFiles(123);

      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe("valid.ts");

      consoleWarnSpy.mockRestore();
    });

    it("handles missing changeEntries", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: 123,
        repository: { id: "repo-uuid-123" },
      });

      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([
        {
          id: 1,
          sourceRefCommit: { commitId: "source123" },
          commonRefCommit: { commitId: "base123" },
        },
      ]);

      mockFetch.mockImplementationOnce(() => createMockResponse(true, 200, {}));

      const result = await adapter.getPRFiles(123);

      expect(result).toEqual([]);
    });

    it("handles null changeEntries", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: 123,
        repository: { id: "repo-uuid-123" },
      });

      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([
        {
          id: 1,
          sourceRefCommit: { commitId: "source123" },
          commonRefCommit: { commitId: "base123" },
        },
      ]);

      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, { changeEntries: null })
      );

      const result = await adapter.getPRFiles(123);

      expect(result).toEqual([]);
    });

    it("maps all change types correctly", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: 123,
        repository: { id: "repo-uuid-123" },
      });

      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([
        {
          id: 1,
          sourceRefCommit: { commitId: "source123" },
          commonRefCommit: { commitId: "base123" },
        },
      ]);

      // Mock PR Iteration Changes API with different change types (numeric)
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          changeEntries: [
            {
              item: {
                path: "/added.ts",
                objectId: "a1",
                gitObjectType: "blob",
              },
              changeType: 1, // Add
            },
            {
              item: {
                path: "/modified.ts",
                objectId: "m1",
                gitObjectType: "blob",
              },
              changeType: 2, // Edit
            },
            {
              item: {
                path: "/renamed.ts",
                objectId: "r1",
                gitObjectType: "blob",
              },
              changeType: 8, // Rename
            },
            {
              item: {
                path: "/deleted.ts",
                objectId: "d1",
                gitObjectType: "blob",
              },
              changeType: 16, // Delete
            },
            {
              item: {
                path: "/unknown.ts",
                objectId: "u1",
                gitObjectType: "blob",
              },
              changeType: 999, // Unknown - should default to modified
            },
          ],
        })
      );

      // Mock Items API for each file
      // added.ts - no base (added), has target
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, { content: "// Added content" })
      );

      // modified.ts - has base and target
      mockFetch.mockImplementationOnce(() => createMockResponse(true, 200, { content: "// Base" }));
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, { content: "// Modified" })
      );

      // renamed.ts - has base and target
      mockFetch.mockImplementationOnce(() => createMockResponse(true, 200, { content: "// Base" }));
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, { content: "// Renamed" })
      );

      // deleted.ts - has base, no target (deleted)
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, { content: "// Deleted content" })
      );

      // unknown.ts - treat as modified (has base and target)
      mockFetch.mockImplementationOnce(() => createMockResponse(true, 200, { content: "// Base" }));
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, { content: "// Unknown" })
      );

      const result = await adapter.getPRFiles(123);

      expect(result[0].status).toBe("added");
      expect(result[1].status).toBe("modified");
      expect(result[2].status).toBe("renamed");
      expect(result[3].status).toBe("deleted");
      expect(result[4].status).toBe("modified");

      consoleWarnSpy.mockRestore();
    });

    it("handles pagination when there are more files than page size", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: 123,
        repository: { id: "repo-uuid-123" },
      });

      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([
        {
          id: 1,
          sourceRefCommit: { commitId: "source123" },
          commonRefCommit: { commitId: "base123" },
        },
      ]);

      // Generate 150 files to test pagination (page size is 100)
      const firstPageChanges = Array.from({ length: 100 }, (_, i) => ({
        item: {
          path: `/src/file${i}.ts`,
          objectId: `obj${i}`,
          gitObjectType: "blob",
        },
        changeType: 2, // Edit (numeric)
      }));

      const secondPageChanges = Array.from({ length: 50 }, (_, i) => ({
        item: {
          path: `/src/file${100 + i}.ts`,
          objectId: `obj${100 + i}`,
          gitObjectType: "blob",
        },
        changeType: 2, // Edit (numeric)
      }));

      // First page - returns 100 items (signals more pages exist)
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          changeEntries: firstPageChanges,
        })
      );

      // Second page - returns 50 items (less than page size, signals end)
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          changeEntries: secondPageChanges,
        })
      );

      // Mock Items API calls for all 150 files (base + target for each modified file)
      // Each file needs 2 fetch calls: base version and target version
      for (let i = 0; i < 150; i++) {
        // Base version
        mockFetch.mockImplementationOnce(() =>
          createMockResponse(true, 200, {
            content: `// Base content for file${i}`,
          })
        );
        // Target version
        mockFetch.mockImplementationOnce(() =>
          createMockResponse(true, 200, {
            content: `// Modified content for file${i}`,
          })
        );
      }

      const result = await adapter.getPRFiles(123);

      // Should have all 150 files
      expect(result).toHaveLength(150);
      expect(result[0].filename).toBe("src/file0.ts");
      expect(result[99].filename).toBe("src/file99.ts");
      expect(result[100].filename).toBe("src/file100.ts");
      expect(result[149].filename).toBe("src/file149.ts");

      // Verify pagination URLs were called with correct parameters
      // First call: $skip=0, $top=100
      expect(mockFetch.mock.calls[0][0]).toContain("$top=100");
      expect(mockFetch.mock.calls[0][0]).toContain("$skip=0");

      // Second call: $skip=100, $top=100
      expect(mockFetch.mock.calls[1][0]).toContain("$top=100");
      expect(mockFetch.mock.calls[1][0]).toContain("$skip=100");
    });

    it("stops pagination when receiving empty page", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: 123,
        repository: { id: "repo-uuid-123" },
      });

      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([
        {
          id: 1,
          sourceRefCommit: { commitId: "source123" },
          commonRefCommit: { commitId: "base123" },
        },
      ]);

      // Return exactly 100 files on first page
      const firstPageChanges = Array.from({ length: 100 }, (_, i) => ({
        item: {
          path: `/src/file${i}.ts`,
          objectId: `obj${i}`,
          gitObjectType: "blob",
        },
        changeType: 1, // Add (numeric)
      }));

      // First page - returns exactly 100 items
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          changeEntries: firstPageChanges,
        })
      );

      // Second page - returns empty (edge case: exactly 100 files total)
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          changeEntries: [],
        })
      );

      // Mock Items API calls for all 100 files (target only for added files)
      for (let i = 0; i < 100; i++) {
        mockFetch.mockImplementationOnce(() =>
          createMockResponse(true, 200, { content: `// Content for file${i}` })
        );
      }

      const result = await adapter.getPRFiles(123);

      // Should have all 100 files
      expect(result).toHaveLength(100);

      // Should have made 2 pagination calls (first page + second empty page)
      const paginationCalls = mockFetch.mock.calls.filter((call) => call[0].includes("/changes?"));
      expect(paginationCalls).toHaveLength(2);
    });
  });

  describe("getExistingBotComments", () => {
    it("retrieves bot comments successfully", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getThreads.mockResolvedValue([
        {
          id: 1,
          comments: [{ content: "<!-- merge-mentor -->\nComment 1" }],
          threadContext: {
            filePath: "/src/test.ts",
            rightFileStart: { line: 10 },
          },
          status: 1, // ACTIVE
        },
        {
          id: 2,
          comments: [{ content: "Regular comment" }],
        },
        {
          id: 3,
          comments: [{ content: "<!-- merge-mentor -->\nComment 2" }],
          status: 2, // FIXED
        },
      ]);

      const result = await adapter.getExistingBotComments(123);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "1",
        body: "<!-- merge-mentor -->\nComment 1",
        path: "/src/test.ts",
        line: 10,
        isResolved: false,
      });
      expect(result[1]).toEqual({
        id: "3",
        body: "<!-- merge-mentor -->\nComment 2",
        path: undefined,
        line: undefined,
        isResolved: true,
      });
    });

    it("handles null threads", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getThreads.mockResolvedValue(null);

      const result = await adapter.getExistingBotComments(123);

      expect(result).toEqual([]);
    });

    it("handles missing thread id", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getThreads.mockResolvedValue([
        {
          id: null,
          comments: [{ content: "<!-- merge-mentor -->\nComment" }],
        },
      ]);

      const result = await adapter.getExistingBotComments(123);

      expect(result[0].id).toBe("");
    });

    it("handles missing comments array", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getThreads.mockResolvedValue([
        {
          id: 1,
          comments: null,
        },
      ]);

      const result = await adapter.getExistingBotComments(123);

      expect(result).toEqual([]);
    });

    it("handles missing comment content", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getThreads.mockResolvedValue([
        {
          id: 1,
          comments: [{ content: null }],
        },
      ]);

      const result = await adapter.getExistingBotComments(123);

      expect(result).toEqual([]);
    });

    it("handles empty comment content with bot identifier", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getThreads.mockResolvedValue([
        {
          id: 1,
          comments: [{ content: "<!-- merge-mentor -->" }],
        },
      ]);

      const result = await adapter.getExistingBotComments(123);

      expect(result).toHaveLength(1);
      expect(result[0].body).toBe("<!-- merge-mentor -->");
    });
  });

  describe("getUnresolvedCommentThreads", () => {
    it("fetches, filters, and maps unresolved threads correctly", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getThreads.mockResolvedValue([
        {
          id: 1,
          status: 1,
          threadContext: {
            filePath: "/src/test.ts",
            rightFileStart: { line: 10 },
          },
          comments: [
            {
              id: 101,
              content: "Fix this typo",
              isDeleted: false,
              author: { uniqueName: "user1" },
            },
          ],
        },
        {
          id: 2,
          status: 2,
          threadContext: {
            filePath: "/src/test.ts",
            rightFileStart: { line: 20 },
          },
          comments: [
            {
              id: 102,
              content: "Fixed comment",
              isDeleted: false,
              author: { uniqueName: "user1" },
            },
          ],
        },
        {
          id: 3,
          status: 4,
          threadContext: {
            filePath: "/src/test.ts",
            rightFileStart: { line: 30 },
          },
          comments: [
            {
              id: 103,
              content: "Closed comment",
              isDeleted: false,
              author: { uniqueName: "user1" },
            },
          ],
        },
        {
          id: 4,
          status: 1,
          threadContext: {
            filePath: "/src/other.ts",
            rightFileStart: { line: 5 },
          },
          comments: [
            {
              id: 104,
              content: "Another issue",
              isDeleted: false,
              author: { displayName: "User Two" },
            },
            { id: 105, content: "Deleted reply", isDeleted: true, author: { uniqueName: "user1" } },
          ],
        },
        {
          id: 5,
          status: 3, // WONT_FIX
          threadContext: {
            filePath: "/src/test.ts",
            rightFileStart: { line: 40 },
          },
          comments: [
            {
              id: 106,
              content: "Won't fix comment",
              isDeleted: false,
              author: { uniqueName: "user1" },
            },
          ],
        },
        {
          id: 6,
          status: 5, // BY_DESIGN
          threadContext: {
            filePath: "/src/test.ts",
            rightFileStart: { line: 50 },
          },
          comments: [
            {
              id: 107,
              content: "By design comment",
              isDeleted: false,
              author: { uniqueName: "user1" },
            },
          ],
        },
        {
          id: 7,
          status: 6, // PENDING
          threadContext: {
            filePath: "/src/pending.ts",
            rightFileStart: { line: 15 },
          },
          comments: [
            {
              id: 108,
              content: "Pending issue comment",
              isDeleted: false,
              author: { uniqueName: "user1" },
            },
          ],
        },
      ]);

      const result = await adapter.getUnresolvedCommentThreads(123);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        id: "1",
        path: "/src/test.ts",
        line: 10,
        comments: [{ author: "user1", body: "Fix this typo" }],
      });
      expect(result[1]).toEqual({
        id: "4",
        path: "/src/other.ts",
        line: 5,
        comments: [{ author: "User Two", body: "Another issue" }],
      });
      expect(result[2]).toEqual({
        id: "7",
        path: "/src/pending.ts",
        line: 15,
        comments: [{ author: "user1", body: "Pending issue comment" }],
      });
    });

    it("handles errors and throws", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getThreads.mockRejectedValue(new Error("Azure API error"));

      await expect(adapter.getUnresolvedCommentThreads(123)).rejects.toThrow("Azure API error");
    });
  });

  describe("postInlineComment", () => {
    it("posts inline comment successfully", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.createThread.mockResolvedValue({});

      await adapter.postInlineComment(123, "src/test.ts", 10, "Fix this");

      expect(mockGitApiInstance.createThread).toHaveBeenCalledWith(
        {
          comments: [
            {
              content: "Fix this",
              commentType: 1,
            },
          ],
          threadContext: {
            filePath: "/src/test.ts",
            rightFileStart: { line: 10, offset: 1 },
            rightFileEnd: { line: 10, offset: 1 },
          },
          status: 1,
        },
        "test-repo",
        123,
        "test-project"
      );
    });

    it("handles path already starting with slash", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.createThread.mockResolvedValue({});

      await adapter.postInlineComment(123, "/src/test.ts", 10, "Fix this");

      const call = mockGitApiInstance.createThread.mock.calls[0][0];
      expect(call.threadContext.filePath).toBe("/src/test.ts");
    });
  });

  describe("postGeneralComment", () => {
    it("posts general comment successfully", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.createThread.mockResolvedValue({});

      await adapter.postGeneralComment(123, "Overall feedback");

      expect(mockGitApiInstance.createThread).toHaveBeenCalledWith(
        {
          comments: [
            {
              content: "Overall feedback",
              commentType: 1,
            },
          ],
          status: 1,
        },
        "test-repo",
        123,
        "test-project"
      );
    });
  });

  describe("getPRFiles edge cases", () => {
    it("returns empty array when PR has no commits", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([
        {
          id: 1,
          sourceRefCommit: null,
          commonRefCommit: { commitId: "base123" },
        },
      ]);

      const files = await adapter.getPRFiles(123);

      expect(files).toEqual([]);
    });

    it("returns empty array when PR has no target commit", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([
        {
          id: 1,
          sourceRefCommit: { commitId: "source123" },
          commonRefCommit: null,
        },
      ]);

      const files = await adapter.getPRFiles(123);

      expect(files).toEqual([]);
    });

    it("returns empty array when PR has neither commit", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([
        {
          id: 1,
          sourceRefCommit: null,
          commonRefCommit: null,
        },
      ]);

      const files = await adapter.getPRFiles(123);

      expect(files).toEqual([]);
    });

    it("handles empty file content", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: 123,
        repository: { id: "repo-uuid-123" },
      });

      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([
        {
          id: 1,
          sourceRefCommit: { commitId: "source123" },
          commonRefCommit: { commitId: "base123" },
        },
      ]);

      // Mock PR Iteration Changes API
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          changeEntries: [
            {
              changeTrackingId: 1,
              item: { path: "/test.ts", gitObjectType: "blob" },
              changeType: 2, // Edit (numeric)
            },
          ],
        })
      );

      // Mock Items API for base version (empty content)
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          content: "",
        })
      );

      // Mock Items API for target version (single line)
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          content: "\n",
        })
      );

      const files = await adapter.getPRFiles(123);

      expect(files).toHaveLength(1);
      expect(files[0].patch).toContain("@@"); // Has hunk header
      expect(files[0].patch).toContain("+"); // Has addition
    });

    it("handles combined changeType bitmasks correctly (Rename + Edit = 10) (2.1)", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: 123,
        repository: { id: "repo-uuid-123" },
      });

      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([
        {
          id: 1,
          sourceRefCommit: { commitId: "source123" },
          commonRefCommit: { commitId: "base123" },
        },
      ]);

      // Mock PR Iteration Changes API with combined changeType (8 | 2 = 10)
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          changeEntries: [
            {
              item: { path: "/combined.ts", gitObjectType: "blob" },
              changeType: 10, // Rename (8) + Edit (2)
            },
          ],
        })
      );

      // Mock base and target versions
      mockFetch.mockImplementationOnce(() => createMockResponse(true, 200, { content: "// Old" }));
      mockFetch.mockImplementationOnce(() => createMockResponse(true, 200, { content: "// New" }));

      const files = await adapter.getPRFiles(123);

      expect(files).toHaveLength(1);
      expect(files[0].status).toBe("renamed");
    });

    it("detects and excludes binary files by checking contentType (2.2)", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: 123,
        repository: { id: "repo-uuid-123" },
      });

      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([
        {
          id: 1,
          sourceRefCommit: { commitId: "source123" },
          commonRefCommit: { commitId: "base123" },
        },
      ]);

      // Mock PR Iteration Changes API
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          changeEntries: [
            {
              item: { path: "/image.png", gitObjectType: "blob" },
              changeType: 2, // Edit
            },
          ],
        })
      );

      // Mock Items API for base version with base64Encoded contentType
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          content: "base64EncodedContent...",
          contentType: "base64Encoded",
        })
      );

      const files = await adapter.getPRFiles(123);

      expect(files).toHaveLength(1);
      expect(files[0].patch).toBe(""); // Skipped binary file
      expect(files[0].additions).toBe(0);
      expect(files[0].deletions).toBe(0);
    });

    it("retries on HTTP 429 using withRateLimitHandling for direct fetches (2.3)", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: 123,
        repository: { id: "repo-uuid-123" },
      });

      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([
        {
          id: 1,
          sourceRefCommit: { commitId: "source123" },
          commonRefCommit: { commitId: "base123" },
        },
      ]);

      // First call to fetchAllIterationChanges fails with 429, then succeeds with 200 on retry
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(false, 429, { message: "Rate limit exceeded" })
      );
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          changeEntries: [
            {
              item: { path: "/file.ts", gitObjectType: "blob" },
              changeType: 2, // Edit
            },
          ],
        })
      );

      // Mock base and target versions
      mockFetch.mockImplementationOnce(() => createMockResponse(true, 200, { content: "// Old" }));
      mockFetch.mockImplementationOnce(() => createMockResponse(true, 200, { content: "// New" }));

      const files = await adapter.getPRFiles(123);

      expect(files).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(4); // 2 iteration page calls + 2 content calls
    });

    it("propagates unexpected HTTP errors instead of silencing them (1.9)", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: 123,
        repository: { id: "repo-uuid-123" },
      });

      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([
        {
          id: 1,
          sourceRefCommit: { commitId: "source123" },
          commonRefCommit: { commitId: "base123" },
        },
      ]);

      // Mock PR Iteration Changes API
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(true, 200, {
          changeEntries: [
            {
              item: { path: "/file.ts", gitObjectType: "blob" },
              changeType: 2, // Edit
            },
          ],
        })
      );

      // Mock Items API for base version with 401 Unauthorized
      mockFetch.mockImplementationOnce(() =>
        createMockResponse(false, 401, { message: "Unauthorized" })
      );

      await expect(adapter.getPRFiles(123)).rejects.toThrow("Failed to fetch file content: 401");
    });
  });

  describe("getRepoInfo", () => {
    it("returns correct repository information for Azure DevOps", () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      const repoInfo = adapter.getRepoInfo();

      expect(repoInfo).toEqual({
        owner: "test-org",
        repo: "test-repo",
        platform: "azure",
        org: "test-org",
        project: "test-project",
      });
    });
  });

  describe("getToken", () => {
    it("returns the authentication token", () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      const token = adapter.getToken();

      expect(token).toBe("test-token");
    });
  });

  describe("PBI and Work Item review features", () => {
    describe("getPBIDetails", () => {
      it("throws error for NaN work item ID", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        await expect(adapter.getPBIDetails("abc")).rejects.toThrow(
          "Invalid Azure DevOps work item ID"
        );
      });

      it("throws error if work item is not found", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        mockWitApiInstance.getWorkItem.mockResolvedValue(null);

        await expect(adapter.getPBIDetails("123")).rejects.toThrow(
          "Work item with ID 123 not found"
        );
      });

      it("fetches and parses work item details with HTML stripping", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        mockWitApiInstance.getWorkItem.mockResolvedValue({
          fields: {
            "System.Title": "Test Work Item",
            "System.Description": "<p>As a user, I want to review...</p><br/>",
            "Microsoft.VSTS.Common.AcceptanceCriteria": "<li>AC1</li><li>AC2</li>",
            "Microsoft.VSTS.Scheduling.StoryPoints": 5,
          },
        });
        mockWitApiInstance.getComments.mockResolvedValue({
          comments: [
            { id: 1, text: "<p>Comment 1</p>" },
            { id: 2, text: "Comment 2" },
          ],
        });

        const result = await adapter.getPBIDetails("123");

        expect(mockWitApiInstance.getWorkItem).toHaveBeenCalledWith(123, undefined, undefined, 4);
        expect(mockWitApiInstance.getComments).toHaveBeenCalledWith("test-project", 123);
        expect(result.id).toBe("123");
        expect(result.title).toBe("Test Work Item");
        expect(result.description).toBe("As a user, I want to review...");
        expect(result.acceptanceCriteria).toBe("- AC1\n- AC2");
        expect(result.storyPoints).toBe(5);
        expect(result.comments).toHaveLength(2);
        expect(result.comments[0].body).toBe("Comment 1");
      });

      it("preserves HTML comments (like review signatures) when stripping HTML from comments", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        mockWitApiInstance.getWorkItem.mockResolvedValue({
          fields: {
            "System.Title": "Test Work Item",
          },
        });
        mockWitApiInstance.getComments.mockResolvedValue({
          comments: [{ id: 1, text: "<p>Old review</p><!-- merge-mentor-pbi-review -->" }],
        });

        const result = await adapter.getPBIDetails("123");

        expect(result.comments).toHaveLength(1);
        expect(result.comments[0].body).toBe("Old review\n<!-- merge-mentor-pbi-review -->");
      });

      it("handles missing description, acceptance criteria, story points, and comments", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        mockWitApiInstance.getWorkItem.mockResolvedValue({
          fields: {
            "System.Title": "Test Work Item",
          },
        });
        mockWitApiInstance.getComments.mockResolvedValue({
          comments: null,
        });

        const result = await adapter.getPBIDetails("123");

        expect(result.id).toBe("123");
        expect(result.title).toBe("Test Work Item");
        expect(result.description).toBe("");
        expect(result.acceptanceCriteria).toBeUndefined();
        expect(result.storyPoints).toBeUndefined();
        expect(result.comments).toHaveLength(0);
      });

      it("traverses to parent PBI/User Story and combines details if work item is a Task", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());

        mockWitApiInstance.getWorkItem.mockResolvedValueOnce({
          fields: {
            "System.Title": "Subtask Title",
            "System.Description": "Subtask Description",
            "Microsoft.VSTS.Common.AcceptanceCriteria": "Subtask AC",
            "System.WorkItemType": "Task",
          },
          relations: [
            {
              rel: "System.LinkTypes.Hierarchy-Reverse",
              url: "https://dev.azure.com/test-org/test-project/_apis/wit/workItems/999",
            },
          ],
        });
        mockWitApiInstance.getComments.mockResolvedValueOnce({ comments: [] });

        mockWitApiInstance.getWorkItem.mockResolvedValueOnce({
          fields: {
            "System.Title": "Parent PBI Title",
            "System.Description": "Parent PBI Description",
            "Microsoft.VSTS.Common.AcceptanceCriteria": "Parent PBI AC",
            "System.WorkItemType": "Product Backlog Item",
            "Microsoft.VSTS.Scheduling.StoryPoints": 8,
          },
        });
        mockWitApiInstance.getComments.mockResolvedValueOnce({
          comments: [{ id: 1, text: "Parent Comment" }],
        });

        const result = await adapter.getPBIDetails("123");

        expect(result.id).toBe("123");
        expect(result.title).toBe("Task: Subtask Title (Parent PBI #999: Parent PBI Title)");
        expect(result.description).toContain("Task Description:\n\nSubtask Description");
        expect(result.description).toContain("Parent PBI Description:\n\nParent PBI Description");
        expect(result.acceptanceCriteria).toContain("Task Acceptance Criteria:\nSubtask AC");
        expect(result.acceptanceCriteria).toContain(
          "Parent PBI Acceptance Criteria:\nParent PBI AC"
        );
        expect(result.storyPoints).toBe(8);
        expect(result.comments).toHaveLength(1);
        expect(result.comments[0].body).toBe("Parent Comment");
      });

      it("extracts moscowTag and backlogPriority correctly", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        mockWitApiInstance.getWorkItem.mockResolvedValue({
          fields: {
            "System.Title": "Test Work Item",
            "System.Tags": "some-tag; must-have; another-tag",
            "Microsoft.VSTS.Common.BacklogPriority": 42.5,
          },
        });
        mockWitApiInstance.getComments.mockResolvedValue({ comments: [] });

        const result = await adapter.getPBIDetails("123");
        expect(result.moscowTag).toBe("Must");
        expect(result.backlogPriority).toBe(42.5);
      });

      it("handles non-numeric storyPoints and backlogPriority values as undefined", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        mockWitApiInstance.getWorkItem.mockResolvedValue({
          fields: {
            "System.Title": "Test Work Item",
            "Microsoft.VSTS.Scheduling.StoryPoints": "invalid-points",
            "Microsoft.VSTS.Common.BacklogPriority": "invalid-priority",
          },
        });
        mockWitApiInstance.getComments.mockResolvedValue({ comments: [] });

        const result = await adapter.getPBIDetails("123");
        expect(result.storyPoints).toBeUndefined();
        expect(result.backlogPriority).toBeUndefined();
      });

      it("logs error and rethrows on failure", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        mockWitApiInstance.getWorkItem.mockRejectedValue(new Error("API Error"));

        await expect(adapter.getPBIDetails("123")).rejects.toThrow("API Error");
      });
    });

    describe("postPBIComment", () => {
      it("throws error for NaN ID", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        await expect(adapter.postPBIComment("abc", "test")).rejects.toThrow(
          "Invalid Azure DevOps work item ID"
        );
      });

      it("creates a new comment if commentId is undefined", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        mockWitApiInstance.vsoClient.getVersioningData.mockResolvedValue({
          requestUrl:
            "https://dev.azure.com/test-org/test-project/_apis/wit/workItems/123/comments",
          apiVersion: "7.1",
        });
        mockWitApiInstance.createRequestOptions.mockReturnValue({
          acceptHeader: "application/json",
        });
        mockWitApiInstance.rest.create.mockResolvedValue({ result: {} });

        await adapter.postPBIComment("123", "test comment");

        expect(mockWitApiInstance.vsoClient.getVersioningData).toHaveBeenCalledWith(
          "7.1",
          "wit",
          "608aac0a-32e1-4493-a863-b9cf4566d257",
          { project: "test-project", workItemId: 123 }
        );
        expect(mockWitApiInstance.createRequestOptions).toHaveBeenCalledWith(
          "application/json",
          "7.1"
        );
        expect(mockWitApiInstance.rest.create).toHaveBeenCalledWith(
          "https://dev.azure.com/test-org/test-project/_apis/wit/workItems/123/comments?format=Markdown",
          { text: "test comment" },
          { acceptHeader: "application/json" }
        );
      });

      it("updates an existing comment if commentId is defined", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        mockWitApiInstance.vsoClient.getVersioningData.mockResolvedValue({
          requestUrl:
            "https://dev.azure.com/test-org/test-project/_apis/wit/workItems/123/comments/999",
          apiVersion: "7.1",
        });
        mockWitApiInstance.createRequestOptions.mockReturnValue({
          acceptHeader: "application/json",
        });
        mockWitApiInstance.rest.update.mockResolvedValue({ result: {} });

        await adapter.postPBIComment("123", "updated comment", 999);

        expect(mockWitApiInstance.vsoClient.getVersioningData).toHaveBeenCalledWith(
          "7.1",
          "wit",
          "608aac0a-32e1-4493-a863-b9cf4566d257",
          { project: "test-project", workItemId: 123, commentId: 999 }
        );
        expect(mockWitApiInstance.rest.update).toHaveBeenCalledWith(
          "https://dev.azure.com/test-org/test-project/_apis/wit/workItems/123/comments/999?format=Markdown",
          { text: "updated comment" },
          { acceptHeader: "application/json" }
        );
      });

      it("updates comment if commentId is a string", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        mockWitApiInstance.vsoClient.getVersioningData.mockResolvedValue({
          requestUrl:
            "https://dev.azure.com/test-org/test-project/_apis/wit/workItems/123/comments/999",
          apiVersion: "7.1",
        });
        mockWitApiInstance.createRequestOptions.mockReturnValue({
          acceptHeader: "application/json",
        });
        mockWitApiInstance.rest.update.mockResolvedValue({ result: {} });

        await adapter.postPBIComment("123", "updated comment", "999");

        expect(mockWitApiInstance.vsoClient.getVersioningData).toHaveBeenCalledWith(
          "7.1",
          "wit",
          "608aac0a-32e1-4493-a863-b9cf4566d257",
          { project: "test-project", workItemId: 123, commentId: 999 }
        );
      });

      it("logs error and rethrows on post/update failure", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        mockWitApiInstance.vsoClient.getVersioningData.mockResolvedValue({
          requestUrl:
            "https://dev.azure.com/test-org/test-project/_apis/wit/workItems/123/comments",
          apiVersion: "7.1",
        });
        mockWitApiInstance.createRequestOptions.mockReturnValue({
          acceptHeader: "application/json",
        });
        mockWitApiInstance.rest.create.mockRejectedValue(new Error("Post failed"));

        await expect(adapter.postPBIComment("123", "test")).rejects.toThrow("Post failed");
      });
    });

    describe("getLinkedPBIIds", () => {
      it("fetches linked work item IDs for PR successfully", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        mockGitApiInstance.getPullRequestById.mockResolvedValue({
          pullRequestId: 123,
          repository: { id: "repo-uuid-123" },
        });
        const mockGetPullRequestWorkItemRefs = vi
          .fn()
          .mockResolvedValue([{ id: 456 }, { id: "789" }]);
        mockGitApiInstance.getPullRequestWorkItemRefs = mockGetPullRequestWorkItemRefs;

        const result = await adapter.getLinkedPBIIds(123);

        expect(mockGitApiInstance.getPullRequestById).toHaveBeenCalledWith(123, "test-project");
        expect(mockGetPullRequestWorkItemRefs).toHaveBeenCalledWith(
          "repo-uuid-123",
          123,
          "test-project"
        );
        expect(result).toEqual(["456", "789"]);
      });

      it("returns empty array if getPullRequestWorkItemRefs returns null/undefined", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        mockGitApiInstance.getPullRequestById.mockResolvedValue({
          pullRequestId: 123,
          repository: { id: "repo-uuid-123" },
        });
        const mockGetPullRequestWorkItemRefs = vi.fn().mockResolvedValue(null);
        mockGitApiInstance.getPullRequestWorkItemRefs = mockGetPullRequestWorkItemRefs;

        const result = await adapter.getLinkedPBIIds(123);
        expect(result).toEqual([]);
      });
    });

    describe("getProjectDetails", () => {
      it("throws error for NaN work item ID", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        await expect(adapter.getProjectDetails("abc")).rejects.toThrow(
          "Invalid Azure DevOps work item ID"
        );
      });

      it("throws error if root work item is not found", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        mockWitApiInstance.getWorkItem.mockResolvedValue(null);

        await expect(adapter.getProjectDetails("123")).rejects.toThrow(
          "Root work item #123 could not be resolved"
        );
      });

      it("successfully fetches work item hierarchy, stopping at story/PBI level, and maps dependencies", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());

        mockWitApiInstance.getWorkItem.mockImplementation((id: number) => {
          if (id === 100) {
            return Promise.resolve({
              fields: {
                "System.Title": "Test Feature",
                "System.WorkItemType": "Feature",
                "System.Description": "Feature description",
                "System.State": "New",
              },
              relations: [
                {
                  rel: "System.LinkTypes.Hierarchy-Forward",
                  url: "https://dev.azure.com/test-org/test-project/_apis/wit/workItems/101",
                },
              ],
            });
          }
          if (id === 101) {
            return Promise.resolve({
              fields: {
                "System.Title": "Child PBI",
                "System.WorkItemType": "Product Backlog Item",
                "System.Description": "PBI description",
                "System.State": "In Progress",
                "System.Tags": "Could Have, some-other-tag",
                "Microsoft.VSTS.Common.StackRank": 100.5,
              },
              relations: [
                {
                  rel: "System.LinkTypes.Hierarchy-Forward",
                  url: "https://dev.azure.com/test-org/test-project/_apis/wit/workItems/102",
                },
                {
                  rel: "System.LinkTypes.Dependency-Forward",
                  url: "https://dev.azure.com/test-org/test-project/_apis/wit/workItems/103",
                },
              ],
            });
          }
          if (id === 103) {
            return Promise.resolve({
              fields: {
                "System.Title": "External Successor Story",
                "System.WorkItemType": "User Story",
                "System.State": "Done",
              },
              relations: [],
            });
          }
          return Promise.resolve(null);
        });

        mockWitApiInstance.getComments.mockResolvedValue({ comments: [] });

        const result = await adapter.getProjectDetails("100");

        // The root item 100 was requested
        expect(result.rootId).toBe("100");
        expect(result.rootTitle).toBe("Test Feature");
        expect(result.rootType).toBe("Feature");
        expect(result.rootDescription).toBe("Feature description");

        // Should retrieve 100, 101, 103. 102 should NOT be fetched because 101 is a PBI (leaf) type.
        expect(result.workItems).toHaveLength(3);
        const itemIds = result.workItems.map((wi) => wi.id);
        expect(itemIds).toContain("100");
        expect(itemIds).toContain("101");
        expect(itemIds).toContain("103");
        expect(itemIds).not.toContain("102");

        // 101 depends on 103 (successor dependency)
        expect(result.dependencies).toHaveLength(1);
        expect(result.dependencies[0]).toEqual({
          sourceId: "101",
          targetId: "103",
          type: "successor",
        });

        // Verify state normalization
        const item100 = result.workItems.find((wi) => wi.id === "100");
        const item101 = result.workItems.find((wi) => wi.id === "101");
        const item103 = result.workItems.find((wi) => wi.id === "103");
        expect(item100?.normalizedState).toBe("todo");
        expect(item101?.normalizedState).toBe("inprogress");
        expect(item103?.normalizedState).toBe("done");

        // Verify moscowTag and backlogPriority extraction
        expect(item101?.moscowTag).toBe("Could");
        expect(item101?.backlogPriority).toBe(100.5);
      });

      it("successfully fetches hierarchy starting from Project down to Epic, Feature, and PBI", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());

        mockWitApiInstance.getWorkItem.mockImplementation((id: number) => {
          if (id === 200) {
            return Promise.resolve({
              fields: {
                "System.Title": "Test Project Work Item",
                "System.WorkItemType": "Project",
                "System.Description": "Project description",
                "System.State": "New",
              },
              relations: [
                {
                  rel: "System.LinkTypes.Hierarchy-Forward",
                  url: "https://dev.azure.com/test-org/test-project/_apis/wit/workItems/201",
                },
              ],
            });
          }
          if (id === 201) {
            return Promise.resolve({
              fields: {
                "System.Title": "Child Epic",
                "System.WorkItemType": "Epic",
                "System.Description": "Epic description",
                "System.State": "Active",
              },
              relations: [
                {
                  rel: "System.LinkTypes.Hierarchy-Forward",
                  url: "https://dev.azure.com/test-org/test-project/_apis/wit/workItems/202",
                },
              ],
            });
          }
          if (id === 202) {
            return Promise.resolve({
              fields: {
                "System.Title": "Grandchild Feature",
                "System.WorkItemType": "Feature",
                "System.Description": "Feature description",
                "System.State": "Active",
              },
              relations: [
                {
                  rel: "System.LinkTypes.Hierarchy-Forward",
                  url: "https://dev.azure.com/test-org/test-project/_apis/wit/workItems/203",
                },
              ],
            });
          }
          if (id === 203) {
            return Promise.resolve({
              fields: {
                "System.Title": "Leaf User Story",
                "System.WorkItemType": "User Story",
                "System.State": "Closed",
              },
              relations: [
                {
                  rel: "System.LinkTypes.Hierarchy-Forward",
                  url: "https://dev.azure.com/test-org/test-project/_apis/wit/workItems/204",
                },
              ],
            });
          }
          return Promise.resolve(null);
        });

        mockWitApiInstance.getComments.mockResolvedValue({ comments: [] });

        const result = await adapter.getProjectDetails("200");

        expect(result.rootId).toBe("200");
        expect(result.rootTitle).toBe("Test Project Work Item");
        expect(result.rootType).toBe("Project");
        expect(result.rootDescription).toBe("Project description");

        // Should retrieve 200 (Project), 201 (Epic), 202 (Feature), 203 (User Story). 204 should NOT be fetched.
        expect(result.workItems).toHaveLength(4);
        const itemIds = result.workItems.map((wi) => wi.id);
        expect(itemIds).toContain("200");
        expect(itemIds).toContain("201");
        expect(itemIds).toContain("202");
        expect(itemIds).toContain("203");
        expect(itemIds).not.toContain("204");
      });
    });
  });

  describe("comment thread operations", () => {
    describe("getCommentThread", () => {
      it("fetches comment thread containing comment ID successfully", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        mockGitApiInstance.getThreads.mockResolvedValue([
          {
            id: 123,
            threadContext: {
              filePath: "/src/main.ts",
              rightFileStart: { line: 10 },
            },
            comments: [
              {
                id: 456,
                content: "Hello",
                isDeleted: false,
                commentType: 1,
                publishedDate: new Date("2026-07-09T00:00:00Z"),
              },
              {
                id: 789,
                content: "World",
                isDeleted: false,
                commentType: 1,
                publishedDate: new Date("2026-07-09T00:01:00Z"),
              },
            ],
          },
        ]);

        const result = await adapter.getCommentThread(1, 456);
        expect(result.threadId).toBe(123);
        expect(result.path).toBe("src/main.ts");
        expect(result.line).toBe(10);
        expect(result.comments).toHaveLength(2);
        expect(result.comments[0].body).toBe("Hello");
      });

      it("throws ValidationError if comment thread is not found", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        mockGitApiInstance.getThreads.mockResolvedValue([]);
        await expect(adapter.getCommentThread(1, 456)).rejects.toThrow("No comment thread found");
      });
    });

    describe("postCommentReply", () => {
      it("posts a reply comment successfully", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        mockGitApiInstance.getPullRequestById.mockResolvedValue({
          pullRequestId: 1,
          repository: { id: "repo-uuid" },
        });
        await adapter.postCommentReply(1, 123, "Reply message");
        expect(mockGitApiInstance.createComment).toHaveBeenCalled();
      });
    });

    describe("resolveCommentThread", () => {
      it("updates the thread status to CLOSED", async () => {
        const adapter = new AzureDevOpsAdapter(createTestConfig());
        mockGitApiInstance.getPullRequestById.mockResolvedValue({
          pullRequestId: 1,
          repository: { id: "repo-uuid" },
        });
        await adapter.resolveCommentThread(1, 123);
        expect(mockGitApiInstance.updateThread).toHaveBeenCalledWith(
          { status: 4 }, // CLOSED
          "repo-uuid",
          1,
          123,
          "test-project"
        );
      });
    });
  });
});
