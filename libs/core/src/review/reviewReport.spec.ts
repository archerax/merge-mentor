import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ReviewResult } from "./engine.js";
import { generateMarkdownReport, saveReviewReport } from "./reviewReport.js";

function stripGenerated(markdown: string): string {
  return markdown.replace(/^\*\*Generated:\*\*.*$/m, "**Generated:** <timestamp>");
}

function createResult(): ReviewResult {
  return {
    prDetails: {
      number: 42,
      title: "Test PR",
      description: "Test description",
      author: "testuser",
      baseBranch: "main",
      headBranch: "feature/test",
    },
    filesReviewed: 1,
    filesSkipped: 0,
    filesIgnored: 0,
    ignoredFiles: [],
    fileResults: [
      {
        filename: "file1.ts",
        findings: [
          {
            severity: "medium",
            confidence: "high",
            category: "quality",
            message: "Issue 1",
            line: 10,
            suggestion: "Fix it",
            reasoning: "This issue affects code quality.",
          },
        ],
      },
    ],
    crossFileResult: {
      overallAssessment: "Good",
      findings: [],
      recommendations: ["Add tests"],
    },
    commentsCreated: 1,
    commentErrors: [],
    linesAdded: 10,
    linesDeleted: 5,
  };
}

describe("saveReviewReport", () => {
  let tempPath: string;

  beforeEach(() => {
    tempPath = mkdtempSync(join(tmpdir(), "review-report-"));
  });

  afterEach(() => {
    rmSync(tempPath, { recursive: true, force: true });
  });

  it("writes the report under <tempPath>/reports with a platform-scoped file name", () => {
    const result = createResult();

    const reportFile = saveReviewReport({
      result,
      aiProvider: "copilot-sdk",
      dryRun: true,
      reviewType: "general",
      platform: "github",
      projectId: "test-owner-test-repo",
      tempPath,
    });

    expect(reportFile).toBe(
      join(tempPath, "reports", "Github-test-owner-test-repo-PR42-review-profile-report.md")
    );
    expect(stripGenerated(readFileSync(reportFile, "utf-8"))).toBe(
      stripGenerated(generateMarkdownReport(result, "copilot-sdk", true, "general"))
    );
  });

  it("sanitizes the project identifier used in the file name", () => {
    const reportFile = saveReviewReport({
      result: createResult(),
      aiProvider: "copilot-sdk",
      dryRun: false,
      platform: "azure",
      projectId: "My Project/Repo",
      tempPath,
    });

    expect(reportFile).toBe(
      join(tempPath, "reports", "Azure-My-Project_Repo-PR42-review-profile-report.md")
    );
  });
});
