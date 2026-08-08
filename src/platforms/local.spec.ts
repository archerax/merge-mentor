import { describe, expect, it, vi } from "vitest";
import { createStubGitClient } from "../review/gitClients/gitClient.test-helper.js";
import { LocalPlatformAdapter, parseRemoteUrl, toPRFile } from "./local.js";

const BASE_CHANGE = {
  path: "src/app.ts",
  status: "modified" as const,
  additions: 2,
  deletions: 1,
  patch: "diff --git a/src/app.ts b/src/app.ts\n@@ -1,3 +1,4 @@\n",
  sha: "abc123",
};

describe("parseRemoteUrl", () => {
  it("parses GitHub HTTPS URLs", () => {
    expect(parseRemoteUrl("https://github.com/acme/widgets.git")).toEqual({
      platform: "github",
      owner: "acme",
      repo: "widgets",
    });
  });

  it("parses GitHub SSH URLs", () => {
    expect(parseRemoteUrl("git@github.com:acme/widgets.git")).toEqual({
      platform: "github",
      owner: "acme",
      repo: "widgets",
    });
  });

  it("parses Azure DevOps URLs", () => {
    expect(parseRemoteUrl("https://dev.azure.com/org/proj/_git/widgets")).toEqual({
      platform: "azure",
      owner: "org",
      repo: "widgets",
    });
  });

  it("returns empty parts for unrecognized URLs", () => {
    expect(parseRemoteUrl("not-a-url")).toEqual({
      platform: "github",
      owner: "",
      repo: "",
    });
  });
});

describe("toPRFile", () => {
  it("maps a GitFileChange to the PRFile shape", () => {
    expect(toPRFile(BASE_CHANGE)).toEqual({
      filename: "src/app.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      patch: BASE_CHANGE.patch,
      sha: "abc123",
    });
  });
});

describe("LocalPlatformAdapter", () => {
  it("reports a pseudo-PR with number -1 and the current branch", async () => {
    const gitClient = createStubGitClient({
      currentBranch: vi.fn().mockResolvedValue("feat/auth"),
    });
    const adapter = new LocalPlatformAdapter({ repoPath: "/repo", gitClient, baseRef: "main" });

    const details = await adapter.getPRDetails(1);
    expect(details.number).toBe(-1);
    expect(details.headBranch).toBe("feat/auth");
    expect(details.baseBranch).toBe("main");
  });

  it("routes to workingTreeDiff by default", async () => {
    const gitClient = createStubGitClient({
      workingTreeDiff: vi.fn().mockResolvedValue([BASE_CHANGE]),
    });
    const adapter = new LocalPlatformAdapter({ repoPath: "/repo", gitClient });

    const files = await adapter.getPRFiles(1);
    expect(files[0].filename).toBe("src/app.ts");
    expect(gitClient.workingTreeDiff).toHaveBeenCalledWith("/repo", "HEAD");
  });

  it("routes to stagedDiff when stagedOnly is set", async () => {
    const gitClient = createStubGitClient({
      stagedDiff: vi.fn().mockResolvedValue([BASE_CHANGE]),
    });
    const adapter = new LocalPlatformAdapter({ repoPath: "/repo", gitClient, stagedOnly: true });

    await adapter.getPRFiles(1);
    expect(gitClient.stagedDiff).toHaveBeenCalledWith("/repo", "HEAD");
    expect(gitClient.workingTreeDiff).not.toHaveBeenCalled();
  });

  it("routes to ref-to-ref diff when headRef is set", async () => {
    const gitClient = createStubGitClient({
      diff: vi.fn().mockResolvedValue([BASE_CHANGE]),
    });
    const adapter = new LocalPlatformAdapter({
      repoPath: "/repo",
      gitClient,
      baseRef: "main",
      headRef: "feat/x",
    });

    await adapter.getPRFiles(1);
    expect(gitClient.diff).toHaveBeenCalledWith("/repo", "main", "feat/x");
  });

  it("comment and posting methods are safe no-ops", async () => {
    const adapter = new LocalPlatformAdapter({
      repoPath: "/repo",
      gitClient: createStubGitClient(),
    });

    await expect(adapter.getExistingBotComments(1)).resolves.toEqual([]);
    await expect(adapter.getUnresolvedCommentThreads(1)).resolves.toEqual([]);
    await expect(adapter.postCommentReply(1, "t", "body")).resolves.toBeUndefined();
    await expect(adapter.resolveCommentThread(1, "t")).resolves.toBeUndefined();
    await expect(adapter.postInlineComment(1, "f.ts", 1, "body")).resolves.toBeUndefined();
    await expect(adapter.postGeneralComment(1, "body")).resolves.toBeUndefined();
    await expect(adapter.getLinkedPBIIds(1)).resolves.toEqual([]);
    await expect(adapter.updatePRDetails(1, { title: "x" })).resolves.toBeUndefined();
  });

  it("unsupported review methods throw a clear error", async () => {
    const adapter = new LocalPlatformAdapter({
      repoPath: "/repo",
      gitClient: createStubGitClient(),
    });

    await expect(adapter.getCommentThread(1, "t")).rejects.toThrow(/not available/);
    await expect(adapter.getPBIDetails("1")).rejects.toThrow(/not available/);
    await expect(adapter.getProjectDetails("1")).rejects.toThrow(/not available/);
  });

  it("uses provided repoInfo for identity and token is empty", () => {
    const adapter = new LocalPlatformAdapter({
      repoPath: "/repo",
      gitClient: createStubGitClient(),
      repoInfo: { platform: "github", owner: "acme", repo: "widgets" },
    });

    expect(adapter.getProjectIdentifier()).toBe("widgets");
    expect(adapter.getPlatformName()).toBe("github");
    expect(adapter.getRepoInfo()).toEqual({ platform: "github", owner: "acme", repo: "widgets" });
    expect(adapter.getToken()).toBe("");
  });

  it("derives repo name from the directory when no repoInfo is provided", () => {
    const adapter = new LocalPlatformAdapter({
      repoPath: "/tmp/my-app",
      gitClient: createStubGitClient(),
    });

    expect(adapter.getProjectIdentifier()).toBe("my-app");
  });
});
