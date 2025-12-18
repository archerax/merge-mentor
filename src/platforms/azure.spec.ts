import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { AzureDevOpsAdapter } from "./azure.js";

const mockGitApiInstance = {
  getPullRequestById: vi.fn(),
  getPullRequestIterations: vi.fn(),
  getPullRequestIterationChanges: vi.fn(),
  getThreads: vi.fn(),
  createThread: vi.fn(),
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
    botCommentIdentifier: "<!-- PR-Bot -->",
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
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      mockGitApiInstance.getPullRequestIterationChanges.mockResolvedValue({
        changeEntries: [
          {
            item: { path: "/src/test.ts" },
            changeType: 2, // EDIT
          },
          {
            item: { path: "README.md" },
            changeType: 1, // ADD
          },
        ],
      });

      const result = await adapter.getPRFiles(123);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        filename: "src/test.ts",
        status: "modified",
        additions: 0,
        deletions: 0,
        patch: undefined,
      });
      expect(result[1]).toEqual({
        filename: "README.md",
        status: "added",
        additions: 0,
        deletions: 0,
        patch: undefined,
      });
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
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([{ id: 1 }]);
      mockGitApiInstance.getPullRequestIterationChanges.mockResolvedValue({
        changeEntries: [
          { item: null },
          { item: { path: null } },
          { item: { path: "valid.ts" }, changeType: 2 },
        ],
      });

      const result = await adapter.getPRFiles(123);

      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe("valid.ts");
    });

    it("handles missing changeEntries", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([{ id: 1 }]);
      mockGitApiInstance.getPullRequestIterationChanges.mockResolvedValue({});

      const result = await adapter.getPRFiles(123);

      expect(result).toEqual([]);
    });

    it("handles null changeEntries", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([{ id: 1 }]);
      mockGitApiInstance.getPullRequestIterationChanges.mockResolvedValue({ changeEntries: null });

      const result = await adapter.getPRFiles(123);

      expect(result).toEqual([]);
    });

    it("maps all change types correctly", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getPullRequestIterations.mockResolvedValue([{ id: 1 }]);
      mockGitApiInstance.getPullRequestIterationChanges.mockResolvedValue({
        changeEntries: [
          { item: { path: "added.ts" }, changeType: 1 },
          { item: { path: "modified.ts" }, changeType: 2 },
          { item: { path: "renamed.ts" }, changeType: 8 },
          { item: { path: "deleted.ts" }, changeType: 16 },
          { item: { path: "unknown.ts" }, changeType: 999 },
        ],
      });

      const result = await adapter.getPRFiles(123);

      expect(result[0].status).toBe("added");
      expect(result[1].status).toBe("modified");
      expect(result[2].status).toBe("renamed");
      expect(result[3].status).toBe("deleted");
      expect(result[4].status).toBe("modified");
    });
  });

  describe("getExistingBotComments", () => {
    it("retrieves bot comments successfully", async () => {
      const adapter = new AzureDevOpsAdapter(createTestConfig());
      mockGitApiInstance.getThreads.mockResolvedValue([
        {
          id: 1,
          comments: [{ content: "<!-- PR-Bot -->\nComment 1" }],
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
          comments: [{ content: "<!-- PR-Bot -->\nComment 2" }],
          status: 2, // FIXED
        },
      ]);

      const result = await adapter.getExistingBotComments(123);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "1",
        body: "<!-- PR-Bot -->\nComment 1",
        path: "/src/test.ts",
        line: 10,
        isResolved: false,
      });
      expect(result[1]).toEqual({
        id: "3",
        body: "<!-- PR-Bot -->\nComment 2",
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
          comments: [{ content: "<!-- PR-Bot -->\nComment" }],
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
          comments: [{ content: "<!-- PR-Bot -->" }],
        },
      ]);

      const result = await adapter.getExistingBotComments(123);

      expect(result).toHaveLength(1);
      expect(result[0].body).toBe("<!-- PR-Bot -->");
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
              content: "<!-- PR-Bot -->\n\nFix this",
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
              content: "<!-- PR-Bot -->\n\nOverall feedback",
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
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      await adapter.updateComment(456, "Updated");

      expect(consoleSpy).toHaveBeenCalledWith(
        "Note: Azure DevOps comment update requested for thread 456"
      );
      consoleSpy.mockRestore();
    });

    it("logs update request for string id", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      await adapter.updateComment("789", "Updated");

      expect(consoleSpy).toHaveBeenCalledWith(
        "Note: Azure DevOps comment update requested for thread 789"
      );
      consoleSpy.mockRestore();
    });
  });

  describe("resolveComment", () => {
    it("logs resolve request for numeric id", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      await adapter.resolveComment(456);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Note: Azure DevOps comment resolve requested for thread 456"
      );
      consoleSpy.mockRestore();
    });

    it("logs resolve request for string id", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const adapter = new AzureDevOpsAdapter(createTestConfig());

      await adapter.resolveComment("789");

      expect(consoleSpy).toHaveBeenCalledWith(
        "Note: Azure DevOps comment resolve requested for thread 789"
      );
      consoleSpy.mockRestore();
    });
  });
});
