import { describe, expect, it } from "vitest";
import type { DiffManifest } from "../../../review/diffStorage.js";
import { buildPerformanceFileReviewPrompt } from "./performance.js";
import { buildSecurityFileReviewPrompt } from "./security.js";

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
