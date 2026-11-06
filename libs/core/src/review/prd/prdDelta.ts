/**
 * Compares a PRD / FRD review with an earlier review of the same document, so
 * an author revising the document can see what was fixed, what is new and
 * what is still open.
 *
 * Findings carry no stable identity (ids are renumbered every run), so they
 * are matched by what they quote and say: the same passage with the same kind
 * of problem is the same finding, even when the author has reworded the text
 * around it.
 */
import type { PrdReadinessVerdict, PrdReviewReport } from "./prdReport.js";
import type { PrdFinding, PrdSeverity } from "./types.js";

/** Result of comparing a review with an earlier one. */
export interface PrdReviewComparison {
  readonly previousRunId: string;
  /** ISO timestamp of the earlier review. */
  readonly previousCreatedAt: string;
  readonly previousVerdict: PrdReadinessVerdict;
  readonly previousCounts: Readonly<Record<PrdSeverity, number>>;
  /** Ids (in the current report) of findings that were not in the earlier review. */
  readonly newFindingIds: readonly string[];
  /** Ids (in the current report) of findings that were already in the earlier review. */
  readonly stillOpenFindingIds: readonly string[];
  /** Findings of the earlier review that this review no longer reports. */
  readonly resolved: readonly PrdFinding[];
  /**
   * Set when "resolved" may be overstated because the current review did not
   * cover the whole document.
   */
  readonly caveat?: string;
}

/** Minimum score for two findings to be treated as the same finding. */
const MATCH_THRESHOLD = 0.55;
/** Minimum similarity of the quoted text on its own. */
const MIN_QUOTE_SIMILARITY = 0.5;

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 0)
  );
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function quoteSimilarity(a: PrdFinding, b: PrdFinding): number {
  if (a.imageId !== undefined || b.imageId !== undefined) {
    return a.imageId === b.imageId ? 1 : 0;
  }
  return jaccard(tokens(a.quote), tokens(b.quote));
}

function matchScore(previous: PrdFinding, current: PrdFinding): number {
  const quote = quoteSimilarity(previous, current);
  if (quote < MIN_QUOTE_SIMILARITY) return 0;
  const problem = jaccard(tokens(previous.problem), tokens(current.problem));
  const dimension = previous.dimension === current.dimension ? 1 : 0;
  return quote * 0.6 + problem * 0.3 + dimension * 0.1;
}

/**
 * Matches the findings of an earlier review with the current ones and works
 * out what changed.
 *
 * @param previous - The earlier review of the document
 * @param current - Findings of the review that just ran
 * @param currentComplete - Whether the current review covered the whole document
 */
export function compareReviews(
  previous: PrdReviewReport,
  current: readonly PrdFinding[],
  currentComplete: boolean
): PrdReviewComparison {
  const candidates: { previousIndex: number; currentIndex: number; score: number }[] = [];
  previous.findings.forEach((before, previousIndex) => {
    current.forEach((after, currentIndex) => {
      const score = matchScore(before, after);
      if (score >= MATCH_THRESHOLD) candidates.push({ previousIndex, currentIndex, score });
    });
  });
  // Best matches first, so a finding is paired with its closest counterpart.
  candidates.sort((a, b) => b.score - a.score);

  const matchedPrevious = new Set<number>();
  const matchedCurrent = new Set<number>();
  for (const candidate of candidates) {
    if (matchedPrevious.has(candidate.previousIndex)) continue;
    if (matchedCurrent.has(candidate.currentIndex)) continue;
    matchedPrevious.add(candidate.previousIndex);
    matchedCurrent.add(candidate.currentIndex);
  }

  const newFindingIds: string[] = [];
  const stillOpenFindingIds: string[] = [];
  current.forEach((finding, index) => {
    (matchedCurrent.has(index) ? stillOpenFindingIds : newFindingIds).push(finding.id);
  });
  const resolved = previous.findings.filter((_finding, index) => !matchedPrevious.has(index));

  const caveats: string[] = [];
  if (!currentComplete) {
    caveats.push(
      "this review did not cover the whole document, so some “resolved” issues may simply not have been checked"
    );
  }
  if (!previous.complete) {
    caveats.push("the earlier review was partial, so some “new” issues may have been there before");
  }

  return {
    previousRunId: previous.runId,
    previousCreatedAt: previous.createdAt,
    previousVerdict: previous.readiness.verdict,
    previousCounts: previous.counts,
    newFindingIds,
    stillOpenFindingIds,
    resolved,
    ...(caveats.length > 0 ? { caveat: `Note: ${caveats.join("; and ")}.` } : {}),
  };
}
