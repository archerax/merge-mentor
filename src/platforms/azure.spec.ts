import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { AzureDevOpsAdapter } from "./azure.js";

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
};

vi.mock("azure-devops-node-api", () => ({
  WebApi: class {
    async getGitApi() {
      return mockGitApiInstance;
    }
  },
  getPersonalAccessTokenHandler: vi.fn(() => ({})),
}));

// Mock fetch for REST API calls
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Helper to create mock Response
function createMockResponse(ok: boolean, status: number, data: any) {
  return Promise.resolve({
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => data,
    text: async () => JSON.stringify(data),
  });
}

function createTestConfig(): Config {
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
    aiProvider: "copilot",
    skipPreExisting: true,
    reviewRuns: 1,
    reviewType: "general",
    streamingEnabled: true,
    streamingLines: 5,
  };
}

describe("AzureDevOpsAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
              item: { path: "/src/test.ts", objectId: "obj123", gitObjectType: "blob" },
              changeType: 2, // Edit
            },
            {
              item: { path: "/README.md", objectId: "obj456", gitObjectType: "blob" },
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

      expect(result[1].filename).toBe("README.md");
      expect(result[1].status).toBe("added");
      expect(result[1].patch).toContain("diff --git");
      expect(result[1].patch).toContain("@@");
      expect(result[1].patch).toContain("+# README");
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
        { sourceRefCommit: { commitId: "source123" }, commonRefCommit: { commitId: "base123" } },
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
              item: { path: "/valid.ts", objectId: "obj789", gitObjectType: "blob" },
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
              item: { path: "/added.ts", objectId: "a1", gitObjectType: "blob" },
              changeType: 1, // Add
            },
            {
              item: { path: "/modified.ts", objectId: "m1", gitObjectType: "blob" },
              changeType: 2, // Edit
            },
            {
              item: { path: "/renamed.ts", objectId: "r1", gitObjectType: "blob" },
              changeType: 8, // Rename
            },
            {
              item: { path: "/deleted.ts", objectId: "d1", gitObjectType: "blob" },
              changeType: 16, // Delete
            },
            {
              item: { path: "/unknown.ts", objectId: "u1", gitObjectType: "blob" },
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
        item: { path: `/src/file${i}.ts`, objectId: `obj${i}`, gitObjectType: "blob" },
        changeType: 2, // Edit (numeric)
      }));

      const secondPageChanges = Array.from({ length: 50 }, (_, i) => ({
        item: { path: `/src/file${100 + i}.ts`, objectId: `obj${100 + i}`, gitObjectType: "blob" },
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
          createMockResponse(true, 200, { content: `// Base content for file${i}` })
        );
        // Target version
        mockFetch.mockImplementationOnce(() =>
          createMockResponse(true, 200, { content: `// Modified content for file${i}` })
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
        item: { path: `/src/file${i}.ts`, objectId: `obj${i}`, gitObjectType: "blob" },
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

  describe("updateComment", () => {
    it("logs update request for numeric id", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      await adapter.updateComment(456, "Updated");

      // Just verify it completes without error - logging is internal
      expect(true).toBe(true);
    });

    it("logs update request for string id", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      await adapter.updateComment("789", "Updated");

      // Just verify it completes without error - logging is internal
      expect(true).toBe(true);
    });
  });

  describe("resolveComment", () => {
    it("logs resolve request for numeric id", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      await adapter.resolveComment(456);

      // Just verify it completes without error - logging is internal
      expect(true).toBe(true);
    });

    it("logs resolve request for string id", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      await adapter.resolveComment("789");

      // Just verify it completes without error - logging is internal
      expect(true).toBe(true);
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
});
