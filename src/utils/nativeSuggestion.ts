import type { FileFinding } from "../platforms/types.js";

const MAX_SUGGESTION_LINES = 9;

export interface NativeSuggestion {
  readonly startLine: number;
  readonly endLine: number;
  readonly replacement: string;
}

/**
 * Validates the constrained replacement form supported by native PR suggestions.
 * Invalid replacements intentionally return undefined so callers can retain the
 * normal explanatory review comment instead.
 */
export function validateNativeSuggestion(
  finding: FileFinding,
  patch: string | undefined
): NativeSuggestion | undefined {
  if (finding.confidence !== "high" || !finding.replacement?.trim() || !patch) {
    return undefined;
  }

  const replacement = finding.replacement.replace(/\r\n/g, "\n").replace(/\n$/, "");
  if (
    !replacement ||
    replacement.includes("```") ||
    lineCount(replacement) > MAX_SUGGESTION_LINES
  ) {
    return undefined;
  }

  const startLine = finding.startLine ?? finding.line;
  const endLine = finding.endLine ?? finding.line;
  if (
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine ||
    endLine - startLine + 1 > MAX_SUGGESTION_LINES
  ) {
    return undefined;
  }

  const diffLines = getDiffLineContents(patch);
  for (let line = startLine; line <= endLine; line++) {
    if (!diffLines.has(line)) {
      return undefined;
    }
  }

  const targetLines = Array.from(
    { length: endLine - startLine + 1 },
    (_, index) => diffLines.get(startLine + index) ?? ""
  );
  if (containsImport(replacement) && !targetLines.some((line) => containsImport(line))) {
    return undefined;
  }

  return { startLine, endLine, replacement };
}

export function formatNativeSuggestion(suggestion: NativeSuggestion): string {
  return `\n\n\`\`\`suggestion\n${suggestion.replacement}\n\`\`\``;
}

function lineCount(value: string): number {
  return value.split("\n").length;
}

function containsImport(value: string): boolean {
  return /^\s*(?:import\s|export\s+[^;]*\s+from\s)/.test(value);
}

function getDiffLineContents(patch: string): Map<number, string> {
  const lines = new Map<number, string>();
  let currentLine = 0;

  for (const patchLine of patch.split("\n")) {
    const hunkMatch = patchLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentLine = Number.parseInt(hunkMatch[1], 10);
      continue;
    }

    if (currentLine === 0) continue;

    if (patchLine.startsWith("+")) {
      lines.set(currentLine, patchLine.slice(1));
      currentLine++;
    } else if (patchLine.startsWith("-")) {
    } else if (patchLine.startsWith(" ")) {
      lines.set(currentLine, patchLine.slice(1));
      currentLine++;
    }
  }

  return lines;
}
