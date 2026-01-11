/**
 * Integration tests for platform adapters with mocked API clients.
 * Tests GitHub and Azure DevOps adapters with realistic mock responses.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../src/config.js";

// Create a proper mock Octokit class
const mockOctokit = {
  pulls: {
    get: vi.fn().mockResolvedValue({
      data: {
        number: 42,
        title: "Test PR",
        body: "Test description",
        user: { login: "test-user" },
        base: { ref: "main" },
        head: { ref: "feature/test", sha: "abc123" },
      },
    }),
    listFiles: vi.fn().mockResolvedValue({
      data: [
        {
          filename: "src/app.ts",
          status: "modified",
          additions: 10,
          deletions: 5,
          patch: "@@ -1,5 +1,10 @@\n+const x = 1;",
          sha: "file-sha-1",
        },
        {
          filename: "src/utils.ts",
          status: "added",
          additions: 20,
          deletions: 0,
          patch: "@@ -0,0 +1,20 @@\n+export function util() {}",
          sha: "file-sha-2",
        },
      ],
    }),
    listReviewComments: vi.fn().mockResolvedValue({
      data: [
        {
          id: 1001,
          body: "[TestBot]\n\nPrevious comment",
          path: "src/app.ts",
          line: 5,
        },
      ],
    }),
    createReviewComment: vi.fn().mockResolvedValue({ data: { id: 1002 } }),
    updateReviewComment: vi.fn().mockResolvedValue({ data: {} }),
    getReviewComment: vi.fn().mockResolvedValue({
      data: {
        id: 1001,
        pull_request_review_id: 5001,
      },
    }),
  },
  issues: {
    listComments: vi.fn().mockResolvedValue({
      data: [
        {
          id: 2001,
          body: "[TestBot]\n\nGeneral comment",
        },
      ],
    }),
    createComment: vi.fn().mockResolvedValue({ data: { id: 2002 } }),
    updateComment: vi.fn().mockResolvedValue({ data: {} }),
  },
  graphql: vi.fn().mockResolvedValue({
    resolveReviewThread: { thread: { id: "thread-1", isResolved: true } },
  }),
};

// Mock Octokit before importing GitHubAdapter
vi.mock("@octokit/rest", () => ({
  Octokit: function Octokit() {
    return mockOctokit;
  },
}));

// Create mock Azure DevOps Git API
const mockGitApi = {
  getPullRequestById: vi.fn().mockResolvedValue({
    pullRequestId: 42,
    title: "Azure Test PR",
    description: "Azure test description",
    createdBy: { displayName: "azure-user" },
    targetRefName: "refs/heads/main",
    sourceRefName: "refs/heads/feature/test",
    lastMergeSourceCommit: { commitId: "source-sha" },
    lastMergeTargetCommit: { commitId: "target-sha" },
    repository: { id: "repo-id" },
  }),
  getPullRequestIterations: vi.fn().mockResolvedValue([
    {
      id: 1,
      sourceRefCommit: { commitId: "head-sha" },
      commonRefCommit: { commitId: "base-sha" },
    },
  ]),
  getPullRequestIterationChanges: vi.fn().mockResolvedValue({
    changeEntries: [
      {
        changeType: 2, // Edit
        item: { path: "/src/app.ts", objectId: "blob-sha" },
      },
    ],
  }),
  getFileDiffs: vi.fn().mockResolvedValue([
    {
      path: "/src/app.ts",
      lineDiffBlocks: [
        {
          originalLineNumberStart: 1,
          originalLinesCount: 5,
          modifiedLineNumberStart: 1,
          modifiedLinesCount: 10,
        },
      ],
    },
  ]),
  getBlobContent: vi.fn().mockImplementation(async function* () {
    yield Buffer.from("const x = 1;\nconst y = 2;\n");
  }),
  getThreads: vi.fn().mockResolvedValue([
    {
      id: 3001,
      comments: [{ content: "[TestBot]\n\nAzure comment" }],
      threadContext: {
        filePath: "/src/app.ts",
        rightFileStart: { line: 5 },
      },
      status: 1, // Active
    },
  ]),
  createThread: vi.fn().mockResolvedValue({ id: 3002 }),
};

// Mock global fetch for Azure DevOps REST API calls
const mockFetch = vi.fn().mockImplementation((url) => {
  if (typeof url === "string" && url.includes("/changes?")) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          changeEntries: [
            {
              changeType: 2, // Edit
              item: { path: "/src/app.ts", objectId: "blob-sha", gitObjectType: "blob" },
            },
          ],
        }),
    });
  }
  if (typeof url === "string" && url.includes("/items?")) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          content: "const x = 1;\nconst y = 2;\n",
        }),
    });
  }
  return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
});

vi.stubGlobal("fetch", mockFetch);

// Mock Azure DevOps API
vi.mock("azure-devops-node-api", () => ({
  WebApi: function WebApi() {
    return {
      getGitApi: vi.fn().mockResolvedValue(mockGitApi),
    };
  },
  getPersonalAccessTokenHandler: vi.fn().mockReturnValue({}),
}));

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock rate limit handler
vi.mock("../../src/utils/rateLimitHandler.js", () => ({
  withRateLimitHandling: vi.fn((fn) => fn()),
}));

describe("GitHubAdapter Integration", () => {
  let config: Config;

  beforeEach(() => {
    vi.clearAllMocks();
    config = {
      defaultPlatform: "github",
      botCommentIdentifier: "[TestBot]",
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
    };
  });

  describe("getPRDetails", () => {
    it("fetches PR details from GitHub", async () => {
      const { GitHubAdapter } = await import("../../src/platforms/github.js");
      const adapter = new GitHubAdapter(config);

      const details = await adapter.getPRDetails(42);

      expect(details.number).toBe(42);
      expect(details.title).toBe("Test PR");
      expect(details.author).toBe("test-user");
      expect(details.baseBranch).toBe("main");
      expect(details.headBranch).toBe("feature/test");
    });
  });

  describe("getPRFiles", () => {
    it("fetches and transforms PR files", async () => {
      const { GitHubAdapter } = await import("../../src/platforms/github.js");
      const adapter = new GitHubAdapter(config);

      const files = await adapter.getPRFiles(42);

      expect(files).toHaveLength(2);
      expect(files[0].filename).toBe("src/app.ts");
      expect(files[0].status).toBe("modified");
      expect(files[0].sha).toBe("file-sha-1");
      expect(files[1].filename).toBe("src/utils.ts");
      expect(files[1].status).toBe("added");
    });
  });

  describe("getExistingBotComments", () => {
    it("filters comments by bot identifier", async () => {
      const { GitHubAdapter } = await import("../../src/platforms/github.js");
      const adapter = new GitHubAdapter(config);

      const comments = await adapter.getExistingBotComments(42);

      expect(comments.length).toBeGreaterThan(0);
      expect(comments.some((c) => c.body.includes("[TestBot]"))).toBe(true);
    });
  });

  describe("postInlineComment", () => {
    it("posts inline comment to correct location", async () => {
      const { GitHubAdapter } = await import("../../src/platforms/github.js");
      const adapter = new GitHubAdapter(config);

      await adapter.postInlineComment(42, "src/app.ts", 10, "Test comment");

      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalled();
    });
  });

  describe("postGeneralComment", () => {
    it("posts general comment on PR", async () => {
      const { GitHubAdapter } = await import("../../src/platforms/github.js");
      const adapter = new GitHubAdapter(config);

      await adapter.postGeneralComment(42, "General review comment");

      expect(mockOctokit.issues.createComment).toHaveBeenCalled();
    });
  });
});

describe("AzureDevOpsAdapter Integration", () => {
  let config: Config;

  beforeEach(() => {
    vi.clearAllMocks();
    config = {
      defaultPlatform: "azure",
      botCommentIdentifier: "[TestBot]",
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
    };
  });

  describe("getPRDetails", () => {
    it("fetches PR details from Azure DevOps", async () => {
      const { AzureDevOpsAdapter } = await import("../../src/platforms/azure.js");
      const adapter = new AzureDevOpsAdapter(config);

      const details = await adapter.getPRDetails(42);

      expect(details.number).toBe(42);
      expect(details.title).toBe("Azure Test PR");
      expect(details.author).toBe("azure-user");
      expect(details.baseBranch).toBe("main");
      expect(details.headBranch).toBe("feature/test");
    });
  });

  describe("getPRFiles", () => {
    it("fetches and transforms PR files with diffs", async () => {
      const { AzureDevOpsAdapter } = await import("../../src/platforms/azure.js");
      const adapter = new AzureDevOpsAdapter(config);

      const files = await adapter.getPRFiles(42);

      expect(files).toHaveLength(1);
      expect(files[0].filename).toBe("src/app.ts");
      expect(files[0].status).toBe("modified");
      expect(files[0].patch).toBeDefined();
    });
  });

  describe("getExistingBotComments", () => {
    it("filters threads by bot identifier", async () => {
      const { AzureDevOpsAdapter } = await import("../../src/platforms/azure.js");
      const adapter = new AzureDevOpsAdapter(config);

      const comments = await adapter.getExistingBotComments(42);

      expect(comments.length).toBeGreaterThan(0);
      expect(comments[0].body).toContain("[TestBot]");
    });
  });

  describe("postInlineComment", () => {
    it("creates thread at correct location", async () => {
      const { AzureDevOpsAdapter } = await import("../../src/platforms/azure.js");
      const adapter = new AzureDevOpsAdapter(config);

      await adapter.postInlineComment(42, "src/app.ts", 10, "Test comment");

      expect(mockGitApi.createThread).toHaveBeenCalled();
    });
  });

  describe("postGeneralComment", () => {
    it("creates general thread on PR", async () => {
      const { AzureDevOpsAdapter } = await import("../../src/platforms/azure.js");
      const adapter = new AzureDevOpsAdapter(config);

      await adapter.postGeneralComment(42, "General review comment");

      expect(mockGitApi.createThread).toHaveBeenCalled();
    });
  });
});

describe("Cross-platform behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("both adapters implement same interface", async () => {
    const { GitHubAdapter } = await import("../../src/platforms/github.js");
    const { AzureDevOpsAdapter } = await import("../../src/platforms/azure.js");

    const githubConfig: Config = {
      defaultPlatform: "github",
      botCommentIdentifier: "[Bot]",
      github: { token: "t", owner: "o", repo: "r" },
      azure: { token: "", org: "", project: "", repo: "" },
    };

    const azureConfig: Config = {
      defaultPlatform: "azure",
      botCommentIdentifier: "[Bot]",
      github: { token: "", owner: "", repo: "" },
      azure: { token: "t", org: "o", project: "p", repo: "r" },
    };

    const github = new GitHubAdapter(githubConfig);
    const azure = new AzureDevOpsAdapter(azureConfig);

    // Both should have the same methods
    const methods = [
      "getPRDetails",
      "getPRFiles",
      "getExistingBotComments",
      "postInlineComment",
      "postGeneralComment",
      "updateComment",
      "resolveComment",
    ];

    for (const method of methods) {
      expect(typeof (github as never)[method]).toBe("function");
      expect(typeof (azure as never)[method]).toBe("function");
    }
  });

  it("PR details have consistent shape across platforms", async () => {
    const { GitHubAdapter } = await import("../../src/platforms/github.js");
    const { AzureDevOpsAdapter } = await import("../../src/platforms/azure.js");

    const githubConfig: Config = {
      defaultPlatform: "github",
      botCommentIdentifier: "[Bot]",
      github: { token: "t", owner: "o", repo: "r" },
      azure: { token: "", org: "", project: "", repo: "" },
    };

    const azureConfig: Config = {
      defaultPlatform: "azure",
      botCommentIdentifier: "[Bot]",
      github: { token: "", owner: "", repo: "" },
      azure: { token: "t", org: "o", project: "p", repo: "r" },
    };

    const github = new GitHubAdapter(githubConfig);
    const azure = new AzureDevOpsAdapter(azureConfig);

    const githubDetails = await github.getPRDetails(42);
    const azureDetails = await azure.getPRDetails(42);

    // Both should have the same shape
    const expectedKeys = ["number", "title", "description", "author", "baseBranch", "headBranch"];
    for (const key of expectedKeys) {
      expect(key in githubDetails).toBe(true);
      expect(key in azureDetails).toBe(true);
    }
  });
});
