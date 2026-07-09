import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { resolveReviewProfile } from "../review/reviewSelection.js";
import { GitHubAdapter } from "./github.js";

const mockOctokitInstance = {
  pulls: {
    get: vi.fn(),
    listFiles: vi.fn(),
    listReviewComments: vi.fn(),
    createReviewComment: vi.fn(),
    getReviewComment: vi.fn(),
    createReplyForReviewComment: vi.fn(),
  },
  issues: {
    get: vi.fn(),
    listComments: vi.fn(),
    createComment: vi.fn(),
    updateComment: vi.fn(),
  },
  paginate: vi.fn(),
  graphql: vi.fn(),
};

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    pulls = mockOctokitInstance.pulls;
    issues = mockOctokitInstance.issues;
    paginate = mockOctokitInstance.paginate;
    graphql = mockOctokitInstance.graphql;
  },
}));

function createTestConfig(): Config {
  const reviewProfile = resolveReviewProfile({ reviewType: "general" });

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

describe("GitHubAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getPlatformName", () => {
    it("returns github", () => {
      const adapter = new GitHubAdapter(createTestConfig());
      expect(adapter.getPlatformName()).toBe("github");
    });
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
      mockOctokitInstance.paginate.mockResolvedValue([
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
      ]);

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
      expect(mockOctokitInstance.paginate).toHaveBeenCalledWith(
        mockOctokitInstance.pulls.listFiles,
        {
          owner: "test-owner",
          repo: "test-repo",
          pull_number: 123,
          per_page: 100,
        }
      );
    });

    it("handles empty file list", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.paginate.mockResolvedValue([]);

      const result = await adapter.getPRFiles(123);

      expect(result).toEqual([]);
    });

    it("handles files with null sha", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.paginate.mockResolvedValue([
        {
          filename: "src/test.ts",
          status: "modified",
          additions: 10,
          deletions: 5,
          patch: "@@ -1,3 +1,4 @@",
          sha: null,
        },
      ]);

      const result = await adapter.getPRFiles(123);

      expect(result).toHaveLength(1);
      expect(result[0].sha).toBeUndefined();
    });

    it("retrieves all files across multiple pages", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      const manyFiles = Array.from({ length: 150 }, (_, i) => ({
        filename: `src/file${i}.ts`,
        status: "modified",
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@",
        sha: `sha${i}`,
      }));
      mockOctokitInstance.paginate.mockResolvedValue(manyFiles);

      const result = await adapter.getPRFiles(123);

      expect(result).toHaveLength(150);
    });
  });

  describe("getExistingBotComments", () => {
    it("retrieves bot comments from reviews and issues", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.paginate
        .mockResolvedValueOnce([
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
        ])
        .mockResolvedValueOnce([
          {
            id: 3,
            body: "<!-- merge-mentor -->\nGeneral comment",
          },
          {
            id: 4,
            body: "User comment",
          },
        ]);

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
      mockOctokitInstance.paginate
        .mockResolvedValueOnce([
          {
            id: 1,
            body: "<!-- merge-mentor -->\nComment",
            path: "test.ts",
            line: null,
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await adapter.getExistingBotComments(123);

      expect(result[0].line).toBeUndefined();
    });

    it("handles null body in issue comment", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.paginate
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 1, body: null }]);

      const result = await adapter.getExistingBotComments(123);

      expect(result).toHaveLength(0);
    });

    it("paginates through all review and issue comments", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      const manyReviewComments = Array.from({ length: 120 }, (_, i) => ({
        id: i + 1,
        body: `<!-- merge-mentor -->\nComment ${i}`,
        path: `src/file${i}.ts`,
        line: i + 1,
      }));
      const manyIssueComments = Array.from({ length: 30 }, (_, i) => ({
        id: i + 200,
        body: `<!-- merge-mentor -->\nIssue comment ${i}`,
      }));
      mockOctokitInstance.paginate
        .mockResolvedValueOnce(manyReviewComments)
        .mockResolvedValueOnce(manyIssueComments);

      const result = await adapter.getExistingBotComments(123);

      expect(result).toHaveLength(150);
      expect(mockOctokitInstance.paginate).toHaveBeenCalledTimes(2);
      expect(mockOctokitInstance.paginate).toHaveBeenNthCalledWith(
        1,
        mockOctokitInstance.pulls.listReviewComments,
        {
          owner: "test-owner",
          repo: "test-repo",
          pull_number: 123,
          per_page: 100,
        }
      );
      expect(mockOctokitInstance.paginate).toHaveBeenNthCalledWith(
        2,
        mockOctokitInstance.issues.listComments,
        {
          owner: "test-owner",
          repo: "test-repo",
          issue_number: 123,
          per_page: 100,
        }
      );
    });
  });

  describe("getUnresolvedCommentThreads", () => {
    it("fetches, filters, and maps unresolved review threads via GraphQL", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.graphql.mockResolvedValueOnce({
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  id: "thread-1",
                  isResolved: false,
                  path: "src/file1.ts",
                  line: 15,
                  comments: {
                    nodes: [
                      {
                        author: { login: "user-1" },
                        body: "Please fix this typo.",
                      },
                      {
                        author: { login: "user-2" },
                        body: "Agreed, typo should be fixed.",
                      },
                    ],
                  },
                },
                {
                  id: "thread-2",
                  isResolved: true,
                  path: "src/file2.ts",
                  line: 30,
                  comments: {
                    nodes: [
                      {
                        author: { login: "user-1" },
                        body: "Some resolved comment",
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      });

      const result = await adapter.getUnresolvedCommentThreads(123);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "thread-1",
        path: "src/file1.ts",
        line: 15,
        comments: [
          { author: "user-1", body: "Please fix this typo." },
          { author: "user-2", body: "Agreed, typo should be fixed." },
        ],
      });
      expect(mockOctokitInstance.graphql).toHaveBeenCalledTimes(1);
    });

    it("handles errors and throws", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.graphql.mockRejectedValueOnce(new Error("GraphQL error"));

      await expect(adapter.getUnresolvedCommentThreads(123)).rejects.toThrow("GraphQL error");
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

  describe("PBI and Issue review features", () => {
    describe("getPBIDetails", () => {
      it("throws error for NaN issue ID", async () => {
        const adapter = new GitHubAdapter(createTestConfig());
        await expect(adapter.getPBIDetails("abc")).rejects.toThrow("Invalid GitHub issue number");
      });

      it("fetches and parses issue details with acceptance criteria and story points", async () => {
        const adapter = new GitHubAdapter(createTestConfig());
        mockOctokitInstance.issues.get.mockResolvedValue({
          data: {
            title: "Test Issue",
            body: "Some body text\n### Acceptance Criteria\n- AC1\n- AC2\n### Story Points\nStory Points: 8\n",
            labels: [{ name: "should have" }, "random-tag"],
          },
        });
        mockOctokitInstance.paginate.mockResolvedValue([
          { id: 1, body: "Comment 1" },
          { id: 2, body: "Comment 2" },
        ]);

        const result = await adapter.getPBIDetails("123");

        expect(mockOctokitInstance.issues.get).toHaveBeenCalledWith({
          owner: "test-owner",
          repo: "test-repo",
          issue_number: 123,
        });
        expect(result.id).toBe("123");
        expect(result.title).toBe("Test Issue");
        expect(result.acceptanceCriteria).toBe("- AC1\n- AC2");
        expect(result.storyPoints).toBe(8);
        expect(result.comments).toHaveLength(2);
        expect(result.comments[0].body).toBe("Comment 1");
        expect(result.moscowTag).toBe("Should");
      });

      it("handles missing acceptance criteria, story points, and description", async () => {
        const adapter = new GitHubAdapter(createTestConfig());
        mockOctokitInstance.issues.get.mockResolvedValue({
          data: {
            title: "Test Issue",
            body: null,
          },
        });
        mockOctokitInstance.paginate.mockResolvedValue([]);

        const result = await adapter.getPBIDetails("123");

        expect(result.description).toBe("");
        expect(result.acceptanceCriteria).toBeUndefined();
        expect(result.storyPoints).toBeUndefined();
        expect(result.comments).toHaveLength(0);
      });

      it("logs error and rethrows on failure", async () => {
        const adapter = new GitHubAdapter(createTestConfig());
        mockOctokitInstance.issues.get.mockRejectedValue(new Error("API Error"));

        await expect(adapter.getPBIDetails("123")).rejects.toThrow("API Error");
      });
    });

    describe("postPBIComment", () => {
      it("throws error for NaN ID", async () => {
        const adapter = new GitHubAdapter(createTestConfig());
        await expect(adapter.postPBIComment("abc", "test")).rejects.toThrow(
          "Invalid GitHub issue number"
        );
      });

      it("creates a new comment if commentId is undefined", async () => {
        const adapter = new GitHubAdapter(createTestConfig());
        mockOctokitInstance.issues.createComment.mockResolvedValue({});

        await adapter.postPBIComment("123", "test comment");

        expect(mockOctokitInstance.issues.createComment).toHaveBeenCalledWith({
          owner: "test-owner",
          repo: "test-repo",
          issue_number: 123,
          body: "test comment",
        });
      });

      it("updates an existing comment if commentId is defined", async () => {
        const adapter = new GitHubAdapter(createTestConfig());
        mockOctokitInstance.issues.updateComment.mockResolvedValue({});

        await adapter.postPBIComment("123", "updated comment", 999);

        expect(mockOctokitInstance.issues.updateComment).toHaveBeenCalledWith({
          owner: "test-owner",
          repo: "test-repo",
          comment_id: 999,
          body: "updated comment",
        });
      });

      it("updates comment if commentId is a string", async () => {
        const adapter = new GitHubAdapter(createTestConfig());
        mockOctokitInstance.issues.updateComment.mockResolvedValue({});

        await adapter.postPBIComment("123", "updated comment", "999");

        expect(mockOctokitInstance.issues.updateComment).toHaveBeenCalledWith({
          owner: "test-owner",
          repo: "test-repo",
          comment_id: 999,
          body: "updated comment",
        });
      });

      it("logs error and rethrows on post/update failure", async () => {
        const adapter = new GitHubAdapter(createTestConfig());
        mockOctokitInstance.issues.createComment.mockRejectedValue(new Error("Post failed"));

        await expect(adapter.postPBIComment("123", "test")).rejects.toThrow("Post failed");
      });
    });

    describe("getLinkedPBIIds", () => {
      it("returns empty array if no links are found", async () => {
        const adapter = new GitHubAdapter(createTestConfig());
        mockOctokitInstance.pulls.get.mockResolvedValue({
          data: {
            number: 10,
            title: "Just a regular PR title",
            body: "This description has no links.",
            user: { login: "testuser" },
            base: { ref: "main" },
            head: { ref: "feature" },
          },
        });

        const result = await adapter.getLinkedPBIIds(10);
        expect(result).toEqual([]);
      });

      it("extracts and deduplicates closing and generic links from title and body", async () => {
        const adapter = new GitHubAdapter(createTestConfig());
        mockOctokitInstance.pulls.get.mockResolvedValue({
          data: {
            number: 10,
            title: "Fixes #123 and closes #456",
            body: "This PR relates to issue #123, task #789 and story #101. Also closed #456.",
            user: { login: "testuser" },
            base: { ref: "main" },
            head: { ref: "feature" },
          },
        });

        const result = await adapter.getLinkedPBIIds(10);
        expect([...result].sort()).toEqual(["101", "123", "456", "789"].sort());
      });

      it("is case-insensitive and handles multiple spacing/prefixes", async () => {
        const adapter = new GitHubAdapter(createTestConfig());
        mockOctokitInstance.pulls.get.mockResolvedValue({
          data: {
            number: 10,
            title: "RESOLVED #555",
            body: "Some description with BUG #888, PBI  #999, and regular #111.",
            user: { login: "testuser" },
            base: { ref: "main" },
            head: { ref: "feature" },
          },
        });

        const result = await adapter.getLinkedPBIIds(10);
        expect([...result].sort()).toEqual(["111", "555", "888", "999"].sort());
      });
    });
  });

  describe("comment thread operations", () => {
    describe("getCommentThread", () => {
      it("fetches comment thread by numeric ID", async () => {
        const adapter = new GitHubAdapter(createTestConfig());
        mockOctokitInstance.pulls.getReviewComment.mockResolvedValue({
          data: {
            id: 456,
            in_reply_to_id: 123,
            path: "src/file.ts",
            line: 10,
          },
        });
        mockOctokitInstance.graphql.mockResolvedValue({
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
                    id: "gql-thread-123",
                    comments: {
                      nodes: [{ databaseId: 123 }],
                    },
                  },
                ],
              },
            },
          },
        });
        mockOctokitInstance.paginate.mockResolvedValue([
          { id: 123, user: { login: "bot" }, body: "Hello", created_at: "2026-07-09T00:00:00Z" },
          {
            id: 456,
            in_reply_to_id: 123,
            user: { login: "user" },
            body: "Hi",
            created_at: "2026-07-09T00:01:00Z",
          },
        ]);

        const result = await adapter.getCommentThread(1, 456);
        expect(result.threadId).toBe("gql-thread-123");
        expect(result.path).toBe("src/file.ts");
        expect(result.line).toBe(10);
        expect(result.comments).toHaveLength(2);
        expect(result.comments[0].author).toBe("bot");
      });

      it("fetches comment thread by GraphQL string ID", async () => {
        const adapter = new GitHubAdapter(createTestConfig());
        mockOctokitInstance.graphql.mockResolvedValue({
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
                    id: "gql-thread-123",
                    path: "src/file.ts",
                    line: 10,
                    comments: {
                      nodes: [
                        {
                          databaseId: 123,
                          author: { login: "bot" },
                          body: "Hello",
                          createdAt: "2026-07-09T00:00:00Z",
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        });

        const result = await adapter.getCommentThread(1, "gql-thread-123");
        expect(result.threadId).toBe("gql-thread-123");
        expect(result.path).toBe("src/file.ts");
        expect(result.line).toBe(10);
        expect(result.comments).toHaveLength(1);
        expect(result.comments[0].author).toBe("bot");
      });
    });

    describe("postCommentReply", () => {
      it("creates a reply via REST for numeric ID", async () => {
        const adapter = new GitHubAdapter(createTestConfig());
        await adapter.postCommentReply(1, 123, "Reply body");
        expect(mockOctokitInstance.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
          owner: "test-owner",
          repo: "test-repo",
          pull_number: 1,
          comment_id: 123,
          body: "Reply body",
        });
      });

      it("creates a reply via GraphQL for string ID", async () => {
        const adapter = new GitHubAdapter(createTestConfig());
        await adapter.postCommentReply(1, "gql-thread-123", "Reply body");
        expect(mockOctokitInstance.graphql).toHaveBeenCalled();
      });
    });

    describe("resolveCommentThread", () => {
      it("resolves a review thread via GraphQL", async () => {
        const adapter = new GitHubAdapter(createTestConfig());
        mockOctokitInstance.graphql.mockResolvedValueOnce({
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
                    id: "gql-thread-123",
                    comments: {
                      nodes: [{ databaseId: 123 }],
                    },
                  },
                ],
              },
            },
          },
        });
        await adapter.resolveCommentThread(1, 123);
        expect(mockOctokitInstance.graphql).toHaveBeenCalled();
      });
    });
  });
});
