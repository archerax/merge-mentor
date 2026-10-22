import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStubProcessRunner } from "@merge-mentor/shared/ports/processRunner.test-helper.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildAuthEnv, buildGitEnv, CliGitClient } from "./cliGitClient.js";
import { createScratchRepo } from "./gitRepo.test-helper.js";

function makeClient() {
  const runner = createStubProcessRunner();
  const client = new CliGitClient(runner);
  return { client, runner } as const;
}

describe("CliGitClient", () => {
  // Keep the GIT_CONFIG_* indexes deterministic regardless of the host environment.
  beforeEach(() => {
    vi.stubEnv("GIT_CONFIG_COUNT", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

    it("injects GitHub auth header via env, not argv or URL", async () => {
      const { client, runner } = makeClient();

      await client.clone(
        "https://github.com/org/repo.git",
        "/tmp/repo",
        { type: "token", token: "my-token", platform: "github" },
        { branch: "main" }
      );

      const args = (runner.execFile as ReturnType<typeof import("vitest").vi.fn>).mock
        .calls[0][1] as string[];
      const call = (runner.execFile as ReturnType<typeof import("vitest").vi.fn>).mock.calls[0];
      const env = (call[2] as { env: Record<string, string> }).env;
      expect(args).not.toContain("-c");
      expect(args.join(" ")).not.toContain("Authorization");
      expect(env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraHeader");
      expect(env.GIT_CONFIG_VALUE_0).toContain("Authorization: Basic");
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

      const env = (
        (runner.execFile as ReturnType<typeof import("vitest").vi.fn>).mock.calls[0][2] as {
          env: Record<string, string>;
        }
      ).env;
      expect(env.GIT_CONFIG_KEY_0).toBe("http.https://dev.azure.com/.extraHeader");
      const encoded = env.GIT_CONFIG_VALUE_0?.split("Authorization: Basic ")[1] ?? "";
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
          "+main:refs/remotes/origin/main",
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

      const call = (runner.execFile as ReturnType<typeof import("vitest").vi.fn>).mock.calls[0];
      expect(call[1] as string[]).not.toContain("-c");
      expect((call[2] as { env: Record<string, string> }).env.GIT_CONFIG_COUNT).toBeDefined();
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

  // ── hasUncommittedChanges ──────────────────────────────────────────────────

  describe("hasUncommittedChanges", () => {
    it("returns false when 'status --porcelain' is empty", async () => {
      const { client, runner } = makeClient();
      (runner.execFile as ReturnType<typeof import("vitest").vi.fn>).mockResolvedValue({
        stdout: "",
        stderr: "",
      });

      await expect(client.hasUncommittedChanges("/tmp/repo")).resolves.toBe(false);
      expect(runner.execFile).toHaveBeenCalledWith(
        "git",
        ["-C", "/tmp/repo", "status", "--porcelain"],
        expect.any(Object)
      );
    });

    it("returns true when 'status --porcelain' reports changes", async () => {
      const { client, runner } = makeClient();
      (runner.execFile as ReturnType<typeof import("vitest").vi.fn>).mockResolvedValue({
        stdout: " M README.md\n",
        stderr: "",
      });

      await expect(client.hasUncommittedChanges("/tmp/repo")).resolves.toBe(true);
    });
  });

  // ── switchBranch ───────────────────────────────────────────────────────────

  describe("switchBranch", () => {
    it("runs a plain 'checkout <branch>' (no reset to origin)", async () => {
      const { client, runner } = makeClient();

      await client.switchBranch("/tmp/repo", "develop");

      expect(runner.execFile).toHaveBeenCalledWith(
        "git",
        ["-C", "/tmp/repo", "checkout", "develop"],
        expect.any(Object)
      );
    });
  });

  // ── pull ───────────────────────────────────────────────────────────────────

  describe("pull", () => {
    it("runs 'pull --ff-only origin <branch>'", async () => {
      const { client, runner } = makeClient();

      await client.pull("/tmp/repo", "main");

      expect(runner.execFile).toHaveBeenCalledWith(
        "git",
        ["-C", "/tmp/repo", "pull", "--ff-only", "origin", "main"],
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

describe("buildAuthEnv", () => {
  it("returns no overrides for CI mode", () => {
    expect(buildAuthEnv({ type: "ci" }, {})).toEqual({});
  });

  it("passes the GitHub header through GIT_CONFIG_* env, not argv", () => {
    const env = buildAuthEnv({ type: "token", token: "ghp_abc", platform: "github" }, {});
    expect(env.GIT_CONFIG_COUNT).toBe("1");
    expect(env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraHeader");
    expect(env.GIT_CONFIG_VALUE_0).toMatch(/^Authorization: Basic /);
  });

  it("encodes GitHub credentials as x-access-token:<token>", () => {
    const env = buildAuthEnv({ type: "token", token: "my-token", platform: "github" }, {});
    const encoded = env.GIT_CONFIG_VALUE_0.split("Authorization: Basic ")[1];
    expect(Buffer.from(encoded, "base64").toString()).toBe("x-access-token:my-token");
  });

  it("encodes Azure credentials as :<token> (empty username) scoped to dev.azure.com", () => {
    const env = buildAuthEnv({ type: "token", token: "azure-pat", platform: "azure" }, {});
    expect(env.GIT_CONFIG_KEY_0).toMatch(/^http\.https:\/\/dev\.azure\.com\//);
    const encoded = env.GIT_CONFIG_VALUE_0.split("Authorization: Basic ")[1];
    expect(Buffer.from(encoded, "base64").toString()).toBe(":azure-pat");
  });

  it("appends after GIT_CONFIG_* entries already in the environment", () => {
    const env = buildAuthEnv(
      { type: "token", token: "t", platform: "github" },
      { GIT_CONFIG_COUNT: "2" }
    );
    expect(env.GIT_CONFIG_COUNT).toBe("3");
    expect(env.GIT_CONFIG_KEY_2).toBe("http.https://github.com/.extraHeader");
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
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

// ── real-git integration tests for local diff operations ────────────────────

describe("CliGitClient local diffs (real git)", () => {
  it("reports unstaged + untracked changes via workingTreeDiff", async () => {
    const repo = createScratchRepo();
    try {
      repo.write("README.md", "hello\nupdated\n");
      repo.write("src/new.ts", "export const x = 1;\n");

      const client = new CliGitClient();
      const changes = await client.workingTreeDiff(repo.path);

      const byPath = new Map(changes.map((c) => [c.path, c]));
      expect(byPath.get("README.md")?.status).toBe("modified");
      expect(byPath.get("src/new.ts")?.status).toBe("added");
      expect(byPath.get("src/new.ts")?.patch).toContain("+export const x = 1;");
      expect(byPath.get("README.md")?.sha).toBeTruthy();
    } finally {
      repo.cleanup();
    }
  });

  it("excludes unstaged changes from stagedDiff", async () => {
    const repo = createScratchRepo();
    try {
      repo.write("README.md", "hello\nstaged\n");
      repo.git("add", "README.md");
      repo.write("tracked.txt", "untracked edit\n");

      const client = new CliGitClient();
      const staged = await client.stagedDiff(repo.path);
      expect(staged.map((c) => c.path)).toEqual(["README.md"]);

      const worktree = await client.workingTreeDiff(repo.path);
      const paths = worktree.map((c) => c.path).toSorted();
      expect(paths).toContain("README.md");
      expect(paths).toContain("tracked.txt");
    } finally {
      repo.cleanup();
    }
  });

  it("only includes staged changes when a file has both staged and unstaged edits", async () => {
    const repo = createScratchRepo();
    try {
      repo.write("README.md", "hello\nv2\n");
      repo.git("add", "README.md");
      repo.write("README.md", "hello\nv3\n");

      const client = new CliGitClient();
      const staged = await client.stagedDiff(repo.path);
      expect(staged.map((c) => c.path)).toEqual(["README.md"]);
      expect(staged[0].patch).toContain("+v2");
      expect(staged[0].patch).not.toContain("+v3");
    } finally {
      repo.cleanup();
    }
  });

  it("reports deletions without a sha", async () => {
    const repo = createScratchRepo();
    try {
      repo.git("rm", "-q", "README.md");

      const client = new CliGitClient();
      const changes = await client.workingTreeDiff(repo.path);
      expect(changes).toHaveLength(1);
      expect(changes[0].path).toBe("README.md");
      expect(changes[0].status).toBe("deleted");
      expect(changes[0].sha).toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });

  it("diffs an arbitrary ref pair", async () => {
    const repo = createScratchRepo();
    try {
      repo.write("README.md", "hello\ncommit1\n");
      repo.git("add", "README.md");
      repo.git("commit", "-qm", "change 1");

      const base = repo.git("rev-parse", "HEAD~1");
      const head = repo.git("rev-parse", "HEAD");

      const client = new CliGitClient();
      const changes = await client.diff(repo.path, base, head);
      expect(changes.map((c) => c.path)).toEqual(["README.md"]);
      expect(changes[0].status).toBe("modified");
    } finally {
      repo.cleanup();
    }
  });

  it("reports renames via rename detection", async () => {
    const repo = createScratchRepo();
    try {
      repo.git("mv", "README.md", "GUIDE.md");

      const client = new CliGitClient();
      const changes = await client.workingTreeDiff(repo.path);
      expect(changes).toHaveLength(1);
      expect(changes[0].status).toBe("renamed");
      expect(changes[0].path).toBe("GUIDE.md");
    } finally {
      repo.cleanup();
    }
  });

  it("returns the current branch name", async () => {
    const repo = createScratchRepo();
    try {
      const client = new CliGitClient();
      expect(await client.currentBranch(repo.path)).toBe("main");
    } finally {
      repo.cleanup();
    }
  });

  it("returns undefined for getRemoteUrl without an origin", async () => {
    const repo = createScratchRepo();
    try {
      const client = new CliGitClient();
      expect(await client.getRemoteUrl(repo.path)).toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });
});

describe("CliGitClient fetchRef (real git)", () => {
  it("checks out a fork PR ref even when its branch name matches an upstream branch", async () => {
    const upstream = createScratchRepo();
    const workDir = mkdtempSync(join(tmpdir(), "mm-fork-clone-"));
    try {
      const baseSha = upstream.git("rev-parse", "HEAD");
      // The fork's "main" diverges from upstream's and only exists as a PR ref here.
      upstream.git("checkout", "-q", "-b", "fork-main");
      upstream.write("fork-only.txt", "from the fork\n");
      upstream.git("add", ".");
      upstream.git("commit", "-qm", "fork change");
      const forkSha = upstream.git("rev-parse", "HEAD");
      upstream.git("update-ref", "refs/pull/7/head", forkSha);
      upstream.git("checkout", "-q", "main");
      upstream.git("branch", "-D", "fork-main");

      const client = new CliGitClient();
      const target = join(workDir, "clone");
      const auth = { type: "ci" } as const;
      await client.clone(`file://${upstream.path}`, target, auth, { branch: "main", depth: 1 });
      expect(
        execFileSync("git", ["-C", target, "rev-parse", "HEAD"], { encoding: "utf-8" }).trim()
      ).toBe(baseSha);

      await client.fetchRef(target, "refs/pull/7/head", "mm-pull-7-head", auth);
      await client.checkout(target, "mm-pull-7-head");

      const head = execFileSync("git", ["-C", target, "rev-parse", "HEAD"], {
        encoding: "utf-8",
      }).trim();
      expect(head).toBe(forkSha);
      expect(existsSync(join(target, "fork-only.txt"))).toBe(true);
    } finally {
      upstream.cleanup();
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
