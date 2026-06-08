import { describe, expect, it } from "vitest";
import { createStubProcessRunner } from "../../ports/processRunner.test-helper.js";
import { buildAuthArgs, buildGitEnv, CliGitClient } from "./cliGitClient.js";

describe("CliGitClient", () => {
  function makeClient() {
    const runner = createStubProcessRunner();
    const client = new CliGitClient(runner);
    return { client, runner } as const;
  }

  // ── clone ──────────────────────────────────────────────────────────────────

  describe("clone", () => {
    it("passes 'clone' with branch, depth, url and targetPath to execFile", async () => {
      const { client, runner } = makeClient();

      await client.clone(
        "https://github.com/org/repo.git",
        "/tmp/repo",
        { type: "token", token: "ghp_token", platform: "github" },
        { branch: "main" }
      );

      expect(runner.execFile).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["clone", "--branch", "main", "--depth", "1"]),
        expect.any(Object)
      );
    });

    it("includes the target path as the last positional argument", async () => {
      const { client, runner } = makeClient();

      await client.clone(
        "https://github.com/org/repo.git",
        "/tmp/my-repo",
        { type: "token", token: "tok", platform: "github" },
        { branch: "main" }
      );

      const args = (runner.execFile as ReturnType<typeof import("vitest").vi.fn>).mock
        .calls[0][1] as string[];
      expect(args[args.length - 1]).toBe("/tmp/my-repo");
    });

    it("uses custom depth when provided", async () => {
      const { client, runner } = makeClient();

      await client.clone(
        "https://github.com/org/repo.git",
        "/tmp/repo",
        { type: "token", token: "tok", platform: "github" },
        { branch: "main", depth: 5 }
      );

      expect(runner.execFile).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["--depth", "5"]),
        expect.any(Object)
      );
    });

    it("injects GitHub auth header via -c, not in URL", async () => {
      const { client, runner } = makeClient();

      await client.clone(
        "https://github.com/org/repo.git",
        "/tmp/repo",
        { type: "token", token: "my-token", platform: "github" },
        { branch: "main" }
      );

      const args = (runner.execFile as ReturnType<typeof import("vitest").vi.fn>).mock
        .calls[0][1] as string[];
      expect(args).toContain("-c");
      const header = args.find((a) => a.startsWith("http.https://github.com/.extraHeader="));
      expect(header).toBeDefined();
      expect(header).toContain("Authorization: Basic");
      // URL must not contain the raw token
      const url = args.find((a) => a.startsWith("https://github.com"));
      expect(url).not.toContain("my-token");
    });

    it("injects Azure DevOps auth using empty-username PAT format", async () => {
      const { client, runner } = makeClient();

      await client.clone(
        "https://dev.azure.com/org/proj/_git/repo",
        "/tmp/repo",
        { type: "token", token: "azure-pat", platform: "azure" },
        { branch: "main" }
      );

      const args = (runner.execFile as ReturnType<typeof import("vitest").vi.fn>).mock
        .calls[0][1] as string[];
      const header = args.find((a) => a.startsWith("http.https://dev.azure.com/.extraHeader="));
      expect(header).toBeDefined();
      const encoded = header?.split("Authorization: Basic ")[1] ?? "";
      const decoded = Buffer.from(encoded, "base64").toString();
      expect(decoded).toBe(":azure-pat");
    });

    it("does not inject auth args in CI mode", async () => {
      const { client, runner } = makeClient();

      await client.clone(
        "https://github.com/org/repo.git",
        "/tmp/repo",
        { type: "ci" },
        { branch: "main" }
      );

      const args = (runner.execFile as ReturnType<typeof import("vitest").vi.fn>).mock
        .calls[0][1] as string[];
      expect(args).not.toContain("-c");
    });

    it("sets GIT_TERMINAL_PROMPT=0 in env for token auth", async () => {
      const { client, runner } = makeClient();

      await client.clone(
        "https://github.com/org/repo.git",
        "/tmp/repo",
        { type: "token", token: "tok", platform: "github" },
        { branch: "main" }
      );

      const opts = (runner.execFile as ReturnType<typeof import("vitest").vi.fn>).mock
        .calls[0][2] as { env?: Record<string, string> };
      expect(opts.env?.GIT_TERMINAL_PROMPT).toBe("0");
    });

    it("passes branch as a direct argument (shell-injection safe)", async () => {
      const { client, runner } = makeClient();
      const maliciousBranch = "main; rm -rf /";

      await client.clone(
        "https://github.com/org/repo.git",
        "/tmp/repo",
        { type: "ci" },
        { branch: maliciousBranch }
      );

      const args = (runner.execFile as ReturnType<typeof import("vitest").vi.fn>).mock
        .calls[0][1] as string[];
      expect(args).toContain(maliciousBranch);
      expect(runner.exec).not.toHaveBeenCalled();
    });

    it("throws on execFile failure", async () => {
      const runner = createStubProcessRunner();
      (runner.execFile as ReturnType<typeof import("vitest").vi.fn>).mockRejectedValue(
        new Error("clone failed")
      );
      const client = new CliGitClient(runner);

      await expect(
        client.clone(
          "https://github.com/org/repo.git",
          "/tmp/repo",
          { type: "ci" },
          { branch: "main" }
        )
      ).rejects.toThrow("clone failed");
    });
  });

  // ── fetch ──────────────────────────────────────────────────────────────────

  describe("fetch", () => {
    it("passes 'fetch' with repoPath, branch and depth to execFile", async () => {
      const { client, runner } = makeClient();

      await client.fetch("/tmp/repo", "main", { type: "ci" });

      expect(runner.execFile).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining([
          "-C",
          "/tmp/repo",
          "fetch",
          "--depth",
          "1",
          "origin",
          "main:refs/remotes/origin/main",
        ]),
        expect.any(Object)
      );
    });

    it("uses custom depth", async () => {
      const { client, runner } = makeClient();

      await client.fetch("/tmp/repo", "main", { type: "ci" }, 10);

      expect(runner.execFile).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["--depth", "10"]),
        expect.any(Object)
      );
    });

    it("injects auth header for token fetch", async () => {
      const { client, runner } = makeClient();

      await client.fetch("/tmp/repo", "main", { type: "token", token: "tok", platform: "github" });

      const args = (runner.execFile as ReturnType<typeof import("vitest").vi.fn>).mock
        .calls[0][1] as string[];
      expect(args).toContain("-c");
    });
  });

  // ── checkout ───────────────────────────────────────────────────────────────

  describe("checkout", () => {
    it("runs 'checkout -B <branch> origin/<branch>'", async () => {
      const { client, runner } = makeClient();

      await client.checkout("/tmp/repo", "feature-x");

      expect(runner.execFile).toHaveBeenCalledWith(
        "git",
        ["-C", "/tmp/repo", "checkout", "-B", "feature-x", "origin/feature-x"],
        expect.any(Object)
      );
    });
  });

  // ── clean ──────────────────────────────────────────────────────────────────

  describe("clean", () => {
    it("runs 'clean -fdx'", async () => {
      const { client, runner } = makeClient();

      await client.clean("/tmp/repo");

      expect(runner.execFile).toHaveBeenCalledWith(
        "git",
        ["-C", "/tmp/repo", "clean", "-fdx"],
        expect.any(Object)
      );
    });
  });

  // ── setRemoteUrl ───────────────────────────────────────────────────────────

  describe("setRemoteUrl", () => {
    it("runs 'remote set-url origin <url>'", async () => {
      const { client, runner } = makeClient();

      await client.setRemoteUrl("/tmp/repo", "https://github.com/org/repo.git");

      expect(runner.execFile).toHaveBeenCalledWith(
        "git",
        ["-C", "/tmp/repo", "remote", "set-url", "origin", "https://github.com/org/repo.git"],
        expect.any(Object)
      );
    });
  });

  // ── timeout ────────────────────────────────────────────────────────────────

  describe("timeout handling", () => {
    it("throws a timeout error when AbortError is received", async () => {
      const runner = createStubProcessRunner();
      (runner.execFile as ReturnType<typeof import("vitest").vi.fn>).mockImplementation(
        async (_file, _args, opts: { signal?: AbortSignal } = {}) =>
          new Promise((_res, rej) => {
            if (opts.signal) {
              opts.signal.addEventListener("abort", () => {
                const err = new Error("aborted");
                err.name = "AbortError";
                rej(err);
              });
            }
          })
      );
      // 1ms timeout ensures the abort fires immediately
      const client = new CliGitClient(runner, 1);

      await expect(client.clean("/tmp/repo")).rejects.toThrow(/timed out/);
    });
  });
});

// ── pure helper unit tests ───────────────────────────────────────────────────

describe("buildAuthArgs", () => {
  it("returns empty array for CI mode", () => {
    expect(buildAuthArgs({ type: "ci" })).toEqual([]);
  });

  it("returns -c arg for GitHub token", () => {
    const args = buildAuthArgs({ type: "token", token: "ghp_abc", platform: "github" });
    expect(args).toHaveLength(2);
    expect(args[0]).toBe("-c");
    expect(args[1]).toMatch(/^http\.https:\/\/github\.com\/\.extraHeader=Authorization: Basic /);
  });

  it("encodes GitHub credentials as x-access-token:<token>", () => {
    const args = buildAuthArgs({ type: "token", token: "my-token", platform: "github" });
    const encoded = (args[1] as string).split("Authorization: Basic ")[1];
    expect(Buffer.from(encoded, "base64").toString()).toBe("x-access-token:my-token");
  });

  it("encodes Azure credentials as :<token> (empty username)", () => {
    const args = buildAuthArgs({ type: "token", token: "azure-pat", platform: "azure" });
    const encoded = (args[1] as string).split("Authorization: Basic ")[1];
    expect(Buffer.from(encoded, "base64").toString()).toBe(":azure-pat");
  });

  it("scopes header to dev.azure.com for Azure", () => {
    const args = buildAuthArgs({ type: "token", token: "t", platform: "azure" });
    expect(args[1]).toMatch(/^http\.https:\/\/dev\.azure\.com\//);
  });
});

describe("buildGitEnv", () => {
  it("returns empty object for CI mode", () => {
    expect(buildGitEnv({ type: "ci" })).toEqual({});
  });

  it("sets GIT_TERMINAL_PROMPT=0 for token auth", () => {
    const env = buildGitEnv({ type: "token", token: "t", platform: "github" });
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
  });
});
