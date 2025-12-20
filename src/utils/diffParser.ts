/**
 * Parses a unified diff patch to extract valid line numbers for inline comments.
 * GitHub API only allows comments on lines that are part of the diff.
 */

interface DiffLineInfo {
  /** Line number in the new version of the file */
  readonly lineNumber: number;
  /** Whether this line was added or modified (can be commented on) */
  readonly isCommentable: boolean;
}

/**
 * Extracts valid line numbers from a git diff patch.
 * 
 * GitHub allows inline comments only on:
 * - Lines that were added (+)
 * - Lines that were modified (contextual lines near changes)
 * 
 * @param patch - Unified diff patch string
 * @returns Set of valid line numbers that can be commented on
 * 
 * @example
 * ```typescript
 * const patch = `@@ -10,5 +10,6 @@ function example() {
 *  context line
 * +added line
 * -removed line`;
 * const validLines = getValidDiffLines(patch);
 * // Returns Set containing line numbers for added/context lines
 * ```
 */
export function getValidDiffLines(patch: string | undefined): Set<number> {
  const validLines = new Set<number>();
  
  if (!patch) {
    return validLines;
  }

  const lines = patch.split('\n');
  let currentLine = 0;

  for (const line of lines) {
    // Parse hunk header: @@ -oldStart,oldLines +newStart,newLines @@
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentLine = Number.parseInt(hunkMatch[1], 10);
      continue;
    }

    // Skip if we haven't found a hunk header yet
    if (currentLine === 0) {
      continue;
    }

    // Process diff content lines
    if (line.startsWith('+')) {
      // Added line - commentable
      validLines.add(currentLine);
      currentLine++;
    } else if (line.startsWith('-')) {
      // Deleted line - not commentable, don't increment line number
      continue;
    } else if (line.startsWith(' ')) {
      // Context line - commentable in some cases, but safer to include
      validLines.add(currentLine);
      currentLine++;
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" - skip
      continue;
    }
  }

  return validLines;
}

/**
 * Finds the nearest valid line number for commenting.
 * If the requested line is invalid, finds the closest valid line.
 * 
 * @param requestedLine - The line number requested by the AI
 * @param validLines - Set of valid line numbers from the diff
 * @returns Nearest valid line number, or undefined if no valid lines exist
 */
export function findNearestValidLine(
  requestedLine: number,
  validLines: Set<number>
): number | undefined {
  if (validLines.size === 0) {
    return undefined;
  }

  // If requested line is valid, use it
  if (validLines.has(requestedLine)) {
    return requestedLine;
  }

  // Find nearest valid line
  const sortedLines = Array.from(validLines).sort((a, b) => a - b);
  
  let nearest = sortedLines[0];
  let minDistance = Math.abs(requestedLine - nearest);

  for (const line of sortedLines) {
    const distance = Math.abs(requestedLine - line);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = line;
    }
  }

  return nearest;
}

/**
 * Checks if a line number is valid for commenting on a diff.
 * 
 * @param line - Line number to check
 * @param validLines - Set of valid line numbers
 * @returns True if the line can be commented on
 */
export function isValidDiffLine(line: number, validLines: Set<number>): boolean {
  return validLines.has(line);
}
