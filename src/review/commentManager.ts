import { CATEGORY_EMOJI, SEVERITY_EMOJI } from "../constants.js";
import type {
  CommentAction,
  CrossFileReviewResult,
  ExistingComment,
  FileFinding,
  FileReviewResult,
  FindingSeverity,
} from "../platforms/types.js";

/**
 * Manages PR comment lifecycle (create, update, resolve).
 * Tracks bot comments and determines required actions.
 */
export class CommentManager {
  private readonly botIdentifier: string;

  constructor(botIdentifier: string) {
    this.botIdentifier = botIdentifier;
  }

  /**
   * Determines comment actions based on existing comments and new findings.
   *
   * @param existingComments - Bot comments already on the PR
   * @param fileResults - Results from file-by-file review
   * @param crossFileResult - Results from cross-file analysis
   * @returns Array of actions to perform (create, update, resolve)
   *
   * @example
   * ```typescript
   * const manager = new CommentManager('[Bot]');
   * const actions = manager.determineActions(
   *   existingComments,
   *   fileResults,
   *   crossFileResult
   * );
   * console.log(`${actions.length} actions to perform`);
   * ```
   */
  determineActions(
    existingComments: readonly ExistingComment[],
    fileResults: readonly FileReviewResult[],
    crossFileResult: CrossFileReviewResult
  ): CommentAction[] {
    const actions: CommentAction[] = [];
    const matchedExistingIds = new Set<number | string>();

    // Process file findings
    for (const fileResult of fileResults) {
      for (const finding of fileResult.findings) {
        const existingComment = this.findMatchingComment(
          existingComments,
          fileResult.filename,
          finding,
          matchedExistingIds
        );

        if (existingComment) {
          matchedExistingIds.add(existingComment.id);
          const newBody = this.formatInlineComment(finding);
          if (!this.commentsMatch(existingComment.body, newBody)) {
            actions.push({
              type: "update",
              existingCommentId: existingComment.id,
              path: fileResult.filename,
              line: finding.line,
              body: newBody,
            });
          }
        } else {
          actions.push({
            type: "create",
            path: fileResult.filename,
            line: finding.line,
            body: this.formatInlineComment(finding),
          });
        }
      }
    }

    // Resolve comments that are no longer relevant
    for (const comment of existingComments) {
      if (!matchedExistingIds.has(comment.id) && !comment.isResolved && comment.path) {
        actions.push({
          type: "resolve",
          existingCommentId: comment.id,
          body: "This issue has been resolved.",
        });
      }
    }

    // Always create a new summary comment
    actions.push({
      type: "create",
      body: this.formatSummaryComment(fileResults, crossFileResult),
    });

    return actions;
  }

  private findMatchingComment(
    existingComments: readonly ExistingComment[],
    filename: string,
    finding: FileFinding,
    alreadyMatched: Set<number | string>
  ): ExistingComment | undefined {
    return existingComments.find(
      (c) =>
        !alreadyMatched.has(c.id) &&
        c.path === filename &&
        c.line === finding.line &&
        c.body.includes(finding.category)
    );
  }

  private commentsMatch(existingBody: string, newBody: string): boolean {
    const stripIdentifier = (s: string) => s.replace(this.botIdentifier, "").trim();
    return stripIdentifier(existingBody) === stripIdentifier(newBody);
  }

  /**
   * Formats a file finding as an inline comment.
   *
   * @param finding - The finding to format
   * @returns Formatted comment body
   */
  formatInlineComment(finding: FileFinding): string {
    const severityEmoji = this.getSeverityEmoji(finding.severity);
    return `${severityEmoji} **${finding.severity.toUpperCase()}** - ${finding.category}

${finding.message}

**Suggestion:** ${finding.suggestion}`;
  }

  /**
   * Formats the complete review summary comment.
   *
   * @param fileResults - Results from all file reviews
   * @param crossFileResult - Results from cross-file analysis
   * @returns Formatted summary comment body
   */
  formatSummaryComment(
    fileResults: readonly FileReviewResult[],
    crossFileResult: CrossFileReviewResult
  ): string {
    const totalFindings = fileResults.reduce((sum, r) => sum + r.findings.length, 0);
    const filesReviewed = fileResults.length;

    const severityCounts = this.countBySeverity(fileResults);
    const categoryCounts = this.countByCategory(fileResults);

    let summary = this.buildOverviewSection(crossFileResult, filesReviewed, totalFindings);
    summary += this.buildSeverityTable(severityCounts);
    summary += this.buildCategoryTable(categoryCounts);
    summary += this.buildCrossFileFindingsSection(crossFileResult);
    summary += this.buildRecommendationsSection(crossFileResult);

    return summary;
  }

  private buildOverviewSection(
    crossFileResult: CrossFileReviewResult,
    filesReviewed: number,
    totalFindings: number
  ): string {
    return `# 📋 Code Review Summary

## Overview
${crossFileResult.overallAssessment}

## Statistics
- **Files Reviewed:** ${filesReviewed}
- **Total Issues Found:** ${totalFindings}

`;
  }

  private buildSeverityTable(counts: Record<FindingSeverity, number>): string {
    return `### By Severity
| Severity | Count |
|----------|-------|
| 🔴 Critical | ${counts.critical} |
| 🟠 High | ${counts.high} |
| 🟡 Medium | ${counts.medium} |
| 🟢 Low | ${counts.low} |

`;
  }

  private buildCategoryTable(counts: Record<string, number>): string {
    return `### By Category
| Category | Count |
|----------|-------|
| ${CATEGORY_EMOJI.bug} Bug | ${counts.bug} |
| ${CATEGORY_EMOJI.security} Security | ${counts.security} |
| ${CATEGORY_EMOJI.performance} Performance | ${counts.performance} |
| ${CATEGORY_EMOJI.quality} Quality | ${counts.quality} |
| ${CATEGORY_EMOJI.documentation} Documentation | ${counts.documentation} |
`;
  }

  private buildCrossFileFindingsSection(crossFileResult: CrossFileReviewResult): string {
    if (crossFileResult.findings.length === 0) {
      return "";
    }

    let section = `
## Cross-File Findings
`;
    for (const finding of crossFileResult.findings) {
      const emoji = this.getSeverityEmoji(finding.severity);
      section += `
### ${emoji} ${finding.category.toUpperCase()}
${finding.message}

**Affected Files:** ${finding.affectedFiles.join(", ") || "Multiple files"}
`;
    }

    return section;
  }

  private buildRecommendationsSection(crossFileResult: CrossFileReviewResult): string {
    if (crossFileResult.recommendations.length === 0) {
      return "";
    }

    let section = `
## Recommendations
`;
    for (const rec of crossFileResult.recommendations) {
      section += `- ${rec}\n`;
    }

    return section;
  }

  private getSeverityEmoji(severity: string): string {
    return SEVERITY_EMOJI[severity as FindingSeverity] || "⚪";
  }

  private countBySeverity(results: readonly FileReviewResult[]): Record<FindingSeverity, number> {
    const counts: Record<FindingSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const result of results) {
      for (const finding of result.findings) {
        counts[finding.severity]++;
      }
    }

    return counts;
  }

  private countByCategory(results: readonly FileReviewResult[]): Record<string, number> {
    const counts: Record<string, number> = {
      bug: 0,
      security: 0,
      performance: 0,
      quality: 0,
      documentation: 0,
    };

    for (const result of results) {
      for (const finding of result.findings) {
        counts[finding.category] = (counts[finding.category] || 0) + 1;
      }
    }

    return counts;
  }
}
