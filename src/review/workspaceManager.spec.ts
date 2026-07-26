import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PlatformAdapter } from "../platforms/types.js";
import { createStubFileSystem } from "../ports/fileSystem.test-helper.js";
import { createCapturingOutputWriter } from "../ports/outputWriter.test-helper.js";
import type { DiffManifest } from "./diffStorage.js";
import type { RepoManager } from "./repoManager.js";
import { WorkspaceManager } from "./workspaceManager.js";

describe("WorkspaceManager", () => {
  function createMockPlatform(): PlatformAdapter {
    return {
      getProjectIdentifier: vi.fn().mockReturnValue("Hello-World"),
      getPlatformName: vi.fn().mockReturnValue("github"),
      getRepoInfo: vi
        .fn()
        .mockReturnValue({ owner: "octocat", repo: "Hello-World", platform: "github" }),
      getToken: vi.fn().mockReturnValue("github_pat_12345"),
      getPRDetails: vi.fn(),
      getPRFiles: vi.fn(),
      getExistingBotComments: vi.fn(),
      getCommentThread: vi.fn(),
      getUnresolvedCommentThreads: vi.fn(),
      postCommentReply: vi.fn(),
      resolveCommentThread: vi.fn(),
      postInlineComment: vi.fn(),
      postGeneralComment: vi.fn(),
      getLinkedPBIIds: vi.fn(),
      getPBIDetails: vi.fn(),
      getProjectDetails: vi.fn(),
      postPBIComment: vi.fn(),
      updatePRDetails: vi.fn(),
    };
  }

  function createMockRepoManager(): RepoManager {
    return {
      ensureRepo: vi.fn().mockResolvedValue("/tmp/mergementor/clones/octocat-Hello-World"),
      cleanupStaleRepos: vi.fn(),
    } as unknown as RepoManager;
  }

  describe("resolveWorkspace", () => {
    it("returns localWorkspacePath if provided and accessible", async () => {
      const platform = createMockPlatform();
      const repoManager = createMockRepoManager();
      const fileSystem = createStubFileSystem({
        access: vi.fn().mockResolvedValue(undefined),
      });
      const output = createCapturingOutputWriter();

      const manager = new WorkspaceManager(platform, repoManager, fileSystem, output, {
        localWorkspacePath: "/ci/workspace/my-repo",
      });

      const result = await manager.resolveWorkspace("main");

      expect(result).toBe("/ci/workspace/my-repo");
      expect(fileSystem.access).toHaveBeenCalledWith("/ci/workspace/my-repo");
      expect(repoManager.ensureRepo).not.toHaveBeenCalled();
    });

    it("throws error if localWorkspacePath is not accessible", async () => {
      const platform = createMockPlatform();
      const repoManager = createMockRepoManager();
      const fileSystem = createStubFileSystem({
        access: vi.fn().mockRejectedValue(new Error("ENOENT: no such file or directory")),
      });
      const output = createCapturingOutputWriter();

      const manager = new WorkspaceManager(platform, repoManager, fileSystem, output, {
        localWorkspacePath: "/nonexistent/workspace",
      });

      await expect(manager.resolveWorkspace("main")).rejects.toThrow(
        "CI workspace path does not exist or is not accessible: /nonexistent/workspace"
      );
    });

    it("clones repository when localWorkspacePath is not provided", async () => {
      const platform = createMockPlatform();
      const repoManager = createMockRepoManager();
      const fileSystem = createStubFileSystem();
      const output = createCapturingOutputWriter();

      const manager = new WorkspaceManager(platform, repoManager, fileSystem, output);

      const result = await manager.resolveWorkspace("feature-branch");

      expect(result).toBe("/tmp/mergementor/clones/octocat-Hello-World");
      expect(platform.getRepoInfo).toHaveBeenCalled();
      expect(platform.getToken).toHaveBeenCalled();
      expect(repoManager.ensureRepo).toHaveBeenCalledWith(
        { owner: "octocat", repo: "Hello-World", platform: "github" },
        "feature-branch",
        "github_pat_12345"
      );
    });
  });

  describe("ensureRepoCloned", () => {
    it("logs failure and throws error if cloning fails", async () => {
      const platform = createMockPlatform();
      const repoManager = {
        ensureRepo: vi.fn().mockRejectedValue(new Error("Git clone exit code 128")),
      } as unknown as RepoManager;
      const fileSystem = createStubFileSystem();
      const output = createCapturingOutputWriter();

      const manager = new WorkspaceManager(platform, repoManager, fileSystem, output);

      await expect(manager.ensureRepoCloned("main")).rejects.toThrow(
        "Failed to clone repository: Git clone exit code 128"
      );
      expect(output.output.some((entry) => entry.data.includes("Failed to clone repository"))).toBe(
        true
      );
    });
  });

  describe("copyDiffsToRepoDir", () => {
    it("copies diff files to repoPath/.mergementor/diffs when repoPath is provided", async () => {
      const platform = createMockPlatform();
      const repoManager = createMockRepoManager();
      const fileSystem = createStubFileSystem({
        readFile: vi.fn().mockImplementation((filePath: string) => {
          if (filePath.endsWith("diff1.patch")) return Promise.resolve("diff content 1");
          if (filePath.endsWith("diff2.patch")) return Promise.resolve("diff content 2!!");
          return Promise.resolve("");
        }),
        writeFile: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockResolvedValue(undefined),
      });
      const output = createCapturingOutputWriter();

      const manager = new WorkspaceManager(platform, repoManager, fileSystem, output);

      const manifest: DiffManifest = {
        prIdentifier: "PR-123",
        createdAt: "2026-07-26T12:00:00Z",
        files: [
          {
            filename: "src/a.ts",
            status: "modified",
            diffPath: "diff1.patch",
            additions: 5,
            deletions: 1,
          },
          {
            filename: "src/b.ts",
            status: "modified",
            diffPath: "diff2.patch",
            additions: 10,
            deletions: 0,
          },
        ],
      };

      const result = await manager.copyDiffsToRepoDir(
        "/tmp/source-diffs",
        manifest,
        "/path/to/repo"
      );

      const expectedTargetDir = path.join("/path/to/repo", ".mergementor", "diffs");
      expect(fileSystem.mkdir).toHaveBeenCalledWith(expectedTargetDir, { recursive: true });
      expect(fileSystem.writeFile).toHaveBeenCalledWith(
        path.join(expectedTargetDir, "diff1.patch"),
        "diff content 1",
        "utf-8"
      );
      expect(fileSystem.writeFile).toHaveBeenCalledWith(
        path.join(expectedTargetDir, "diff2.patch"),
        "diff content 2!!",
        "utf-8"
      );
      expect(result.paths).toEqual([
        path.join(expectedTargetDir, "diff1.patch"),
        path.join(expectedTargetDir, "diff2.patch"),
      ]);
      expect(result.totalSize).toBe("diff content 1".length + "diff content 2!!".length);
    });

    it("uses default tempPath when repoPath is omitted", async () => {
      const platform = createMockPlatform();
      const repoManager = createMockRepoManager();
      const fileSystem = createStubFileSystem();
      const output = createCapturingOutputWriter();

      const manager = new WorkspaceManager(platform, repoManager, fileSystem, output, {
        tempPath: "/custom/temp",
      });

      const manifest: DiffManifest = {
        prIdentifier: "PR-456",
        createdAt: "2026-07-26T12:00:00Z",
        files: [
          {
            filename: "src/main.ts",
            status: "modified",
            diffPath: "main.patch",
            additions: 1,
            deletions: 0,
          },
        ],
      };

      const result = await manager.copyDiffsToRepoDir("/tmp/diffs", manifest);

      const expectedTargetDir = path.join("/custom/temp", "temp");
      expect(fileSystem.mkdir).toHaveBeenCalledWith(expectedTargetDir, { recursive: true });
      expect(result.paths).toEqual([path.join(expectedTargetDir, "main.patch")]);
    });

    it("rethrows error when reading a diff file fails", async () => {
      const platform = createMockPlatform();
      const repoManager = createMockRepoManager();
      const fileSystem = createStubFileSystem({
        readFile: vi.fn().mockRejectedValue(new Error("Permission denied")),
      });
      const output = createCapturingOutputWriter();

      const manager = new WorkspaceManager(platform, repoManager, fileSystem, output);

      const manifest: DiffManifest = {
        prIdentifier: "PR-789",
        createdAt: "2026-07-26T12:00:00Z",
        files: [
          {
            filename: "src/main.ts",
            status: "modified",
            diffPath: "main.patch",
            additions: 1,
            deletions: 0,
          },
        ],
      };

      await expect(manager.copyDiffsToRepoDir("/tmp/diffs", manifest)).rejects.toThrow(
        "Permission denied"
      );
    });
  });
});
