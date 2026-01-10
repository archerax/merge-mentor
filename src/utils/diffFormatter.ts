/**
 * Formats unified diffs with pre-calculated line numbers for easier AI consumption.
 * This helps AI models accurately identify line numbers without manual counting.
 */

export interface NumberedLine {
  /** Line number in the new file (undefined for deleted lines) */
  newLineNumber: number | undefined;
  /** The type of line: added, removed, or context */
  type: "added" | "removed" | "context";
  /** The actual content of the line (without diff prefix) */
  content: string;
}

export interface NumberedHunk {
  /** Header showing line range info */
  header: string;
  /** Lines with calculated line numbers */
  lines: NumberedLine[];
}

export interface NumberedDiff {
  /** All hunks in the diff */
  hunks: NumberedHunk[];
}

/**
 * Parses a unified diff and calculates line numbers for each line.
 *
 * @param patch - Unified diff patch string
 * @returns Parsed diff with calculated line numbers
 *
 * @example
 * ```typescript
 * const patch = `@@ -10,3 +10,4 @@ function test() {
 *  context line
 * +added line
 *  context`;
 * const numbered = parseAndNumberDiff(patch);
 * // numbered.hunks[0].lines[1] = { newLineNumber: 11, type: 'added', content: 'added line' }
 * ```
 */
export function parseAndNumberDiff(patch: string | undefined): NumberedDiff {
  const result: NumberedDiff = { hunks: [] };

  if (!patch) {
    return result;
  }

  const lines = patch.split("\n");
  let currentHunk: NumberedHunk | null = null;
  let currentNewLine = 0;

  for (const line of lines) {
    // Parse hunk header: @@ -oldStart,oldLines +newStart,newLines @@ optional context
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (hunkMatch) {
      currentNewLine = Number.parseInt(hunkMatch[1], 10);
      currentHunk = {
        header: line,
        lines: [],
      };
      result.hunks.push(currentHunk);
      continue;
    }

    // Skip if we haven't found a hunk header yet
    if (!currentHunk) {
      continue;
    }

    // Process diff content lines
    if (line.startsWith("+")) {
      currentHunk.lines.push({
        newLineNumber: currentNewLine,
        type: "added",
        content: line.slice(1),
      });
      currentNewLine++;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({
        newLineNumber: undefined,
        type: "removed",
        content: line.slice(1),
      });
      // Don't increment - removed lines don't exist in new file
    } else if (line.startsWith(" ")) {
      currentHunk.lines.push({
        newLineNumber: currentNewLine,
        type: "context",
        content: line.slice(1),
      });
      currentNewLine++;
    } else if (line.startsWith("\\")) {
      // "No newline at end of file" marker - skip
    }
  }

  return result;
}

/**
 * Formats a numbered diff into a string with explicit line numbers.
 * Format: `LINE | CONTENT` where LINE shows the new file line number.
 *
 * This format makes it trivially easy for AI models to identify line numbers
 * without requiring them to count lines from hunk headers.
 *
 * @param numberedDiff - Parsed diff with calculated line numbers
 * @returns Formatted string with line numbers
 *
 * @example
 * Output format:
 * ```
 * @@ -10,3 +10,4 @@ function test()
 *      10 | context line
 *    + 11 | added line
 *      12 | context
 * ```
 */
export function formatNumberedDiff(numberedDiff: NumberedDiff): string {
  const output: string[] = [];

  for (const hunk of numberedDiff.hunks) {
    output.push(hunk.header);

    for (const line of hunk.lines) {
      const prefix = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
      const lineNum =
        line.newLineNumber !== undefined ? String(line.newLineNumber).padStart(6) : "     -";
      output.push(`${prefix}${lineNum} | ${line.content}`);
    }
  }

  return output.join("\n");
}

/**
 * Converts a unified diff patch to numbered format in a single step.
 * Combines parsing and formatting for convenience.
 *
 * @param patch - Unified diff patch string
 * @returns Formatted diff with explicit line numbers
 *
 * @example
 * ```typescript
 * const patch = `@@ -10,3 +10,4 @@ function test() {
 *  context line
 * +added line
 *  context`;
 * const numbered = convertToNumberedDiff(patch);
 * // Returns:
 * // @@ -10,3 +10,4 @@ function test()
 * //      10 | context line
 * //    + 11 | added line
 * //      12 | context
 * ```
 */
export function convertToNumberedDiff(patch: string | undefined): string {
  if (!patch) {
    return "";
  }
  const numbered = parseAndNumberDiff(patch);
  return formatNumberedDiff(numbered);
}
