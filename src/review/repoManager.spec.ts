import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RepoInfo, RepoManager } from "./repoManager.js";

// Mock child_process.exec
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    rm: vi.fn(),
  },
}));

const mockExec = vi.mocked(exec);
const mockFs = vi.mocked(fs);

describe("RepoManager", () => {
  let repoManager: RepoManager;
  const testReposDir = "/test/.merge-mentor/repos";

  beforeEach(() => {
    vi.clearAllMocks();
    repoManager = new RepoManager({ reposDir: testReposDir });

    // Default exec mock - succeeds
    mockExec.mockImplementation((_cmd, _opts, callback) => {
      if (callback) {
        callback(null, "success", "");
      }
      return {} as ReturnType<typeof exec>;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("uses default options when none provided", () => {
      const manager = new RepoManager();
      expect(manager).toBeDefined();
    });

    it("accepts custom options", () => {
      const manager = new RepoManager({
        cloneTimeoutMs: 60000,
        fetchTimeoutMs: 15000,
        reposDir: "/custom/repos",
      });
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
      // Repository doesn't exist
      mockFs.stat.mockRejectedValue(new Error("ENOENT"));
      mockFs.mkdir.mockResolvedValue(undefined);

      const result = await repoManager.ensureRepo(repoInfo, branch, token);

      expect(result).toBe(path.join(testReposDir, "github-testowner-testrepo"));
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining("git clone"),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it("updates repository when it already exists", async () => {
      // Repository exists
      mockFs.stat.mockResolvedValue({ isDirectory: () => true } as unknown as Awaited<
        ReturnType<typeof fs.stat>
      >);

      const result = await repoManager.ensureRepo(repoInfo, branch, token);

      expect(result).toBe(path.join(testReposDir, "github-testowner-testrepo"));
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining("git -C"),
        expect.any(Object),
        expect.any(Function)
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
      mockFs.stat.mockRejectedValue(new Error("ENOENT"));
      mockFs.mkdir.mockResolvedValue(undefined);

      const result = await repoManager.ensureRepo(azureRepoInfo, branch, token);

      expect(result).toBe(path.join(testReposDir, "azure-myorg-myproject-azurerepo"));
    });

    it("uses correct clone URL for GitHub", async () => {
      mockFs.stat.mockRejectedValue(new Error("ENOENT"));
      mockFs.mkdir.mockResolvedValue(undefined);

      await repoManager.ensureRepo(repoInfo, branch, token);

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining("https://test-token@github.com/testowner/testrepo.git"),
        expect.any(Object),
        expect.any(Function)
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
      mockFs.stat.mockRejectedValue(new Error("ENOENT"));
      mockFs.mkdir.mockResolvedValue(undefined);

      await repoManager.ensureRepo(azureRepoInfo, branch, token);

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining("https://test-token@dev.azure.com/myorg/myproject/_git/azurerepo"),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it("throws error when clone fails", async () => {
      mockFs.stat.mockRejectedValue(new Error("ENOENT"));
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.rm.mockResolvedValue(undefined);

      mockExec.mockImplementation((_cmd, _opts, callback) => {
        if (callback) {
          callback(new Error("Clone failed"), "", "");
        }
        return {} as ReturnType<typeof exec>;
      });

      await expect(repoManager.ensureRepo(repoInfo, branch, token)).rejects.toThrow(
        "Failed to clone repository"
      );
    });

    it("throws error when update fails", async () => {
      mockFs.stat.mockResolvedValue({ isDirectory: () => true } as unknown as Awaited<
        ReturnType<typeof fs.stat>
      >);

      mockExec.mockImplementation((_cmd, _opts, callback) => {
        if (callback) {
          callback(new Error("Fetch failed"), "", "");
        }
        return {} as ReturnType<typeof exec>;
      });

      await expect(repoManager.ensureRepo(repoInfo, branch, token)).rejects.toThrow(
        "Failed to update repository"
      );
    });

    it("cleans up partial clone on failure", async () => {
      mockFs.stat.mockRejectedValue(new Error("ENOENT"));
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.rm.mockResolvedValue(undefined);

      mockExec.mockImplementation((_cmd, _opts, callback) => {
        if (callback) {
          callback(new Error("Clone failed"), "", "");
        }
        return {} as ReturnType<typeof exec>;
      });

      await expect(repoManager.ensureRepo(repoInfo, branch, token)).rejects.toThrow();
      expect(mockFs.rm).toHaveBeenCalledWith(
        expect.stringContaining("github-testowner-testrepo"),
        expect.objectContaining({ recursive: true, force: true })
      );
    });
  });

  describe("loadRepoContext", () => {
    const repoPath = "/test/repo";

    it("loads AGENTS.md when present", async () => {
      mockFs.readFile.mockImplementation(async (filePath) => {
        if (String(filePath).endsWith("AGENTS.md")) {
          return "# Agent Instructions\nTest content";
        }
        throw new Error("ENOENT");
      });
      mockFs.readdir.mockRejectedValue(new Error("ENOENT"));

      const context = await repoManager.loadRepoContext(repoPath);

      expect(context.filesLoaded).toContain("AGENTS.md");
      expect(context.content).toContain("# Agent Instructions");
      expect(context.repoPath).toBe(repoPath);
    });

    it("loads multiple context files", async () => {
      mockFs.readFile.mockImplementation(async (filePath) => {
        const pathStr = String(filePath);
        if (pathStr.endsWith("AGENTS.md")) {
          return "# Agent Instructions";
        }
        if (pathStr.endsWith("CONTRIBUTING.md")) {
          return "# Contributing Guide";
        }
        throw new Error("ENOENT");
      });
      mockFs.readdir.mockRejectedValue(new Error("ENOENT"));

      const context = await repoManager.loadRepoContext(repoPath);

      expect(context.filesLoaded).toContain("AGENTS.md");
      expect(context.filesLoaded).toContain("CONTRIBUTING.md");
      expect(context.content).toContain("# Agent Instructions");
      expect(context.content).toContain("# Contributing Guide");
    });

    it("loads .github/instructions files", async () => {
      mockFs.readFile.mockImplementation(async (filePath) => {
        const pathStr = String(filePath);
        if (pathStr.includes("clean-typescript.instructions.md")) {
          return "# Clean TypeScript";
        }
        throw new Error("ENOENT");
      });
      mockFs.readdir.mockResolvedValue([
        { isFile: () => true, name: "extra.instructions.md" },
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      // Override for extra file
      mockFs.readFile.mockImplementation(async (filePath) => {
        const pathStr = String(filePath);
        if (pathStr.includes("clean-typescript.instructions.md")) {
          return "# Clean TypeScript";
        }
        if (pathStr.includes("extra.instructions.md")) {
          return "# Extra Instructions";
        }
        throw new Error("ENOENT");
      });

      const context = await repoManager.loadRepoContext(repoPath);

      expect(context.content).toContain("# Clean TypeScript");
    });

    it("returns empty content when no context files found", async () => {
      mockFs.readFile.mockRejectedValue(new Error("ENOENT"));
      mockFs.readdir.mockRejectedValue(new Error("ENOENT"));

      const context = await repoManager.loadRepoContext(repoPath);

      expect(context.filesLoaded).toHaveLength(0);
      expect(context.content).toBe("");
    });

    it("skips empty files", async () => {
      mockFs.readFile.mockImplementation(async (filePath) => {
        if (String(filePath).endsWith("AGENTS.md")) {
          return "   \n\t  "; // Whitespace only
        }
        if (String(filePath).endsWith("CONTRIBUTING.md")) {
          return "# Real content";
        }
        throw new Error("ENOENT");
      });
      mockFs.readdir.mockRejectedValue(new Error("ENOENT"));

      const context = await repoManager.loadRepoContext(repoPath);

      expect(context.filesLoaded).not.toContain("AGENTS.md");
      expect(context.filesLoaded).toContain("CONTRIBUTING.md");
    });

    it("does not load duplicate files from instructions directory", async () => {
      const loadedFiles: string[] = [];
      mockFs.readFile.mockImplementation(async (filePath) => {
        const pathStr = String(filePath);
        loadedFiles.push(pathStr);
        if (pathStr.includes("clean-typescript.instructions.md")) {
          return "# Clean TypeScript";
        }
        throw new Error("ENOENT");
      });
      mockFs.readdir.mockResolvedValue([
        { isFile: () => true, name: "clean-typescript.instructions.md" },
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      const context = await repoManager.loadRepoContext(repoPath);

      // Should only have one entry, not duplicate
      const cleanTsCount = context.filesLoaded.filter((f) =>
        f.includes("clean-typescript.instructions.md")
      ).length;
      expect(cleanTsCount).toBe(1);
    });
  });

  describe("listClonedRepos", () => {
    it("returns empty array when repos directory is empty", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);

      const repos = await repoManager.listClonedRepos();

      expect(repos).toEqual([]);
    });

    it("returns directory names only", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        { isDirectory: () => true, name: "github-owner-repo1" },
        { isDirectory: () => true, name: "azure-org-proj-repo2" },
        { isDirectory: () => false, name: "somefile.txt" },
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      const repos = await repoManager.listClonedRepos();

      expect(repos).toEqual(["github-owner-repo1", "azure-org-proj-repo2"]);
    });

    it("returns empty array on error", async () => {
      mockFs.mkdir.mockRejectedValue(new Error("Permission denied"));

      const repos = await repoManager.listClonedRepos();

      expect(repos).toEqual([]);
    });
  });

  describe("getRepoStats", () => {
    it("returns stats for existing repository", async () => {
      const mtime = new Date("2025-01-15");
      mockFs.stat.mockImplementation(async (filePath) => {
        if (String(filePath).endsWith(".git")) {
          return { size: 5000000, isDirectory: () => true } as unknown as Awaited<
            ReturnType<typeof fs.stat>
          >;
        }
        return { isDirectory: () => true, mtime } as unknown as Awaited<ReturnType<typeof fs.stat>>;
      });

      const stats = await repoManager.getRepoStats("github-owner-repo");

      expect(stats).toBeDefined();
      expect(stats!.size).toBe(5000000);
      expect(stats!.lastUsed).toEqual(mtime);
    });

    it("returns undefined for non-existent repository", async () => {
      mockFs.stat.mockRejectedValue(new Error("ENOENT"));

      const stats = await repoManager.getRepoStats("nonexistent");

      expect(stats).toBeUndefined();
    });

    it("returns undefined for non-directory", async () => {
      mockFs.stat.mockResolvedValue({ isDirectory: () => false } as unknown as Awaited<
        ReturnType<typeof fs.stat>
      >);

      const stats = await repoManager.getRepoStats("somefile");

      expect(stats).toBeUndefined();
    });
  });

  describe("cleanOldRepos", () => {
    it("removes repositories older than specified days", async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 60); // 60 days ago

      const newDate = new Date();
      newDate.setDate(newDate.getDate() - 5); // 5 days ago

      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        { isDirectory: () => true, name: "old-repo" },
        { isDirectory: () => true, name: "new-repo" },
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      mockFs.stat.mockImplementation(async (filePath) => {
        const pathStr = String(filePath);
        if (pathStr.includes("old-repo")) {
          if (pathStr.endsWith(".git")) {
            return { size: 1000, isDirectory: () => true } as unknown as Awaited<
              ReturnType<typeof fs.stat>
            >;
          }
          return { isDirectory: () => true, mtime: oldDate } as unknown as Awaited<
            ReturnType<typeof fs.stat>
          >;
        }
        if (pathStr.includes("new-repo")) {
          if (pathStr.endsWith(".git")) {
            return { size: 1000, isDirectory: () => true } as unknown as Awaited<
              ReturnType<typeof fs.stat>
            >;
          }
          return { isDirectory: () => true, mtime: newDate } as unknown as Awaited<
            ReturnType<typeof fs.stat>
          >;
        }
        throw new Error("ENOENT");
      });

      mockFs.rm.mockResolvedValue(undefined);

      const removed = await repoManager.cleanOldRepos(30);

      expect(removed).toBe(1);
      expect(mockFs.rm).toHaveBeenCalledWith(
        expect.stringContaining("old-repo"),
        expect.objectContaining({ recursive: true, force: true })
      );
      expect(mockFs.rm).not.toHaveBeenCalledWith(
        expect.stringContaining("new-repo"),
        expect.any(Object)
      );
    });

    it("returns zero when no old repos found", async () => {
      const newDate = new Date();

      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        { isDirectory: () => true, name: "new-repo" },
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      mockFs.stat.mockImplementation(async (filePath) => {
        if (String(filePath).endsWith(".git")) {
          return { size: 1000, isDirectory: () => true } as unknown as Awaited<
            ReturnType<typeof fs.stat>
          >;
        }
        return { isDirectory: () => true, mtime: newDate } as unknown as Awaited<
          ReturnType<typeof fs.stat>
        >;
      });

      const removed = await repoManager.cleanOldRepos(30);

      expect(removed).toBe(0);
    });

    it("handles empty repos directory", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);

      const removed = await repoManager.cleanOldRepos(30);

      expect(removed).toBe(0);
    });
  });

  describe("timeout handling", () => {
    it("handles clone timeout", async () => {
      const manager = new RepoManager({
        cloneTimeoutMs: 1, // 1ms timeout
        reposDir: testReposDir,
      });

      mockFs.stat.mockRejectedValue(new Error("ENOENT"));
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.rm.mockResolvedValue(undefined);

      // Simulate a command that doesn't complete
      mockExec.mockImplementation((_cmd, opts, callback) => {
        // Don't call callback immediately
        const timeoutId = setTimeout(() => {
          if (callback) {
            callback(null, "done", "");
          }
        }, 100);

        // If signal is aborted, clean up
        if (opts && "signal" in opts && opts.signal) {
          (opts.signal as AbortSignal).addEventListener("abort", () => {
            clearTimeout(timeoutId);
            if (callback) {
              const error = new Error("Command timed out");
              error.name = "AbortError";
              callback(error, "", "");
            }
          });
        }

        return {} as ReturnType<typeof exec>;
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
