/**
 * Helpers for producing per-file unified diffs from local git state.
 *
 * Used by the `CliGitClient` (which parses `git diff` output) and the
 * `IsomorphicGitClient` (which synthesizes patches from file contents) so the
 * two backends produce equivalent `GitFileChange` results.
 *
 * @module
 */

import { createTwoFilesPatch } from "diff";

/** A parsed hunk of a unified diff. */
interface DiffHunk {
  readonly header: string;
  readonly lines: readonly string[];
}

/** A single file's unified diff, split out of a combined `git diff` blob. */
export interface GitDiffChunk {
  /** Full unified diff for one file (headers + hunks). */
  readonly patch: string;
  /** `@@ -l,c +l,c @@` hunks, in order. */
  readonly hunks: readonly DiffHunk[];
}

/**
 * Splits combined `git diff` output into per-file chunks.
 *
 * Chunks are delimited by lines beginning with `diff --git `. Diff content
 * lines always begin with a space, `+`, `-`, `\` or `@@`, so a real content
 * line can never collide with the delimiter.
 */
export function splitGitDiff(raw: string): GitDiffChunk[] {
  const lines = raw.split("\n");
  const chunks: string[][] = [];
  let current: string[] | undefined;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current !== undefined) chunks.push(current);
      current = [line];
    } else if (current !== undefined) {
      current.push(line);
    }
  }
  if (current !== undefined) chunks.push(current);

  return chunks.map((chunkLines) => {
    const hunks: DiffHunk[] = [];
    let hunkHeader: string | undefined;
    let hunkLines: string[] = [];

    for (const line of chunkLines) {
      if (line.startsWith("@@")) {
        if (hunkHeader !== undefined) {
          hunks.push({ header: hunkHeader, lines: hunkLines });
        }
        hunkHeader = line;
        hunkLines = [];
      } else if (hunkHeader !== undefined) {
        hunkLines.push(line);
      }
    }
    if (hunkHeader !== undefined) {
      hunks.push({ header: hunkHeader, lines: hunkLines });
    }

    return {
      patch: chunkLines.join("\n"),
      hunks,
    };
  });
}

/** Counts added (+) and deleted (-) lines in a unified diff, excluding headers. */
export function countPatchStats(chunk: GitDiffChunk): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of chunk.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }
  }
  return { additions, deletions };
}

/** Returns `true` when the patch contains at least one content hunk. */
export function hasContentHunks(chunk: GitDiffChunk): boolean {
  return chunk.hunks.length > 0;
}

/** Returns `true` when the content contains NUL bytes (binary file). */
export function isBinaryContent(content: string): boolean {
  return content.includes("\u0000");
}

/**
 * Builds a unified diff for a newly added file, matching the shape git produces
 * (`new file mode`, `--- /dev/null`, `+++ b/<path>`).
 */
export function buildAddedFilePatch(path: string, content: string, sha?: string): string {
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  const fileLines = normalized.split("\n");
  fileLines.pop();
  const count = fileLines.length;
  const trailingNewline = content.endsWith("\n") ? "\n" : "\n\\ No newline at end of file\n";
  const body = fileLines.map((line) => `+${line}`).join("\n");

  const header = [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    `index 0000000..${sha ?? "0000000"} 100644`,
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${count} @@`,
  ].join("\n");

  return `${header}\n${body}${trailingNewline}`;
}

/**
 * Builds a git-style unified diff for a modified file from its old and new
 * content, using the `diff` package's Myers diff and normalizing the header to
 * match `git diff` output.
 */
export function buildContentDiffPatch(
  path: string,
  oldContent: string,
  newContent: string
): string {
  const raw = createTwoFilesPatch(`a/${path}`, `b/${path}`, oldContent, newContent);
  const lines = raw.split("\n");
  if (lines[0]?.startsWith("===")) lines.shift();
  return [`diff --git a/${path} b/${path}`, ...lines].join("\n");
}

/** Extracts the "new" side blob SHA from a chunk's `index old..new` line. */
export function extractNewSha(chunk: GitDiffChunk): string | undefined {
  for (const line of chunk.patch.split("\n")) {
    if (line.startsWith("index ")) {
      const match = line.match(/^index [0-9a-f]{7,40}\.\.([0-9a-f]{7,40})/);
      if (match && !/^0+$/.test(match[1])) {
        return match[1];
      }
      return undefined;
    }
  }
  return undefined;
}

/** Extracts the new-side path from a chunk's `+++ b/…`, `rename to …` lines. */
export function extractNewPath(chunk: GitDiffChunk): string | undefined {
  for (const line of chunk.patch.split("\n")) {
    if (line.startsWith("+++ b/")) return line.slice(6);
    if (line.startsWith("rename to ")) return line.slice(10);
  }
  return undefined;
}
