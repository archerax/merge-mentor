import { describe, expect, it } from "vitest";
import type { FileReviewResult, PRDetails, PRFile } from "../../platforms/types.js";
import type { DiffManifest } from "../../review/diffStorage.js";
import {
  buildBatchedFileReviewPrompt,
  buildCrossFilePrompt,
  buildFilesSummary,
} from "./prompts.js";

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

    it("should include SELF-CHALLENGE REQUIREMENT section", () => {
      const prompt = buildCrossFilePrompt(prDetails, filesSummary, []);

      expect(prompt).toContain("# SELF-CHALLENGE REQUIREMENT");
      expect(prompt).toContain('"Could this be intentional design?"');
      expect(prompt).toContain('"Is this validated/handled elsewhere in the system?"');
      expect(prompt).toContain('"Is there architectural context I\'m missing?"');
      expect(prompt).toContain('"Is this actually a system-level concern?"');
      expect(prompt).toContain('"Would an experienced architect agree this is a problem?"');
    });

    it("should include counter-argument documentation examples", () => {
      const prompt = buildCrossFilePrompt(prDetails, filesSummary, []);

      expect(prompt).toContain("## Counter-Argument Documentation");
      expect(prompt).toContain("Counter-Argument Considered:");
      expect(prompt).toContain("Rebuttal:");
      expect(prompt).toContain("Decision:");
    });

    it("should include verification checklist", () => {
      const prompt = buildCrossFilePrompt(prDetails, filesSummary, []);

      expect(prompt).toContain("# VERIFICATION CHECKLIST");
      expect(prompt).toContain("Issue spans multiple files");
      expect(prompt).toContain("Issue is NEW to this PR");
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

  describe("buildBatchedFileReviewPrompt", () => {
    const mockManifest: DiffManifest = {
      prIdentifier: "test-pr-123",
      files: [
        {
          filename: "src/test.ts",
          status: "modified",
          diffPath: "test.diff",
          additions: 10,
          deletions: 5,
        },
      ],
      createdAt: new Date().toISOString(),
    };

    it("should include SELF-CHALLENGE REQUIREMENT section", () => {
      const prompt = buildBatchedFileReviewPrompt(mockManifest);

      expect(prompt).toContain("# SELF-CHALLENGE REQUIREMENT");
      expect(prompt).toContain('"Could this be intentional?"');
      expect(prompt).toContain('"Is this validated elsewhere?"');
      expect(prompt).toContain('"Is this test/mock/development code?"');
      expect(prompt).toContain('"Is there missing context?"');
      expect(prompt).toContain('"Would a senior engineer flag this?"');
    });

    it("should include counter-argument documentation examples", () => {
      const prompt = buildBatchedFileReviewPrompt(mockManifest);

      expect(prompt).toContain("## Counter-Argument Documentation");
      expect(prompt).toContain("Counter-Argument Considered:");
      expect(prompt).toContain("Rebuttal:");
      expect(prompt).toContain("Decision:");
      expect(prompt).toContain("✅ **Report**");
      expect(prompt).toContain("❌ **Don't report**");
    });

    it("should include verification checklist", () => {
      const prompt = buildBatchedFileReviewPrompt(mockManifest);

      expect(prompt).toContain("# VERIFICATION CHECKLIST");
      expect(prompt).toContain("Issue exists in ADDED lines (+)");
      expect(prompt).toContain("Line number is correct");
      expect(prompt).toContain("Suggestion actually fixes the root cause");
    });

    it("should include examples with counter-argument reasoning", () => {
      const prompt = buildBatchedFileReviewPrompt(mockManifest);

      // Check that examples include counter-arguments
      expect(prompt).toContain("✅ EXAMPLE 2:");
      expect(prompt).toContain("✓ Counter-argument:");
      expect(prompt).toContain("✓ Rebuttal:");
    });

    it("should include repository context when provided", () => {
      const repoContext = "Use TypeScript strict mode\nFollow ESLint rules";
      const prompt = buildBatchedFileReviewPrompt(mockManifest, undefined, repoContext);

      expect(prompt).toContain("# REPOSITORY-SPECIFIC GUIDELINES");
      expect(prompt).toContain(repoContext);
    });

    it("should include workspace access section when repoPath provided", () => {
      const prompt = buildBatchedFileReviewPrompt(
        mockManifest,
        undefined,
        undefined,
        "/path/to/repo"
      );

      expect(prompt).toContain("# WORKSPACE ACCESS ENABLED");
      expect(prompt).toContain("@workspace /search");
      expect(prompt).toContain("@file:");
    });
  });
});
