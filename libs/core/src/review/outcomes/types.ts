/**
 * Types for outcome tracking: what happened to the inline review threads Merge
 * Mentor started on pull requests.
 */

/**
 * What became of one Merge Mentor thread.
 * - `resolved`: the thread was resolved.
 * - `open-merged`: the PR was merged with the thread still open.
 * - `open-closed`: the PR was closed unmerged with the thread still open.
 * - `open`: the PR is still open and the thread is unresolved, so there is no outcome yet.
 */
export type CommentOutcome = "resolved" | "open-merged" | "open-closed" | "open";

/** One Merge Mentor thread, reduced to the fields needed for counting. No text or authors. */
export interface OutcomeComment {
  /** Finding category (`bug`, `security`, ...), or `unknown` when it cannot be read. */
  readonly category: string;
  /** Finding severity (`critical`, ...), or `unknown` when it cannot be read. */
  readonly severity: string;
  readonly outcome: CommentOutcome;
  /** Month the comment was posted, as `YYYY-MM`. */
  readonly month: string;
}

/** The cached result of scanning one PR. */
export interface ScannedPr {
  /** The PR's `updatedAt` when it was scanned. */
  readonly updatedAt: string;
  readonly state: "open" | "closed";
  /** When the PR was merged or closed, when it has been. */
  readonly closedAt?: string;
  /** When this PR was scanned. */
  readonly scannedAt: string;
  /** Merge Mentor threads on the PR; empty when it has none. */
  readonly comments: readonly OutcomeComment[];
}

/** Current schema version of {@link OutcomesFile}. */
export const OUTCOMES_FILE_VERSION = 1;

/** The results file, which also serves as the scan cache. */
export interface OutcomesFile {
  readonly version: typeof OUTCOMES_FILE_VERSION;
  readonly platform: string;
  readonly project: string;
  readonly generatedAt: string;
  /** Scanned PRs keyed by PR number. */
  readonly prs: Readonly<Record<string, ScannedPr>>;
}

/** Counts of threads by outcome. */
export interface OutcomeCounts {
  readonly total: number;
  readonly resolved: number;
  readonly openMerged: number;
  readonly openClosed: number;
  readonly open: number;
  /**
   * `resolved / (resolved + openMerged + openClosed)`, so threads on PRs still in flight do not
   * lower it. `null` when no thread has reached an outcome yet.
   */
  readonly resolutionRate: number | null;
}

/** Aggregated outcome statistics. */
export interface OutcomeStats extends OutcomeCounts {
  /** PRs in the window that were scanned or served from the cache. */
  readonly prsScanned: number;
  /** Scanned PRs carrying at least one Merge Mentor thread. */
  readonly prsWithComments: number;
  readonly byCategory: Readonly<Record<string, OutcomeCounts>>;
  readonly bySeverity: Readonly<Record<string, OutcomeCounts>>;
  /** One entry per month with comments, oldest first. */
  readonly byMonth: readonly (OutcomeCounts & { readonly month: string })[];
}
