/**
 * PR comment management and deduplication.
 *
 * Manages the lifecycle of AI-generated code review comments, handling:
 * - Deduplication: Avoids posting duplicate findings (same file, line, issue)
 * - Pre-existing filtering: Optionally skips issues not introduced in this PR
 * - Comment matching: Tracks existing bot comments to prevent redundancy
 * - Summary generation: Creates a summary comment with key findings
 *
 * The CommentManager uses fingerprinting to match findings:
 * - Fingerprint = filename + line + category + first 10 words of message
 * - Exact duplicates are skipped (same comment already posted)
 * - Variations in wording on the same issue are treated as duplicates
 *
 * Pre-existing filtering uses the `prInfo.addedLines` to detect if an issue
 * is newly introduced (on added lines) or pre-existing. This prevents noise
 * when reviewing large refactors where old issues would otherwise surface.
 *
 * @example
 * ```typescript
 * const manager = new CommentManager('[Bot]', { skipPreExisting: true });
 *
 * const actions = manager.determineActions(
 *   existingBotComments,
 *   fileReviewResults,
 *   crossFileResult
 * );
 *
 * for (const action of actions) {
 *   if (action.type === 'create') {
 *     await platform.postComment(action.data);
 *   }
 * }
 * ```
 */

import packageJson from "../../package.json" with { type: "json" };
import { APP_NAME_LINK, CATEGORY_EMOJI, SEVERITY_EMOJI } from "../constants.js";
import { createChildLogger } from "../logger.js";
import type {
  CommentAction,
  CrossFileReviewResult,
  ExistingComment,
  FileFinding,
  FileReviewResult,
  FindingSeverity,
} from "../platforms/types.js";
import { remapLineNumber } from "../utils/hunkRemapper.js";
import { formatNativeSuggestion, validateNativeSuggestion } from "../utils/nativeSuggestion.js";
import { calculateTextSimilarity } from "../utils/textSimilarity.js";
import { formatReviewTypeLabel, type ReviewPass, type ReviewStrategy } from "./reviewSelection.js";

/**
 * Configuration options for comment management behavior.
 *
 * Controls how existing findings are filtered and deduplicated.
 */
interface CommentManagerOptions {
  /** Skip findings on lines not modified in this PR (pre-existing issues). Default: true */
  readonly skipPreExisting?: boolean;
  /** Review type label shown in comment footers. Default: general. */
  readonly reviewType?: string;
  /** Ordered additive review passes shown in review footers. */
  readonly reviewPasses?: readonly ReviewPass[];
  /** Execution strategy shown in review footers. */
  readonly reviewStrategy?: ReviewStrategy;
  /** Configured AI model identifier shown in comment footers. */
  readonly model?: string;
}

/**
 * Manages PR comment lifecycle (create).
 *
 * Tracks bot comments and determines required actions (create new comments).
 * Uses fingerprinting to deduplicate identical findings across multiple review runs
 * or to avoid re-posting comments that already exist.
 */
export class CommentManager {
  private readonly botIdentifier: string;
  private readonly summaryMarker = "<!-- AI_CODE_REVIEW_SUMMARY -->";
  private readonly skipPreExisting: boolean;
  private footer: string;
  private readonly reviewType?: string;
  private readonly reviewPasses?: readonly ReviewPass[];
  private readonly reviewStrategy?: ReviewStrategy;
  private model?: string;
  private readonly logger = createChildLogger({ component: "CommentManager" });

  /**
   * Creates a new comment manager for a bot.
   *
   * @param botIdentifier - Unique identifier used to tag and recognize bot comments
   * @param options - Configuration for filtering behavior
   *
   * @example
   * ```typescript
   * // Create manager that includes pre-existing issues
   * const manager = new CommentManager('[Merge Mentor]', { skipPreExisting: false });
   *
   * // Create manager that skips pre-existing issues (default)
   * const smartManager = new CommentManager('[Bot]');
   * ```
   */
  constructor(botIdentifier: string, options?: CommentManagerOptions) {
    this.botIdentifier = botIdentifier;
    this.skipPreExisting = options?.skipPreExisting ?? true;
    this.reviewType = options?.reviewType;
    this.reviewPasses = options?.reviewPasses;
    this.reviewStrategy = options?.reviewStrategy;
    this.model = options?.model;
    this.footer = this.buildFooter(
      this.reviewType,
      this.reviewPasses,
      this.reviewStrategy,
      this.model
    );
  }

  /**
   * Dynamically updates the AI model name used in the comment footer.
   * Rebuilds the footer string immediately.
   *
   * @param model - The resolved AI model name
   */
  updateModel(model: string): void {
    if (!model || model.trim().length === 0) return;
    const trimmedModel = model.trim();
    if (this.model === trimmedModel) return;

    this.logger.info(
      { previousModel: this.model, newModel: trimmedModel },
      "Updating dynamic AI model name in comment footer"
    );
    this.model = trimmedModel;
    this.footer = this.buildFooter(
      this.reviewType,
      this.reviewPasses,
      this.reviewStrategy,
      this.model
    );
  }

  /**
   * Determines comment actions based on existing comments and new findings.
   *
   * Analyzes findings and existing comments to determine what actions should be taken:
   * - Creates inline comments for each finding not already commented
   * - Creates or skips summary comment based on existence
   *
   * Uses fingerprinting to match findings: `filename:line:category:first10words`.
   * This enables reliable deduplication even when finding text varies slightly.
   *
   * Pre-existing filtering can be applied: if skipPreExisting=true, findings on
   * lines not modified in this PR are skipped (using prInfo.addedLines).
   *
   * @param existingComments - Bot comments already posted to the PR
   * @param fileResults - File-level review results from AI analysis
   * @param crossFileResult - Cross-file analysis results (for summary)
   * @returns Array of comment actions to perform (all type: "create")
   *
   * @example
   * ```typescript
   * const manager = new CommentManager('[Bot]', { skipPreExisting: true });
   *
   * const actions = manager.determineActions(
   *   await platform.getPRComments(),
   *   fileReviewResults,
   *   crossFileAnalysisResult
   * );
   *
   * console.log(`Will post ${actions.length} comments`);
   * for (const action of actions) {
   *   await platform.postComment(action);
   * }
   * ```
   */
  determineActions(
    existingComments: readonly ExistingComment[],
    fileResults: readonly FileReviewResult[],
    crossFileResult: CrossFileReviewResult,
    filePatches?: ReadonlyMap<string, string>
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
          matchedExistingIds,
          filePatches?.get(fileResult.filename)
        );

        if (existingComment) {
          // Skip - comment already exists (avoids duplicates)
          matchedExistingIds.add(existingComment.id);
        } else {
          actions.push({
            type: "create",
            path: fileResult.filename,
            line: this.getSuggestionEndLine(finding, filePatches?.get(fileResult.filename)),
            startLine: this.getSuggestionStartLine(finding, filePatches?.get(fileResult.filename)),
            body: this.formatInlineComment(
              finding,
              fileResult.filename,
              filePatches?.get(fileResult.filename)
            ),
          });
        }
      }
    }

    // Create summary comment (or skip if already exists)
    const existingSummary = this.findExistingSummaryComment(existingComments);
    const newSummaryBody = this.formatSummaryComment(fileResults, crossFileResult);

    if (existingSummary) {
      // Skip - summary already exists
      matchedExistingIds.add(existingSummary.id);
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
    alreadyMatched: Set<number | string>,
    filePatch?: string
  ): ExistingComment | undefined {
    // Stage 1: Match by finding ID with line remapping
    const matchById = existingComments.find((c) => {
      if (alreadyMatched.has(c.id)) return false;
      const cid = this.extractFindingId(c.body);
      if (!cid) return false;

      const decoded = this.decodeFindingId(cid);
      if (!decoded) return false;
      if (decoded.filename !== filename || decoded.category !== finding.category) return false;

      const remappedLine = remapLineNumber(decoded.line, filePatch);

      if (remappedLine === finding.line) return true;
      if (Math.abs(remappedLine - finding.line) <= 2) return true;

      return false;
    });

    if (matchById) {
      return matchById;
    }

    // Stage 2: Text-similarity proximity matching + legacy fallback
    return existingComments.find((c) => {
      if (alreadyMatched.has(c.id)) return false;
      if (c.path !== filename) return false;

      const hasFindingId = this.extractFindingId(c.body) !== null;

      // Skip non-inline comments
      if (c.line === undefined) return false;

      // Remap existing comment's line if patch is available
      let effectiveLine = c.line;
      if (filePatch) {
        effectiveLine = remapLineNumber(c.line, filePatch);
      }

      const lineMatch =
        effectiveLine === finding.line || Math.abs(effectiveLine - finding.line) <= 5;

      if (!lineMatch) return false;

      // Skip comments with finding IDs (already checked in Stage 1)
      if (hasFindingId) return false;

      // Legacy: category substring match
      if (c.body.toLowerCase().includes(finding.category.toLowerCase())) return true;

      // Text similarity on the finding message
      if (calculateTextSimilarity(this.extractMessageFromBody(c.body), finding.message) >= 0.78) {
        return true;
      }

      return false;
    });
  }

  private findExistingSummaryComment(
    existingComments: readonly ExistingComment[]
  ): ExistingComment | undefined {
    return existingComments.find((c) => c.body.includes(this.summaryMarker));
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
   * Decodes a base64 finding ID back into its components.
   */
  private decodeFindingId(
    findingId: string
  ): { filename: string; line: number; category: string } | null {
    try {
      const decoded = Buffer.from(findingId, "base64").toString("utf-8");
      const parts = decoded.split(":");
      if (parts.length >= 3) {
        const line = Number.parseInt(parts[1], 10);
        if (Number.isNaN(line)) return null;
        return {
          filename: parts[0],
          line,
          category: parts.slice(2).join(":"),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extracts the issue message from a formatted comment body.
   */
  private extractMessageFromBody(body: string): string {
    const match = body.match(/\*\*Issue\*\*:\s*(.+)/);
    return match ? match[1].trim() : body;
  }

  /**
   * Formats a file finding as an inline comment.
   *
   * @param finding - The finding to format
   * @param filename - The file path for generating unique ID
   * @returns Formatted comment body with enhanced markdown formatting
   */
  formatInlineComment(finding: FileFinding, filename?: string, filePatch?: string): string {
    const severityEmoji = this.getSeverityEmoji(finding.severity);
    const categoryEmoji = this.getCategoryEmoji(finding.category);

    const findingId = filename ? this.generateFindingId(filename, finding) : "";
    const idMarker = findingId ? `\n<!-- finding-id: ${findingId} -->` : "";

    const nativeSuggestion = validateNativeSuggestion(finding, filePatch);
    const suggestionBlock = nativeSuggestion ? formatNativeSuggestion(nativeSuggestion) : "";

    return `### ${categoryEmoji} ${finding.category.charAt(0).toUpperCase() + finding.category.slice(1)} Issue

**Severity**: ${severityEmoji} ${finding.severity.charAt(0).toUpperCase() + finding.severity.slice(1)}

**Issue**: ${finding.message}

**Suggestion**:
${finding.suggestion}${suggestionBlock}

---
${this.footer}${idMarker}`;
  }

  private getSuggestionStartLine(finding: FileFinding, filePatch?: string): number | undefined {
    const suggestion = validateNativeSuggestion(finding, filePatch);
    return suggestion && suggestion.startLine !== finding.line ? suggestion.startLine : undefined;
  }

  private getSuggestionEndLine(finding: FileFinding, filePatch?: string): number {
    return validateNativeSuggestion(finding, filePatch)?.endLine ?? finding.line;
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

    summary += `\n---\n${this.footer}`;

    return summary;
  }

  private buildFooter(
    reviewType?: string,
    reviewPasses?: readonly ReviewPass[],
    reviewStrategy?: ReviewStrategy,
    model?: string
  ): string {
    const footerParts = [
      `${APP_NAME_LINK} v${packageJson.version}`,
      this.formatReviewType(reviewType, reviewPasses, reviewStrategy),
      this.formatModelName(model),
    ];

    return `${footerParts.join(", ")}\n<!-- ${this.botIdentifier} -->`;
  }

  private formatReviewType(
    reviewType?: string,
    reviewPasses?: readonly ReviewPass[],
    reviewStrategy?: ReviewStrategy
  ): string {
    return formatReviewTypeLabel(reviewType, reviewPasses, reviewStrategy);
  }

  private formatModelName(model?: string): string {
    if (!model || model.trim().length === 0) {
      return "AI model";
    }

    return model.trim();
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
    const categories = Object.keys(CATEGORY_EMOJI).filter((cat) => counts[cat] > 0);
    if (categories.length === 0) {
      return "";
    }

    let table = `### By Category
| Category | Count |
|----------|-------|
`;
    for (const category of categories) {
      const emoji = CATEGORY_EMOJI[category as keyof typeof CATEGORY_EMOJI];
      table += `| ${emoji} ${category.charAt(0).toUpperCase() + category.slice(1)} | ${counts[category]} |
`;
    }
    return table;
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
