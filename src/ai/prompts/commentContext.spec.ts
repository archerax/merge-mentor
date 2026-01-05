import { describe, expect, it } from "vitest";
import type { ExistingComment } from "../../platforms/types.js";
import { formatExistingCommentsContext, formatFileCommentsContext } from "./commentContext.js";

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

  describe("formatFileCommentsContext", () => {
    it("returns empty string when no comments exist", () => {
      const result = formatFileCommentsContext("src/app.ts", []);
      expect(result).toBe("");
    });

    it("returns empty string when no comments for specified file", () => {
      const comments: ExistingComment[] = [
        {
          id: 1,
          path: "other.ts",
          line: 10,
          body: "### 🐛 Bug Issue\n**Issue**: Bug",
          isResolved: false,
        },
      ];

      const result = formatFileCommentsContext("src/app.ts", comments);
      expect(result).toBe("");
    });

    it("formats only comments for specified file", () => {
      const comments: ExistingComment[] = [
        {
          id: 1,
          path: "src/app.ts",
          line: 10,
          body: "### 🐛 Bug Issue\n**Issue**: Bug in app",
          isResolved: false,
        },
        {
          id: 2,
          path: "src/utils.ts",
          line: 5,
          body: "### ⚡ Performance Issue\n**Issue**: Slow utils",
          isResolved: false,
        },
      ];

      const result = formatFileCommentsContext("src/app.ts", comments);

      expect(result).toContain("EXISTING COMMENTS ON THIS FILE:");
      expect(result).toContain("Line 10: [Bug] Bug in app");
      expect(result).not.toContain("utils");
      expect(result).not.toContain("Slow utils");
    });

    it("includes resolved status in output", () => {
      const comments: ExistingComment[] = [
        {
          id: 1,
          path: "src/app.ts",
          line: 10,
          body: "### 🐛 Bug Issue\n**Issue**: Fixed bug",
          isResolved: true,
        },
      ];

      const result = formatFileCommentsContext("src/app.ts", comments);
      expect(result).toContain("[RESOLVED]");
    });

    it("filters out comments without line numbers", () => {
      const comments: ExistingComment[] = [
        {
          id: 1,
          path: "src/app.ts",
          body: "General comment without line",
          isResolved: false,
        },
        {
          id: 2,
          path: "src/app.ts",
          line: 10,
          body: "### 🐛 Bug Issue\n**Issue**: Specific issue",
          isResolved: false,
        },
      ];

      const result = formatFileCommentsContext("src/app.ts", comments);
      expect(result).toContain("Line 10");
      expect(result).not.toContain("General comment");
    });

    it("sorts comments by line number", () => {
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

      const result = formatFileCommentsContext("src/app.ts", comments);
      const firstIndex = result.indexOf("Line 10");
      const secondIndex = result.indexOf("Line 50");

      expect(firstIndex).toBeLessThan(secondIndex);
    });

    it("handles comments without path gracefully", () => {
      const comments: ExistingComment[] = [
        {
          id: 1,
          line: 10,
          body: "### 🐛 Bug Issue\n**Issue**: No path comment",
          isResolved: false,
        },
      ];

      const result = formatExistingCommentsContext(comments);
      expect(result).toBe("No existing inline comments on this PR.");
    });

    it("handles multiple files with comments in various formats", () => {
      const comments: ExistingComment[] = [
        {
          id: 1,
          path: "src/app.ts",
          line: 10,
          body: "### 🐛 Bug Issue\n**Issue**: First bug",
          isResolved: false,
        },
        {
          id: 2,
          path: "src/app.ts",
          line: 20,
          body: "### 🔒 Security Issue\n**Issue**: Security problem",
          isResolved: true,
        },
        {
          id: 3,
          path: "src/utils.ts",
          line: 5,
          body: "### ⚡ Performance Issue\n**Issue**: Slow code",
          isResolved: false,
        },
      ];

      const result = formatExistingCommentsContext(comments);

      expect(result).toContain("File: src/app.ts");
      expect(result).toContain("File: src/utils.ts");
      expect(result).toContain("[RESOLVED]");
    });
  });

  describe("formatFileCommentsContext", () => {
    it("returns empty string when no comments exist", () => {
      const result = formatFileCommentsContext("src/app.ts", []);
      expect(result).toBe("");
    });

    it("returns empty string when no comments for specified file", () => {
      const comments: ExistingComment[] = [
        {
          id: 1,
          path: "other.ts",
          line: 10,
          body: "### 🐛 Bug Issue\n**Issue**: Bug",
          isResolved: false,
        },
      ];

      const result = formatFileCommentsContext("src/app.ts", comments);
      expect(result).toBe("");
    });

    it("formats only comments for specified file", () => {
      const comments: ExistingComment[] = [
        {
          id: 1,
          path: "src/app.ts",
          line: 10,
          body: "### 🐛 Bug Issue\n**Issue**: Bug in app",
          isResolved: false,
        },
        {
          id: 2,
          path: "src/utils.ts",
          line: 5,
          body: "### ⚡ Performance Issue\n**Issue**: Slow utils",
          isResolved: false,
        },
      ];

      const result = formatFileCommentsContext("src/app.ts", comments);

      expect(result).toContain("EXISTING COMMENTS ON THIS FILE:");
      expect(result).toContain("Line 10: [Bug] Bug in app");
      expect(result).not.toContain("utils");
      expect(result).not.toContain("Slow utils");
    });

    it("includes resolved status in output", () => {
      const comments: ExistingComment[] = [
        {
          id: 1,
          path: "src/app.ts",
          line: 10,
          body: "### 🐛 Bug Issue\n**Issue**: Fixed bug",
          isResolved: true,
        },
      ];

      const result = formatFileCommentsContext("src/app.ts", comments);
      expect(result).toContain("[RESOLVED]");
    });

    it("filters out comments without line numbers", () => {
      const comments: ExistingComment[] = [
        {
          id: 1,
          path: "src/app.ts",
          body: "General comment without line",
          isResolved: false,
        },
        {
          id: 2,
          path: "src/app.ts",
          line: 10,
          body: "### 🐛 Bug Issue\n**Issue**: Specific issue",
          isResolved: false,
        },
      ];

      const result = formatFileCommentsContext("src/app.ts", comments);
      expect(result).toContain("Line 10");
      expect(result).not.toContain("General comment");
    });

    it("sorts comments by line number", () => {
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

      const result = formatFileCommentsContext("src/app.ts", comments);
      const firstIndex = result.indexOf("Line 10");
      const secondIndex = result.indexOf("Line 50");

      expect(firstIndex).toBeLessThan(secondIndex);
    });

    it("handles comments without path gracefully", () => {
      const comments: ExistingComment[] = [
        {
          id: 1,
          line: 10,
          body: "### 🐛 Bug Issue\n**Issue**: No path comment",
          isResolved: false,
        },
      ];

      const result = formatFileCommentsContext("src/app.ts", comments);
      expect(result).toBe("");
    });
  });
});
