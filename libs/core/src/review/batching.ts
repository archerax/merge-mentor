import path from "node:path";

import type { PRFile } from "@merge-mentor/domain/platform.js";

/**
 * Default byte budget for one review batch. Kept below the engine's 150 KB
 * attachment threshold so a batch's diffs are always attached to the prompt
 * rather than left for the model to open one by one.
 */
export const DEFAULT_BATCH_MAX_BYTES = 100 * 1024;

/** Default maximum number of files reviewed in a single batch. */
export const DEFAULT_BATCH_MAX_FILES = 15;

/** Limits applied when packing files into review batches. */
export interface BatchLimits {
  /** Estimated byte budget for the numbered diffs of one batch. */
  readonly maxBytes: number;
  /** Maximum number of files in one batch. */
  readonly maxFiles: number;
}

/** Numbered diffs prepend a line number to each line; approximate that overhead. */
const NUMBERING_OVERHEAD_PER_LINE = 8;

/**
 * Estimates the on-disk size of a file's numbered diff.
 *
 * @param file - PR file with an optional patch.
 * @returns Estimated size in bytes.
 */
export function estimateDiffBytes(file: PRFile): number {
  const patch = file.patch ?? "";
  if (patch.length === 0) {
    return 0;
  }
  const lineCount = patch.split("\n").length;
  return patch.length + lineCount * NUMBERING_OVERHEAD_PER_LINE;
}

/** Strips test suffixes so a source file sorts next to its tests. */
function stemForGrouping(filename: string): string {
  const base = path.posix.basename(filename);
  return base.replace(/(\.(spec|test)|_test)?\.[^.]+$/, "");
}

/**
 * Splits files into review batches that fit within the given limits.
 *
 * Files are ordered by directory and then by name (tests next to the source
 * they cover) before being packed greedily, so each batch holds related files
 * and keeps most of the context a reviewer needs. A single file larger than
 * the byte budget gets a batch of its own.
 *
 * @param files - Files to review (callers pass files that have patches).
 * @param limits - Byte and file-count limits for one batch.
 * @returns Ordered batches; a single batch when everything fits.
 */
export function planReviewBatches(files: readonly PRFile[], limits: BatchLimits): PRFile[][] {
  const maxBytes = Math.max(1, limits.maxBytes);
  const maxFiles = Math.max(1, limits.maxFiles);

  const ordered = files.toSorted((a, b) => {
    const dirA = path.posix.dirname(a.filename);
    const dirB = path.posix.dirname(b.filename);
    if (dirA !== dirB) {
      return dirA < dirB ? -1 : 1;
    }
    const stemA = stemForGrouping(a.filename);
    const stemB = stemForGrouping(b.filename);
    if (stemA !== stemB) {
      return stemA < stemB ? -1 : 1;
    }
    return a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0;
  });

  const batches: PRFile[][] = [];
  let current: PRFile[] = [];
  let currentBytes = 0;

  for (const file of ordered) {
    const size = estimateDiffBytes(file);
    const fits = current.length < maxFiles && currentBytes + size <= maxBytes;

    if (current.length > 0 && !fits) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(file);
    currentBytes += size;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

/**
 * Runs `fn` over `items` concurrently, processing at most `limit` items at a
 * time while preserving input order in the results.
 *
 * @param items - Values to process.
 * @param limit - Maximum number of concurrent executions.
 * @param fn - Async function applied to each item and its index.
 * @returns Results in the same order as `items`.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = Array.from<R>({ length: items.length });
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex++;
      results[index] = await fn(items[index], index);
    }
  };

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

/**
 * Normalizes a repository path reported by the model so it can be compared
 * against manifest filenames, stripping leading "./" and normalizing
 * Windows-style backslashes to forward slashes.
 */
export function normalizeRepoPath(filePath: string): string {
  return filePath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Returns the filenames the model did not report a result for. An empty report
 * means nothing was reviewed, so every file is returned.
 *
 * Each reported path is attributed to at most one expected file (an exact
 * match, else the longest expected file it ends with, else a unique bare
 * basename), so one reported file can never mask a namesake or a path-suffix
 * lookalike.
 *
 * @param reported - Paths the model returned results for.
 * @param expected - Filenames that should have been reported.
 * @returns The expected filenames with no matching reported path.
 */
export function findUnreportedFiles(
  reported: readonly string[],
  expected: readonly string[]
): string[] {
  if (!reported || reported.length === 0) {
    return [...expected];
  }

  const targets = expected.map((file) => normalizeRepoPath(file));
  const targetSet = new Set(targets);

  const basenameCounts = new Map<string, number>();
  for (const target of targets) {
    const base = path.posix.basename(target);
    basenameCounts.set(base, (basenameCounts.get(base) ?? 0) + 1);
  }

  const covered = new Set<string>();
  for (const reportedPath of reported.map((file) => normalizeRepoPath(file))) {
    if (targetSet.has(reportedPath)) {
      covered.add(reportedPath);
      continue;
    }
    // A repo-prefixed path ("repo/src/a.ts") matches the longest file it ends with.
    const suffixMatch = targets
      .filter((target) => reportedPath.endsWith(`/${target}`))
      .toSorted((x, y) => y.length - x.length)[0];
    if (suffixMatch) {
      covered.add(suffixMatch);
      continue;
    }
    // A bare basename only counts when it identifies exactly one file.
    if (!reportedPath.includes("/") && basenameCounts.get(reportedPath) === 1) {
      const match = targets.find((target) => path.posix.basename(target) === reportedPath);
      if (match) {
        covered.add(match);
      }
    }
  }

  return expected.filter((file) => !covered.has(normalizeRepoPath(file)));
}
