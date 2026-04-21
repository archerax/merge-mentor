import type { Stats } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, type Mocked } from "vitest";
import type { Clock } from "../ports/clock.js";
import { createFixedClock } from "../ports/clock.test-helper.js";
import type { FileSystem } from "../ports/fileSystem.js";
import { createStubFileSystem } from "../ports/fileSystem.test-helper.js";
import type { GitClient } from "./gitClient.js";
import { createStubGitClient } from "./gitClients/gitClient.test-helper.js";
import { type RepoInfo, RepoManager } from "./repoManager.js";

describe("RepoManager", () => {
  let repoManager: RepoManager;
  let fileSystem: Mocked<FileSystem>;
  let gitClient: Mocked<GitClient>;
  let clock: Clock;

  const testTempPath = "/test/.mergementor";
  const testReposDir = "/test/.mergementor/repos";

  beforeEach(() => {
    fileSystem = createStubFileSystem() as Mocked<FileSystem>;
    gitClient = createStubGitClient() as Mocked<GitClient>;
    clock = createFixedClock("2025-01-15T10:00:00.000Z");
    repoManager = new RepoManager(testTempPath, undefined, gitClient, fileSystem, clock);
  });

  describe("constructor", () => {
    it("uses default options when none provided", () => {
      const manager = new RepoManager(testTempPath, undefined, gitClient, fileSystem, clock);
      expect(manager).toBeDefined();
    });

    it("accepts ciMode option", () => {
      const manager = new RepoManager(testTempPath, { ciMode: true }, gitClient, fileSystem, clock);
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
      expect(gitClient.clone).toHaveBeenCalledOnce();
    });

    it("updates repository when it already exists", async () => {
      fileSystem.stat.mockResolvedValue({
        isDirectory: () => true,
      } as unknown as Stats);

      const result = await repoManager.ensureRepo(repoInfo, branch, token);

      expect(result).toBe(path.join(testReposDir, "github-testowner-testrepo"));
      expect(gitClient.fetch).toHaveBeenCalledOnce();
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

    it("passes GitHub clone URL to gitClient.clone", async () => {
      fileSystem.stat.mockRejectedValue(new Error("ENOENT"));

      await repoManager.ensureRepo(repoInfo, branch, token);

      expect(gitClient.clone).toHaveBeenCalledWith(
        "https://github.com/testowner/testrepo.git",
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ branch })
      );
    });

    it("passes Azure DevOps clone URL to gitClient.clone", async () => {
      const azureRepoInfo: RepoInfo = {
        owner: "azureowner",
        repo: "azurerepo",
        platform: "azure",
        org: "myorg",
        project: "myproject",
      };
      fileSystem.stat.mockRejectedValue(new Error("ENOENT"));

      await repoManager.ensureRepo(azureRepoInfo, branch, token);

      expect(gitClient.clone).toHaveBeenCalledWith(
        "https://dev.azure.com/myorg/myproject/_git/azurerepo",
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ branch })
      );
    });

    it("passes token auth to gitClient.clone for GitHub", async () => {
      fileSystem.stat.mockRejectedValue(new Error("ENOENT"));

      await repoManager.ensureRepo(repoInfo, branch, token);

      expect(gitClient.clone).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { type: "token", token, platform: "github" },
        expect.any(Object)
      );
    });

    it("passes token auth to gitClient.clone for Azure DevOps", async () => {
      const azureRepoInfo: RepoInfo = {
        owner: "azureowner",
        repo: "azurerepo",
        platform: "azure",
        org: "myorg",
        project: "myproject",
      };
      fileSystem.stat.mockRejectedValue(new Error("ENOENT"));

      await repoManager.ensureRepo(azureRepoInfo, branch, token);

      expect(gitClient.clone).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { type: "token", token, platform: "azure" },
        expect.any(Object)
      );
    });

    it("passes ci auth when ciMode is enabled", async () => {
      const ciManager = new RepoManager(
        testTempPath,
        { ciMode: true },
        gitClient,
        fileSystem,
        clock
      );
      fileSystem.stat.mockRejectedValue(new Error("ENOENT"));

      await ciManager.ensureRepo(repoInfo, branch, token);

      expect(gitClient.clone).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { type: "ci" },
        expect.any(Object)
      );
    });

    it("runs clean, setRemoteUrl, fetch and checkout when updating", async () => {
      fileSystem.stat.mockResolvedValue({
        isDirectory: () => true,
      } as unknown as Stats);

      await repoManager.ensureRepo(repoInfo, branch, token);

      expect(gitClient.clean).toHaveBeenCalledOnce();
      expect(gitClient.setRemoteUrl).toHaveBeenCalledOnce();
      expect(gitClient.fetch).toHaveBeenCalledOnce();
      expect(gitClient.checkout).toHaveBeenCalledOnce();
    });

    it("throws error when clone fails", async () => {
      fileSystem.stat.mockRejectedValue(new Error("ENOENT"));
      gitClient.clone.mockRejectedValue(new Error("Clone failed"));

      await expect(repoManager.ensureRepo(repoInfo, branch, token)).rejects.toThrow(
        "Failed to clone repository"
      );
    });

    it("redacts token from clone error messages", async () => {
      fileSystem.stat.mockRejectedValue(new Error("ENOENT"));
      gitClient.clone.mockRejectedValue(
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
      gitClient.fetch.mockRejectedValue(new Error("Fetch failed"));

      await expect(repoManager.ensureRepo(repoInfo, branch, token)).rejects.toThrow(
        "Failed to update repository"
      );
    });

    it("redacts token from update error messages", async () => {
      fileSystem.stat.mockResolvedValue({
        isDirectory: () => true,
      } as unknown as Stats);
      gitClient.fetch.mockRejectedValue(
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
      gitClient.clone.mockRejectedValue(new Error("Clone failed"));

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
    it("propagates timeout error from gitClient.clone", async () => {
      gitClient.clone.mockRejectedValue(new Error("Command timed out after 120000ms"));
      fileSystem.stat.mockRejectedValue(new Error("ENOENT"));

      const repoInfo: RepoInfo = {
        owner: "testowner",
        repo: "testrepo",
        platform: "github",
      };

      await expect(repoManager.ensureRepo(repoInfo, "main", "token")).rejects.toThrow(
        "Failed to clone repository"
      );
    });
  });
});
