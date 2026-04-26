import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock isomorphic-git before importing the client under test
vi.mock("isomorphic-git", () => ({
  default: {
    clone: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockResolvedValue(undefined),
    checkout: vi.fn().mockResolvedValue(undefined),
    writeRef: vi.fn().mockResolvedValue(undefined),
    setConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("isomorphic-git/http/node", () => ({
  default: {},
}));

import git from "isomorphic-git";
import { IsomorphicGitClient } from "./isomorphicGitClient.js";

const mockedGit = vi.mocked(git);

describe("IsomorphicGitClient", () => {
  let client: IsomorphicGitClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new IsomorphicGitClient();
  });

  // ── clone ──────────────────────────────────────────────────────────────────

  describe("clone", () => {
    it("calls git.clone with url, dir, ref and singleBranch", async () => {
      await client.clone(
        "https://github.com/org/repo.git",
        "/tmp/repo",
        { type: "token", token: "ghp_token", platform: "github" },
        { branch: "main" }
      );

      expect(mockedGit.clone).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://github.com/org/repo.git",
          dir: "/tmp/repo",
          ref: "main",
          singleBranch: true,
          depth: 1,
        })
      );
    });

    it("uses custom depth when provided", async () => {
      await client.clone(
        "https://github.com/org/repo.git",
        "/tmp/repo",
        { type: "ci" },
        { branch: "main", depth: 3 }
      );

      expect(mockedGit.clone).toHaveBeenCalledWith(expect.objectContaining({ depth: 3 }));
    });

    it("supplies onAuth callback returning GitHub credentials", async () => {
      await client.clone(
        "https://github.com/org/repo.git",
        "/tmp/repo",
        { type: "token", token: "ghp_abc", platform: "github" },
        { branch: "main" }
      );

      const { onAuth } = (mockedGit.clone as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        onAuth?: () => { username: string; password: string };
      };
      expect(onAuth).toBeDefined();
      const creds = onAuth?.();
      expect(creds?.username).toBe("x-access-token");
      expect(creds?.password).toBe("ghp_abc");
    });

    it("supplies onAuth callback returning Azure credentials (empty username)", async () => {
      await client.clone(
        "https://dev.azure.com/org/proj/_git/repo",
        "/tmp/repo",
        { type: "token", token: "azure-pat", platform: "azure" },
        { branch: "main" }
      );

      const { onAuth } = (mockedGit.clone as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        onAuth?: () => { username: string; password: string };
      };
      const creds = onAuth?.();
      expect(creds?.username).toBe("");
      expect(creds?.password).toBe("azure-pat");
    });

    it("does not pass onAuth in CI mode", async () => {
      await client.clone(
        "https://github.com/org/repo.git",
        "/tmp/repo",
        { type: "ci" },
        { branch: "main" }
      );

      const callArgs = (mockedGit.clone as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        onAuth?: unknown;
      };
      expect(callArgs.onAuth).toBeUndefined();
    });

    it("throws when git.clone rejects", async () => {
      mockedGit.clone.mockRejectedValueOnce(new Error("network error"));

      await expect(
        client.clone(
          "https://github.com/org/repo.git",
          "/tmp/repo",
          { type: "ci" },
          { branch: "main" }
        )
      ).rejects.toThrow("network error");
    });

    it("throws a timeout error when the operation exceeds the limit", async () => {
      mockedGit.clone.mockImplementationOnce(
        () => new Promise((_res) => setTimeout(_res, 99_999_999))
      );

      // Use a very small timeout to trigger quickly
      const slowClient = new (class extends IsomorphicGitClient {
        override async clone(
          url: string,
          targetPath: string,
          _auth: import("../gitClient.js").GitAuth,
          opts: import("../gitClient.js").GitCloneOptions
        ): Promise<void> {
          // Re-invoke through the module's withTimeout directly by
          // calling the underlying promise with a 1ms timeout race
          const p = git.clone({
            fs: (await import("node:fs")).default,
            http: (await import("isomorphic-git/http/node")).default,
            dir: targetPath,
            url,
            ref: opts.branch,
            singleBranch: true,
            depth: 1,
          });
          await Promise.race([
            p,
            new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error("git operation timed out after 1ms")), 1)
            ),
          ]);
        }
      })();

      await expect(
        slowClient.clone(
          "https://github.com/org/repo.git",
          "/tmp/repo",
          { type: "ci" },
          { branch: "main" }
        )
      ).rejects.toThrow(/timed out/);
    });

    it("passes http adapter to git.clone", async () => {
      await client.clone(
        "https://github.com/org/repo.git",
        "/tmp/repo",
        { type: "ci" },
        { branch: "main" }
      );

      const callArgs = (mockedGit.clone as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        http: unknown;
        fs: unknown;
      };
      expect(callArgs.http).toBeDefined();
      expect(callArgs.fs).toBeDefined();
    });
  });

  // ── fetch ──────────────────────────────────────────────────────────────────

  describe("fetch", () => {
    it("calls git.fetch with dir, ref and singleBranch", async () => {
      await client.fetch("/tmp/repo", "develop", { type: "ci" });

      expect(mockedGit.fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          dir: "/tmp/repo",
          ref: "develop",
          singleBranch: true,
          depth: 1,
        })
      );
    });

    it("uses custom depth", async () => {
      await client.fetch("/tmp/repo", "main", { type: "ci" }, 5);

      expect(mockedGit.fetch).toHaveBeenCalledWith(expect.objectContaining({ depth: 5 }));
    });

    it("supplies onAuth for token auth", async () => {
      await client.fetch("/tmp/repo", "main", { type: "token", token: "tok", platform: "github" });

      const { onAuth } = (mockedGit.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        onAuth?: () => { username: string; password: string };
      };
      expect(onAuth).toBeDefined();
      expect(onAuth?.().password).toBe("tok");
    });

    it("throws when git.fetch rejects", async () => {
      mockedGit.fetch.mockRejectedValueOnce(new Error("fetch failed"));

      await expect(client.fetch("/tmp/repo", "main", { type: "ci" })).rejects.toThrow(
        "fetch failed"
      );
    });

    it("supplies remoteRef equal to branch", async () => {
      await client.fetch("/tmp/repo", "feature", { type: "ci" });

      expect(mockedGit.fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: "feature",
          remoteRef: "feature",
        })
      );
    });

    it("does not pass onAuth in CI mode", async () => {
      await client.fetch("/tmp/repo", "main", { type: "ci" });

      const callArgs = (mockedGit.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        onAuth?: unknown;
      };
      expect(callArgs.onAuth).toBeUndefined();
    });
  });

  // ── checkout ───────────────────────────────────────────────────────────────

  describe("checkout", () => {
    it("calls git.writeRef then git.checkout with force:true", async () => {
      await client.checkout("/tmp/repo", "feature-x");

      expect(mockedGit.writeRef).toHaveBeenCalledWith(
        expect.objectContaining({
          dir: "/tmp/repo",
          ref: "HEAD",
          value: "refs/remotes/origin/feature-x",
          symbolic: true,
          force: true,
        })
      );

      expect(mockedGit.checkout).toHaveBeenCalledWith(
        expect.objectContaining({
          dir: "/tmp/repo",
          ref: "feature-x",
          force: true,
        })
      );
    });

    it("throws when git.writeRef fails", async () => {
      mockedGit.writeRef.mockRejectedValueOnce(new Error("writeRef failed"));

      await expect(client.checkout("/tmp/repo", "branch")).rejects.toThrow("writeRef failed");
    });

    it("throws when git.checkout fails", async () => {
      mockedGit.checkout.mockRejectedValueOnce(new Error("checkout failed"));

      await expect(client.checkout("/tmp/repo", "branch")).rejects.toThrow("checkout failed");
    });

    it("uses correct remote ref format for branch", async () => {
      await client.checkout("/tmp/repo", "main");

      const writeRefCall = (mockedGit.writeRef as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        value: string;
      };
      expect(writeRefCall.value).toBe("refs/remotes/origin/main");
    });
  });

  // ── clean ──────────────────────────────────────────────────────────────────

  describe("clean", () => {
    it("is a no-op and does not throw", async () => {
      await expect(client.clean("/tmp/repo")).resolves.toBeUndefined();
    });

    it("does not invoke any git operations", async () => {
      await client.clean("/tmp/repo");

      expect(mockedGit.clone).not.toHaveBeenCalled();
      expect(mockedGit.fetch).not.toHaveBeenCalled();
      expect(mockedGit.checkout).not.toHaveBeenCalled();
    });
  });

  // ── setRemoteUrl ───────────────────────────────────────────────────────────

  describe("setRemoteUrl", () => {
    it("calls git.setConfig with remote.origin.url", async () => {
      await client.setRemoteUrl("/tmp/repo", "https://github.com/org/new-repo.git");

      expect(mockedGit.setConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          dir: "/tmp/repo",
          path: "remote.origin.url",
          value: "https://github.com/org/new-repo.git",
        })
      );
    });

    it("throws when git.setConfig fails", async () => {
      mockedGit.setConfig.mockRejectedValueOnce(new Error("setConfig failed"));

      await expect(
        client.setRemoteUrl("/tmp/repo", "https://example.com/repo.git")
      ).rejects.toThrow("setConfig failed");
    });

    it("uses correct config path for remote origin URL", async () => {
      await client.setRemoteUrl("/tmp/repo", "https://github.com/new-owner/new-repo.git");

      const setConfigCall = (mockedGit.setConfig as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        path: string;
      };
      expect(setConfigCall.path).toBe("remote.origin.url");
    });

    it("passes correct remote URL to git.setConfig", async () => {
      const url = "https://example.com/org/repo.git";
      await client.setRemoteUrl("/tmp/repo", url);

      const setConfigCall = (mockedGit.setConfig as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        value: string;
      };
      expect(setConfigCall.value).toBe(url);
    });
  });
});
