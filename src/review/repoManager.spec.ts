import type { Stats } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, type Mocked } from "vitest";
import type { Clock } from "../ports/clock.js";
import { createFixedClock } from "../ports/clock.test-helper.js";
import type { FileSystem } from "../ports/fileSystem.js";
import { createStubFileSystem } from "../ports/fileSystem.test-helper.js";
import type { ProcessRunner } from "../ports/processRunner.js";
import { createStubProcessRunner } from "../ports/processRunner.test-helper.js";
import { type RepoInfo, RepoManager } from "./repoManager.js";

describe("RepoManager", () => {
  let repoManager: RepoManager;
  let fileSystem: Mocked<FileSystem>;
  let processRunner: Mocked<ProcessRunner>;
  let clock: Clock;

  const testTempPath = "/test/.mergementor";
  const testReposDir = "/test/.mergementor/repos";

  beforeEach(() => {
    fileSystem = createStubFileSystem() as Mocked<FileSystem>;
    processRunner = createStubProcessRunner() as Mocked<ProcessRunner>;
    clock = createFixedClock("2025-01-15T10:00:00.000Z");
    repoManager = new RepoManager(testTempPath, undefined, fileSystem, processRunner, clock);
  });

  describe("constructor", () => {
    it("uses default options when none provided", () => {
      const manager = new RepoManager(testTempPath, undefined, fileSystem, processRunner, clock);
      expect(manager).toBeDefined();
    });

    it("accepts custom options", () => {
      const manager = new RepoManager(
        testTempPath,
        { cloneTimeoutMs: 60000, fetchTimeoutMs: 15000 },
        fileSystem,
        processRunner,
        clock
      );
      expect(manager).toBeDefined();
    });
  });

  describe("ensureRepo", () => {
    const repoInfo: RepoInfo = {
      owner: "testowner",
      repo: "testrepo",
      platform: "github",
    };
    const branch = "main";
    const token = "test-token";

    it("clones repository when it does not exist", async () => {
      fileSystem.stat.mockRejectedValue(new Error("ENOENT"));

      const result = await repoManager.ensureRepo(repoInfo, branch, token);

      expect(result).toBe(path.join(testReposDir, "github-testowner-testrepo"));
      expect(processRunner.execFile).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["clone"]),
        expect.any(Object)
      );
    });

    it("updates repository when it already exists", async () => {
      fileSystem.stat.mockResolvedValue({
        isDirectory: () => true,
      } as unknown as Stats);

      const result = await repoManager.ensureRepo(repoInfo, branch, token);

      expect(result).toBe(path.join(testReposDir, "github-testowner-testrepo"));
      expect(processRunner.execFile).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["-C"]),
        expect.any(Object)
      );
    });

    it("generates correct path for Azure DevOps repository", async () => {
      const azureRepoInfo: RepoInfo = {
        owner: "azureowner",
        repo: "azurerepo",
        platform: "azure",
        org: "myorg",
        project: "myproject",
      };
      fileSystem.stat.mockRejectedValue(new Error("ENOENT"));

      const result = await repoManager.ensureRepo(azureRepoInfo, branch, token);

      expect(result).toBe(path.join(testReposDir, "azure-myorg-myproject-azurerepo"));
    });

    it("uses correct clone URL for GitHub", async () => {
      fileSystem.stat.mockRejectedValue(new Error("ENOENT"));

      await repoManager.ensureRepo(repoInfo, branch, token);

      expect(processRunner.execFile).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["https://github.com/testowner/testrepo.git"]),
        expect.any(Object)
      );
    });

    it("uses correct clone URL for Azure DevOps", async () => {
      const azureRepoInfo: RepoInfo = {
        owner: "azureowner",
        repo: "azurerepo",
        platform: "azure",
        org: "myorg",
        project: "myproject",
      };
      fileSystem.stat.mockRejectedValue(new Error("ENOENT"));

      await repoManager.ensureRepo(azureRepoInfo, branch, token);

      expect(processRunner.execFile).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["https://dev.azure.com/myorg/myproject/_git/azurerepo"]),
        expect.any(Object)
      );
    });

    it("passes branch as a separate argument, not a shell string", async () => {
      const maliciousBranch = "main; rm -rf /";
      fileSystem.stat.mockRejectedValue(new Error("ENOENT"));

      await repoManager.ensureRepo(repoInfo, maliciousBranch, token);

      // Shell metacharacters are inert because execFile passes args directly to git
      expect(processRunner.execFile).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining([maliciousBranch]),
        expect.any(Object)
      );
      expect(processRunner.exec).not.toHaveBeenCalled();
    });

    it("throws error when clone fails", async () => {
      fileSystem.stat.mockRejectedValue(new Error("ENOENT"));
      processRunner.execFile.mockRejectedValue(new Error("Clone failed"));

      await expect(repoManager.ensureRepo(repoInfo, branch, token)).rejects.toThrow(
        "Failed to clone repository"
      );
    });

    it("redacts token from clone error messages", async () => {
      fileSystem.stat.mockRejectedValue(new Error("ENOENT"));
      processRunner.execFile.mockRejectedValue(
        new Error(
          `fatal: repository 'https://${token}@github.com/testowner/testrepo.git' not found`
        )
      );

      await expect(repoManager.ensureRepo(repoInfo, branch, token)).rejects.toSatisfy(
        (err: Error) => !err.message.includes(token)
      );
    });

    it("throws error when update fails", async () => {
      fileSystem.stat.mockResolvedValue({
        isDirectory: () => true,
      } as unknown as Stats);
      processRunner.execFile.mockRejectedValue(new Error("Fetch failed"));

      await expect(repoManager.ensureRepo(repoInfo, branch, token)).rejects.toThrow(
        "Failed to update repository"
      );
    });

    it("redacts token from update error messages", async () => {
      fileSystem.stat.mockResolvedValue({
        isDirectory: () => true,
      } as unknown as Stats);
      processRunner.execFile.mockRejectedValue(
        new Error(
          `error: could not read Username for 'https://${token}@github.com': No such device or address`
        )
      );

      await expect(repoManager.ensureRepo(repoInfo, branch, token)).rejects.toSatisfy(
        (err: Error) => !err.message.includes(token)
      );
    });

    it("cleans up partial clone on failure", async () => {
      fileSystem.stat.mockRejectedValue(new Error("ENOENT"));
      processRunner.execFile.mockRejectedValue(new Error("Clone failed"));

      await expect(repoManager.ensureRepo(repoInfo, branch, token)).rejects.toThrow();
      expect(fileSystem.rm).toHaveBeenCalledWith(
        expect.stringContaining("github-testowner-testrepo"),
        expect.objectContaining({ recursive: true, force: true })
      );
    });
  });

  describe("listClonedRepos", () => {
    it("returns empty array when repos directory is empty", async () => {
      fileSystem.readdir.mockResolvedValue([]);

      const repos = await repoManager.listClonedRepos();

      expect(repos).toEqual([]);
    });

    it("returns directory names only", async () => {
      fileSystem.readdir.mockResolvedValue([
        { isDirectory: () => true, name: "github-owner-repo1" },
        { isDirectory: () => true, name: "azure-org-proj-repo2" },
        { isDirectory: () => false, name: "somefile.txt" },
      ] as unknown as Awaited<ReturnType<typeof fileSystem.readdir>>);

      const repos = await repoManager.listClonedRepos();

      expect(repos).toEqual(["github-owner-repo1", "azure-org-proj-repo2"]);
    });

    it("returns empty array on error", async () => {
      fileSystem.mkdir.mockRejectedValue(new Error("Permission denied"));

      const repos = await repoManager.listClonedRepos();

      expect(repos).toEqual([]);
    });
  });

  describe("getRepoStats", () => {
    it("returns stats for existing repository", async () => {
      const mtime = new Date("2025-01-15");
      fileSystem.stat.mockImplementation(async (filePath) => {
        if (String(filePath).endsWith(".git")) {
          return { size: 5000000, isDirectory: () => true } as unknown as Stats;
        }
        return { isDirectory: () => true, mtime } as unknown as Stats;
      });

      const stats = await repoManager.getRepoStats("github-owner-repo");

      expect(stats).toBeDefined();
      expect(stats?.size).toBe(5000000);
      expect(stats?.lastUsed).toEqual(mtime);
    });

    it("returns undefined for non-existent repository", async () => {
      fileSystem.stat.mockRejectedValue(new Error("ENOENT"));

      const stats = await repoManager.getRepoStats("nonexistent");

      expect(stats).toBeUndefined();
    });

    it("returns undefined for non-directory", async () => {
      fileSystem.stat.mockResolvedValue({
        isDirectory: () => false,
      } as unknown as Stats);

      const stats = await repoManager.getRepoStats("somefile");

      expect(stats).toBeUndefined();
    });
  });

  describe("cleanOldRepos", () => {
    it("removes repositories older than specified days", async () => {
      // Clock is fixed at 2025-01-15T10:00:00.000Z
      const oldDate = new Date("2024-11-01"); // ~75 days ago, well beyond 30-day cutoff
      const newDate = new Date("2025-01-10"); // 5 days ago, within 30-day cutoff

      fileSystem.readdir.mockResolvedValue([
        { isDirectory: () => true, name: "old-repo" },
        { isDirectory: () => true, name: "new-repo" },
      ] as unknown as Awaited<ReturnType<typeof fileSystem.readdir>>);

      fileSystem.stat.mockImplementation(async (filePath) => {
        const pathStr = String(filePath);
        if (pathStr.includes("old-repo")) {
          if (pathStr.endsWith(".git")) {
            return { size: 1000, isDirectory: () => true } as unknown as Stats;
          }
          return { isDirectory: () => true, mtime: oldDate } as unknown as Stats;
        }
        if (pathStr.includes("new-repo")) {
          if (pathStr.endsWith(".git")) {
            return { size: 1000, isDirectory: () => true } as unknown as Stats;
          }
          return { isDirectory: () => true, mtime: newDate } as unknown as Stats;
        }
        throw new Error("ENOENT");
      });

      const removed = await repoManager.cleanOldRepos(30);

      expect(removed).toBe(1);
      expect(fileSystem.rm).toHaveBeenCalledWith(
        expect.stringContaining("old-repo"),
        expect.objectContaining({ recursive: true, force: true })
      );
      expect(fileSystem.rm).not.toHaveBeenCalledWith(
        expect.stringContaining("new-repo"),
        expect.any(Object)
      );
    });

    it("returns zero when no old repos found", async () => {
      const newDate = new Date("2025-01-14"); // 1 day ago, within 30-day cutoff

      fileSystem.readdir.mockResolvedValue([
        { isDirectory: () => true, name: "new-repo" },
      ] as unknown as Awaited<ReturnType<typeof fileSystem.readdir>>);

      fileSystem.stat.mockImplementation(async (filePath) => {
        if (String(filePath).endsWith(".git")) {
          return { size: 1000, isDirectory: () => true } as unknown as Stats;
        }
        return { isDirectory: () => true, mtime: newDate } as unknown as Stats;
      });

      const removed = await repoManager.cleanOldRepos(30);

      expect(removed).toBe(0);
    });

    it("handles empty repos directory", async () => {
      fileSystem.readdir.mockResolvedValue([]);

      const removed = await repoManager.cleanOldRepos(30);

      expect(removed).toBe(0);
    });
  });

  describe("timeout handling", () => {
    it("handles clone timeout", async () => {
      const manager = new RepoManager(
        testTempPath,
        { cloneTimeoutMs: 1 },
        fileSystem,
        processRunner,
        clock
      );

      fileSystem.stat.mockRejectedValue(new Error("ENOENT"));

      // Simulate a command that rejects with AbortError when signal fires
      processRunner.execFile.mockImplementation(async (_file, _args, options) => {
        return new Promise((_resolve, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error("Should have been aborted"));
          }, 5000);

          if (options?.signal) {
            options.signal.addEventListener("abort", () => {
              clearTimeout(timeoutId);
              const error = new Error("Command timed out");
              error.name = "AbortError";
              reject(error);
            });
          }
        });
      });

      const repoInfo: RepoInfo = {
        owner: "testowner",
        repo: "testrepo",
        platform: "github",
      };

      await expect(manager.ensureRepo(repoInfo, "main", "token")).rejects.toThrow();
    });
  });
});
