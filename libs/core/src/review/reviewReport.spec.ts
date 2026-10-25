import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      platform: "github",
      projectId: "test-owner-test-repo",
      tempPath,
    });

    expect(reportFile).toBe(
      join(tempPath, "reports", "Github-test-owner-test-repo-PR42-review-profile-report.md")
    );
    expect(stripGenerated(readFileSync(reportFile, "utf-8"))).toBe(
      stripGenerated(generateMarkdownReport(result, "copilot-sdk", true))
    );
  });

  it("writes a timestamped usage record per run next to the report", () => {
    const base = createResult();
    const result: ReviewResult = {
      ...base,
      tokenUsage: { inputTokens: 10, outputTokens: 5, model: "gpt-4.1" },
      usageCalls: { total: 3, reported: 2 },
    };
    const options = {
      result,
      aiProvider: "copilot-sdk" as const,
      dryRun: true,
      platform: "github" as const,
      projectId: "owner-repo",
      tempPath,
    };

    saveReviewReport(options);
    // Re-review of the same PR must not overwrite earlier usage.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 5000));
    try {
      saveReviewReport(options);
    } finally {
      vi.useRealTimers();
    }

    const files = readdirSync(join(tempPath, "reports")).filter((f) =>
      f.startsWith("Github-owner-repo-PR42-review-usage-")
    );
    expect(files).toHaveLength(2);
    const parsed = JSON.parse(readFileSync(join(tempPath, "reports", files[0]), "utf-8"));
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      platform: "github",
      projectId: "owner-repo",
      prNumber: 42,
      prTitle: "Test PR",
      aiProvider: "copilot-sdk",
      tokenUsage: { inputTokens: 10, outputTokens: 5, model: "gpt-4.1" },
      calls: { total: 3, reported: 2 },
    });
  });

  it("omits tokenUsage from the usage record when the provider reported none", () => {
    saveReviewReport({
      result: createResult(),
      aiProvider: "copilot-sdk",
      dryRun: true,
      platform: "github",
      projectId: "owner-repo",
      tempPath,
    });
    const file = readdirSync(join(tempPath, "reports")).find((f) => f.includes("-review-usage-"));
    expect(file).toBeDefined();
    const parsed = JSON.parse(readFileSync(join(tempPath, "reports", file ?? ""), "utf-8"));
    expect(parsed.tokenUsage).toBeUndefined();
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

  it("renders token usage and pre-existing markers", () => {
    const base = createResult();
    const result: ReviewResult = {
      ...base,
      tokenUsage: { inputTokens: 1200, outputTokens: 340 },
      fileResults: base.fileResults.map((file) => ({
        ...file,
        findings: file.findings.map((finding) => ({ ...finding, isPreExisting: true })),
      })),
    };

    const markdown = generateMarkdownReport(result, "opencode-sdk", false);

    expect(markdown).toContain("### 💰 Token Usage");
    expect(markdown).toContain("**Pre-existing:** Yes");
  });
});
