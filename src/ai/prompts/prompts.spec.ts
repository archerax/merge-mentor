import { describe, expect, it } from "vitest";
import type { FileReviewResult, PRDetails, PRFile } from "../../platforms/types.js";
import { buildCrossFilePrompt, buildFileReviewPrompt, buildFilesSummary } from "./prompts.js";

describe("AI Prompts", () => {
  describe("buildFileReviewPrompt", () => {
    it("should include the filename and diff", () => {
      const prompt = buildFileReviewPrompt("src/test.ts", '@@ -1,3 +1,4 @@\n+console.log("test");');

      expect(prompt).toContain("FILE: src/test.ts");
      expect(prompt).toContain("@@ -1,3 +1,4 @@");
      expect(prompt).toContain('console.log("test")');
    });

    it("should include all files context when provided", () => {
      const filesContext = "- package.json (modified, +2/-1)\n- pnpm-lock.yaml (modified, +15/-10)";
      const prompt = buildFileReviewPrompt("src/test.ts", "diff", filesContext);

      expect(prompt).toContain("FILES CHANGED IN THIS PR:");
      expect(prompt).toContain("package.json");
      expect(prompt).toContain("pnpm-lock.yaml");
    });

    it("should not include files context section when not provided", () => {
      const prompt = buildFileReviewPrompt("src/test.ts", "diff");

      expect(prompt).not.toContain("FILES CHANGED IN THIS PR:");
    });

    it("should include review criteria", () => {
      const prompt = buildFileReviewPrompt("test.ts", "diff");

      expect(prompt).toContain("FOCUS ON SUBSTANTIVE ISSUES");
      expect(prompt).toContain("Actual bugs");
      expect(prompt).toContain("Security vulnerabilities");
      expect(prompt).toContain("Performance problems");
      expect(prompt).toContain("Breaking changes");
    });

    it("should include JSON response format instructions", () => {
      const prompt = buildFileReviewPrompt("test.ts", "diff");

      expect(prompt).toContain("Respond with your analysis and findings.");
      expect(prompt).toContain("FORMAT:");
      expect(prompt).toContain("1. ANALYSIS:");
      expect(prompt).toContain("2. JSON:");
      expect(prompt).toContain("Example Response:");
      expect(prompt).toContain("```json");
      expect(prompt).toContain('"findings"');
      expect(prompt).toContain('"severity"');
      expect(prompt).toContain('"category"');
      expect(prompt).toContain('"message"');
      expect(prompt).toContain('"suggestion"');
    });

    it("should include explicit line number instructions for pre-calculated format", () => {
      const prompt = buildFileReviewPrompt("test.ts", "diff");

      expect(prompt).toContain("CRITICAL LINE NUMBER INSTRUCTIONS");
      expect(prompt).toContain("PRE-CALCULATED LINE NUMBERS");
      expect(prompt).toContain("DIFF FORMAT");
      expect(prompt).toContain("[PREFIX][LINE_NUMBER] | [CONTENT]");
      expect(prompt).toContain("EXAMPLE");
      expect(prompt).toContain("@@ -80,5 +155,7 @@");
      expect(prompt).toContain("line 159");
      expect(prompt).toContain("Read the line number directly from the diff");
    });
  });

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

      expect(prompt).toContain("PR TITLE: Add new feature");
      expect(prompt).toContain("PR DESCRIPTION: This PR adds a new feature");
    });

    it("should include files summary", () => {
      const prompt = buildCrossFilePrompt(prDetails, filesSummary, []);

      expect(prompt).toContain("CHANGED FILES SUMMARY:");
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
              category: "bug",
              message: "Bug found",
              suggestion: "Fix it",
            },
          ],
        },
        {
          filename: "src/file2.ts",
          findings: [],
        },
      ];

      const prompt = buildCrossFilePrompt(prDetails, filesSummary, fileResults);

      expect(prompt).toContain("INDIVIDUAL FILE REVIEW FINDINGS:");
      expect(prompt).toContain("src/file1.ts: 1 finding(s)");
      expect(prompt).not.toContain("src/file2.ts:");
    });

    it("should handle empty description", () => {
      const prWithNoDesc = { ...prDetails, description: "" };
      const prompt = buildCrossFilePrompt(prWithNoDesc, filesSummary, []);

      expect(prompt).toContain("PR DESCRIPTION: No description provided");
    });

    it("should include cross-file analysis criteria", () => {
      const prompt = buildCrossFilePrompt(prDetails, filesSummary, []);

      expect(prompt).toContain("FOCUS ON HIGH-LEVEL SUBSTANTIVE ISSUES");
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
