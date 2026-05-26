import { describe, expect, test } from "vitest";
import type { PRDetails } from "../../../platforms/types.js";
import type { DiffManifest } from "../../../review/diffStorage.js";
import { buildFastReviewPrompt } from "./fast.js";

describe("buildFastReviewPrompt", () => {
  const mockPRDetails: PRDetails = {
    number: 42,
    title: "Add authentication middleware",
    description: "Implements JWT-based auth for API routes",
    author: "testuser",
    baseBranch: "main",
    headBranch: "feature/auth",
  };

  const mockManifest: DiffManifest = {
    prIdentifier: "test-pr-42",
    files: [
      {
        filename: "src/auth.ts",
        status: "added",
        diffPath: "auth.diff",
        additions: 80,
        deletions: 0,
      },
      {
        filename: "src/routes.ts",
        status: "modified",
        diffPath: "routes.diff",
        additions: 15,
        deletions: 5,
      },
    ],
    createdAt: new Date().toISOString(),
  };

  test("returns string containing PR title and description", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest);

    expect(prompt).toContain("Add authentication middleware");
    expect(prompt).toContain("Implements JWT-based auth for API routes");
  });

  test("includes file listings from manifest", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest);

    expect(prompt).toContain("src/auth.ts");
    expect(prompt).toContain("src/routes.ts");
    expect(prompt).toContain("(added, +80/-0)");
    expect(prompt).toContain("(modified, +15/-5)");
    expect(prompt).toContain("@auth.diff");
    expect(prompt).toContain("@routes.diff");
  });

  test("includes existing comments section when provided", () => {
    const comments = "reviewer1: Consider using bcrypt for hashing";
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest, comments);

    expect(prompt).toContain("EXISTING PR COMMENTS");
    expect(prompt).toContain("Consider using bcrypt for hashing");
    expect(prompt).toContain("Focus on NEW issues not already covered");
  });

  test("omits existing comments section when undefined", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest);

    expect(prompt).not.toContain("EXISTING PR COMMENTS");
  });

  test("includes workspace section when repoPath is provided", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest, undefined, "/path/to/repo");

    expect(prompt).toContain("WORKSPACE ACCESS ENABLED");
    expect(prompt).toContain("@workspace /search");
    expect(prompt).toContain("@file:");
  });

  test("uses relative diff paths when repoPath is provided", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest, undefined, "/path/to/repo");

    expect(prompt).toContain("@.mergementor/diffs/auth.diff");
    expect(prompt).toContain("@.mergementor/diffs/routes.diff");
  });

  test("omits workspace section when repoPath is undefined", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest);

    expect(prompt).not.toContain("WORKSPACE ACCESS ENABLED");
  });

  test("contains JSON output format instructions", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest);

    expect(prompt).toContain("OUTPUT FORMAT");
    expect(prompt).toContain("```json");
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"findings"');
    expect(prompt).toContain('"severity"');
    expect(prompt).toContain('"confidence"');
    expect(prompt).toContain('"category"');
    expect(prompt).toContain('"message"');
    expect(prompt).toContain('"suggestion"');
    expect(prompt).toContain('"reasoning"');
  });

  test("contains severity thresholds", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest);

    expect(prompt).toContain("SEVERITY THRESHOLDS");
    expect(prompt).toContain("critical");
    expect(prompt).toContain("high");
    expect(prompt).toContain("medium");
    expect(prompt).toContain("low");
  });

  test("contains verification checklist", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest);

    expect(prompt).toContain("VERIFICATION CHECKLIST");
    expect(prompt).toContain("Issue exists in ADDED lines");
    expect(prompt).toContain("Line number is correct");
  });

  test("defines the expert code reviewer role", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest);

    expect(prompt).toContain("Expert code reviewer");
    expect(prompt).toContain("Individual file analysis");
    expect(prompt).toContain("Cross-file architectural analysis");
  });

  test("includes compact analysis structure", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest);

    expect(prompt).toContain("# ANALYSIS");
    expect(prompt).toContain("Scan thoroughly");
    expect(prompt).not.toContain("MANDATORY ANALYSIS STRUCTURE");
  });

  test("includes self-challenge requirement", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest);

    expect(prompt).toContain("SELF-CHALLENGE REQUIREMENT");
    expect(prompt).toContain("Could this be intentional?");
    expect(prompt).toContain("Is this validated elsewhere?");
  });

  test("omits counter-argument documentation examples", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest);

    expect(prompt).not.toContain("Counter-Argument Considered:");
    expect(prompt).not.toContain("Decision:");
  });

  test("includes attribution rules for different finding scopes", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest);

    expect(prompt).toContain("Attribution Rules");
    expect(prompt).toContain("Line-specific");
    expect(prompt).toContain("File-level");
    expect(prompt).toContain("General/PR-level");
  });

  test("shows fallback when description is empty", () => {
    const prWithoutDesc: PRDetails = {
      ...mockPRDetails,
      description: "",
    };
    const prompt = buildFastReviewPrompt(prWithoutDesc, mockManifest);

    expect(prompt).toContain("No description provided");
  });

  test("handles empty manifest files array", () => {
    const emptyManifest: DiffManifest = {
      prIdentifier: "empty-pr",
      files: [],
      createdAt: new Date().toISOString(),
    };
    const prompt = buildFastReviewPrompt(mockPRDetails, emptyManifest);

    expect(prompt).toContain("# YOUR ROLE");
    expect(prompt).toContain("Files to Review:");
  });

  test("adds duplicate avoidance rule when existing comments provided", () => {
    const comments = "Some existing review comment";
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest, comments);

    expect(prompt).toContain("AVOID duplicating issues in EXISTING COMMENTS");
  });

  test("omits duplicate avoidance rule when no existing comments", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest);

    expect(prompt).not.toContain("AVOID duplicating issues in EXISTING COMMENTS");
  });

  test("includes confidence levels", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest);

    expect(prompt).toContain("CONFIDENCE LEVELS");
    expect(prompt).toContain("Clear issue with definite negative impact");
  });

  test("includes isPreExisting field in output schema", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest);

    expect(prompt).toContain('"isPreExisting"');
  });

  test("includes selectedPasses and additional context sections when provided", () => {
    const passes = ["security", "performance"] as const;
    const additionalSections = ["## Custom Analysis Section", "Custom context here"];
    const prompt = buildFastReviewPrompt(
      mockPRDetails,
      mockManifest,
      undefined,
      undefined,
      passes,
      additionalSections
    );

    expect(prompt).toContain("security");
    expect(prompt).toContain("performance");
    expect(prompt).toContain("Custom Analysis Section");
    expect(prompt).toContain("Custom context here");
  });

  test("omits selected passes section when empty array", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest, undefined, undefined, []);

    expect(prompt).not.toContain("ADDITIVE REVIEW PASSES");
  });

  test("includes ordered numbered passes", () => {
    const passes = ["scan", "security", "logic"] as const;
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest, undefined, undefined, passes);

    expect(prompt).toContain("1. scan");
    expect(prompt).toContain("2. security");
    expect(prompt).toContain("3. logic");
  });

  test("includes focused pass analysis with phase details", () => {
    const passes = ["security"] as const;
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest, undefined, undefined, passes);

    expect(prompt).toContain("Additional Focused Passes");
    expect(prompt).toContain("Additive Pass 1: security");
    expect(prompt).toContain("trust boundaries");
    expect(prompt).toContain("secrets, data exposure");
  });

  test("builds workspace section with proper formatting", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest, undefined, "/path/to/repo");

    expect(prompt).toContain("---");
    expect(prompt).toContain("WORKSPACE ACCESS ENABLED");
    expect(prompt).toContain("@workspace /search");
    expect(prompt).toContain("@file:");
    expect(prompt).toContain("MANDATORY");
  });

  test("omits workspace section when repoPath is undefined or empty", () => {
    const prompt1 = buildFastReviewPrompt(mockPRDetails, mockManifest);
    const prompt2 = buildFastReviewPrompt(mockPRDetails, mockManifest, undefined, "");

    expect(prompt1).not.toContain("WORKSPACE ACCESS ENABLED");
    expect(prompt2).not.toContain("WORKSPACE ACCESS ENABLED");
  });

  test("includes additional context sections with proper formatting", () => {
    const sections = [
      "## Section One",
      "Content for section one",
      "## Section Two",
      "Content for section two",
    ];
    const prompt = buildFastReviewPrompt(
      mockPRDetails,
      mockManifest,
      undefined,
      undefined,
      undefined,
      sections
    );

    expect(prompt).toContain("Section One");
    expect(prompt).toContain("Section Two");
    expect(prompt).toContain("Content for section one");
    expect(prompt).toContain("Content for section two");
  });

  test("omits additional context when array is empty", () => {
    const prompt = buildFastReviewPrompt(
      mockPRDetails,
      mockManifest,
      undefined,
      undefined,
      undefined,
      []
    );

    // Verify the section is just omitted entirely
    expect(prompt).toContain("# YOUR ROLE");
  });

  test("combines all optional sections correctly", () => {
    const passes = ["logic", "performance"] as const;
    const sections = ["## Custom Guidance"];
    const comments = "Previous review: check error handling";
    const prompt = buildFastReviewPrompt(
      mockPRDetails,
      mockManifest,
      comments,
      "/repo",
      passes,
      sections
    );

    expect(prompt).toContain("EXISTING PR COMMENTS");
    expect(prompt).toContain("WORKSPACE ACCESS ENABLED");
    expect(prompt).toContain("ADDITIVE REVIEW PASSES");
    expect(prompt).toContain("Custom Guidance");
    expect(prompt).toContain("logic");
    expect(prompt).toContain("performance");
  });

  test("handles all review phases in pass analysis", () => {
    const allPhases = [
      "scan",
      "security",
      "logic",
      "performance",
      "monorepo",
      "testing",
      "database",
    ] as const;
    const prompt = buildFastReviewPrompt(
      mockPRDetails,
      mockManifest,
      undefined,
      undefined,
      allPhases
    );

    expect(prompt).toContain("scan");
    expect(prompt).toContain("security");
    expect(prompt).toContain("logic");
    expect(prompt).toContain("performance");
    expect(prompt).toContain("monorepo");
    expect(prompt).toContain("testing");
    expect(prompt).toContain("database");
  });

  test("formats file listings with correct symbol for workspace path", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest, undefined, "/workspace");

    // When repoPath is provided, uses @.mergementor/diffs/ prefix
    expect(prompt).toContain("@.mergementor/diffs/");
  });

  test("formats file listings without workspace prefix when no repoPath", () => {
    const prompt = buildFastReviewPrompt(mockPRDetails, mockManifest);

    // Without repoPath, uses simple @ prefix
    expect(prompt).toContain("@auth.diff");
    expect(prompt).not.toContain("@.mergementor/diffs/");
  });
});
