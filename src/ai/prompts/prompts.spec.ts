import { describe, expect, it } from "vitest";
import type { FileReviewResult, PRDetails } from "../../platforms/types.js";
import type { DiffManifest } from "../../review/diffStorage.js";
import { buildBatchedFileReviewPrompt, buildCrossFilePrompt } from "./prompts.js";

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
      expect(prompt).toContain("Could this be intentional design?");
      expect(prompt).toContain("Is this validated/handled elsewhere in the system?");
      expect(prompt).toContain("Is there architectural context I'm missing?");
      expect(prompt).toContain("Is this actually a system-level concern");
      expect(prompt).toContain("Would an experienced architect");
    });

    it("should omit counter-argument documentation examples", () => {
      const prompt = buildCrossFilePrompt(prDetails, filesSummary, []);

      expect(prompt).toContain("# SELF-CHALLENGE REQUIREMENT");
      expect(prompt).not.toContain("## Counter-Argument Documentation");
      expect(prompt).not.toContain("Counter-Argument Considered:");
    });

    it("should include verification checklist", () => {
      const prompt = buildCrossFilePrompt(prDetails, filesSummary, []);

      expect(prompt).toContain("# VERIFICATION CHECKLIST");
      expect(prompt).toContain("Issue spans multiple files");
      expect(prompt).toContain("Issue is NEW to this PR");
    });

    it("should include existing comments section when provided", () => {
      const comments = "Reviewer noted a security issue on line 5";
      const prompt = buildCrossFilePrompt(prDetails, filesSummary, [], comments);

      expect(prompt).toContain("EXISTING PR COMMENTS:");
      expect(prompt).toContain(comments);
      expect(prompt).toContain("Focus on NEW system-level concerns not already covered");
    });

    it("should include repo context section when provided", () => {
      const repoContext = "Always use TypeScript strict mode";
      const prompt = buildCrossFilePrompt(prDetails, filesSummary, [], undefined, repoContext);

      expect(prompt).toContain("# REPOSITORY-SPECIFIC GUIDELINES");
      expect(prompt).toContain(repoContext);
    });

    it("should include workspace section when repoPath is provided", () => {
      const prompt = buildCrossFilePrompt(
        prDetails,
        filesSummary,
        [],
        undefined,
        undefined,
        "/path/to/repo"
      );

      expect(prompt).toContain("# WORKSPACE ACCESS ENABLED");
      expect(prompt).toContain("@workspace /search");
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
      expect(prompt).toContain("Could this be intentional?");
      expect(prompt).toContain("Is this validated elsewhere?");
      expect(prompt).toContain("Is this test/mock code?");
      expect(prompt).toContain("Is there framework context I'm missing?");
      expect(prompt).toContain("Would a senior engineer flag this?");
    });

    it("should include self-challenge requirement instead of counter-argument examples", () => {
      const prompt = buildBatchedFileReviewPrompt(mockManifest);

      expect(prompt).toContain("# SELF-CHALLENGE REQUIREMENT");
      expect(prompt).not.toContain("## Counter-Argument Documentation");
      expect(prompt).not.toContain("Counter-Argument Considered:");
    });

    it("should include verification checklist", () => {
      const prompt = buildBatchedFileReviewPrompt(mockManifest);

      expect(prompt).toContain("# VERIFICATION CHECKLIST");
      expect(prompt).toContain("Issue exists in ADDED lines (+)");
      expect(prompt).toContain("Line number is correct");
    });

    it("should include compact reasoning requirement", () => {
      const prompt = buildBatchedFileReviewPrompt(mockManifest);

      expect(prompt).toContain("reasoning");
      expect(prompt).toContain("concrete impact");
      expect(prompt).toContain("justify the severity");
    });

    it("should omit verbose counter-argument examples", () => {
      const prompt = buildBatchedFileReviewPrompt(mockManifest);

      expect(prompt).not.toContain("✅ EXAMPLE 2:");
      expect(prompt).not.toContain("✓ Counter-argument:");
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

    it("should include existing comments section when provided", () => {
      const existingComments = "Previously noted: missing null check on line 20";
      const prompt = buildBatchedFileReviewPrompt(mockManifest, existingComments);

      expect(prompt).toContain(existingComments);
      expect(prompt).toContain("Do NOT flag issues already mentioned above");
    });

    it("should add rule 5 when existingCommentsContext is provided", () => {
      const prompt = buildBatchedFileReviewPrompt(mockManifest, "some prior comment");

      expect(prompt).toContain("5. AVOID duplicating issues in EXISTING COMMENTS above");
    });

    it("should omit rule 5 when no existingCommentsContext", () => {
      const prompt = buildBatchedFileReviewPrompt(mockManifest);

      expect(prompt).not.toContain("5. AVOID duplicating issues");
    });

    it("uses @file: syntax when repoPath is provided", () => {
      const prompt = buildBatchedFileReviewPrompt(mockManifest, undefined, undefined, "/some/repo");

      expect(prompt).toContain("@file:.mergementor/diffs/test.diff");
    });
  });
});
