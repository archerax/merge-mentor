import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Platform } from "@merge-mentor/config/config.js";
import {
  formatReviewPasses,
  formatReviewTypeLabel,
  type ReviewPass,
  type ReviewStrategy,
} from "@merge-mentor/config/reviewSelection.js";
import { CATEGORY_EMOJI, SEVERITY_EMOJI } from "@merge-mentor/shared/constants.js";
import {
  generatePRIdentifier,
  sanitizeProjectName,
} from "@merge-mentor/shared/utils/prIdentifier.js";
import { formatTokenUsage } from "@merge-mentor/shared/utils/tokenUsage.js";

import type { AIProviderType } from "../ai/types.js";
import type { ReviewResult } from "./engine.js";

/**
 * Markdown review report generation and persistence.
 *
 * Shared by the CLI and the web UI so both entry points write the same
 * `*-review-profile-report.md` files under `<tempPath>/reports`.
 */

/**
 * Generate a markdown report for the review.
 *
 * @param result - Completed review result
 * @param aiProvider - AI provider used for the review
 * @param dryRun - Whether comments were posted or only planned
 * @param reviewType - Review type label
 * @param reviewPasses - Optional analysis passes
 * @param reviewStrategy - Review strategy
 * @returns Markdown report content
 */
export function generateMarkdownReport(
  result: ReviewResult,
  aiProvider: AIProviderType,
  dryRun: boolean,
  reviewType = "general",
  reviewPasses?: readonly ReviewPass[],
  reviewStrategy: ReviewStrategy = "fast"
): string {
  const date = new Date().toISOString();
  const totalIssues = result.fileResults.reduce((sum, r) => sum + r.findings.length, 0);
  const crossFileIssues = result.crossFileResult.findings.length;
  const reviewTypeLabel = formatReviewTypeLabel(reviewType, reviewPasses, reviewStrategy);
  const formattedPasses = formatReviewPasses(reviewPasses);

  let report = `# Code Review Report - PR #${result.prDetails.number}\n\n`;

  // Header with PR details
  report += `**Generated:** ${date}  \n`;
  report += `**AI Provider:** ${aiProvider}  \n`;
  report += `**Review Profile:** ${reviewTypeLabel}  \n`;
  if (formattedPasses) {
    report += `**Review Passes:** ${formattedPasses}  \n`;
  }
  if (reviewStrategy !== "fast") {
    report += `**Review Strategy:** ${reviewStrategy}  \n`;
  }
  report += `**PR Title:** ${result.prDetails.title}  \n`;
  report += `**Author:** ${result.prDetails.author}  \n`;
  report += `**Branch:** \`${result.prDetails.headBranch}\` → \`${result.prDetails.baseBranch}\`  \n\n`;

  // Summary
  report += `## 📊 Review Summary\n\n`;
  report += `- **Files Reviewed:** ${result.filesReviewed}\n`;
  report += `- **Files Skipped:** ${result.filesSkipped}\n`;
  report += `- **Total Issues Found:** ${totalIssues + crossFileIssues}\n`;
  report += `  - File-specific issues: ${totalIssues}\n`;
  report += `  - Cross-file issues: ${crossFileIssues}\n\n`;

  if (result.tokenUsage) {
    const lines = formatTokenUsage(result.tokenUsage);
    report += `### 💰 Token Usage\n\n`;
    for (const line of lines) {
      report += `- ${line}\n`;
    }
    report += `\n`;
  }

  // Review actions summary
  const actionHeader = dryRun ? "### 📝 Planned Actions (Dry-Run)" : "### 📝 Review Actions";
  report += `${actionHeader}\n\n`;
  report += `- Comments to Create: ${result.commentsCreated}\n\n`;

  // Issues by severity
  const severityCounts = countIssuesBySeverity(result);
  if (Object.values(severityCounts).some((count) => count > 0)) {
    report += `### Issues by Severity\n\n`;
    Object.entries(severityCounts).forEach(([severity, count]) => {
      if (count > 0) {
        const emoji = SEVERITY_EMOJI[severity as keyof typeof SEVERITY_EMOJI];
        report += `- ${emoji} **${
          severity.charAt(0).toUpperCase() + severity.slice(1)
        }:** ${count}\n`;
      }
    });
    report += `\n`;
  }

  // Issues by category
  const categoryCounts = countIssuesByCategory(result);
  if (Object.values(categoryCounts).some((count) => count > 0)) {
    report += `### Issues by Category\n\n`;
    Object.entries(categoryCounts).forEach(([category, count]) => {
      if (count > 0) {
        const emoji = CATEGORY_EMOJI[category as keyof typeof CATEGORY_EMOJI];
        report += `- ${emoji} **${
          category.charAt(0).toUpperCase() + category.slice(1)
        }:** ${count}\n`;
      }
    });
    report += `\n`;
  }

  // File-specific issues
  if (totalIssues > 0) {
    report += `## 📁 File-Specific Issues\n\n`;

    result.fileResults.forEach((fileResult) => {
      if (fileResult.findings.length > 0) {
        report += `### \`${fileResult.filename}\`\n\n`;

        fileResult.findings.forEach((finding, index) => {
          const severityEmoji = SEVERITY_EMOJI[finding.severity];
          const categoryEmoji = CATEGORY_EMOJI[finding.category];

          report += `#### ${index + 1}. Line ${finding.line} ${severityEmoji} ${categoryEmoji}\n\n`;
          report += `**Severity:** ${finding.severity.toUpperCase()}  \n`;
          report += `**Category:** ${finding.category}  \n`;
          if (finding.isPreExisting) {
            report += `**Pre-existing:** Yes ⚠️  \n`;
          }
          report += `\n**Issue:** ${finding.message}\n\n`;
          report += `**Suggestion:** ${finding.suggestion}\n\n`;
          report += `---\n\n`;
        });
      }
    });
  }

  // Cross-file issues
  if (crossFileIssues > 0) {
    report += `## 🔗 Cross-File Issues\n\n`;

    result.crossFileResult.findings.forEach((finding, index) => {
      const severityEmoji = SEVERITY_EMOJI[finding.severity];
      const categoryEmoji = CATEGORY_EMOJI[finding.category];

      report += `### ${
        index + 1
      }. ${severityEmoji} ${categoryEmoji} ${finding.category.toUpperCase()}\n\n`;
      report += `**Severity:** ${finding.severity.toUpperCase()}  \n`;
      report += `**Affected Files:** ${finding.affectedFiles
        .map((f) => `\`${f}\``)
        .join(", ")}  \n\n`;
      report += `**Issue:** ${finding.message}\n\n`;
      report += `---\n\n`;
    });
  }

  // Overall assessment
  if (result.crossFileResult.overallAssessment) {
    report += `## 🎯 Overall Assessment\n\n`;
    report += `${result.crossFileResult.overallAssessment}\n\n`;
  }

  // Recommendations
  if (result.crossFileResult.recommendations.length > 0) {
    report += `## 💡 Recommendations\n\n`;
    result.crossFileResult.recommendations.forEach((rec, index) => {
      report += `${index + 1}. ${rec}\n`;
    });
    report += `\n`;
  }

  return report;
}

/** Options for {@link saveReviewReport}. */
export interface SaveReviewReportOptions {
  /** Completed review result to render. */
  readonly result: ReviewResult;
  /** AI provider used for the review. */
  readonly aiProvider: AIProviderType;
  /** Whether comments were posted or only planned. */
  readonly dryRun: boolean;
  /** Review type label. */
  readonly reviewType?: string;
  /** Optional analysis passes. */
  readonly reviewPasses?: readonly ReviewPass[];
  /** Review strategy. */
  readonly reviewStrategy?: ReviewStrategy;
  /** Platform the PR belongs to. */
  readonly platform: Platform;
  /** Project/repository identifier used to build the report file name. */
  readonly projectId: string;
  /** Base directory for temporary files. Defaults to `./.mergementor`. */
  readonly tempPath?: string;
}

/**
 * Generates a markdown report and writes it under `<tempPath>/reports`.
 *
 * @param options - Report generation and persistence options
 * @returns Absolute or relative path of the written report file
 */
export function saveReviewReport(options: SaveReviewReportOptions): string {
  const markdown = generateMarkdownReport(
    options.result,
    options.aiProvider,
    options.dryRun,
    options.reviewType,
    options.reviewPasses,
    options.reviewStrategy
  );

  const reportDir = join(options.tempPath ?? "./.mergementor", "reports");
  const projectId = sanitizeProjectName(options.projectId);
  const prIdentifier = generatePRIdentifier(
    options.platform,
    projectId,
    options.result.prDetails.number
  );
  const reportFile = join(reportDir, `${prIdentifier}-review-profile-report.md`);

  mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportFile, markdown, "utf-8");

  return reportFile;
}

/**
 * Count issues by severity across all files and cross-file results.
 */
function countIssuesBySeverity(result: ReviewResult): Record<string, number> {
  const counts: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  // Count file-specific issues
  result.fileResults.forEach((fileResult) => {
    fileResult.findings.forEach((finding) => {
      counts[finding.severity] = (counts[finding.severity] || 0) + 1;
    });
  });

  // Count cross-file issues
  result.crossFileResult.findings.forEach((finding) => {
    counts[finding.severity] = (counts[finding.severity] || 0) + 1;
  });

  return counts;
}

/**
 * Count issues by category across all files and cross-file results.
 */
function countIssuesByCategory(result: ReviewResult): Record<string, number> {
  const counts: Record<string, number> = {};

  // Count file-specific issues
  result.fileResults.forEach((fileResult) => {
    fileResult.findings.forEach((finding) => {
      counts[finding.category] = (counts[finding.category] || 0) + 1;
    });
  });

  // Count cross-file issues
  result.crossFileResult.findings.forEach((finding) => {
    counts[finding.category] = (counts[finding.category] || 0) + 1;
  });

  return counts;
}
