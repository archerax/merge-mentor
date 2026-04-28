import { describe, expect, it } from "vitest";
import type { PRDetails } from "../../../platforms/types.js";
import type { DiffManifest } from "../../../review/diffStorage.js";
import type { GeneralCrossFileContext } from "./general.js";
import { buildGeneralCrossFilePrompt, buildGeneralFileReviewPrompt } from "./general.js";
import type { PerformanceCrossFileContext } from "./performance.js";
import {
  buildPerformanceCrossFilePrompt,
  buildPerformanceFileReviewPrompt,
} from "./performance.js";
import type { SecurityCrossFileContext } from "./security.js";
import { buildSecurityCrossFilePrompt, buildSecurityFileReviewPrompt } from "./security.js";

describe("Specialized Review Prompts", () => {
  const mockManifest: DiffManifest = {
    prIdentifier: "test-pr-123",
    files: [
      {
        filename: "src/auth.ts",
        status: "modified",
        diffPath: "auth.diff",
        additions: 25,
        deletions: 10,
      },
      {
        filename: "src/utils.ts",
        status: "added",
        diffPath: "utils.diff",
        additions: 50,
        deletions: 0,
      },
    ],
    createdAt: new Date().toISOString(),
  };

  describe("buildSecurityFileReviewPrompt", () => {
    it("should define the security researcher role", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      expect(prompt).toContain("Security Researcher");
      expect(prompt).toContain("security-focused code review");
    });

    it("should include CRITICAL SCOPE RESTRICTIONS", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      expect(prompt).toContain("CRITICAL SCOPE RESTRICTIONS");
      expect(prompt).toContain("ONLY REPORT");
      expect(prompt).toContain("security vulnerabilities");
    });

    it("should explicitly exclude non-security issues", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      expect(prompt).toContain("❌ Logic bugs");
      expect(prompt).toContain("❌ Performance issues");
      expect(prompt).toContain("❌ Code quality/style issues");
    });

    it("should include files listing with diff references", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      expect(prompt).toContain("src/auth.ts");
      expect(prompt).toContain("src/utils.ts");
      expect(prompt).toContain("@auth.diff");
      expect(prompt).toContain("@utils.diff");
    });

    it("should include security focus areas", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      expect(prompt).toContain("Injection Vulnerabilities");
      expect(prompt).toContain("SQL injection");
      expect(prompt).toContain("XSS");
      expect(prompt).toContain("Command injection");
      expect(prompt).toContain("Path traversal");
    });

    it("should include authentication/authorization section", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      expect(prompt).toContain("Authentication & Authorization");
      expect(prompt).toContain("Authentication bypasses");
      expect(prompt).toContain("JWT vulnerabilities");
      expect(prompt).toContain("IDOR");
    });

    it("should include cryptographic issues section", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      expect(prompt).toContain("Cryptographic Issues");
      expect(prompt).toContain("Weak or broken algorithms");
      expect(prompt).toContain("Hardcoded secrets");
    });

    it("should include data exposure section", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      expect(prompt).toContain("Data Exposure");
      expect(prompt).toContain("Sensitive data in logs");
    });

    it("should include unsafe operations section", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      expect(prompt).toContain("Unsafe Operations");
      expect(prompt).toContain("Unsafe deserialization");
      expect(prompt).toContain("SSRF");
    });

    it("should include race conditions in security context", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      expect(prompt).toContain("Race Conditions in Security Context");
      expect(prompt).toContain("TOCTOU");
    });

    it("should include CSRF section", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      expect(prompt).toContain("CSRF");
      expect(prompt).toContain("CORS");
    });

    it("should include verification checklist", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      expect(prompt).toContain("VERIFICATION CHECKLIST");
      expect(prompt).toContain("CLEAR security impact");
      expect(prompt).toContain("realistic attack scenario");
    });

    it("should include at least 15 good security examples", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      // Count good examples
      const goodExampleMatches = prompt.match(/✅ EXAMPLE \d+:/g);
      expect(goodExampleMatches).not.toBeNull();
      expect(goodExampleMatches?.length).toBeGreaterThanOrEqual(15);
    });

    it("should include bad examples showing what NOT to report", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      expect(prompt).toContain("BAD FINDINGS (DO NOT REPORT THESE)");
      expect(prompt).toContain("❌ EXAMPLE");
      expect(prompt).toContain("Why skip:");
    });

    it("should include self-challenge requirement", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      expect(prompt).toContain("SELF-CHALLENGE REQUIREMENT");
      expect(prompt).toContain("realistic attack scenario");
    });

    it("should include JSON output schema", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      expect(prompt).toContain("OUTPUT FORMAT");
      expect(prompt).toContain("```json");
      expect(prompt).toContain('"file_results"');
      expect(prompt).toContain('"findings"');
      expect(prompt).toContain('"severity"');
      expect(prompt).toContain('"confidence"');
      expect(prompt).toContain('"category"');
      expect(prompt).toContain('"message"');
      expect(prompt).toContain('"suggestion"');
      expect(prompt).toContain('"reasoning"');
    });

    it("should include workspace access section when repoPath provided", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest, "/path/to/repo");

      expect(prompt).toContain("WORKSPACE ACCESS ENABLED");
      expect(prompt).toContain("@workspace /search");
      expect(prompt).toContain("@file:");
    });

    it("should use relative diff paths when repoPath provided", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest, "/path/to/repo");

      expect(prompt).toContain("@.mergementor/diffs/");
    });

    it("should not include workspace section without repoPath", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      expect(prompt).not.toContain("WORKSPACE ACCESS ENABLED");
    });

    it("should include counter-argument requirement", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      expect(prompt).toContain("SELF-CHALLENGE REQUIREMENT");
      expect(prompt).toContain("mitigated elsewhere");
    });

    it("should include counter-argument documentation section", () => {
      const prompt = buildSecurityFileReviewPrompt(mockManifest);

      expect(prompt).toContain("## Counter-Argument Documentation");
      expect(prompt).toContain("Counter-Argument Considered:");
      expect(prompt).toContain("Rebuttal:");
      expect(prompt).toContain("Decision:");
      expect(prompt).toContain("✅ **Report**");
      expect(prompt).toContain("❌ **Don't report**");
    });
  });

  describe("buildPerformanceFileReviewPrompt", () => {
    it("should define the performance engineer role", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest);

      expect(prompt).toContain("Performance Engineer");
      expect(prompt).toContain("performance-focused code review");
    });

    it("should include CRITICAL SCOPE RESTRICTIONS", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest);

      expect(prompt).toContain("CRITICAL SCOPE RESTRICTIONS");
      expect(prompt).toContain("ONLY REPORT");
      expect(prompt).toContain("performance issues");
    });

    it("should explicitly exclude non-performance issues", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest);

      expect(prompt).toContain("❌ Security vulnerabilities");
      expect(prompt).toContain("❌ Logic bugs");
      expect(prompt).toContain("❌ Code quality/style issues");
    });

    it("should include files listing with diff references", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest);

      expect(prompt).toContain("src/auth.ts");
      expect(prompt).toContain("src/utils.ts");
      expect(prompt).toContain("@auth.diff");
    });

    it("should include N+1 query patterns section", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest);

      expect(prompt).toContain("N+1 Query Patterns");
      expect(prompt).toContain("Database queries inside loops");
    });

    it("should include re-renders/re-computations section", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest);

      expect(prompt).toContain("Unnecessary Re-renders/Re-computations");
      expect(prompt).toContain("useMemo");
      expect(prompt).toContain("useCallback");
    });

    it("should include memory leaks section", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest);

      expect(prompt).toContain("Memory Leaks");
      expect(prompt).toContain("Event listeners not cleaned up");
      expect(prompt).toContain("setInterval");
    });

    it("should include algorithmic inefficiency section", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest);

      expect(prompt).toContain("Algorithmic Inefficiency");
      expect(prompt).toContain("O(n²) when O(n) possible");
    });

    it("should include blocking operations section", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest);

      expect(prompt).toContain("Blocking Operations");
      expect(prompt).toContain("Synchronous I/O");
      expect(prompt).toContain("main thread");
    });

    it("should include bundle/payload issues section", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest);

      expect(prompt).toContain("Bundle/Payload Issues");
      expect(prompt).toContain("code splitting");
      expect(prompt).toContain("lazy loading");
    });

    it("should include missing caching section", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest);

      expect(prompt).toContain("Missing Caching");
      expect(prompt).toContain("memoization");
    });

    it("should include verification checklist", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest);

      expect(prompt).toContain("VERIFICATION CHECKLIST");
      expect(prompt).toContain("MEASURABLE performance impact");
    });

    it("should include at least 15 good performance examples", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest);

      // Count good examples
      const goodExampleMatches = prompt.match(/✅ EXAMPLE \d+:/g);
      expect(goodExampleMatches).not.toBeNull();
      expect(goodExampleMatches?.length).toBeGreaterThanOrEqual(15);
    });

    it("should include bad examples showing what NOT to report", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest);

      expect(prompt).toContain("BAD FINDINGS (DO NOT REPORT THESE)");
      expect(prompt).toContain("❌ EXAMPLE");
      expect(prompt).toContain("Micro-Optimization");
    });

    it("should include self-challenge requirement", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest);

      expect(prompt).toContain("SELF-CHALLENGE REQUIREMENT");
      expect(prompt).toContain("measurable");
    });

    it("should include JSON output schema", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest);

      expect(prompt).toContain("OUTPUT FORMAT");
      expect(prompt).toContain("```json");
      expect(prompt).toContain('"file_results"');
      expect(prompt).toContain('"findings"');
    });

    it("should include workspace access section when repoPath provided", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest, "/path/to/repo");

      expect(prompt).toContain("WORKSPACE ACCESS ENABLED");
      expect(prompt).toContain("@workspace /search");
    });

    it("should use relative diff paths when repoPath provided", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest, "/path/to/repo");

      expect(prompt).toContain("@.mergementor/diffs/");
    });

    it("should include counter-argument requirement", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest);

      expect(prompt).toContain("hot path");
      expect(prompt).toContain("already optimized");
    });

    it("should include counter-argument documentation section", () => {
      const prompt = buildPerformanceFileReviewPrompt(mockManifest);

      expect(prompt).toContain("## Counter-Argument Documentation");
      expect(prompt).toContain("Counter-Argument Considered:");
      expect(prompt).toContain("Rebuttal:");
      expect(prompt).toContain("Decision:");
      expect(prompt).toContain("✅ **Report**");
      expect(prompt).toContain("❌ **Don't report**");
    });
  });

  const mockPRDetails: PRDetails = {
    number: 42,
    title: "Add authentication middleware",
    description: "Implements JWT-based auth for API routes",
    author: "testuser",
    baseBranch: "main",
    headBranch: "feature/auth",
  };

  describe("buildSecurityCrossFilePrompt", () => {
    function createSecurityContext(
      overrides?: Partial<SecurityCrossFileContext>
    ): SecurityCrossFileContext {
      return {
        filesSummary: "src/auth.ts (modified, +25/-10)\nsrc/utils.ts (added, +50/-0)",
        fileReviewResults: [
          {
            filename: "src/auth.ts",
            findings: [
              {
                line: 10,
                severity: "high",
                confidence: "high",
                category: "security",
                message: "Hardcoded secret",
                suggestion: "Use env variable",
                reasoning: "Secret exposed in source",
              },
            ],
          },
          {
            filename: "src/utils.ts",
            findings: [],
          },
        ],
        ...overrides,
      };
    }

    it("should return string containing PR context", () => {
      const prompt = buildSecurityCrossFilePrompt(mockPRDetails, createSecurityContext());

      expect(prompt).toContain("Add authentication middleware");
      expect(prompt).toContain("Implements JWT-based auth for API routes");
    });

    it("should include file review results summary", () => {
      const prompt = buildSecurityCrossFilePrompt(mockPRDetails, createSecurityContext());

      expect(prompt).toContain("src/auth.ts: 1 finding(s)");
      expect(prompt).not.toContain("src/utils.ts: 0 finding(s)");
    });

    it("should show files summary from context", () => {
      const prompt = buildSecurityCrossFilePrompt(mockPRDetails, createSecurityContext());

      expect(prompt).toContain("src/auth.ts (modified, +25/-10)");
      expect(prompt).toContain("src/utils.ts (added, +50/-0)");
    });

    it("should include existing comments section when provided", () => {
      const prompt = buildSecurityCrossFilePrompt(
        mockPRDetails,
        createSecurityContext({
          existingCommentsContext: "reviewer1: Check CSRF tokens",
        })
      );

      expect(prompt).toContain("EXISTING PR COMMENTS");
      expect(prompt).toContain("Check CSRF tokens");
      expect(prompt).toContain("Focus on NEW security concerns");
    });

    it("should omit comments section when not provided", () => {
      const prompt = buildSecurityCrossFilePrompt(
        mockPRDetails,
        createSecurityContext({ existingCommentsContext: undefined })
      );

      expect(prompt).not.toContain("EXISTING PR COMMENTS");
    });

    it("should include workspace section when repoPath is provided", () => {
      const prompt = buildSecurityCrossFilePrompt(
        mockPRDetails,
        createSecurityContext(),
        "/path/to/repo"
      );

      expect(prompt).toContain("WORKSPACE ACCESS ENABLED");
      expect(prompt).toContain("@workspace /search");
      expect(prompt).toContain("Critical for Security Analysis");
    });

    it("should omit workspace section when repoPath is undefined", () => {
      const prompt = buildSecurityCrossFilePrompt(mockPRDetails, createSecurityContext());

      expect(prompt).not.toContain("WORKSPACE ACCESS ENABLED");
    });

    it("should contain security-focused analysis instructions", () => {
      const prompt = buildSecurityCrossFilePrompt(mockPRDetails, createSecurityContext());

      expect(prompt).toContain("Security researcher");
      expect(prompt).toContain("cross-file security concerns");
      expect(prompt).toContain("Authentication/Authorization Architecture");
      expect(prompt).toContain("Trust Boundaries");
      expect(prompt).toContain("Security Control Consistency");
    });

    it("should contain critical scope restrictions", () => {
      const prompt = buildSecurityCrossFilePrompt(mockPRDetails, createSecurityContext());

      expect(prompt).toContain("CRITICAL SCOPE RESTRICTIONS");
      expect(prompt).toContain("ONLY REPORT");
      expect(prompt).toContain("system-level security issues");
    });

    it("should contain JSON output format", () => {
      const prompt = buildSecurityCrossFilePrompt(mockPRDetails, createSecurityContext());

      expect(prompt).toContain("OUTPUT FORMAT");
      expect(prompt).toContain("```json");
      expect(prompt).toContain('"findings"');
      expect(prompt).toContain('"overall_assessment"');
      expect(prompt).toContain('"affected_files"');
      expect(prompt).toContain('"recommendations"');
    });

    it("should include self-challenge requirement", () => {
      const prompt = buildSecurityCrossFilePrompt(mockPRDetails, createSecurityContext());

      expect(prompt).toContain("SELF-CHALLENGE REQUIREMENT");
      expect(prompt).toContain("truly a cross-file security issue");
    });

    it("should show fallback when no individual findings exist", () => {
      const prompt = buildSecurityCrossFilePrompt(
        mockPRDetails,
        createSecurityContext({
          fileReviewResults: [{ filename: "src/auth.ts", findings: [] }],
        })
      );

      expect(prompt).toContain("No individual security issues found");
    });

    it("should show fallback when description is empty", () => {
      const prWithoutDesc: PRDetails = { ...mockPRDetails, description: "" };
      const prompt = buildSecurityCrossFilePrompt(prWithoutDesc, createSecurityContext());

      expect(prompt).toContain("No description provided");
    });

    it("should include counter-argument documentation", () => {
      const prompt = buildSecurityCrossFilePrompt(mockPRDetails, createSecurityContext());

      expect(prompt).toContain("Counter-Argument Documentation");
      expect(prompt).toContain("Counter-Argument Considered:");
      expect(prompt).toContain("Rebuttal:");
    });

    it("should include verification checklist", () => {
      const prompt = buildSecurityCrossFilePrompt(mockPRDetails, createSecurityContext());

      expect(prompt).toContain("VERIFICATION CHECKLIST");
      expect(prompt).toContain("Issue spans multiple files");
      expect(prompt).toContain("realistic attack scenario");
    });
  });

  describe("buildPerformanceCrossFilePrompt", () => {
    function createPerformanceContext(
      overrides?: Partial<PerformanceCrossFileContext>
    ): PerformanceCrossFileContext {
      return {
        filesSummary: "src/fetcher.ts (modified, +30/-5)\nsrc/aggregator.ts (added, +60/-0)",
        fileReviewResults: [
          {
            filename: "src/fetcher.ts",
            findings: [
              {
                line: 22,
                severity: "medium",
                confidence: "high",
                category: "performance",
                message: "N+1 query pattern",
                suggestion: "Use batch loading",
                reasoning: "Queries inside loop",
              },
            ],
          },
          {
            filename: "src/aggregator.ts",
            findings: [],
          },
        ],
        ...overrides,
      };
    }

    it("should return string containing PR context", () => {
      const prompt = buildPerformanceCrossFilePrompt(mockPRDetails, createPerformanceContext());

      expect(prompt).toContain("Add authentication middleware");
      expect(prompt).toContain("Implements JWT-based auth for API routes");
    });

    it("should include file review results summary", () => {
      const prompt = buildPerformanceCrossFilePrompt(mockPRDetails, createPerformanceContext());

      expect(prompt).toContain("src/fetcher.ts: 1 finding(s)");
      expect(prompt).not.toContain("src/aggregator.ts: 0 finding(s)");
    });

    it("should show files summary from context", () => {
      const prompt = buildPerformanceCrossFilePrompt(mockPRDetails, createPerformanceContext());

      expect(prompt).toContain("src/fetcher.ts (modified, +30/-5)");
      expect(prompt).toContain("src/aggregator.ts (added, +60/-0)");
    });

    it("should include existing comments section when provided", () => {
      const prompt = buildPerformanceCrossFilePrompt(
        mockPRDetails,
        createPerformanceContext({
          existingCommentsContext: "reviewer1: Consider caching this query",
        })
      );

      expect(prompt).toContain("EXISTING PR COMMENTS");
      expect(prompt).toContain("Consider caching this query");
      expect(prompt).toContain("Focus on NEW performance concerns");
    });

    it("should omit comments section when not provided", () => {
      const prompt = buildPerformanceCrossFilePrompt(
        mockPRDetails,
        createPerformanceContext({ existingCommentsContext: undefined })
      );

      expect(prompt).not.toContain("EXISTING PR COMMENTS");
    });

    it("should include workspace section when repoPath is provided", () => {
      const prompt = buildPerformanceCrossFilePrompt(
        mockPRDetails,
        createPerformanceContext(),
        "/path/to/repo"
      );

      expect(prompt).toContain("WORKSPACE ACCESS ENABLED");
      expect(prompt).toContain("@workspace /search");
      expect(prompt).toContain("Critical for Performance Analysis");
    });

    it("should omit workspace section when repoPath is undefined", () => {
      const prompt = buildPerformanceCrossFilePrompt(mockPRDetails, createPerformanceContext());

      expect(prompt).not.toContain("WORKSPACE ACCESS ENABLED");
    });

    it("should contain performance-focused analysis instructions", () => {
      const prompt = buildPerformanceCrossFilePrompt(mockPRDetails, createPerformanceContext());

      expect(prompt).toContain("Performance engineer");
      expect(prompt).toContain("cross-file performance concerns");
      expect(prompt).toContain("Distributed Performance Patterns");
      expect(prompt).toContain("Resource Management Architecture");
      expect(prompt).toContain("Caching Architecture");
    });

    it("should contain critical scope restrictions", () => {
      const prompt = buildPerformanceCrossFilePrompt(mockPRDetails, createPerformanceContext());

      expect(prompt).toContain("CRITICAL SCOPE RESTRICTIONS");
      expect(prompt).toContain("ONLY REPORT");
      expect(prompt).toContain("system-level performance issues");
    });

    it("should contain JSON output format", () => {
      const prompt = buildPerformanceCrossFilePrompt(mockPRDetails, createPerformanceContext());

      expect(prompt).toContain("OUTPUT FORMAT");
      expect(prompt).toContain("```json");
      expect(prompt).toContain('"findings"');
      expect(prompt).toContain('"overall_assessment"');
      expect(prompt).toContain('"affected_files"');
      expect(prompt).toContain('"recommendations"');
    });

    it("should include self-challenge requirement", () => {
      const prompt = buildPerformanceCrossFilePrompt(mockPRDetails, createPerformanceContext());

      expect(prompt).toContain("SELF-CHALLENGE REQUIREMENT");
      expect(prompt).toContain("truly a cross-file performance issue");
    });

    it("should show fallback when no individual findings exist", () => {
      const prompt = buildPerformanceCrossFilePrompt(
        mockPRDetails,
        createPerformanceContext({
          fileReviewResults: [{ filename: "src/fetcher.ts", findings: [] }],
        })
      );

      expect(prompt).toContain("No individual performance issues found");
    });

    it("should show fallback when description is empty", () => {
      const prWithoutDesc: PRDetails = { ...mockPRDetails, description: "" };
      const prompt = buildPerformanceCrossFilePrompt(prWithoutDesc, createPerformanceContext());

      expect(prompt).toContain("No description provided");
    });

    it("should include counter-argument documentation", () => {
      const prompt = buildPerformanceCrossFilePrompt(mockPRDetails, createPerformanceContext());

      expect(prompt).toContain("Counter-Argument Documentation");
      expect(prompt).toContain("Counter-Argument Considered:");
      expect(prompt).toContain("Rebuttal:");
    });

    it("should include verification checklist", () => {
      const prompt = buildPerformanceCrossFilePrompt(mockPRDetails, createPerformanceContext());

      expect(prompt).toContain("VERIFICATION CHECKLIST");
      expect(prompt).toContain("Issue spans multiple files");
      expect(prompt).toContain("Performance impact is measurable");
    });
  });

  describe("Common prompt structure", () => {
    it("should all have consistent structure", () => {
      const securityPrompt = buildSecurityFileReviewPrompt(mockManifest);
      const perfPrompt = buildPerformanceFileReviewPrompt(mockManifest);

      // All should have these sections
      for (const prompt of [securityPrompt, perfPrompt]) {
        expect(prompt).toContain("# YOUR ROLE");
        expect(prompt).toContain("# CRITICAL SCOPE RESTRICTIONS");
        expect(prompt).toContain("# FILES TO REVIEW");
        expect(prompt).toContain("# VERIFICATION CHECKLIST");
        expect(prompt).toContain("# SELF-CHALLENGE REQUIREMENT");
        expect(prompt).toContain("## Counter-Argument Documentation");
        expect(prompt).toContain("# OUTPUT FORMAT");
      }
    });

    it("should all include isPreExisting field in schema", () => {
      const securityPrompt = buildSecurityFileReviewPrompt(mockManifest);
      const perfPrompt = buildPerformanceFileReviewPrompt(mockManifest);

      for (const prompt of [securityPrompt, perfPrompt]) {
        expect(prompt).toContain('"isPreExisting"');
      }
    });

    it("should all handle empty manifest", () => {
      const emptyManifest: DiffManifest = {
        prIdentifier: "empty-pr",
        files: [],
        createdAt: new Date().toISOString(),
      };

      const securityPrompt = buildSecurityFileReviewPrompt(emptyManifest);
      const perfPrompt = buildPerformanceFileReviewPrompt(emptyManifest);

      // All should still be valid prompts
      expect(securityPrompt).toContain("# YOUR ROLE");
      expect(perfPrompt).toContain("# YOUR ROLE");
    });
  });
});

describe("General Review Prompts", () => {
  const mockManifest: DiffManifest = {
    prIdentifier: "test-pr-42",
    files: [
      {
        filename: "src/index.ts",
        status: "modified",
        diffPath: "index.diff",
        additions: 15,
        deletions: 3,
      },
    ],
    createdAt: new Date().toISOString(),
  };

  const mockPrDetails: PRDetails = {
    number: 42,
    title: "Refactor auth module",
    description: "Refactors the authentication flow for clarity",
    author: "dev",
    baseBranch: "main",
    headBranch: "refactor/auth",
  };

  describe("buildGeneralFileReviewPrompt", () => {
    it("builds a valid prompt for file review", () => {
      const prompt = buildGeneralFileReviewPrompt(mockManifest);

      expect(prompt).toContain("# YOUR ROLE");
      expect(prompt).toContain("src/index.ts");
      expect(prompt).toContain("modified");
    });

    it("uses plain @filename references without repoPath", () => {
      const prompt = buildGeneralFileReviewPrompt(mockManifest);

      expect(prompt).toContain("@index.diff");
      expect(prompt).not.toContain("@file:.mergementor/diffs/");
    });

    it("uses @file: syntax with .mergementor prefix when repoPath is provided", () => {
      const prompt = buildGeneralFileReviewPrompt(mockManifest, undefined, "/repo");

      expect(prompt).toContain("@.mergementor/diffs/index.diff");
      expect(prompt).toContain("# WORKSPACE ACCESS ENABLED");
    });

    it("includes existing comments section when provided", () => {
      const comments = "Existing comment about line 5";
      const prompt = buildGeneralFileReviewPrompt(mockManifest, comments);

      expect(prompt).toContain("# EXISTING PR COMMENTS");
      expect(prompt).toContain("<untrusted-existing-pr-comments>");
      expect(prompt).toContain(comments);
      expect(prompt).toContain("Focus on NEW issues not already covered");
    });

    it("omits existing comments section when not provided", () => {
      const prompt = buildGeneralFileReviewPrompt(mockManifest);

      expect(prompt).not.toContain("# EXISTING PR COMMENTS");
    });

    it("adds rule 5 about existing comments when comments are provided", () => {
      const prompt = buildGeneralFileReviewPrompt(mockManifest, "some comment");

      expect(prompt).toContain("AVOID duplicating issues in EXISTING COMMENTS above");
    });

    it("omits rule 5 when no existing comments", () => {
      const prompt = buildGeneralFileReviewPrompt(mockManifest);

      expect(prompt).not.toContain("AVOID duplicating issues");
    });

    it("includes workspace section when repoPath is provided", () => {
      const prompt = buildGeneralFileReviewPrompt(mockManifest, undefined, "/some/repo");

      expect(prompt).toContain("# WORKSPACE ACCESS ENABLED");
      expect(prompt).toContain("@workspace /search");
    });

    it("omits workspace section when repoPath is not provided", () => {
      const prompt = buildGeneralFileReviewPrompt(mockManifest);

      expect(prompt).not.toContain("# WORKSPACE ACCESS ENABLED");
    });

    it("supports additive passes for file review", () => {
      const prompt = buildGeneralFileReviewPrompt(mockManifest, undefined, undefined, [
        "scan",
        "logic",
      ]);

      expect(prompt).toContain("# ADDITIVE REVIEW PASSES");
      expect(prompt).toContain("1. scan");
      expect(prompt).toContain("2. logic");
      expect(prompt).toContain("These passes add focus and context. They do **not** restrict");
      expect(prompt).toContain("## Additional Focused Passes");
      expect(prompt).toContain("### Additive Pass 1: scan");
      expect(prompt).toContain("### Additive Pass 2: logic");
      expect(prompt).toContain(
        "Use only these categories: bug, security, performance, quality, documentation"
      );
    });

    it("includes monorepo-specific guidance when monorepo phase is selected", () => {
      const prompt = buildGeneralFileReviewPrompt(mockManifest, undefined, undefined, ["monorepo"]);

      expect(prompt).toContain("1. monorepo");
      expect(prompt).toContain("Package boundary violations and private cross-package imports");
      expect(prompt).toContain("**monorepo**: Monorepo-team lens");
      expect(prompt).toContain("**Monorepo hygiene**: Boundary violations");
    });

    describe("tokenSaver option", () => {
      it("includes mandatory analysis structure by default", () => {
        const prompt = buildGeneralFileReviewPrompt(mockManifest);

        expect(prompt).toContain("MANDATORY ANALYSIS STRUCTURE");
      });

      it("suppresses mandatory analysis structure when tokenSaver is true", () => {
        const prompt = buildGeneralFileReviewPrompt(
          mockManifest,
          undefined,
          undefined,
          undefined,
          undefined,
          { tokenSaver: true }
        );

        expect(prompt).not.toContain("MANDATORY ANALYSIS STRUCTURE");
      });

      it("includes compact analysis instruction when tokenSaver is true with no passes", () => {
        const prompt = buildGeneralFileReviewPrompt(
          mockManifest,
          undefined,
          undefined,
          undefined,
          undefined,
          { tokenSaver: true }
        );

        expect(prompt).toContain("# ANALYSIS");
        expect(prompt).toContain("Scan thoroughly");
      });

      it("suppresses verbose output format instruction when tokenSaver is true", () => {
        const prompt = buildGeneralFileReviewPrompt(
          mockManifest,
          undefined,
          undefined,
          undefined,
          undefined,
          { tokenSaver: true }
        );

        expect(prompt).not.toContain("Document your analysis step-by-step");
        expect(prompt).toContain("Return ONLY");
      });

      it("still includes core review content when tokenSaver is true", () => {
        const prompt = buildGeneralFileReviewPrompt(
          mockManifest,
          undefined,
          undefined,
          undefined,
          undefined,
          { tokenSaver: true }
        );

        expect(prompt).toContain("Expert code reviewer");
        expect(prompt).toContain("VERIFICATION CHECKLIST");
      });

      it("still includes pass analysis for custom phases when tokenSaver is true", () => {
        const prompt = buildGeneralFileReviewPrompt(
          mockManifest,
          undefined,
          undefined,
          ["security"],
          undefined,
          { tokenSaver: true }
        );

        expect(prompt).not.toContain("MANDATORY ANALYSIS STRUCTURE");
        expect(prompt).toContain("Additive Pass");
        expect(prompt).toContain("security");
      });
    });
  });

  describe("buildGeneralCrossFilePrompt", () => {
    const baseContext: GeneralCrossFileContext = {
      filesSummary: "- src/index.ts (modified, +15/-3)",
      fileReviewResults: [],
    };

    it("builds a valid cross-file prompt", () => {
      const prompt = buildGeneralCrossFilePrompt(mockPrDetails, baseContext);

      expect(prompt).toContain("# YOUR ROLE");
      expect(prompt).toContain("Refactor auth module");
    });

    it("includes PR description", () => {
      const prompt = buildGeneralCrossFilePrompt(mockPrDetails, baseContext);

      expect(prompt).toContain("Refactors the authentication flow for clarity");
    });

    it("shows no description placeholder when description is empty", () => {
      const prNoDesc = { ...mockPrDetails, description: "" };
      const prompt = buildGeneralCrossFilePrompt(prNoDesc, baseContext);

      expect(prompt).toContain("No description provided");
    });

    it("includes findings summary when file results have findings", () => {
      const context: GeneralCrossFileContext = {
        filesSummary: "- src/index.ts (modified, +15/-3)",
        fileReviewResults: [
          {
            filename: "src/index.ts",
            findings: [
              {
                line: 10,
                severity: "high",
                confidence: "high",
                category: "bug",
                message: "issue",
                suggestion: "fix",
                reasoning: "reason",
                isPreExisting: false,
              },
            ],
          },
        ],
      };

      const prompt = buildGeneralCrossFilePrompt(mockPrDetails, context);

      expect(prompt).toContain("src/index.ts: 1 finding(s)");
    });

    it("shows no individual issues when all files have empty findings", () => {
      const context: GeneralCrossFileContext = {
        filesSummary: "- src/index.ts (modified, +15/-3)",
        fileReviewResults: [{ filename: "src/index.ts", findings: [] }],
      };

      const prompt = buildGeneralCrossFilePrompt(mockPrDetails, context);

      expect(prompt).toContain("No individual issues found");
    });

    it("includes existing comments section when provided", () => {
      const context: GeneralCrossFileContext = {
        ...baseContext,
        existingCommentsContext: "Comment about architecture",
      };

      const prompt = buildGeneralCrossFilePrompt(mockPrDetails, context);

      expect(prompt).toContain("EXISTING PR COMMENTS:");
      expect(prompt).toContain("<untrusted-existing-pr-comments>");
      expect(prompt).toContain("Comment about architecture");
    });

    it("omits existing comments section when not provided", () => {
      const prompt = buildGeneralCrossFilePrompt(mockPrDetails, baseContext);

      expect(prompt).not.toContain("EXISTING PR COMMENTS:");
    });

    it("includes workspace section when repoPath is provided", () => {
      const prompt = buildGeneralCrossFilePrompt(mockPrDetails, baseContext, "/some/repo");

      expect(prompt).toContain("# WORKSPACE ACCESS ENABLED");
      expect(prompt).toContain("@workspace /search");
    });

    it("omits workspace section when repoPath is not provided", () => {
      const prompt = buildGeneralCrossFilePrompt(mockPrDetails, baseContext);

      expect(prompt).not.toContain("# WORKSPACE ACCESS ENABLED");
    });

    it("supports additive passes for cross-file review", () => {
      const prompt = buildGeneralCrossFilePrompt(mockPrDetails, baseContext, undefined, [
        "scan",
        "performance",
      ]);

      expect(prompt).toContain("# ADDITIVE REVIEW PASSES");
      expect(prompt).toContain("1. scan");
      expect(prompt).toContain("2. performance");
      expect(prompt).toContain(
        "- **performance**: Algorithmic complexity, caching, resource usage"
      );
      expect(prompt).toContain("These passes add focus and context. They do **not** restrict");
      expect(prompt).toContain("Return ONLY the JSON code block");
      expect(prompt).toContain("- Security: Authentication/authorization consistent?");
    });

    it("includes monorepo checklist items when monorepo phase is selected", () => {
      const prompt = buildGeneralCrossFilePrompt(mockPrDetails, baseContext, undefined, [
        "monorepo",
      ]);

      expect(prompt).toContain("1. monorepo");
      expect(prompt).toContain(
        "- **monorepo**: Package boundaries, dependency graph hygiene, shared tooling conventions, and workspace structure"
      );
    });
  });
});
