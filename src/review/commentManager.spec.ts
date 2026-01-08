import { describe, expect, it, test, vi } from "vitest";
import type {
  CrossFileReviewResult,
  ExistingComment,
  FileFinding,
  FileReviewResult,
} from "../platforms/types.js";
import { CommentManager } from "./commentManager.js";

// Mock the logger
vi.mock("../logger.js", () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function createCommentManager(): CommentManager {
  return new CommentManager("[AI Code Review Bot]");
}

function createFileFinding(overrides: Partial<FileFinding> = {}): FileFinding {
  return {
    line: 10,
    severity: "high",
    category: "bug",
    message: "Test message",
    suggestion: "Test suggestion",
    confidence: "high",
    isPreExisting: false,
    ...overrides,
  };
}

function createCrossFileResult(
  overrides: Partial<CrossFileReviewResult> = {}
): CrossFileReviewResult {
  return {
    overallAssessment: "Test assessment",
    findings: [],
    recommendations: [],
    ...overrides,
  };
}

describe("CommentManager", () => {
  describe("formatInlineComment", () => {
    it("should format finding with correct severity emoji", () => {
      const manager = createCommentManager();
      const finding = createFileFinding({
        severity: "critical",
        category: "security",
        message: "SQL injection vulnerability",
        suggestion: "Use parameterized queries",
      });

      const result = manager.formatInlineComment(finding);

      expect(result).toContain("🔴");
      expect(result).toContain("Critical");
      expect(result).toContain("🔒");
      expect(result).toContain("Security Issue");
      expect(result).toContain("SQL injection vulnerability");
      expect(result).toContain("Use parameterized queries");
      expect(result).toContain("Code Review");
    });

    test.each([
      ["critical", "🔴"],
      ["high", "🟠"],
      ["medium", "🟡"],
      ["low", "🟢"],
    ] as const)("should use %s emoji for %s severity", (severity, emoji) => {
      const manager = createCommentManager();
      const finding = createFileFinding({ severity });

      const result = manager.formatInlineComment(finding);

      expect(result).toContain(emoji);
    });

    it("should use default emoji for unknown severity", () => {
      const manager = createCommentManager();
      const finding = createFileFinding({ severity: "unknown" as any });

      const result = manager.formatInlineComment(finding);

      expect(result).toContain("⚪");
    });

    it("should include line number in formatted comment", () => {
      const manager = createCommentManager();
      const finding = createFileFinding({ line: 42 });

      const result = manager.formatInlineComment(finding);

      expect(result).toContain("**Line**: 42");
    });

    it("should format suggestion text", () => {
      const manager = createCommentManager();
      const finding = createFileFinding({
        suggestion: "Fix this code",
      });

      const result = manager.formatInlineComment(finding);

      expect(result).toContain("**Suggestion**:");
      expect(result).toContain("Fix this code");
    });

    test.each([
      ["bug", "🐛"],
      ["security", "🔒"],
      ["performance", "⚡"],
      ["quality", "📝"],
      ["documentation", "📚"],
    ] as const)("should use correct emoji for %s category", (category, emoji) => {
      const manager = createCommentManager();
      const finding = createFileFinding({ category });

      const result = manager.formatInlineComment(finding);

      expect(result).toContain(emoji);
    });

    it("should capitalize category name in header", () => {
      const manager = createCommentManager();
      const finding = createFileFinding({ category: "security" });

      const result = manager.formatInlineComment(finding);

      expect(result).toContain("Security Issue");
    });
  });

  describe("formatSummaryComment", () => {
    it("should include overview section", () => {
      const manager = createCommentManager();
      const fileResults: FileReviewResult[] = [];
      const crossFileResult = createCrossFileResult({
        overallAssessment: "This PR looks good",
      });

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain("# 📋 Code Review Summary");
      expect(result).toContain("## Overview");
      expect(result).toContain("This PR looks good");
    });

    it("should include statistics", () => {
      const manager = createCommentManager();
      const fileResults: FileReviewResult[] = [
        {
          filename: "file1.ts",
          findings: [
            createFileFinding({ line: 1, severity: "critical", category: "bug" }),
            createFileFinding({ line: 2, severity: "high", category: "security" }),
          ],
        },
        {
          filename: "file2.ts",
          findings: [createFileFinding({ line: 5, severity: "medium", category: "performance" })],
        },
      ];
      const crossFileResult = createCrossFileResult({ overallAssessment: "Needs work" });

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain("**Files Reviewed:** 2");
      expect(result).toContain("**Total Issues Found:** 3");
    });

    it("should count by severity correctly", () => {
      const manager = createCommentManager();
      const fileResults: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [
            createFileFinding({ line: 1, severity: "critical" }),
            createFileFinding({ line: 2, severity: "critical" }),
            createFileFinding({ line: 3, severity: "high" }),
            createFileFinding({ line: 4, severity: "medium" }),
            createFileFinding({ line: 5, severity: "low" }),
          ],
        },
      ];
      const crossFileResult = createCrossFileResult();

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain("| 🔴 Critical | 2 |");
      expect(result).toContain("| 🟠 High | 1 |");
      expect(result).toContain("| 🟡 Medium | 1 |");
      expect(result).toContain("| 🟢 Low | 1 |");
    });

    it("should include cross-file findings when present", () => {
      const manager = createCommentManager();
      const fileResults: FileReviewResult[] = [];
      const crossFileResult = createCrossFileResult({
        overallAssessment: "Review complete",
        findings: [
          {
            severity: "high",
            category: "architecture",
            message: "Circular dependency detected",
            affectedFiles: ["a.ts", "b.ts"],
          },
        ],
      });

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain("## Cross-File Findings");
      expect(result).toContain("ARCHITECTURE");
      expect(result).toContain("Circular dependency detected");
      expect(result).toContain("a.ts, b.ts");
    });

    it("should handle cross-file findings with empty affectedFiles", () => {
      const manager = createCommentManager();
      const fileResults: FileReviewResult[] = [];
      const crossFileResult = createCrossFileResult({
        findings: [
          {
            severity: "medium",
            category: "design",
            message: "Test finding",
            affectedFiles: [],
          },
        ],
      });

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain("**Affected Files:** Multiple files");
    });

    it("should include recommendations when present", () => {
      const manager = createCommentManager();
      const fileResults: FileReviewResult[] = [];
      const crossFileResult = createCrossFileResult({
        recommendations: ["Add unit tests", "Update documentation"],
      });

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain("## Recommendations");
      expect(result).toContain("- Add unit tests");
      expect(result).toContain("- Update documentation");
    });
  });

  describe("determineActions", () => {
    it("should create new comments for new findings", () => {
      const manager = createCommentManager();
      const existingComments: ExistingComment[] = [];
      const fileResults: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [createFileFinding({ line: 10, message: "Bug found", suggestion: "Fix it" })],
        },
      ];
      const crossFileResult = createCrossFileResult({ overallAssessment: "Needs work" });

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const createActions = actions.filter((a) => a.type === "create");
      expect(createActions).toHaveLength(2); // 1 inline + 1 summary
      expect(createActions[0].path).toBe("test.ts");
      expect(createActions[0].line).toBe(10);
    });

    it("should resolve comments that are no longer relevant", () => {
      const manager = createCommentManager();
      const existingComments: ExistingComment[] = [
        { id: 1, body: "bug issue", path: "test.ts", line: 10 },
      ];
      const fileResults: FileReviewResult[] = [];
      const crossFileResult = createCrossFileResult({ overallAssessment: "All good" });

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const resolveActions = actions.filter((a) => a.type === "resolve");
      expect(resolveActions).toHaveLength(1);
      expect(resolveActions[0].existingCommentId).toBe(1);
    });

    it("should not resolve already resolved comments", () => {
      const manager = createCommentManager();
      const existingComments: ExistingComment[] = [
        {
          id: 1,
          body: "bug issue",
          path: "test.ts",
          line: 10,
          isResolved: true,
        },
      ];
      const fileResults: FileReviewResult[] = [];
      const crossFileResult = createCrossFileResult();

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const resolveActions = actions.filter((a) => a.type === "resolve");
      expect(resolveActions).toHaveLength(0);
    });

    it("should create a summary comment when none exists", () => {
      const manager = createCommentManager();
      const actions = manager.determineActions([], [], createCrossFileResult());

      const summaryActions = actions.filter((a) => a.type === "create" && !a.path);
      expect(summaryActions).toHaveLength(1);
      expect(summaryActions[0].body).toContain("Code Review Summary");
      expect(summaryActions[0].body).toContain("<!-- AI_CODE_REVIEW_SUMMARY -->");
    });

    it("should update existing summary comment when it already exists", () => {
      const manager = createCommentManager();
      const existingComments: ExistingComment[] = [
        {
          id: 999,
          body: "<!-- AI_CODE_REVIEW_SUMMARY -->\n# 📋 Code Review Summary\n\nOld content",
        },
      ];
      const fileResults: FileReviewResult[] = [];
      const crossFileResult = createCrossFileResult({ overallAssessment: "New assessment" });

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const createActions = actions.filter((a) => a.type === "create" && !a.path);
      const updateActions = actions.filter((a) => a.type === "update");

      expect(createActions).toHaveLength(0); // No new summary created
      expect(updateActions).toHaveLength(1); // Existing summary updated
      expect(updateActions[0].existingCommentId).toBe(999);
      expect(updateActions[0].body).toContain("New assessment");
    });

    it("should not update summary comment when content is unchanged", () => {
      const manager = createCommentManager();
      const fileResults: FileReviewResult[] = [];
      const crossFileResult = createCrossFileResult({ overallAssessment: "Test assessment" });
      const summaryBody = manager.formatSummaryComment(fileResults, crossFileResult);

      const existingComments: ExistingComment[] = [
        {
          id: 999,
          body: summaryBody,
        },
      ];

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const createActions = actions.filter((a) => a.type === "create" && !a.path);
      const updateActions = actions.filter((a) => a.type === "update");

      expect(createActions).toHaveLength(0);
      expect(updateActions).toHaveLength(0);
    });

    it("should not resolve comments without path", () => {
      const manager = createCommentManager();
      const existingComments: ExistingComment[] = [
        { id: 1, body: "General comment" },
      ];
      const fileResults: FileReviewResult[] = [];
      const crossFileResult = createCrossFileResult();

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const resolveActions = actions.filter((a) => a.type === "resolve");
      expect(resolveActions).toHaveLength(0);
    });

    it("should match comments correctly by category and line", () => {
      const manager = createCommentManager();
      const existingComments: ExistingComment[] = [
        { id: 1, body: "bug at line 10", path: "test.ts", line: 10 },
        { id: 2, body: "security at line 20", path: "test.ts", line: 20 },
      ];
      const fileResults: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [createFileFinding({ line: 10, category: "bug", message: "Bug issue" })],
        },
      ];
      const crossFileResult = createCrossFileResult();

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const resolveActions = actions.filter((a) => a.type === "resolve");
      expect(resolveActions).toHaveLength(1);
      expect(resolveActions[0].existingCommentId).toBe(2);
    });

    it("should not update when existing comment matches new comment", () => {
      const manager = createCommentManager();
      const finding = createFileFinding({
        line: 10,
        severity: "high",
        category: "bug",
        message: "Test message",
        suggestion: "Test suggestion",
        confidence: "high",
        isPreExisting: false,
      });
      const existingBody = manager.formatInlineComment(finding, "test.ts");
      const existingComments: ExistingComment[] = [
        { id: 1, body: existingBody, path: "test.ts", line: 10 },
      ];
      const fileResults: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [finding],
        },
      ];
      const crossFileResult = createCrossFileResult();

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const updateActions = actions.filter((a) => a.type === "update");
      expect(updateActions).toHaveLength(0);
    });

    it("should resolve comments identified by model as resolved", () => {
      const manager = createCommentManager();
      const existingComments: ExistingComment[] = [
        {
          id: 1,
          body: "### Bug Issue\nNull check missing",
          path: "test.ts",
          line: 10,
        },
      ];
      const fileResults: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [],
          resolvedComments: [{ line: 10, reason: "Null check was added in this commit" }],
        },
      ];
      const crossFileResult = createCrossFileResult();

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const resolveActions = actions.filter((a) => a.type === "resolve");
      expect(resolveActions).toHaveLength(1);
      expect(resolveActions[0].existingCommentId).toBe(1);
    });

    it("should use model's resolution reason in resolution comment", () => {
      const manager = createCommentManager();
      const existingComments: ExistingComment[] = [
        { id: 1, body: "Old issue", path: "test.ts", line: 10 },
      ];
      const fileResults: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [],
          resolvedComments: [{ line: 10, reason: "Code was refactored to handle edge case" }],
        },
      ];
      const crossFileResult = createCrossFileResult();

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const updateActions = actions.filter((a) => a.type === "update");
      expect(updateActions).toHaveLength(1);
      expect(updateActions[0].body).toContain("Code was refactored to handle edge case");
    });

    it("should not resolve already resolved comments", () => {
      const manager = createCommentManager();
      const existingComments: ExistingComment[] = [
        {
          id: 1,
          body: "Old issue",
          path: "test.ts",
          line: 10,
          isResolved: true,
        },
      ];
      const fileResults: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [],
          resolvedComments: [{ line: 10, reason: "Already resolved" }],
        },
      ];
      const crossFileResult = createCrossFileResult();

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const resolveActions = actions.filter((a) => a.type === "resolve");
      expect(resolveActions).toHaveLength(0);
    });
  });

  describe("formatSummaryComment cross-file findings", () => {
    it('should show "Multiple files" when affectedFiles is empty', () => {
      const manager = createCommentManager();
      const fileResults: FileReviewResult[] = [];
      const crossFileResult = createCrossFileResult({
        findings: [
          {
            severity: "high",
            category: "architecture",
            message: "Design issue",
            affectedFiles: [],
          },
        ],
      });

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain("**Affected Files:** Multiple files");
    });
  });

  describe("confidence filtering", () => {
    it("should skip low confidence findings when minConfidence is high", () => {
      const manager = new CommentManager("[Bot]", {
        filterConfig: {
          minConfidence: "high",
          skipPreExisting: true,
          postResolutionComments: true,
        },
      });
      const fileResults: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [
            createFileFinding({
              line: 10,
              confidence: "low",
              isPreExisting: false,
            }),
          ],
        },
      ];
      const crossFileResult = createCrossFileResult();

      const actions = manager.determineActions([], fileResults, crossFileResult);

      const createActions = actions.filter((a) => a.type === "create" && a.path);
      expect(createActions).toHaveLength(0);
    });

    it("should include medium confidence findings when minConfidence is medium", () => {
      const manager = new CommentManager("[Bot]", {
        filterConfig: {
          minConfidence: "medium",
          skipPreExisting: true,
          postResolutionComments: true,
        },
      });
      const fileResults: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [
            createFileFinding({
              line: 10,
              confidence: "medium",
              isPreExisting: false,
            }),
          ],
        },
      ];
      const crossFileResult = createCrossFileResult();

      const actions = manager.determineActions([], fileResults, crossFileResult);

      const createActions = actions.filter((a) => a.type === "create" && a.path);
      expect(createActions).toHaveLength(1);
    });

    it("should skip pre-existing issues when skipPreExisting is true", () => {
      const manager = new CommentManager("[Bot]", {
        filterConfig: {
          minConfidence: "high",
          skipPreExisting: true,
          postResolutionComments: true,
        },
      });
      const fileResults: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [
            createFileFinding({
              line: 10,
              confidence: "high",
              isPreExisting: true,
            }),
          ],
        },
      ];
      const crossFileResult = createCrossFileResult();

      const actions = manager.determineActions([], fileResults, crossFileResult);

      const createActions = actions.filter((a) => a.type === "create" && a.path);
      expect(createActions).toHaveLength(0);
    });

    it("should include pre-existing issues when skipPreExisting is false", () => {
      const manager = new CommentManager("[Bot]", {
        filterConfig: {
          minConfidence: "high",
          skipPreExisting: false,
          postResolutionComments: true,
        },
      });
      const fileResults: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [
            createFileFinding({
              line: 10,
              confidence: "high",
              isPreExisting: true,
            }),
          ],
        },
      ];
      const crossFileResult = createCrossFileResult();

      const actions = manager.determineActions([], fileResults, crossFileResult);

      const createActions = actions.filter((a) => a.type === "create" && a.path);
      expect(createActions).toHaveLength(1);
    });

    it("should include confidence in formatted comment", () => {
      const manager = new CommentManager("[Bot]");
      const finding = createFileFinding({
        confidence: "high",
      });

      const result = manager.formatInlineComment(finding);

      expect(result).toContain("**Confidence**: 🟢 High");
    });

    it("should add resolution comment before resolving when postResolutionComments is true", () => {
      const manager = new CommentManager("[Bot]", {
        filterConfig: {
          minConfidence: "high",
          skipPreExisting: true,
          postResolutionComments: true,
        },
      });
      const existingComments: ExistingComment[] = [
        { id: 1, body: "bug issue", path: "test.ts", line: 10 },
      ];
      const fileResults: FileReviewResult[] = [];
      const crossFileResult = createCrossFileResult();

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const updateActions = actions.filter((a) => a.type === "update" && a.existingCommentId === 1);
      const resolveActions = actions.filter((a) => a.type === "resolve");

      expect(updateActions).toHaveLength(1);
      expect(updateActions[0].resolutionReason).toBeDefined();
      expect(updateActions[0].body).toContain("Issue Resolved");
      expect(resolveActions).toHaveLength(1);
    });

    it("should not add resolution comment when postResolutionComments is false", () => {
      const manager = new CommentManager("[Bot]", {
        filterConfig: {
          minConfidence: "high",
          skipPreExisting: true,
          postResolutionComments: false,
        },
      });
      const existingComments: ExistingComment[] = [
        { id: 1, body: "bug issue", path: "test.ts", line: 10 },
      ];
      const fileResults: FileReviewResult[] = [];
      const crossFileResult = createCrossFileResult();

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const updateActions = actions.filter((a) => a.type === "update" && a.existingCommentId === 1);
      const resolveActions = actions.filter((a) => a.type === "resolve");

      expect(updateActions).toHaveLength(0);
      expect(resolveActions).toHaveLength(1);
    });

    it("should not create duplicate comments when run twice with no changes", () => {
      const manager = createCommentManager();
      const finding = createFileFinding({
        line: 10,
        severity: "high",
        category: "bug",
        message: "Test message",
        confidence: "high",
        isPreExisting: false,
      });
      const fileResults: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [finding],
        },
      ];
      const crossFileResult = createCrossFileResult();

      // First run: create comment
      const firstRunActions = manager.determineActions([], fileResults, crossFileResult);
      const createdComment = firstRunActions.find(
        (a) => a.type === "create" && a.path === "test.ts"
      );
      expect(createdComment).toBeDefined();
      if (!createdComment || !createdComment.body) {
        throw new Error("Expected comment to be created with body");
      }

      // Second run: should match existing comment, not create duplicate
      const existingComments: ExistingComment[] = [
        { id: 1, body: createdComment.body, path: "test.ts", line: 10 },
      ];
      const secondRunActions = manager.determineActions(
        existingComments,
        fileResults,
        crossFileResult
      );
      const createActions = secondRunActions.filter((a) => a.type === "create" && a.path);
      const updateActions = secondRunActions.filter(
        (a) => a.type === "update" && a.existingCommentId === 1
      );

      expect(createActions).toHaveLength(0); // Should not create duplicate
      expect(updateActions).toHaveLength(0); // Should not update (content matches)
    });

    it("should match comments by finding ID even with modified body", () => {
      const manager = createCommentManager();
      const finding = createFileFinding({
        line: 10,
        category: "bug",
        confidence: "high",
        isPreExisting: false,
      });
      const originalBody = manager.formatInlineComment(finding, "test.ts");
      // Simulate comment that was updated with resolution text
      const modifiedBody = `${originalBody}\n\n---\n✅ **Issue Resolved**`;
      const existingComments: ExistingComment[] = [
        { id: 1, body: modifiedBody, path: "test.ts", line: 10 },
      ];
      const fileResults: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [finding],
        },
      ];
      const crossFileResult = createCrossFileResult();

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const createActions = actions.filter((a) => a.type === "create" && a.path);
      expect(createActions).toHaveLength(0); // Should match by ID, not create duplicate
    });
  });
});
