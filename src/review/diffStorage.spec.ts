import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PRFile } from "../platforms/types.js";
import { createStubFileSystem } from "../ports/fileSystem.test-helper.js";
import { DiffStorage } from "./diffStorage.js";

describe("DiffStorage", () => {
  const mockClock = {
    now: () => new Date("2026-05-28T12:00:00.000Z"),
    timestamp: () => "2026-05-28T12:00:00.000Z",
    epochMs: () => 1780017600000,
  };

  describe("storeDiffs", () => {
    it("stores PR diffs and manifest correctly on disk", async () => {
      const fileSystem = createStubFileSystem();
      const storage = new DiffStorage("/tmp/mentor", fileSystem, mockClock);

      const files: PRFile[] = [
        {
          filename: "src/utils/helper.ts",
          status: "modified",
          patch: "@@ -1,3 +1,4 @@\n const x = 1;\n+const y = 2;\n const z = 3;",
          additions: 1,
          deletions: 0,
        },
        {
          filename: "README.md",
          status: "added",
          patch: "@@ -0,0 +1,2 @@\n+# README\n+Hello",
          additions: 2,
          deletions: 0,
        },
      ];

      const result = await storage.storeDiffs("github-owner-repo-PR42", files);

      // Verify diffDir and manifest returned
      const expectedDir = path.join("/tmp/mentor/diffs", "github-owner-repo-PR42");
      expect(result.diffDir).toBe(expectedDir);
      expect(result.manifest.prIdentifier).toBe("github-owner-repo-PR42");
      expect(result.manifest.createdAt).toBe("2026-05-28T12:00:00.000Z");
      expect(result.manifest.files).toHaveLength(2);

      // Verify cleanup was called first
      expect(fileSystem.rm).toHaveBeenCalledWith(expectedDir, { recursive: true, force: true });

      // Verify directory was created
      expect(fileSystem.mkdir).toHaveBeenCalledWith(expectedDir, { recursive: true });

      // Verify individual diff files were written (sanitized filenames)
      const firstFilePath = path.join(expectedDir, "src__utils__helper.ts.diff");
      expect(fileSystem.writeFile).toHaveBeenCalledWith(
        firstFilePath,
        expect.stringContaining("      1 | const x = 1;"),
        "utf-8"
      );

      const secondFilePath = path.join(expectedDir, "README.md.diff");
      expect(fileSystem.writeFile).toHaveBeenCalledWith(
        secondFilePath,
        expect.stringContaining("+     1 | # README"),
        "utf-8"
      );

      // Verify manifest.json was written
      const manifestPath = path.join(expectedDir, "manifest.json");
      expect(fileSystem.writeFile).toHaveBeenCalledWith(
        manifestPath,
        expect.stringContaining('"prIdentifier": "github-owner-repo-PR42"'),
        "utf-8"
      );
    });

    it("skips files with no patch content", async () => {
      const fileSystem = createStubFileSystem();
      const storage = new DiffStorage("/tmp/mentor", fileSystem, mockClock);

      const files: PRFile[] = [
        {
          filename: "src/no-patch.ts",
          status: "modified",
          patch: "", // No patch
          additions: 0,
          deletions: 0,
        },
        {
          filename: "src/has-patch.ts",
          status: "added",
          patch: "@@ -0,0 +1,2 @@\n+const a = 1;",
          additions: 1,
          deletions: 0,
        },
      ];

      const result = await storage.storeDiffs("github-owner-repo-PR42", files);

      expect(result.manifest.files).toHaveLength(1);
      expect(result.manifest.files[0].filename).toBe("src/has-patch.ts");

      const hasPatchPath = path.join(
        "/tmp/mentor/diffs/github-owner-repo-PR42",
        "src__has-patch.ts.diff"
      );
      expect(fileSystem.writeFile).toHaveBeenCalledWith(hasPatchPath, expect.any(String), "utf-8");

      const noPatchPath = path.join(
        "/tmp/mentor/diffs/github-owner-repo-PR42",
        "src__no-patch.ts.diff"
      );
      expect(fileSystem.writeFile).not.toHaveBeenCalledWith(
        noPatchPath,
        expect.any(String),
        "utf-8"
      );
    });
  });

  describe("cleanup", () => {
    it("removes the PR diff directory recursive and forced", async () => {
      const fileSystem = createStubFileSystem();
      const storage = new DiffStorage("/tmp/mentor", fileSystem, mockClock);

      await storage.cleanup("github-owner-repo-PR42");

      const expectedDir = path.join("/tmp/mentor/diffs", "github-owner-repo-PR42");
      expect(fileSystem.rm).toHaveBeenCalledWith(expectedDir, { recursive: true, force: true });
    });

    it("swallows ENOENT error gracefully during cleanup", async () => {
      const fileSystem = createStubFileSystem();
      const enoentError = new Error("File not found") as NodeJS.ErrnoException;
      enoentError.code = "ENOENT";
      vi.mocked(fileSystem.rm).mockRejectedValueOnce(enoentError);

      const storage = new DiffStorage("/tmp/mentor", fileSystem, mockClock);

      // Should not throw
      await expect(storage.cleanup("github-owner-repo-PR42")).resolves.toBeUndefined();
    });

    it("swallows non-ENOENT errors gracefully during cleanup, only logging them", async () => {
      const fileSystem = createStubFileSystem();
      const epermError = new Error("Permission denied") as NodeJS.ErrnoException;
      epermError.code = "EPERM";
      vi.mocked(fileSystem.rm).mockRejectedValueOnce(epermError);

      const storage = new DiffStorage("/tmp/mentor", fileSystem, mockClock);

      // Should swallow EPERM and not throw
      await expect(storage.cleanup("github-owner-repo-PR42")).resolves.toBeUndefined();
    });
  });

  describe("cleanupAll", () => {
    it("removes the base diffs directory recursive and forced", async () => {
      const fileSystem = createStubFileSystem();
      const storage = new DiffStorage("/tmp/mentor", fileSystem, mockClock);

      await storage.cleanupAll();

      const expectedBaseDir = path.join("/tmp/mentor/diffs");
      expect(fileSystem.rm).toHaveBeenCalledWith(expectedBaseDir, {
        recursive: true,
        force: true,
      });
    });

    it("swallows ENOENT error gracefully during cleanupAll", async () => {
      const fileSystem = createStubFileSystem();
      const enoentError = new Error("File not found") as NodeJS.ErrnoException;
      enoentError.code = "ENOENT";
      vi.mocked(fileSystem.rm).mockRejectedValueOnce(enoentError);

      const storage = new DiffStorage("/tmp/mentor", fileSystem, mockClock);

      // Should not throw
      await expect(storage.cleanupAll()).resolves.toBeUndefined();
    });

    it("swallows non-ENOENT errors gracefully during cleanupAll, only logging them", async () => {
      const fileSystem = createStubFileSystem();
      const epermError = new Error("Permission denied") as NodeJS.ErrnoException;
      epermError.code = "EPERM";
      vi.mocked(fileSystem.rm).mockRejectedValueOnce(epermError);

      const storage = new DiffStorage("/tmp/mentor", fileSystem, mockClock);

      // Should swallow EPERM and not throw
      await expect(storage.cleanupAll()).resolves.toBeUndefined();
    });
  });
});
