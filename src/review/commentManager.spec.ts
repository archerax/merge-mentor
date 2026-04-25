import { describe, expect, it, test, vi } from "vitest";
import packageJson from "../../package.json" with { type: "json" };
import type {
  CrossFileReviewResult,
  ExistingComment,
  FileFinding,
  FileReviewResult,
  FindingSeverity,
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

const DEFAULT_FOOTER = `Merge Mentor v${packageJson.version}, Baseline review, Default model`;

function createCommentManager(options?: {
  skipPreExisting?: boolean;
  reviewType?: string;
  customReviewPhases?: readonly (
    | "scan"
    | "security"
    | "logic"
    | "performance"
    | "monorepo"
    | "testing"
    | "database"
  )[];
  model?: string;
}): CommentManager {
  return new CommentManager("[AI Code Review Bot]", options);
}

function createFileFinding(overrides: Partial<FileFinding> = {}): FileFinding {
  return {
    line: 10,
    severity: "high",
    confidence: "high",
    category: "bug",
    message: "Test message",
    suggestion: "Test suggestion",
    reasoning: "Test reasoning explaining why this is an issue.",
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
        confidence: "high",
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
      expect(result).toContain(DEFAULT_FOOTER);
      expect(result).toContain("<!-- [AI Code Review Bot] -->");
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
      const finding = createFileFinding({ severity: "unknown" as unknown as FindingSeverity });

      const result = manager.formatInlineComment(finding);

      expect(result).toContain("⚪");
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

    it("includes configured review type and model in the footer", () => {
      const manager = createCommentManager({
        reviewType: "fast",
        model: "claude-sonnet-4.6",
      });

      const result = manager.formatInlineComment(createFileFinding());

      expect(result).toContain(
        `Merge Mentor v${packageJson.version}, Baseline review (fast strategy), claude-sonnet-4.6`
      );
    });

    it("includes custom review phases in the footer", () => {
      const manager = createCommentManager({
        reviewType: "custom",
        customReviewPhases: ["scan", "logic"],
      });

      const result = manager.formatInlineComment(createFileFinding());

      expect(result).toContain(
        `Merge Mentor v${packageJson.version}, Baseline review + scan → logic, Default model`
      );
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
            confidence: "high",
            category: "architecture",
            message: "Circular dependency detected",
            reasoning: "Module A imports from B which imports from A, creating a cycle.",
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
            confidence: "high",
            category: "design",
            message: "Test finding",
            reasoning: "Reasoning for the test finding.",
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

    it("should include bot identifier at the end", () => {
      const manager = createCommentManager();
      const fileResults: FileReviewResult[] = [];
      const crossFileResult = createCrossFileResult();

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain(`---\n${DEFAULT_FOOTER}`);
      expect(result).toContain("<!-- [AI Code Review Bot] -->");
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

    it("should create a summary comment when none exists", () => {
      const manager = createCommentManager();
      const actions = manager.determineActions([], [], createCrossFileResult());

      const summaryActions = actions.filter((a) => a.type === "create" && !a.path);
      expect(summaryActions).toHaveLength(1);
      expect(summaryActions[0].body).toContain("Code Review Summary");
      expect(summaryActions[0].body).toContain("<!-- AI_CODE_REVIEW_SUMMARY -->");
    });

    it("should skip creating duplicate summary when it already exists", () => {
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

      expect(createActions).toHaveLength(0); // No new summary created (avoids duplicate)
    });

    it("should skip creating duplicate summary when content is unchanged", () => {
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

      expect(createActions).toHaveLength(0);
    });

    it("should skip creating duplicate when existing comment matches new comment", () => {
      const manager = createCommentManager();
      const finding = createFileFinding({
        line: 10,
        severity: "high",
        confidence: "high",
        category: "bug",
        message: "Test message",
        suggestion: "Test suggestion",
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

      const createActions = actions.filter((a) => a.type === "create" && a.path);
      expect(createActions).toHaveLength(0); // No duplicate created
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
            confidence: "high",
            category: "architecture",
            message: "Design issue",
            reasoning: "Reasoning for the design issue.",
            affectedFiles: [],
          },
        ],
      });

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain("**Affected Files:** Multiple files");
    });
  });

  describe("pre-existing issue filtering", () => {
    it("should skip pre-existing issues when skipPreExisting is true", () => {
      const manager = new CommentManager("[Bot]", {
        skipPreExisting: true,
      });
      const fileResults: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [
            createFileFinding({
              line: 10,
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
        skipPreExisting: false,
      });
      const fileResults: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [
            createFileFinding({
              line: 10,
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

    it("should not create duplicate comments when run twice with no changes", () => {
      const manager = createCommentManager();
      const finding = createFileFinding({
        line: 10,
        severity: "high",
        confidence: "high",
        category: "bug",
        message: "Test message",
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
      if (!createdComment?.body) {
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

      expect(createActions).toHaveLength(0); // Should not create duplicate
    });

    it("should match comments by finding ID even with modified body", () => {
      const manager = createCommentManager();
      const finding = createFileFinding({
        line: 10,
        category: "bug",
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

    it("skips already-matched comment in legacy fallback (covers alreadyMatched branch)", () => {
      const manager = createCommentManager();
      // Use a legacy-format comment (no finding-id marker) matching both findings
      const legacyCommentBody =
        "### 🐛 Bug Issue\n\n**Severity**: 🟠 High\n\n**Issue**: Test message\n\n---\n[AI Code Review Bot]";
      const existingComments: ExistingComment[] = [
        { id: 42, body: legacyCommentBody, path: "test.ts", line: 10 },
      ];
      // Two identical findings — second one will find the comment already matched
      const fileResults: FileReviewResult[] = [
        {
          filename: "test.ts",
          findings: [
            createFileFinding({ line: 10, category: "bug", message: "Test message" }),
            createFileFinding({ line: 10, category: "bug", message: "Test message" }),
          ],
        },
      ];
      const crossFileResult = createCrossFileResult();

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      // First finding matches the legacy comment; second should create a new comment
      const createActions = actions.filter((a) => a.type === "create" && a.path);
      expect(createActions).toHaveLength(1);
    });
  });

  describe("formatInlineComment without filename", () => {
    it("omits finding-id marker when no filename is provided", () => {
      const manager = createCommentManager();
      const finding = createFileFinding({ category: "bug", line: 5 });

      const result = manager.formatInlineComment(finding);

      expect(result).not.toContain("<!-- finding-id:");
    });
  });
});
