import { describe, expect, it } from "vitest";
import type { FileReviewResult, PRDetails, PRFile } from "../../platforms/types.js";
import { buildCrossFilePrompt, buildFilesSummary } from "./prompts.js";

describe("AI Prompts", () => {
  describe("buildCrossFilePrompt", () => {
    const prDetails: PRDetails = {
      number: 123,
      title: "Add new feature",
      description: "This PR adds a new feature",
      author: "testuser",
      baseBranch: "main",
      headBranch: "feature/new",
    };

    const filesSummary = "- src/file1.ts (modified, +10/-5)\n- src/file2.ts (added, +20/-0)";

    it("should include PR details", () => {
      const prompt = buildCrossFilePrompt(prDetails, filesSummary, []);

      expect(prompt).toContain("Title: Add new feature");
      expect(prompt).toContain("Description: This PR adds a new feature");
    });

    it("should include files summary", () => {
      const prompt = buildCrossFilePrompt(prDetails, filesSummary, []);

      expect(prompt).toContain("Changed Files:");
      expect(prompt).toContain("src/file1.ts");
      expect(prompt).toContain("src/file2.ts");
    });

    it("should include file review findings summary", () => {
      const fileResults: FileReviewResult[] = [
        {
          filename: "src/file1.ts",
          findings: [
            {
              line: 10,
              severity: "high",
              confidence: "high",
              category: "bug",
              message: "Bug found",
              suggestion: "Fix it",
              reasoning: "This is a bug because the code does not handle edge cases.",
            },
          ],
        },
        {
          filename: "src/file2.ts",
          findings: [],
        },
      ];

      const prompt = buildCrossFilePrompt(prDetails, filesSummary, fileResults);

      expect(prompt).toContain("Individual File Findings:");
      expect(prompt).toContain("src/file1.ts: 1 finding(s)");
      expect(prompt).not.toContain("src/file2.ts:");
    });

    it("should handle empty description", () => {
      const prWithNoDesc = { ...prDetails, description: "" };
      const prompt = buildCrossFilePrompt(prWithNoDesc, filesSummary, []);

      expect(prompt).toContain("Description: No description provided");
    });

    it("should include cross-file analysis criteria", () => {
      const prompt = buildCrossFilePrompt(prDetails, filesSummary, []);

      expect(prompt).toContain("Architectural problems");
      expect(prompt).toContain("System-level concerns");
      expect(prompt).toContain("Cross-cutting issues");
    });
  });

  describe("buildFilesSummary", () => {
    it("should format files correctly", () => {
      const files: PRFile[] = [
        { filename: "src/test.ts", status: "modified", additions: 10, deletions: 5 },
        { filename: "src/new.ts", status: "added", additions: 20, deletions: 0 },
        { filename: "src/old.ts", status: "deleted", additions: 0, deletions: 15 },
      ];

      const summary = buildFilesSummary(files);

      expect(summary).toContain("- src/test.ts (modified, +10/-5)");
      expect(summary).toContain("- src/new.ts (added, +20/-0)");
      expect(summary).toContain("- src/old.ts (deleted, +0/-15)");
    });

    it("should return empty string for no files", () => {
      const summary = buildFilesSummary([]);
      expect(summary).toBe("");
    });
  });
});
