import type { Config } from "@merge-mentor/config/config.js";
import { resolveReviewProfile } from "@merge-mentor/config/reviewSelection.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GitHubAdapter } from "./github.js";

const mockOctokitInstance = {
  pulls: {
    get: vi.fn(),
    update: vi.fn(),
    listFiles: vi.fn(),
    listReviewComments: vi.fn(),
    createReviewComment: vi.fn(),
    createReplyForReviewComment: vi.fn(),
    getReviewComment: vi.fn(),
  },
  issues: {
    get: vi.fn(),
    listComments: vi.fn(),
    createComment: vi.fn(),
    updateComment: vi.fn(),
  },
  users: {
    getAuthenticated: vi.fn(),
  },
  paginate: vi.fn(),
  graphql: vi.fn(),
};

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    pulls = mockOctokitInstance.pulls;
    issues = mockOctokitInstance.issues;
    users = mockOctokitInstance.users;
    paginate = mockOctokitInstance.paginate;
    graphql = mockOctokitInstance.graphql;
  },
}));

function graphqlThreads(nodes: unknown[]) {
  return { repository: { pullRequest: { reviewThreads: { nodes } } } };
}

function createTestConfig(): Config {
  const reviewProfile = resolveReviewProfile({});

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
    reviewPasses: reviewProfile.passes,
    reviewStrategy: reviewProfile.strategy,
    reviewProfile,
    streamingEnabled: true,
    streamingLines: 5,
    tempPath: "./.mergementor",
    longContext: false,
    experimentalTools: false,
    verifyPbi: false,
    multiAgentMaxParallel: 4,
    reviewRuns: 1,
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
            user: { login: "merge-mentor[bot]" },
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
            user: { login: "merge-mentor[bot]" },
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

    it("ignores comments that carry the bot identifier but were written by someone else", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.users.getAuthenticated.mockResolvedValue({ data: { login: "mm-user" } });
      mockOctokitInstance.paginate
        .mockResolvedValueOnce([
          {
            id: 1,
            user: { login: "attacker" },
            body: "<!-- merge-mentor -->\nfake",
            path: "a.ts",
            line: 1,
          },
          {
            id: 2,
            user: { login: "MM-User" },
            body: "<!-- merge-mentor -->\nreal",
            path: "a.ts",
            line: 2,
          },
        ])
        .mockResolvedValueOnce([
          { id: 3, user: { login: "attacker" }, body: "<!-- merge-mentor -->\nfake" },
        ]);

      const result = await adapter.getExistingBotComments(123);

      expect(result.map((c) => c.id)).toEqual([2]);
    });

    it("does not treat a forged marker as a bot thread comment", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.users.getAuthenticated.mockRejectedValue(new Error("Forbidden"));
      mockOctokitInstance.graphql.mockResolvedValue(
        graphqlThreads([
          {
            id: "T1",
            isResolved: false,
            path: "a.ts",
            line: 3,
            comments: {
              nodes: [
                {
                  id: "C1",
                  databaseId: 1,
                  author: { login: "attacker" },
                  body: "<!-- merge-mentor -->\nfake",
                },
              ],
            },
          },
        ])
      );

      const [thread] = await adapter.getUnresolvedCommentThreads(123);

      expect(thread.botInitiated).toBeUndefined();
      expect(thread.comments[0].isBot).toBeUndefined();
    });

    it("handles missing line in review comment", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.paginate
        .mockResolvedValueOnce([
          {
            id: 1,
            user: { login: "merge-mentor[bot]" },
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
        user: { login: "merge-mentor[bot]" },
        body: `<!-- merge-mentor -->\nComment ${i}`,
        path: `src/file${i}.ts`,
        line: i + 1,
      }));
      const manyIssueComments = Array.from({ length: 30 }, (_, i) => ({
        id: i + 200,
        user: { login: "merge-mentor[bot]" },
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

  describe("fork PRs and head SHA pinning", () => {
    const forkData = {
      number: 7,
      title: "t",
      body: "",
      user: { login: "u" },
      base: { ref: "main", repo: { full_name: "test-owner/test-repo" } },
      head: { ref: "main", sha: "sha-1", repo: { full_name: "forker/test-repo" } },
    };

    it("reports the PR ref and head SHA for a fork PR whose branch is named like the base", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.get.mockResolvedValue({ data: forkData });

      const result = await adapter.getPRDetails(7);

      expect(result.checkoutRef).toBe("refs/pull/7/head");
      expect(result.headSha).toBe("sha-1");
    });

    it("treats a deleted fork (null head repo) as a fork", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.get.mockResolvedValue({
        data: { ...forkData, head: { ref: "x", sha: "s", repo: null } },
      });

      expect((await adapter.getPRDetails(7)).checkoutRef).toBe("refs/pull/7/head");
    });

    it("does not set a checkout ref for same-repo PRs", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.get.mockResolvedValue({
        data: {
          ...forkData,
          head: { ref: "feat", sha: "s", repo: { full_name: "test-owner/test-repo" } },
        },
      });

      expect((await adapter.getPRDetails(7)).checkoutRef).toBeUndefined();
    });

    it("attaches inline comments to the SHA captured at review start, without refetching", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.get.mockResolvedValueOnce({ data: forkData });
      mockOctokitInstance.pulls.createReviewComment.mockResolvedValue({});

      await adapter.getPRDetails(7);
      // A push lands mid-review; a refetch would now return a newer head.
      mockOctokitInstance.pulls.get.mockResolvedValue({
        data: { ...forkData, head: { ...forkData.head, sha: "sha-2" } },
      });
      await adapter.postInlineComment(7, "a.ts", 1, "x");
      await adapter.postInlineComment(7, "b.ts", 2, "y");

      expect(mockOctokitInstance.pulls.get).toHaveBeenCalledTimes(1);
      expect(mockOctokitInstance.pulls.createReviewComment).toHaveBeenCalledTimes(2);
      for (const call of mockOctokitInstance.pulls.createReviewComment.mock.calls) {
        expect(call[0].commit_id).toBe("sha-1");
      }
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
        side: "RIGHT",
      });
    });

    it("posts a multiline inline comment with a start line", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.get.mockResolvedValue({ data: { head: { sha: "abc123" } } });
      mockOctokitInstance.pulls.createReviewComment.mockResolvedValue({});

      await adapter.postInlineComment(123, "src/test.ts", 12, "Apply this", 10);

      expect(mockOctokitInstance.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({
          line: 12,
          side: "RIGHT",
          start_line: 10,
          start_side: "RIGHT",
        })
      );
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
        expect(result.toSorted()).toEqual(["101", "123", "456", "789"].toSorted());
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
        expect(result.toSorted()).toEqual(["111", "555", "888", "999"].toSorted());
      });
    });
  });

  describe("getProjectIdentifier", () => {
    it("returns the repository name", () => {
      const adapter = new GitHubAdapter(createTestConfig());
      expect(adapter.getProjectIdentifier()).toBe("test-repo");
    });
  });

  describe("getCommentThread", () => {
    it("resolves a thread by its node id and maps bot comments", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.graphql.mockResolvedValueOnce(
        graphqlThreads([
          {
            id: "thread-1",
            isResolved: false,
            path: "src/a.ts",
            line: 10,
            comments: {
              nodes: [
                {
                  id: "c1",
                  databaseId: 111,
                  createdAt: "2024-01-01",
                  author: { login: "bot[bot]" },
                  body: "<!-- merge-mentor --> note",
                },
                { id: "c2", databaseId: 222, author: { login: "user" }, body: "reply" },
              ],
            },
          },
        ])
      );

      const thread = await adapter.getCommentThread(123, "thread-1");

      expect(thread).toMatchObject({
        id: "thread-1",
        path: "src/a.ts",
        line: 10,
        status: "active",
        botInitiated: true,
      });
      expect(thread.comments).toHaveLength(2);
      expect(thread.comments[0]).toMatchObject({
        id: 111,
        author: "bot[bot]",
        body: "<!-- merge-mentor --> note",
        isBot: true,
      });
    });

    it("matches a thread by an inner comment databaseId and marks resolved status", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.graphql.mockResolvedValueOnce(
        graphqlThreads([
          {
            id: "thread-9",
            isResolved: true,
            path: "src/b.ts",
            line: 2,
            comments: { nodes: [{ id: "c9", databaseId: 999, body: "done" }] },
          },
        ])
      );

      const thread = await adapter.getCommentThread(123, 999);

      expect(thread).toMatchObject({ id: "thread-9", status: "resolved", botInitiated: false });
      expect(thread.comments[0]).toMatchObject({ id: 999, author: "unknown", body: "done" });
    });

    it("falls back to the REST API when GraphQL fails", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.graphql.mockRejectedValueOnce(new Error("graphql down"));
      mockOctokitInstance.pulls.getReviewComment.mockResolvedValueOnce({
        data: {
          id: 500,
          in_reply_to_id: 400,
          path: "src/b.ts",
          line: 5,
          body: "hello",
          user: { login: "octocat" },
          created_at: "2024-02-02",
        },
      });

      const thread = await adapter.getCommentThread(123, 500);

      expect(mockOctokitInstance.pulls.getReviewComment).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        comment_id: 500,
      });
      expect(thread).toMatchObject({ id: 400, path: "src/b.ts", line: 5, status: "active" });
      expect(thread.comments[0]).toMatchObject({ id: 500, author: "octocat", body: "hello" });
    });

    it("defaults the REST line to 1 when the comment has no line", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.graphql.mockResolvedValueOnce(graphqlThreads([]));
      mockOctokitInstance.pulls.getReviewComment.mockResolvedValueOnce({
        data: {
          id: 600,
          in_reply_to_id: null,
          path: "src/c.ts",
          line: null,
          body: "",
          user: null,
        },
      });

      const thread = await adapter.getCommentThread(123, 600);

      expect(thread).toMatchObject({ id: 600, line: 1, status: "active", botInitiated: false });
      expect(thread.comments[0].author).toBe("unknown");
    });

    it("rethrows when the REST lookup fails", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.graphql.mockResolvedValueOnce(graphqlThreads([]));
      mockOctokitInstance.pulls.getReviewComment.mockRejectedValueOnce(new Error("Not Found"));

      await expect(adapter.getCommentThread(123, 777)).rejects.toThrow("Not Found");
    });

    it("throws when a non-numeric thread id is not found", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.graphql.mockResolvedValueOnce(graphqlThreads([]));

      await expect(adapter.getCommentThread(123, "missing")).rejects.toThrow(
        'Comment thread "missing" not found on PR #123'
      );
    });
  });

  describe("postCommentReply", () => {
    it("uses the REST API for numeric comment ids", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.createReplyForReviewComment.mockResolvedValueOnce({});

      await adapter.postCommentReply(7, 42, "thanks");

      expect(mockOctokitInstance.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        pull_number: 7,
        comment_id: 42,
        body: "thanks",
      });
      expect(mockOctokitInstance.graphql).not.toHaveBeenCalled();
    });

    it("uses the GraphQL mutation for thread ids", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.graphql.mockResolvedValueOnce({});

      await adapter.postCommentReply(7, "thread-1", "thanks");

      const [query, variables] = mockOctokitInstance.graphql.mock.calls[0];
      expect(query).toContain("addPullRequestReviewThreadReply");
      expect(variables).toEqual({ threadId: "thread-1", body: "thanks" });
    });

    it("rethrows and audits on failure", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.createReplyForReviewComment.mockRejectedValueOnce(
        new Error("reply failed")
      );

      await expect(adapter.postCommentReply(7, 42, "x")).rejects.toThrow("reply failed");
    });
  });

  describe("resolveCommentThread", () => {
    it("resolves a thread by node id via GraphQL", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.graphql.mockResolvedValueOnce({});

      await adapter.resolveCommentThread(7, "thread-1");

      const [query, variables] = mockOctokitInstance.graphql.mock.calls[0];
      expect(query).toContain("resolveReviewThread");
      expect(variables).toEqual({ threadId: "thread-1" });
    });

    it("converts a numeric comment id to its node id before resolving", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.graphql
        .mockResolvedValueOnce({
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
                    id: "node-1",
                    isResolved: false,
                    path: "a.ts",
                    line: 1,
                    comments: { nodes: [{ id: "c1", databaseId: 42, body: "hi" }] },
                  },
                ],
              },
            },
          },
        })
        .mockResolvedValueOnce({});

      await adapter.resolveCommentThread(7, 42);

      const [, variables] = mockOctokitInstance.graphql.mock.calls[1];
      expect(variables).toEqual({ threadId: "node-1" });
    });

    it("still resolves with the raw id when node id conversion fails", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.graphql
        .mockRejectedValueOnce(new Error("graphql down"))
        .mockResolvedValueOnce({});
      mockOctokitInstance.pulls.getReviewComment.mockRejectedValueOnce(new Error("rest down"));

      await adapter.resolveCommentThread(7, 42);

      const [, variables] = mockOctokitInstance.graphql.mock.calls[1];
      expect(variables).toEqual({ threadId: "42" });
    });

    it("rethrows when the resolve mutation fails", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.graphql.mockRejectedValueOnce(new Error("resolve failed"));

      await expect(adapter.resolveCommentThread(7, "thread-1")).rejects.toThrow("resolve failed");
    });
  });

  describe("attachWorkItemFile", () => {
    it("throws because GitHub issues cannot accept attachments", async () => {
      const adapter = new GitHubAdapter(createTestConfig());

      await expect(adapter.attachWorkItemFile("1", "file.txt", "content")).rejects.toThrow(
        "Attaching files to issues is not supported by the GitHub adapter."
      );
    });
  });

  describe("updatePRDetails", () => {
    it("updates both title and body when provided", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.update.mockResolvedValueOnce({});

      await adapter.updatePRDetails(7, { title: "New title", body: "New body" });

      expect(mockOctokitInstance.pulls.update).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        pull_number: 7,
        title: "New title",
        body: "New body",
      });
    });

    it("omits fields that are not provided", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.update.mockResolvedValueOnce({});

      await adapter.updatePRDetails(7, { title: "Only title" });

      expect(mockOctokitInstance.pulls.update).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        pull_number: 7,
        title: "Only title",
      });
    });

    it("sends only the identifiers when no details are provided", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.update.mockResolvedValueOnce({});

      await adapter.updatePRDetails(7, {});

      expect(mockOctokitInstance.pulls.update).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        pull_number: 7,
      });
    });

    it("rethrows and audits on failure", async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.update.mockRejectedValueOnce(new Error("update failed"));

      await expect(adapter.updatePRDetails(7, { title: "x" })).rejects.toThrow("update failed");
    });
  });

  describe("getProjectDetails", () => {
    it("throws because project review is unsupported", async () => {
      const adapter = new GitHubAdapter(createTestConfig());

      await expect(adapter.getProjectDetails("1")).rejects.toThrow(
        "GitHub project review is not yet supported in this version."
      );
    });
  });
});
