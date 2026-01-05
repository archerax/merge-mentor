import type { ExistingComment } from "../../platforms/types.js";

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
    return "No existing comments on this PR.";
  }

  // Filter out summary comments (no file/line)
  const inlineComments = existingComments.filter((c) => c.path && c.line);

  if (inlineComments.length === 0) {
    return "No existing inline comments on this PR.";
  }

  // Group by file
  const byFile = new Map<string, ExistingComment[]>();
  for (const comment of inlineComments) {
    if (!comment.path) continue;
    if (!byFile.has(comment.path)) {
      byFile.set(comment.path, []);
    }
    byFile.get(comment.path)!.push(comment);
  }

  // Format as structured list
  const lines: string[] = ["EXISTING COMMENTS ON THIS PR:"];
  for (const [file, comments] of byFile) {
    lines.push(`\nFile: ${file}`);
    for (const comment of comments.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
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

/**
 * Formats existing comments context specifically for a single file.
 * Used in file-by-file reviews to show only relevant comments.
 *
 * @param filename - The file to filter comments for
 * @param existingComments - Array of all existing bot comments
 * @returns Formatted string with file-specific comments, or empty string if none
 *
 * @example
 * ```typescript
 * const context = formatFileCommentsContext('src/app.ts', existingComments);
 * if (context) {
 *   // Include in file review prompt
 * }
 * ```
 */
export function formatFileCommentsContext(
  filename: string,
  existingComments: readonly ExistingComment[]
): string {
  const fileComments = existingComments.filter((c) => c.path === filename && c.line);

  if (fileComments.length === 0) {
    return "";
  }

  const lines: string[] = ["EXISTING COMMENTS ON THIS FILE:"];
  for (const comment of fileComments.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
    const lineNum = comment.line;
    const category = extractCategory(comment.body);
    const summary = extractIssueSummary(comment.body);
    const resolved = comment.isResolved ? " [RESOLVED]" : "";
    lines.push(`  - Line ${lineNum}: [${category}] ${summary}${resolved}`);
  }

  return lines.join("\n");
}
