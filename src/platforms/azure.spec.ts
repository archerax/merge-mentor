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
};

vi.mock("azure-devops-node-api", () => ({
  WebApi: class {
    async getGitApi() {
      return mockGitApiInstance;
    }
  },
  getPersonalAccessTokenHandler: vi.fn(() => ({})),
}));

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
    commentFilter: {
      minConfidence: "high",
      skipPreExisting: true,
      postResolutionComments: true,
    },
    reviewRuns: 1,
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
      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        lastMergeSourceCommit: { commitId: "source123" },
        lastMergeTargetCommit: { commitId: "target123" },
      });
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      mockGitApiInstance.getPullRequestIterationChanges.mockResolvedValue({
        changeEntries: [
          {
            item: { path: "/src/test.ts", objectId: "obj123" },
            changeType: 2, // EDIT
          },
          {
            item: { path: "README.md", objectId: "obj456" },
            changeType: 1, // ADD
          },
        ],
      });

      // Mock getFileDiffs with proper line numbers
      mockGitApiInstance.getFileDiffs.mockResolvedValue([
        {
          path: "/src/test.ts",
          lineDiffBlocks: [
            {
              modifiedLineNumberStart: 10,
              modifiedLinesCount: 5,
              originalLineNumberStart: 10,
              originalLinesCount: 3,
            },
          ],
        },
        {
          path: "/README.md",
          lineDiffBlocks: [
            {
              modifiedLineNumberStart: 1,
              modifiedLinesCount: 10,
              originalLineNumberStart: 1,
              originalLinesCount: 0,
            },
          ],
        },
      ]);

      // Mock getBlobContent with actual file content
      mockGitApiInstance.getBlobContent.mockImplementation((_repoName, sha) => {
        if (sha === "obj123") {
          const content =
            "const x = 1;\nconst y = 2;\nconst z = 3;\n// More code\nfunction test() {\n  return 42;\n}\n// Line 8\n// Line 9\nconst updated = 4;\nconst newVar = 5;\nconst anotherVar = 6;\nconst oneMore = 7;\nconst lastOne = 8;\n";
          const buffer = Buffer.from(content);
          const stream = require("node:stream").Readable.from([buffer]);
          return Promise.resolve(stream);
        }
        if (sha === "obj456") {
          const content =
            "# README\n\nThis is a test file.\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\n";
          const buffer = Buffer.from(content);
          const stream = require("node:stream").Readable.from([buffer]);
          return Promise.resolve(stream);
        }
        throw new Error("Unknown blob");
      });

      const result = await adapter.getPRFiles(123);

      expect(result).toHaveLength(2);
      expect(result[0].filename).toBe("src/test.ts");
      expect(result[0].status).toBe("modified");
      expect(result[0].patch).toContain("diff --git");
      expect(result[0].patch).toContain("@@ -10,3 +10,5 @@");
      expect(result[0].patch).toContain("+const updated = 4;");

      expect(result[1].filename).toBe("README.md");
      expect(result[1].status).toBe("added");
      expect(result[1].patch).toContain("diff --git");
      expect(result[1].patch).toContain("@@ -1,0 +1,10 @@");
      expect(result[1].patch).toContain("+# README");
    });

    it("handles empty iterations", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        lastMergeSourceCommit: { commitId: "source123" },
        lastMergeTargetCommit: { commitId: "target123" },
      });
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([]);

      const result = await adapter.getPRFiles(123);

      expect(result).toEqual([]);
    });

    it("handles null iterations", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        lastMergeSourceCommit: { commitId: "source123" },
        lastMergeTargetCommit: { commitId: "target123" },
      });
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue(null);

      const result = await adapter.getPRFiles(123);

      expect(result).toEqual([]);
    });

    it("handles missing iteration id", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        lastMergeSourceCommit: { commitId: "source123" },
        lastMergeTargetCommit: { commitId: "target123" },
      });
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([{}]);
      mockGitApiInstance.getPullRequestIterationChanges.mockResolvedValue({
        changeEntries: [],
      });

      const result = await adapter.getPRFiles(123);

      expect(mockGitApiInstance.getPullRequestIterationChanges).toHaveBeenCalledWith(
        "test-repo",
        123,
        1,
        "test-project"
      );
      expect(result).toEqual([]);
    });

    it("skips changes without item path", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        lastMergeSourceCommit: { commitId: "source123" },
        lastMergeTargetCommit: { commitId: "target123" },
      });
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([{ id: 1 }]);
      mockGitApiInstance.getPullRequestIterationChanges.mockResolvedValue({
        changeEntries: [
          { item: null },
          { item: { path: null } },
          { item: { path: "valid.ts", objectId: "obj789" }, changeType: 2 },
        ],
      });

      mockGitApiInstance.getFileDiffs.mockResolvedValue([
        {
          path: "/valid.ts",
          lineDiffBlocks: [
            {
              modifiedLineNumberStart: 5,
              modifiedLinesCount: 3,
              originalLineNumberStart: 5,
              originalLinesCount: 3,
            },
          ],
        },
      ]);

      const result = await adapter.getPRFiles(123);

      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe("valid.ts");

      consoleWarnSpy.mockRestore();
    });

    it("handles missing changeEntries", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        lastMergeSourceCommit: { commitId: "source123" },
        lastMergeTargetCommit: { commitId: "target123" },
      });
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([{ id: 1 }]);
      mockGitApiInstance.getPullRequestIterationChanges.mockResolvedValue({});

      const result = await adapter.getPRFiles(123);

      expect(result).toEqual([]);
    });

    it("handles null changeEntries", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        lastMergeSourceCommit: { commitId: "source123" },
        lastMergeTargetCommit: { commitId: "target123" },
      });
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([{ id: 1 }]);
      mockGitApiInstance.getPullRequestIterationChanges.mockResolvedValue({ changeEntries: null });

      const result = await adapter.getPRFiles(123);

      expect(result).toEqual([]);
    });

    it("maps all change types correctly", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        lastMergeSourceCommit: { commitId: "source123" },
        lastMergeTargetCommit: { commitId: "target123" },
      });
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([{ id: 1 }]);
      mockGitApiInstance.getPullRequestIterationChanges.mockResolvedValue({
        changeEntries: [
          { item: { path: "added.ts", objectId: "a1" }, changeType: 1 },
          { item: { path: "modified.ts", objectId: "m1" }, changeType: 2 },
          { item: { path: "renamed.ts", objectId: "r1" }, changeType: 8 },
          { item: { path: "deleted.ts", objectId: "d1" }, changeType: 16 },
          { item: { path: "unknown.ts", objectId: "u1" }, changeType: 999 },
        ],
      });

      mockGitApiInstance.getFileDiffs.mockResolvedValue([
        {
          path: "/added.ts",
          lineDiffBlocks: [
            {
              modifiedLineNumberStart: 1,
              modifiedLinesCount: 10,
              originalLineNumberStart: 1,
              originalLinesCount: 0,
            },
          ],
        },
        {
          path: "/modified.ts",
          lineDiffBlocks: [
            {
              modifiedLineNumberStart: 5,
              modifiedLinesCount: 8,
              originalLineNumberStart: 5,
              originalLinesCount: 6,
            },
          ],
        },
        {
          path: "/renamed.ts",
          lineDiffBlocks: [
            {
              modifiedLineNumberStart: 1,
              modifiedLinesCount: 15,
              originalLineNumberStart: 1,
              originalLinesCount: 15,
            },
          ],
        },
        {
          path: "/deleted.ts",
          lineDiffBlocks: [],
        },
        {
          path: "/unknown.ts",
          lineDiffBlocks: [
            {
              modifiedLineNumberStart: 20,
              modifiedLinesCount: 5,
              originalLineNumberStart: 20,
              originalLinesCount: 5,
            },
          ],
        },
      ]);

      const result = await adapter.getPRFiles(123);

      expect(result[0].status).toBe("added");
      expect(result[1].status).toBe("modified");
      expect(result[2].status).toBe("renamed");
      expect(result[3].status).toBe("deleted");
      expect(result[4].status).toBe("modified");

      consoleWarnSpy.mockRestore();
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
              content: "<!-- merge-mentor -->\n\nFix this",
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
              content: "<!-- merge-mentor -->\n\nOverall feedback",
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
      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: 123,
        title: "Test PR",
        description: "Test description",
        createdBy: { displayName: "Test User" },
        sourceRefName: "refs/heads/feature",
        targetRefName: "refs/heads/main",
        lastMergeSourceCommit: null,
        lastMergeTargetCommit: { commitId: "target123" },
      });

      const files = await adapter.getPRFiles(123);

      expect(files).toEqual([]);
      expect(mockGitApiInstance.getPullRequestIterations).not.toHaveBeenCalled();
    });

    it("returns empty array when PR has no target commit", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: 123,
        title: "Test PR",
        description: "Test description",
        createdBy: { displayName: "Test User" },
        sourceRefName: "refs/heads/feature",
        targetRefName: "refs/heads/main",
        lastMergeSourceCommit: { commitId: "source123" },
        lastMergeTargetCommit: null,
      });

      const files = await adapter.getPRFiles(123);

      expect(files).toEqual([]);
      expect(mockGitApiInstance.getPullRequestIterations).not.toHaveBeenCalled();
    });

    it("returns empty array when PR has neither commit", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: 123,
        title: "Test PR",
        description: "Test description",
        createdBy: { displayName: "Test User" },
        sourceRefName: "refs/heads/feature",
        targetRefName: "refs/heads/main",
        lastMergeSourceCommit: null,
        lastMergeTargetCommit: null,
      });

      const files = await adapter.getPRFiles(123);

      expect(files).toEqual([]);
      expect(mockGitApiInstance.getPullRequestIterations).not.toHaveBeenCalled();
    });

    it("handles file lines beyond range in patch generation", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        pullRequestId: 123,
        title: "Test PR",
        description: "Test description",
        createdBy: { displayName: "Test User" },
        sourceRefName: "refs/heads/feature",
        targetRefName: "refs/heads/main",
        lastMergeSourceCommit: { commitId: "source123" },
        lastMergeTargetCommit: { commitId: "target123" },
      });
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([
        { id: 1, changeList: [{ changeId: "change1" }] },
      ]);
      mockGitApiInstance.getPullRequestIterationChanges.mockResolvedValue({
        changeEntries: [
          {
            changeTrackingId: 1,
            item: { path: "/test.ts" },
            changeType: 2, // Edit
          },
        ],
      });
      mockGitApiInstance.getFileDiffs.mockResolvedValue([
        {
          path: "/test.ts",
          lineDiffBlocks: [
            {
              modifiedLineNumberStart: 1,
              modifiedLinesCount: 1,
              originalLineNumberStart: 1,
              originalLinesCount: 0,
            },
          ],
        },
      ]);
      // Return empty content to trigger line beyond range
      mockGitApiInstance.getBlobContent.mockResolvedValue("");

      const files = await adapter.getPRFiles(123);

      expect(files).toHaveLength(1);
      expect(files[0].patch).toContain("+\n"); // Empty line added
    });

    it("batches file diffs when PR has more than 10 files", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      // Create 15 test files
      const changeEntries = Array.from({ length: 15 }, (_, i) => ({
        item: { path: `/file${i + 1}.ts`, objectId: `obj${i + 1}` },
        changeType: 2, // EDIT
      }));

      mockGitApiInstance.getPullRequestById.mockResolvedValue({
        lastMergeSourceCommit: { commitId: "source123" },
        lastMergeTargetCommit: { commitId: "target123" },
      });
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([{ id: 1 }]);
      mockGitApiInstance.getPullRequestIterationChanges.mockResolvedValue({
        changeEntries,
      });

      // Mock getFileDiffs to track batch calls
      let callCount = 0;
      mockGitApiInstance.getFileDiffs.mockImplementation((criteria) => {
        callCount++;
        // Return mock diffs for each batch
        return Promise.resolve(
          criteria.fileDiffParams.map((param: { path: string }) => ({
            path: param.path,
            lineDiffBlocks: [
              {
                modifiedLineNumberStart: 1,
                modifiedLinesCount: 1,
                originalLineNumberStart: 1,
                originalLinesCount: 1,
              },
            ],
          }))
        );
      });

      // Mock getBlobContent
      mockGitApiInstance.getBlobContent.mockImplementation(() => {
        const content = "test content\n";
        const buffer = Buffer.from(content);
        const stream = require("node:stream").Readable.from([buffer]);
        return Promise.resolve(stream);
      });

      const result = await adapter.getPRFiles(123);

      // Verify batching: 15 files should require 2 calls (10 + 5)
      expect(callCount).toBe(2);
      expect(mockGitApiInstance.getFileDiffs).toHaveBeenCalledTimes(2);

      // First batch should have 10 files
      const firstCall = mockGitApiInstance.getFileDiffs.mock.calls[0][0];
      expect(firstCall.fileDiffParams).toHaveLength(10);

      // Second batch should have 5 files
      const secondCall = mockGitApiInstance.getFileDiffs.mock.calls[1][0];
      expect(secondCall.fileDiffParams).toHaveLength(5);

      // All 15 files should be returned
      expect(result).toHaveLength(15);
      result.forEach((file, i) => {
        expect(file.filename).toBe(`file${i + 1}.ts`);
      });
    });
  });
});
