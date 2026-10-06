import type { ExistingComment } from "../../platforms/types.js";

/** Sentinels returned when there are no inline comments to include. */
export const NO_COMMENTS = "No existing comments on this PR.";
export const NO_INLINE_COMMENTS = "No existing inline comments on this PR.";

/**
 * Groups inline comments by file, discarding summary comments without a
 * file/line location and preserving insertion order of files.
 */
function groupInlineComments(
  existingComments: readonly ExistingComment[]
): Map<string, ExistingComment[]> {
  const byFile = new Map<string, ExistingComment[]>();
  for (const comment of existingComments) {
    if (!comment.path || !comment.line) continue;
    const comments = byFile.get(comment.path);
    if (comments) {
      comments.push(comment);
    } else {
      byFile.set(comment.path, [comment]);
    }
  }
  return byFile;
}

/**
 * Formats existing comments into a concise context string for LLM prompts.
 * Groups comments by file and line to provide structured awareness.
 *
 * @param existingComments - Array of existing bot comments on the PR
 * @returns Formatted string with comment context, or message if no comments
 *
 * @example
 * ```typescript
 * const context = formatExistingCommentsContext(existingComments);
 * // Returns:
 * // EXISTING COMMENTS ON THIS PR:
 * // File: src/app.ts
 * //   - Line 10: [Bug] Null check missing
 * //   - Line 25: [Security] SQL injection risk [RESOLVED]
 * ```
 */
export function formatExistingCommentsContext(
  existingComments: readonly ExistingComment[]
): string {
  if (existingComments.length === 0) {
    return NO_COMMENTS;
  }

  const byFile = groupInlineComments(existingComments);

  if (byFile.size === 0) {
    return NO_INLINE_COMMENTS;
  }

  // Format as structured list
  const lines: string[] = ["EXISTING COMMENTS ON THIS PR:"];
  for (const [file, comments] of byFile) {
    lines.push(`\nFile: ${file}`);
    for (const comment of comments.toSorted((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
      // Extract key info: line, category, issue summary
      const lineNum = comment.line;
      const category = extractCategory(comment.body);
      const summary = extractIssueSummary(comment.body);
      const resolved = comment.isResolved ? " [RESOLVED]" : "";
      lines.push(`  - Line ${lineNum}: [${category}] ${summary}${resolved}`);
    }
  }

  return lines.join("\n");
}

/**
 * Formats existing comments with their full content for the Lead Synthesizer,
 * which owns de-duplication against already-flagged issues. Unlike
 * {@link formatExistingCommentsContext}, this preserves the complete
 * issue/suggestion text (stripping only bot boilerplate) so the synthesizer can
 * judge root-cause overlap accurately.
 *
 * @param existingComments - Array of existing bot comments on the PR
 * @returns Formatted string with full comment content, or message if no comments
 */
export function formatFullCommentsContext(existingComments: readonly ExistingComment[]): string {
  if (existingComments.length === 0) {
    return NO_COMMENTS;
  }

  const byFile = groupInlineComments(existingComments);

  if (byFile.size === 0) {
    return NO_INLINE_COMMENTS;
  }

  const lines: string[] = ["EXISTING COMMENTS ON THIS PR:"];
  for (const [file, comments] of byFile) {
    lines.push(`\nFile: ${file}`);
    for (const comment of comments.toSorted((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
      const category = extractCategory(comment.body);
      const resolved = comment.isResolved ? " [RESOLVED]" : "";
      lines.push(`  - Line ${comment.line}: [${category}]${resolved}`);
      for (const contentLine of stripCommentBoilerplate(comment.body).split("\n")) {
        lines.push(`    ${contentLine}`.trimEnd());
      }
    }
  }

  return lines.join("\n");
}

/**
 * Removes bot-generated boilerplate from a comment body: the trailing footer
 * separator (and everything after it) plus HTML comment markers such as the
 * finding-id and bot-attribution tags.
 */
function stripCommentBoilerplate(body: string): string {
  const footerIndex = body.lastIndexOf("\n---");
  const withoutFooter = footerIndex === -1 ? body : body.slice(0, footerIndex);
  return withoutFooter.replace(/<!--[\s\S]*?-->/g, "").trim();
}

/**
 * Extracts the category from a formatted comment.
 *
 * @param commentBody - The formatted comment body
 * @returns Extracted category name or "Unknown"
 */
function extractCategory(commentBody: string): string {
  const match = commentBody.match(/###\s+\S+\s+(\w+)\s+Issue/i);
  return match ? match[1] : "Unknown";
}

/**
 * Extracts a concise issue summary from a formatted comment.
 *
 * @param commentBody - The formatted comment body
 * @returns Truncated issue summary (max 80 chars)
 */
function extractIssueSummary(commentBody: string): string {
  // Extract the first line of the issue description
  const issueMatch = commentBody.match(/\*\*Issue\*\*:\s*(.+?)(?:\n|$)/);
  if (issueMatch) {
    const summary = issueMatch[1].trim();
    // Truncate to reasonable length
    return summary.length > 80 ? `${summary.slice(0, 77)}...` : summary;
  }
  return "Review feedback";
}
