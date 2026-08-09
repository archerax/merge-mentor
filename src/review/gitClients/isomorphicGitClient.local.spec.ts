import { describe, expect, it } from "vitest";
import { createScratchRepo } from "./gitRepo.test-helper.js";
import { IsomorphicGitClient } from "./isomorphicGitClient.js";

// Integration tests against a real scratch repo using the bundled
// isomorphic-git implementation (no system git diff parsing involved).

describe("IsomorphicGitClient local diffs (real repo)", () => {
  it("reports unstaged + untracked changes via workingTreeDiff", async () => {
    const repo = createScratchRepo();
    try {
      repo.write("README.md", "hello\nupdated\n");
      repo.write("src/new.ts", "export const x = 1;\n");

      const client = new IsomorphicGitClient();
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

      const client = new IsomorphicGitClient();
      const staged = await client.stagedDiff(repo.path);
      expect(staged.map((c) => c.path)).toEqual(["README.md"]);

      const worktree = await client.workingTreeDiff(repo.path);
      const paths = worktree.map((c) => c.path).sort();
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

      const client = new IsomorphicGitClient();
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

      const client = new IsomorphicGitClient();
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

      const client = new IsomorphicGitClient();
      const changes = await client.diff(repo.path, base, head);
      expect(changes.map((c) => c.path)).toEqual(["README.md"]);
      expect(changes[0].status).toBe("modified");
      expect(changes[0].patch).toContain("+commit1");
    } finally {
      repo.cleanup();
    }
  });

  it("returns the current branch name", async () => {
    const repo = createScratchRepo();
    try {
      const client = new IsomorphicGitClient();
      expect(await client.currentBranch(repo.path)).toBe("main");
    } finally {
      repo.cleanup();
    }
  });

  it("returns undefined for getRemoteUrl without an origin", async () => {
    const repo = createScratchRepo();
    try {
      const client = new IsomorphicGitClient();
      expect(await client.getRemoteUrl(repo.path)).toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });
});
