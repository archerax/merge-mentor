import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A real scratch git repository for integration tests. */
export interface ScratchRepo {
  /** Absolute path to the repository working tree. */
  readonly path: string;
  /** Writes a file (creating parent directories) at a repo-relative path. */
  write(filePath: string, content: string): void;
  /** Runs `git` with `-C <path>` and returns trimmed stdout. */
  git(...args: string[]): string;
  /** Removes the repository directory. */
  cleanup(): void;
}

/**
 * Creates an initialized git repository with a single initial commit on `main`.
 * Requires the `git` binary on PATH. Tests that use this are integration tests
 * and must call `cleanup()` (or use `afterEach`) to remove the temp directory.
 */
export function createScratchRepo(): ScratchRepo {
  const path = mkdtempSync(join(tmpdir(), "mm-stage-spec-"));

  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", path, ...args], { encoding: "utf-8" }).trim();

  git("init", "-q", "-b", "main");
  git("config", "user.email", "stage-spec@example.com");
  git("config", "user.name", "Stage Spec");
  writeFileSync(join(path, "README.md"), "hello\n");
  git("add", ".");
  git("commit", "-qm", "initial commit");

  const write = (filePath: string, content: string): void => {
    const fullPath = join(path, filePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
  };

  return {
    path,
    write,
    git,
    cleanup: () => rmSync(path, { recursive: true, force: true }),
  };
}
