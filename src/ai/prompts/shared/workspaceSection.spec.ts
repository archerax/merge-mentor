import { describe, expect, it } from "vitest";
import type { DiffManifest } from "../../../review/diffStorage.js";
import { buildFilesListing, buildWorkspaceSection } from "./workspaceSection.js";

describe("Shared Workspace Prompts", () => {
  const mockManifest: DiffManifest = {
    prIdentifier: "123",
    createdAt: new Date().toISOString(),
    files: [
      {
        filename: "src/UserService.ts",
        status: "modified",
        additions: 10,
        deletions: 5,
        diffPath: "UserService.diff",
      },
      {
        filename: "src/UserService.test.ts",
        status: "added",
        additions: 20,
        deletions: 0,
        diffPath: "UserService.test.diff",
      },
    ],
  };

  describe("buildWorkspaceSection", () => {
    it("returns empty string if repoPath is not provided", () => {
      expect(buildWorkspaceSection()).toBe("");
      expect(buildWorkspaceSection("")).toBe("");
    });

    it("returns formatted workspace instructions if repoPath is provided", () => {
      const section = buildWorkspaceSection("/mock/repo");
      expect(section).toContain("# WORKSPACE ACCESS ENABLED");
      expect(section).toContain("@workspace /search <query>");
      expect(section).toContain("@file:relative/path/to/file.ts");
      expect(section).toContain("@workspace /find <filename>");
    });
  });

  describe("buildFilesListing", () => {
    it("formats file listing with plain diff paths when repoPath is not provided", () => {
      const listing = buildFilesListing(mockManifest);
      expect(listing).toContain("- src/UserService.ts (modified, +10/-5) → @UserService.diff");
      expect(listing).toContain(
        "- src/UserService.test.ts (added, +20/-0) → @UserService.test.diff"
      );
    });

    it("formats file listing with .mergementor/diffs/ prefix when repoPath is provided", () => {
      const listing = buildFilesListing(mockManifest, "/mock/repo");
      expect(listing).toContain(
        "- src/UserService.ts (modified, +10/-5) → @.mergementor/diffs/UserService.diff"
      );
      expect(listing).toContain(
        "- src/UserService.test.ts (added, +20/-0) → @.mergementor/diffs/UserService.test.diff"
      );
    });
  });
});
