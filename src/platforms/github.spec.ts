import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { GitHubAdapter } from "./github.js";

const mockOctokitInstance = {
  pulls: {
    get: vi.fn(),
    listFiles: vi.fn(),
    listReviewComments: vi.fn(),
    createReviewComment: vi.fn(),
    getReviewComment: vi.fn(),
  },
  issues: {
    listComments: vi.fn(),
    createComment: vi.fn(),
  },
  graphql: vi.fn(),
};

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    pulls = mockOctokitInstance.pulls;
    issues = mockOctokitInstance.issues;
    graphql = mockOctokitInstance.graphql;
  },
}));

function createTestConfig(): Config {
  return {
    defaultPlatform: "github",
    github: {
      token: "test-token",
      owner: "test-owner",
      repo: "test-repo",
    },
    azure: {
      token: "",
      org: "",
      project: "",
      repo: "",
    },
    botCommentIdentifier: "<!-- merge-mentor -->",
    aiProvider: "copilot",
    skipPreExisting: true,
    reviewRuns: 1,
    reviewType: "general",
    streamingEnabled: true,
    streamingLines: 5,
    tempPath: "./.mergementor",
  };
}

describe("GitHubAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getPRDetails", () => {
    it("retrieves PR details successfully", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          title: "Test PR",
          body: "Test description",
          user: { login: "testuser" },
          base: { ref: "main" },
          head: { ref: "feature-branch" },
        },
      });

      const result = await adapter.getPRDetails(123);

      expect(result).toEqual({
        number: 123,
        title: "Test PR",
        description: "Test description",
        author: "testuser",
        baseBranch: "main",
        headBranch: "feature-branch",
      });
      expect(mockOctokitInstance.pulls.get).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        pull_number: 123,
      });
    });

    it("handles PR with null body", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          title: "Test PR",
          body: null,
          user: { login: "testuser" },
          base: { ref: "main" },
          head: { ref: "feature" },
        },
      });

      const result = await adapter.getPRDetails(123);

      expect(result.description).toBe("");
    });

    it("handles PR with missing user", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          title: "Test PR",
          body: "Description",
          user: null,
          base: { ref: "main" },
          head: { ref: "feature" },
        },
      });

      const result = await adapter.getPRDetails(123);

      expect(result.author).toBe("unknown");
    });
  });

  describe("getPRFiles", () => {
    it("retrieves PR files successfully", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.listFiles.mockResolvedValue({
        data: [
          {
            filename: "src/test.ts",
            status: "modified",
            additions: 10,
            deletions: 5,
            patch: "@@ -1,3 +1,4 @@",
            sha: "abc123",
          },
          {
            filename: "README.md",
            status: "added",
            additions: 20,
            deletions: 0,
            patch: "@@ -0,0 +1,20 @@",
            sha: "def456",
          },
        ],
      });

      const result = await adapter.getPRFiles(123);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        filename: "src/test.ts",
        status: "modified",
        additions: 10,
        deletions: 5,
        patch: "@@ -1,3 +1,4 @@",
        sha: "abc123",
      });
      expect(result[1]).toEqual({
        filename: "README.md",
        status: "added",
        additions: 20,
        deletions: 0,
        patch: "@@ -0,0 +1,20 @@",
        sha: "def456",
      });
    });

    it("handles empty file list", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.listFiles.mockResolvedValue({ data: [] });

      const result = await adapter.getPRFiles(123);

      expect(result).toEqual([]);
    });

    it("handles files with null sha", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.listFiles.mockResolvedValue({
        data: [
          {
            filename: "src/test.ts",
            status: "modified",
            additions: 10,
            deletions: 5,
            patch: "@@ -1,3 +1,4 @@",
            sha: null, // This tests the ?? undefined branch
          },
        ],
      });

      const result = await adapter.getPRFiles(123);

      expect(result).toHaveLength(1);
      expect(result[0].sha).toBeUndefined();
    });
  });

  describe("getExistingBotComments", () => {
    it("retrieves bot comments from reviews and issues", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.listReviewComments.mockResolvedValue({
        data: [
          {
            id: 1,
            body: "<!-- merge-mentor -->\nReview comment",
            path: "src/test.ts",
            line: 10,
          },
          {
            id: 2,
            body: "Regular comment",
            path: "src/other.ts",
            line: 5,
          },
        ],
      });
      mockOctokitInstance.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 3,
            body: "<!-- merge-mentor -->\nGeneral comment",
          },
          {
            id: 4,
            body: "User comment",
          },
        ],
      });

      const result = await adapter.getExistingBotComments(123);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 1,
        body: "<!-- merge-mentor -->\nReview comment",
        path: "src/test.ts",
        line: 10,
      });
      expect(result[1]).toEqual({
        id: 3,
        body: "<!-- merge-mentor -->\nGeneral comment",
      });
    });

    it("handles missing line in review comment", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.listReviewComments.mockResolvedValue({
        data: [
          {
            id: 1,
            body: "<!-- merge-mentor -->\nComment",
            path: "test.ts",
            line: null,
          },
        ],
      });
      mockOctokitInstance.issues.listComments.mockResolvedValue({ data: [] });

      const result = await adapter.getExistingBotComments(123);

      expect(result[0].line).toBeUndefined();
    });

    it("handles null body in issue comment", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.listReviewComments.mockResolvedValue({ data: [] });
      mockOctokitInstance.issues.listComments.mockResolvedValue({
        data: [{ id: 1, body: null }],
      });

      const result = await adapter.getExistingBotComments(123);

      expect(result).toHaveLength(0);
    });
  });

  describe("postInlineComment", () => {
    it("posts inline comment successfully", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.get.mockResolvedValue({
        data: { head: { sha: "abc123" } },
      });
      mockOctokitInstance.pulls.createReviewComment.mockResolvedValue({});

      await adapter.postInlineComment(123, "src/test.ts", 10, "Fix this issue");

      expect(mockOctokitInstance.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        pull_number: 123,
        body: "Fix this issue",
        commit_id: "abc123",
        path: "src/test.ts",
        line: 10,
      });
    });
  });

  describe("postGeneralComment", () => {
    it("posts general comment successfully", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.issues.createComment.mockResolvedValue({});

      await adapter.postGeneralComment(123, "Overall feedback");

      expect(mockOctokitInstance.issues.createComment).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        issue_number: 123,
        body: "Overall feedback",
      });
    });
  });

  describe("postInlineComment error handling", () => {
    it("throws error when inline comment fails", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          head: { sha: "abc123" },
        },
      });
      mockOctokitInstance.pulls.createReviewComment.mockRejectedValue(new Error("API error"));

      await expect(adapter.postInlineComment(123, "test.ts", 10, "Test")).rejects.toThrow(
        "API error"
      );
    });
  });

  describe("getRepoInfo", () => {
    it("returns correct repository information for GitHub", () => {
      const adapter = new GitHubAdapter(createTestConfig());

      const repoInfo = adapter.getRepoInfo();

      expect(repoInfo).toEqual({
        owner: "test-owner",
        repo: "test-repo",
        platform: "github",
      });
    });
  });

  describe("getToken", () => {
    it("returns the authentication token", () => {
      const adapter = new GitHubAdapter(createTestConfig());

      const token = adapter.getToken();

      expect(token).toBe("test-token");
    });
  });
});
