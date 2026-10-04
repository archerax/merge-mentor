import { describe, expect, it } from "vitest";

import type { ExistingComment } from "../../platforms/types.js";
import { formatExistingCommentsContext, formatFullCommentsContext } from "./commentContext.js";

describe("commentContext", () => {
  describe("formatExistingCommentsContext", () => {
    it("returns message when no comments exist", () => {
      const result = formatExistingCommentsContext([]);
      expect(result).toBe("No existing comments on this PR.");
    });

    it("returns message when only summary comments exist", () => {
      const comments: ExistingComment[] = [
        {
          id: 1,
          body: "<!-- AI_CODE_REVIEW_SUMMARY -->\n# Summary",
          isResolved: false,
        },
      ];

      const result = formatExistingCommentsContext(comments);
      expect(result).toBe("No existing inline comments on this PR.");
    });

    it("formats inline comments grouped by file", () => {
      const comments: ExistingComment[] = [
        {
          id: 1,
          path: "src/app.ts",
          line: 10,
          body: "### 🐛 Bug Issue\n**Issue**: Null check missing",
          isResolved: false,
        },
        {
          id: 2,
          path: "src/app.ts",
          line: 25,
          body: "### 🔒 Security Issue\n**Issue**: SQL injection risk",
          isResolved: true,
        },
        {
          id: 3,
          path: "src/utils.ts",
          line: 5,
          body: "### ⚡ Performance Issue\n**Issue**: Inefficient loop",
          isResolved: false,
        },
      ];

      const result = formatExistingCommentsContext(comments);

      expect(result).toContain("EXISTING COMMENTS ON THIS PR:");
      expect(result).toContain("File: src/app.ts");
      expect(result).toContain("Line 10: [Bug] Null check missing");
      expect(result).toContain("Line 25: [Security] SQL injection risk [RESOLVED]");
      expect(result).toContain("File: src/utils.ts");
      expect(result).toContain("Line 5: [Performance] Inefficient loop");
    });

    it("filters out summary comments without file/line", () => {
      const comments: ExistingComment[] = [
        {
          id: 1,
          body: "<!-- AI_CODE_REVIEW_SUMMARY -->\n# Summary",
          isResolved: false,
        },
        {
          id: 2,
          path: "src/app.ts",
          line: 10,
          body: "### 🐛 Bug Issue\n**Issue**: Bug found",
          isResolved: false,
        },
      ];

      const result = formatExistingCommentsContext(comments);

      expect(result).toContain("File: src/app.ts");
      expect(result).not.toContain("Summary");
    });

    it("sorts comments by line number within each file", () => {
      const comments: ExistingComment[] = [
        {
          id: 1,
          path: "src/app.ts",
          line: 50,
          body: "### 🐛 Bug Issue\n**Issue**: Second issue",
          isResolved: false,
        },
        {
          id: 2,
          path: "src/app.ts",
          line: 10,
          body: "### 🐛 Bug Issue\n**Issue**: First issue",
          isResolved: false,
        },
      ];

      const result = formatExistingCommentsContext(comments);
      const firstIndex = result.indexOf("Line 10");
      const secondIndex = result.indexOf("Line 50");

      expect(firstIndex).toBeLessThan(secondIndex);
    });

    it("truncates long issue summaries", () => {
      const longIssue = "A".repeat(100);
      const comments: ExistingComment[] = [
        {
          id: 1,
          path: "src/app.ts",
          line: 10,
          body: `### 🐛 Bug Issue\n**Issue**: ${longIssue}`,
          isResolved: false,
        },
      ];

      const result = formatExistingCommentsContext(comments);
      expect(result).toContain("...");
      expect(result).not.toContain("A".repeat(81));
    });

    it("handles comments with missing issue field", () => {
      const comments: ExistingComment[] = [
        {
          id: 1,
          path: "src/app.ts",
          line: 10,
          body: "### 🐛 Bug Issue\nSome other content",
          isResolved: false,
        },
      ];

      const result = formatExistingCommentsContext(comments);
      expect(result).toContain("Line 10: [Bug] Review feedback");
    });
  });

  describe("formatFullCommentsContext", () => {
    it("returns sentinels when there are no inline comments", () => {
      expect(formatFullCommentsContext([])).toBe("No existing comments on this PR.");
      expect(
        formatFullCommentsContext([
          { id: 1, body: "<!-- AI_CODE_REVIEW_SUMMARY -->\n# Summary", isResolved: false },
        ])
      ).toBe("No existing inline comments on this PR.");
    });

    it("includes full issue and suggestion content without truncation", () => {
      const longIssue = "A".repeat(120);
      const longSuggestion = "B".repeat(120);
      const comments: ExistingComment[] = [
        {
          id: 1,
          path: "src/app.ts",
          line: 10,
          body: `### 🐛 Bug Issue\n\n**Issue**: ${longIssue}\n\n**Suggestion**:\n${longSuggestion}\n\n---\nMerge Mentor v1.0.0, Standard review\n<!-- [AI Code Review Bot] -->`,
          isResolved: false,
        },
      ];

      const result = formatFullCommentsContext(comments);

      expect(result).toContain(longIssue);
      expect(result).toContain(longSuggestion);
      expect(result).not.toContain("...");
    });

    it("strips the footer and HTML markers from full content", () => {
      const comments: ExistingComment[] = [
        {
          id: 1,
          path: "src/app.ts",
          line: 10,
          body: `### 🔒 Security Issue\n\n**Issue**: SQL injection risk\n\n**Suggestion**: Use parameterized queries\n\n---\nMerge Mentor v1.0.0\n<!-- [AI Code Review Bot] -->\n<!-- finding-id: abc -->`,
          isResolved: true,
        },
      ];

      const result = formatFullCommentsContext(comments);

      expect(result).toContain("Line 10: [Security] [RESOLVED]");
      expect(result).toContain("SQL injection risk");
      expect(result).toContain("Use parameterized queries");
      expect(result).not.toContain("Merge Mentor v1.0.0");
      expect(result).not.toContain("finding-id");
      expect(result).not.toContain("<!--");
    });

    it("groups by file and sorts by line number", () => {
      const comments: ExistingComment[] = [
        {
          id: 1,
          path: "src/app.ts",
          line: 50,
          body: "### 🐛 Bug Issue\n**Issue**: Second issue",
          isResolved: false,
        },
        {
          id: 2,
          path: "src/app.ts",
          line: 10,
          body: "### 🐛 Bug Issue\n**Issue**: First issue",
          isResolved: false,
        },
      ];

      const result = formatFullCommentsContext(comments);

      expect(result.indexOf("Line 10")).toBeLessThan(result.indexOf("Line 50"));
    });
  });
});
