/**
 * Remaps a line number from the old file version to the new file version.
 *
 * Tracks hunk headers and added/removed lines in the patch to compute the
 * offset for a given original line. Returns the original line unchanged when
 * the line was removed or the patch does not contain enough context.
 *
 * @param originalLine - Line number in the old file version
 * @param patch - Unified diff patch string
 * @returns The corresponding line number in the new file version
 */
export function remapLineNumber(originalLine: number, patch: string | undefined): number {
  if (!patch || originalLine <= 0) return originalLine;

  const lines = patch.split("\n");
  let currentOldLine = 0;
  let currentNewLine = 0;

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentOldLine = Number.parseInt(hunkMatch[1], 10);
      currentNewLine = Number.parseInt(hunkMatch[2], 10);
      continue;
    }

    if (currentOldLine === 0) continue;

    if (line.startsWith("+")) {
      currentNewLine++;
    } else if (line.startsWith("-")) {
      if (currentOldLine === originalLine) {
        return originalLine;
      }
      currentOldLine++;
    } else if (line.startsWith(" ")) {
      if (currentOldLine >= originalLine) {
        const offset = currentNewLine - currentOldLine;
        return originalLine + offset;
      }
      currentOldLine++;
      currentNewLine++;
    }
  }

  return originalLine;
}
