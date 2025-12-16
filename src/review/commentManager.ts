import type {
  ExistingComment,
  CommentAction,
  FileFinding,
  FileReviewResult,
  CrossFileReviewResult,
} from '../platforms/types.js';

export class CommentManager {
  private botIdentifier: string;

  constructor(botIdentifier: string) {
    this.botIdentifier = botIdentifier;
  }

  determineActions(
    existingComments: ExistingComment[],
    fileResults: FileReviewResult[],
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
          // Check if comment needs updating
          const newBody = this.formatInlineComment(finding);
          if (!this.commentsMatch(existingComment.body, newBody)) {
            actions.push({
              type: 'update',
              existingCommentId: existingComment.id,
              path: fileResult.filename,
              line: finding.line,
              body: newBody,
            });
          }
        } else {
          // Create new comment
          actions.push({
            type: 'create',
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
          type: 'resolve',
          existingCommentId: comment.id,
          body: 'This issue has been resolved.',
        });
      }
    }

    // Create summary comment (always as new, don't update existing summaries)
    actions.push({
      type: 'create',
      body: this.formatSummaryComment(fileResults, crossFileResult),
    });

    return actions;
  }

  private findMatchingComment(
    existingComments: ExistingComment[],
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
    // Strip the bot identifier and compare core content
    const stripIdentifier = (s: string) =>
      s.replace(this.botIdentifier, '').trim();
    return stripIdentifier(existingBody) === stripIdentifier(newBody);
  }

  formatInlineComment(finding: FileFinding): string {
    const severityEmoji = this.getSeverityEmoji(finding.severity);
    return `${severityEmoji} **${finding.severity.toUpperCase()}** - ${finding.category}

${finding.message}

**Suggestion:** ${finding.suggestion}`;
  }

  formatSummaryComment(
    fileResults: FileReviewResult[],
    crossFileResult: CrossFileReviewResult
  ): string {
    const totalFindings = fileResults.reduce(
      (sum, r) => sum + r.findings.length,
      0
    );
    const filesReviewed = fileResults.length;

    const severityCounts = this.countBySeverity(fileResults);
    const categoryCounts = this.countByCategory(fileResults);

    let summary = `# 📋 Code Review Summary

## Overview
${crossFileResult.overallAssessment}

## Statistics
- **Files Reviewed:** ${filesReviewed}
- **Total Issues Found:** ${totalFindings}

### By Severity
| Severity | Count |
|----------|-------|
| 🔴 Critical | ${severityCounts.critical} |
| 🟠 High | ${severityCounts.high} |
| 🟡 Medium | ${severityCounts.medium} |
| 🟢 Low | ${severityCounts.low} |

### By Category
| Category | Count |
|----------|-------|
| 🐛 Bug | ${categoryCounts.bug} |
| 🔒 Security | ${categoryCounts.security} |
| ⚡ Performance | ${categoryCounts.performance} |
| 📝 Quality | ${categoryCounts.quality} |
| 📚 Documentation | ${categoryCounts.documentation} |
`;

    if (crossFileResult.findings.length > 0) {
      summary += `
## Cross-File Findings
`;
      for (const finding of crossFileResult.findings) {
        const emoji = this.getSeverityEmoji(finding.severity);
        summary += `
### ${emoji} ${finding.category.toUpperCase()}
${finding.message}

**Affected Files:** ${finding.affectedFiles.join(', ') || 'Multiple files'}
`;
      }
    }

    if (crossFileResult.recommendations.length > 0) {
      summary += `
## Recommendations
`;
      for (const rec of crossFileResult.recommendations) {
        summary += `- ${rec}\n`;
      }
    }

    return summary;
  }

  private getSeverityEmoji(severity: string): string {
    const emojis: Record<string, string> = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🟢',
    };
    return emojis[severity] || '⚪';
  }

  private countBySeverity(
    results: FileReviewResult[]
  ): Record<string, number> {
    const counts: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const result of results) {
      for (const finding of result.findings) {
        counts[finding.severity] = (counts[finding.severity] || 0) + 1;
      }
    }

    return counts;
  }

  private countByCategory(
    results: FileReviewResult[]
  ): Record<string, number> {
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
