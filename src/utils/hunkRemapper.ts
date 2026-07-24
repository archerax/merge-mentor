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
