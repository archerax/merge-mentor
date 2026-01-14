import { CATEGORY_EMOJI, SEVERITY_EMOJI } from "../constants.js";
import { createChildLogger } from "../logger.js";
import type {
  CommentAction,
  CrossFileReviewResult,
  ExistingComment,
  FileFinding,
  FileReviewResult,
  FindingSeverity,
} from "../platforms/types.js";

/** Options for configuring comment filtering behavior. */
export interface CommentManagerOptions {
  /** Skip pre-existing issues (issues not introduced in this PR). */
  readonly skipPreExisting?: boolean;
}

/**
 * Manages PR comment lifecycle (create, update, resolve).
 * Tracks bot comments and determines required actions.
 */
export class CommentManager {
  private readonly botIdentifier: string;
  private readonly summaryMarker = "<!-- AI_CODE_REVIEW_SUMMARY -->";
  private readonly skipPreExisting: boolean;
  private readonly logger = createChildLogger({ component: "CommentManager" });

  constructor(botIdentifier: string, options?: CommentManagerOptions) {
    this.botIdentifier = botIdentifier;
    this.skipPreExisting = options?.skipPreExisting ?? true;
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

    // Process file findings with pre-existing filtering
    for (const fileResult of fileResults) {
      for (const finding of fileResult.findings) {
        // Apply pre-existing filter
        if (!this.shouldIncludeFinding(finding, fileResult.filename)) {
          continue;
        }

        const existingComment = this.findMatchingComment(
          existingComments,
          fileResult.filename,
          finding,
          matchedExistingIds
        );

        if (existingComment) {
          matchedExistingIds.add(existingComment.id);
          const newBody = this.formatInlineComment(finding, fileResult.filename);
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
            body: this.formatInlineComment(finding, fileResult.filename),
          });
        }
      }
    }

    // Resolve comments that are no longer relevant
    for (const comment of existingComments) {
      if (
        !matchedExistingIds.has(comment.id) &&
        !comment.isResolved &&
        comment.path
      ) {
        actions.push({
          type: "resolve",
          existingCommentId: comment.id,
        });
      }
    }

    // Create or update summary comment
    const existingSummary = this.findExistingSummaryComment(existingComments);
    const newSummaryBody = this.formatSummaryComment(fileResults, crossFileResult);

    if (existingSummary) {
      matchedExistingIds.add(existingSummary.id);
      if (!this.commentsMatch(existingSummary.body, newSummaryBody)) {
        actions.push({
          type: "update",
          existingCommentId: existingSummary.id,
          body: newSummaryBody,
        });
      }
    } else {
      actions.push({
        type: "create",
        body: newSummaryBody,
      });
    }

    return actions;
  }

  private findMatchingComment(
    existingComments: readonly ExistingComment[],
    filename: string,
    finding: FileFinding,
    alreadyMatched: Set<number | string>
  ): ExistingComment | undefined {
    const findingId = this.generateFindingId(filename, finding);

    // First, try to match by finding ID (most reliable)
    const matchById = existingComments.find(
      (c) => !alreadyMatched.has(c.id) && this.extractFindingId(c.body) === findingId
    );

    if (matchById) {
      return matchById;
    }

    // Fallback to legacy matching for old comments without IDs
    return existingComments.find(
      (c) =>
        !alreadyMatched.has(c.id) &&
        c.path === filename &&
        c.line === finding.line &&
        c.body.toLowerCase().includes(finding.category.toLowerCase())
    );
  }

  private findExistingSummaryComment(
    existingComments: readonly ExistingComment[]
  ): ExistingComment | undefined {
    return existingComments.find((c) => c.body.includes(this.summaryMarker));
  }

  private commentsMatch(existingBody: string, newBody: string): boolean {
    const stripIdentifier = (s: string) => s.replace(this.botIdentifier, "").trim();
    return stripIdentifier(existingBody) === stripIdentifier(newBody);
  }

  /**
   * Checks if a finding should be included based on pre-existing filter.
   */
  private shouldIncludeFinding(finding: FileFinding, filename: string): boolean {
    // Check pre-existing filter
    if (this.skipPreExisting && finding.isPreExisting) {
      this.logger.info(
        {
          filename,
          line: finding.line,
          category: finding.category,
          message: finding.message.slice(0, 100),
        },
        "Skipping pre-existing issue"
      );
      return false;
    }

    return true;
  }

  /**
   * Generates a stable identifier for a finding based on its key properties.
   */
  private generateFindingId(filename: string, finding: FileFinding): string {
    const key = `${filename}:${finding.line}:${finding.category}`;
    return Buffer.from(key).toString("base64");
  }

  /**
   * Extracts the finding ID from a comment body.
   */
  private extractFindingId(commentBody: string): string | null {
    const match = commentBody.match(/<!-- finding-id: ([A-Za-z0-9+/=]+) -->/);
    return match ? match[1] : null;
  }

  /**
   * Formats a file finding as an inline comment.
   *
   * @param finding - The finding to format
   * @param filename - The file path for generating unique ID
   * @returns Formatted comment body with enhanced markdown formatting
   */
  formatInlineComment(finding: FileFinding, filename?: string): string {
    const severityEmoji = this.getSeverityEmoji(finding.severity);
    const categoryEmoji = this.getCategoryEmoji(finding.category);

    const findingId = filename ? this.generateFindingId(filename, finding) : "";
    const idMarker = findingId ? `\n<!-- finding-id: ${findingId} -->` : "";

    return `### ${categoryEmoji} ${finding.category.charAt(0).toUpperCase() + finding.category.slice(1)} Issue

**Severity**: ${severityEmoji} ${finding.severity.charAt(0).toUpperCase() + finding.severity.slice(1)}  
**Line**: ${finding.line}

**Issue**: ${finding.message}

**Suggestion**:
${finding.suggestion}

---
${this.botIdentifier}${idMarker}`;
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

    // Append bot identifier
    summary += `\n---\n${this.botIdentifier}`;

    return summary;
  }

  private buildOverviewSection(
    crossFileResult: CrossFileReviewResult,
    filesReviewed: number,
    totalFindings: number
  ): string {
    return `${this.summaryMarker}
# 📋 Code Review Summary

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

  private getCategoryEmoji(category: string): string {
    return CATEGORY_EMOJI[category as keyof typeof CATEGORY_EMOJI] || "📋";
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
