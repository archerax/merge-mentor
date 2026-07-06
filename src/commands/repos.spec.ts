import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { program } from "../program.js";

// Mock dependencies
vi.mock("../config.js", () => ({
  loadConfig: vi.fn(),
  validateConfig: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(),
    rmSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

import type { Config } from "../config.js";

function createMockConfig(): Partial<Config> {
  return {
    tempPath: "./.mergementor",
  };
}

describe("repos command", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(mkdirSync).mockReturnValue(undefined);
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(loadConfig).mockReturnValue(createMockConfig() as Config);
  });

  it("shows usage help when no options are specified", async () => {
    await program.parseAsync(["node", "test", "repos"]);

    expect(mkdirSync).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Usage: merge-mentor repos [options]")
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("lists empty repos when no repositories exist", async () => {
    vi.mocked(readdirSync).mockReturnValue([]);

    await program.parseAsync(["node", "test", "repos", "--list"]);

    expect(consoleLogSpy).toHaveBeenCalledWith("No cloned repositories found.");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("lists existing repositories with details", async () => {
    const mockDate = new Date("2024-01-15T10:30:00Z");
    vi.mocked(readdirSync).mockReturnValue(["repo-a", "repo-b"] as unknown as ReturnType<
      typeof readdirSync
    >);
    vi.mocked(statSync).mockReturnValue({
      isDirectory: () => true,
      mtime: mockDate,
    } as unknown as ReturnType<typeof statSync>);

    await program.parseAsync(["node", "test", "repos", "--list"]);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Cloned repositories (2)"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("repo-a"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("repo-b"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(mockDate.toISOString()));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("reports no repos to clean when directory is empty", async () => {
    vi.mocked(readdirSync).mockReturnValue([]);

    await program.parseAsync(["node", "test", "repos", "--clean"]);

    expect(consoleLogSpy).toHaveBeenCalledWith("No cloned repositories to clean.");
    expect(rmSync).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("cleans all repositories", async () => {
    vi.mocked(readdirSync).mockReturnValue(["repo-x", "repo-y"] as unknown as ReturnType<
      typeof readdirSync
    >);
    vi.mocked(statSync).mockReturnValue({
      isDirectory: () => true,
    } as unknown as ReturnType<typeof statSync>);

    await program.parseAsync(["node", "test", "repos", "--clean"]);

    expect(rmSync).toHaveBeenCalledTimes(2);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Removed: repo-x"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Removed: repo-y"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Cleaned 2 repositories"));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("removes a specific repository with --clean-repo", async () => {
    vi.mocked(statSync).mockReturnValue({
      isDirectory: () => true,
    } as unknown as ReturnType<typeof statSync>);

    await program.parseAsync(["node", "test", "repos", "--clean-repo", "my-repo"]);

    expect(rmSync).toHaveBeenCalledWith(expect.stringContaining("my-repo"), {
      recursive: true,
      force: true,
    });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Removed repository: my-repo")
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("errors when --clean-repo target is not a directory", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(statSync).mockReturnValue({
      isDirectory: () => false,
    } as unknown as ReturnType<typeof statSync>);

    await program.parseAsync(["node", "test", "repos", "--clean-repo", "not-a-dir"]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("is not a directory"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("errors when --clean-repo target is not found", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(statSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    await program.parseAsync(["node", "test", "repos", "--clean-repo", "missing"]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Repository "missing" not found')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("handles unexpected errors during repos management", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(mkdirSync).mockImplementation(() => {
      throw new Error("Permission denied");
    });

    await program.parseAsync(["node", "test", "repos", "--list"]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Permission denied"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("passes --temp-path option to loadConfig", async () => {
    await program.parseAsync(["node", "test", "repos", "--temp-path", "/custom/path", "--list"]);

    expect(loadConfig).toHaveBeenCalledWith(expect.objectContaining({ tempPath: "/custom/path" }));
  });

  it("filters non-directory entries when listing repos", async () => {
    vi.mocked(readdirSync).mockReturnValue(["real-repo", "some-file"] as unknown as ReturnType<
      typeof readdirSync
    >);
    let callCount = 0;
    vi.mocked(statSync).mockImplementation(() => {
      callCount++;
      if (callCount <= 1) {
        return {
          isDirectory: () => true,
          mtime: new Date(),
        } as unknown as ReturnType<typeof statSync>;
      }
      return { isDirectory: () => false } as unknown as ReturnType<typeof statSync>;
    });

    await program.parseAsync(["node", "test", "repos", "--list"]);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Cloned repositories (1)"));
  });
});
