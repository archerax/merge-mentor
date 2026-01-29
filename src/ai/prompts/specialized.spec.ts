import { describe, expect, it } from "vitest";
import type { DiffManifest } from "../../review/diffStorage.js";
import {
  buildLogicReviewPrompt,
  buildPerformanceReviewPrompt,
  buildSecurityReviewPrompt,
} from "./specialized.js";

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

  describe("buildSecurityReviewPrompt", () => {
    it("should define the security researcher role", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

      expect(prompt).toContain("Security Researcher");
      expect(prompt).toContain("security-focused code review");
    });

    it("should include CRITICAL SCOPE RESTRICTIONS", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

      expect(prompt).toContain("CRITICAL SCOPE RESTRICTIONS");
      expect(prompt).toContain("ONLY REPORT");
      expect(prompt).toContain("security vulnerabilities");
    });

    it("should explicitly exclude non-security issues", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

      expect(prompt).toContain("❌ Logic bugs");
      expect(prompt).toContain("❌ Performance issues");
      expect(prompt).toContain("❌ Code quality/style issues");
    });

    it("should include files listing with diff references", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

      expect(prompt).toContain("src/auth.ts");
      expect(prompt).toContain("src/utils.ts");
      expect(prompt).toContain("@auth.diff");
      expect(prompt).toContain("@utils.diff");
    });

    it("should include security focus areas", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

      expect(prompt).toContain("Injection Vulnerabilities");
      expect(prompt).toContain("SQL injection");
      expect(prompt).toContain("XSS");
      expect(prompt).toContain("Command injection");
      expect(prompt).toContain("Path traversal");
    });

    it("should include authentication/authorization section", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

      expect(prompt).toContain("Authentication & Authorization");
      expect(prompt).toContain("Authentication bypasses");
      expect(prompt).toContain("JWT vulnerabilities");
      expect(prompt).toContain("IDOR");
    });

    it("should include cryptographic issues section", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

      expect(prompt).toContain("Cryptographic Issues");
      expect(prompt).toContain("Weak or broken algorithms");
      expect(prompt).toContain("Hardcoded secrets");
    });

    it("should include data exposure section", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

      expect(prompt).toContain("Data Exposure");
      expect(prompt).toContain("Sensitive data in logs");
    });

    it("should include unsafe operations section", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

      expect(prompt).toContain("Unsafe Operations");
      expect(prompt).toContain("Unsafe deserialization");
      expect(prompt).toContain("SSRF");
    });

    it("should include race conditions in security context", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

      expect(prompt).toContain("Race Conditions in Security Context");
      expect(prompt).toContain("TOCTOU");
    });

    it("should include CSRF section", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

      expect(prompt).toContain("CSRF");
      expect(prompt).toContain("CORS");
    });

    it("should include verification checklist", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

      expect(prompt).toContain("VERIFICATION CHECKLIST");
      expect(prompt).toContain("CLEAR security impact");
      expect(prompt).toContain("realistic attack scenario");
    });

    it("should include at least 15 good security examples", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

      // Count good examples
      const goodExampleMatches = prompt.match(/✅ EXAMPLE \d+:/g);
      expect(goodExampleMatches).not.toBeNull();
      expect(goodExampleMatches!.length).toBeGreaterThanOrEqual(15);
    });

    it("should include bad examples showing what NOT to report", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

      expect(prompt).toContain("BAD FINDINGS (DO NOT REPORT THESE)");
      expect(prompt).toContain("❌ EXAMPLE");
      expect(prompt).toContain("Why skip:");
    });

    it("should include self-challenge requirement", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

      expect(prompt).toContain("SELF-CHALLENGE REQUIREMENT");
      expect(prompt).toContain("realistic attack scenario");
    });

    it("should include JSON output schema", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

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

    it("should include repository context when provided", () => {
      const repoContext = "Use TypeScript strict mode\nNo any types allowed";
      const prompt = buildSecurityReviewPrompt(mockManifest, repoContext);

      expect(prompt).toContain("REPOSITORY-SPECIFIC GUIDELINES");
      expect(prompt).toContain(repoContext);
    });

    it("should include workspace access section when repoPath provided", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest, undefined, "/path/to/repo");

      expect(prompt).toContain("WORKSPACE ACCESS ENABLED");
      expect(prompt).toContain("@workspace /search");
      expect(prompt).toContain("@file:");
    });

    it("should use relative diff paths when repoPath provided", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest, undefined, "/path/to/repo");

      expect(prompt).toContain("@.merge-mentor/diffs/auth.diff");
    });

    it("should not include workspace section without repoPath", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

      expect(prompt).not.toContain("WORKSPACE ACCESS ENABLED");
    });

    it("should include counter-argument requirement", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

      expect(prompt).toContain("SELF-CHALLENGE REQUIREMENT");
      expect(prompt).toContain("mitigated elsewhere");
    });

    it("should include counter-argument documentation section", () => {
      const prompt = buildSecurityReviewPrompt(mockManifest);

      expect(prompt).toContain("## Counter-Argument Documentation");
      expect(prompt).toContain("Counter-Argument Considered:");
      expect(prompt).toContain("Rebuttal:");
      expect(prompt).toContain("Decision:");
      expect(prompt).toContain("✅ **Report**");
      expect(prompt).toContain("❌ **Don't report**");
    });
  });

  describe("buildLogicReviewPrompt", () => {
    it("should define the correctness engineer role", () => {
      const prompt = buildLogicReviewPrompt(mockManifest);

      expect(prompt).toContain("Correctness Engineer");
      expect(prompt).toContain("logic-focused code review");
    });

    it("should include CRITICAL SCOPE RESTRICTIONS", () => {
      const prompt = buildLogicReviewPrompt(mockManifest);

      expect(prompt).toContain("CRITICAL SCOPE RESTRICTIONS");
      expect(prompt).toContain("ONLY REPORT");
      expect(prompt).toContain("logic bugs");
    });

    it("should explicitly exclude non-logic issues", () => {
      const prompt = buildLogicReviewPrompt(mockManifest);

      expect(prompt).toContain("❌ Security vulnerabilities");
      expect(prompt).toContain("❌ Performance issues");
      expect(prompt).toContain("❌ Code quality/style issues");
    });

    it("should include files listing with diff references", () => {
      const prompt = buildLogicReviewPrompt(mockManifest);

      expect(prompt).toContain("src/auth.ts");
      expect(prompt).toContain("src/utils.ts");
      expect(prompt).toContain("@auth.diff");
    });

    it("should include off-by-one errors section", () => {
      const prompt = buildLogicReviewPrompt(mockManifest);

      expect(prompt).toContain("Off-by-One Errors");
      expect(prompt).toContain("Loop boundary mistakes");
      expect(prompt).toContain("Array indexing errors");
    });

    it("should include null/undefined handling section", () => {
      const prompt = buildLogicReviewPrompt(mockManifest);

      expect(prompt).toContain("Null/Undefined Handling");
      expect(prompt).toContain("Missing null checks");
      expect(prompt).toContain("Optional chaining gaps");
    });

    it("should include array/string bounds section", () => {
      const prompt = buildLogicReviewPrompt(mockManifest);

      expect(prompt).toContain("Array/String Bounds");
      expect(prompt).toContain("Index out of bounds");
    });

    it("should include type coercion bugs section", () => {
      const prompt = buildLogicReviewPrompt(mockManifest);

      expect(prompt).toContain("Type Coercion Bugs");
      expect(prompt).toContain("Loose equality");
      expect(prompt).toContain("== vs ===");
    });

    it("should include async race conditions section", () => {
      const prompt = buildLogicReviewPrompt(mockManifest);

      expect(prompt).toContain("Async Race Conditions");
      expect(prompt).toContain("Stale closure");
      expect(prompt).toContain("Missing await");
    });

    it("should include state machine bugs section", () => {
      const prompt = buildLogicReviewPrompt(mockManifest);

      expect(prompt).toContain("State Machine Bugs");
      expect(prompt).toContain("Invalid state transitions");
    });

    it("should include loop termination issues section", () => {
      const prompt = buildLogicReviewPrompt(mockManifest);

      expect(prompt).toContain("Loop Termination Issues");
      expect(prompt).toContain("Infinite loop");
    });

    it("should include verification checklist", () => {
      const prompt = buildLogicReviewPrompt(mockManifest);

      expect(prompt).toContain("VERIFICATION CHECKLIST");
      expect(prompt).toContain("causes incorrect behavior");
    });

    it("should include at least 15 good logic examples", () => {
      const prompt = buildLogicReviewPrompt(mockManifest);

      // Count good examples
      const goodExampleMatches = prompt.match(/✅ EXAMPLE \d+:/g);
      expect(goodExampleMatches).not.toBeNull();
      expect(goodExampleMatches!.length).toBeGreaterThanOrEqual(15);
    });

    it("should include bad examples showing what NOT to report", () => {
      const prompt = buildLogicReviewPrompt(mockManifest);

      expect(prompt).toContain("BAD FINDINGS (DO NOT REPORT THESE)");
      expect(prompt).toContain("❌ EXAMPLE");
    });

    it("should include self-challenge requirement", () => {
      const prompt = buildLogicReviewPrompt(mockManifest);

      expect(prompt).toContain("SELF-CHALLENGE REQUIREMENT");
      expect(prompt).toContain("incorrect behavior");
    });

    it("should include JSON output schema", () => {
      const prompt = buildLogicReviewPrompt(mockManifest);

      expect(prompt).toContain("OUTPUT FORMAT");
      expect(prompt).toContain("```json");
      expect(prompt).toContain('"file_results"');
      expect(prompt).toContain('"findings"');
    });

    it("should include repository context when provided", () => {
      const repoContext = "Use functional programming patterns";
      const prompt = buildLogicReviewPrompt(mockManifest, repoContext);

      expect(prompt).toContain("REPOSITORY-SPECIFIC GUIDELINES");
      expect(prompt).toContain(repoContext);
    });

    it("should include workspace access section when repoPath provided", () => {
      const prompt = buildLogicReviewPrompt(mockManifest, undefined, "/path/to/repo");

      expect(prompt).toContain("WORKSPACE ACCESS ENABLED");
      expect(prompt).toContain("@workspace /search");
    });

    it("should use relative diff paths when repoPath provided", () => {
      const prompt = buildLogicReviewPrompt(mockManifest, undefined, "/path/to/repo");

      expect(prompt).toContain("@.merge-mentor/diffs/auth.diff");
    });

    it("should include counter-argument requirement", () => {
      const prompt = buildLogicReviewPrompt(mockManifest);

      expect(prompt).toContain("intentional behavior");
    });

    it("should include counter-argument documentation section", () => {
      const prompt = buildLogicReviewPrompt(mockManifest);

      expect(prompt).toContain("## Counter-Argument Documentation");
      expect(prompt).toContain("Counter-Argument Considered:");
      expect(prompt).toContain("Rebuttal:");
      expect(prompt).toContain("Decision:");
      expect(prompt).toContain("✅ **Report**");
      expect(prompt).toContain("❌ **Don't report**");
    });
  });

  describe("buildPerformanceReviewPrompt", () => {
    it("should define the performance engineer role", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest);

      expect(prompt).toContain("Performance Engineer");
      expect(prompt).toContain("performance-focused code review");
    });

    it("should include CRITICAL SCOPE RESTRICTIONS", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest);

      expect(prompt).toContain("CRITICAL SCOPE RESTRICTIONS");
      expect(prompt).toContain("ONLY REPORT");
      expect(prompt).toContain("performance issues");
    });

    it("should explicitly exclude non-performance issues", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest);

      expect(prompt).toContain("❌ Security vulnerabilities");
      expect(prompt).toContain("❌ Logic bugs");
      expect(prompt).toContain("❌ Code quality/style issues");
    });

    it("should include files listing with diff references", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest);

      expect(prompt).toContain("src/auth.ts");
      expect(prompt).toContain("src/utils.ts");
      expect(prompt).toContain("@auth.diff");
    });

    it("should include N+1 query patterns section", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest);

      expect(prompt).toContain("N+1 Query Patterns");
      expect(prompt).toContain("Database queries inside loops");
    });

    it("should include re-renders/re-computations section", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest);

      expect(prompt).toContain("Unnecessary Re-renders/Re-computations");
      expect(prompt).toContain("useMemo");
      expect(prompt).toContain("useCallback");
    });

    it("should include memory leaks section", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest);

      expect(prompt).toContain("Memory Leaks");
      expect(prompt).toContain("Event listeners not cleaned up");
      expect(prompt).toContain("setInterval");
    });

    it("should include algorithmic inefficiency section", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest);

      expect(prompt).toContain("Algorithmic Inefficiency");
      expect(prompt).toContain("O(n²) when O(n) possible");
    });

    it("should include blocking operations section", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest);

      expect(prompt).toContain("Blocking Operations");
      expect(prompt).toContain("Synchronous I/O");
      expect(prompt).toContain("main thread");
    });

    it("should include bundle/payload issues section", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest);

      expect(prompt).toContain("Bundle/Payload Issues");
      expect(prompt).toContain("code splitting");
      expect(prompt).toContain("lazy loading");
    });

    it("should include missing caching section", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest);

      expect(prompt).toContain("Missing Caching");
      expect(prompt).toContain("memoization");
    });

    it("should include verification checklist", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest);

      expect(prompt).toContain("VERIFICATION CHECKLIST");
      expect(prompt).toContain("MEASURABLE performance impact");
    });

    it("should include at least 15 good performance examples", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest);

      // Count good examples
      const goodExampleMatches = prompt.match(/✅ EXAMPLE \d+:/g);
      expect(goodExampleMatches).not.toBeNull();
      expect(goodExampleMatches!.length).toBeGreaterThanOrEqual(15);
    });

    it("should include bad examples showing what NOT to report", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest);

      expect(prompt).toContain("BAD FINDINGS (DO NOT REPORT THESE)");
      expect(prompt).toContain("❌ EXAMPLE");
      expect(prompt).toContain("Micro-Optimization");
    });

    it("should include self-challenge requirement", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest);

      expect(prompt).toContain("SELF-CHALLENGE REQUIREMENT");
      expect(prompt).toContain("measurable");
    });

    it("should include JSON output schema", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest);

      expect(prompt).toContain("OUTPUT FORMAT");
      expect(prompt).toContain("```json");
      expect(prompt).toContain('"file_results"');
      expect(prompt).toContain('"findings"');
    });

    it("should include repository context when provided", () => {
      const repoContext = "Performance budget: 100ms TTI";
      const prompt = buildPerformanceReviewPrompt(mockManifest, repoContext);

      expect(prompt).toContain("REPOSITORY-SPECIFIC GUIDELINES");
      expect(prompt).toContain(repoContext);
    });

    it("should include workspace access section when repoPath provided", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest, undefined, "/path/to/repo");

      expect(prompt).toContain("WORKSPACE ACCESS ENABLED");
      expect(prompt).toContain("@workspace /search");
    });

    it("should use relative diff paths when repoPath provided", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest, undefined, "/path/to/repo");

      expect(prompt).toContain("@.merge-mentor/diffs/auth.diff");
    });

    it("should include counter-argument requirement", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest);

      expect(prompt).toContain("hot path");
      expect(prompt).toContain("already optimized");
    });

    it("should include counter-argument documentation section", () => {
      const prompt = buildPerformanceReviewPrompt(mockManifest);

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
      const securityPrompt = buildSecurityReviewPrompt(mockManifest);
      const logicPrompt = buildLogicReviewPrompt(mockManifest);
      const perfPrompt = buildPerformanceReviewPrompt(mockManifest);

      // All should have these sections
      for (const prompt of [securityPrompt, logicPrompt, perfPrompt]) {
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
      const securityPrompt = buildSecurityReviewPrompt(mockManifest);
      const logicPrompt = buildLogicReviewPrompt(mockManifest);
      const perfPrompt = buildPerformanceReviewPrompt(mockManifest);

      for (const prompt of [securityPrompt, logicPrompt, perfPrompt]) {
        expect(prompt).toContain('"isPreExisting"');
      }
    });

    it("should all handle empty manifest", () => {
      const emptyManifest: DiffManifest = {
        prIdentifier: "empty-pr",
        files: [],
        createdAt: new Date().toISOString(),
      };

      const securityPrompt = buildSecurityReviewPrompt(emptyManifest);
      const logicPrompt = buildLogicReviewPrompt(emptyManifest);
      const perfPrompt = buildPerformanceReviewPrompt(emptyManifest);

      // All should still be valid prompts
      expect(securityPrompt).toContain("# YOUR ROLE");
      expect(logicPrompt).toContain("# YOUR ROLE");
      expect(perfPrompt).toContain("# YOUR ROLE");
    });
  });
});
