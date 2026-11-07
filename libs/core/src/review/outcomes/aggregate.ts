import type { OutcomeComment, OutcomeCounts, OutcomeStats, ScannedPr } from "./types.js";

function countsOf(comments: readonly OutcomeComment[]): OutcomeCounts {
  let resolved = 0;
  let openMerged = 0;
  let openClosed = 0;
  let open = 0;
  for (const comment of comments) {
    if (comment.outcome === "resolved") resolved += 1;
    else if (comment.outcome === "open-merged") openMerged += 1;
    else if (comment.outcome === "open-closed") openClosed += 1;
    else open += 1;
  }
  const decided = resolved + openMerged + openClosed;
  return {
    total: comments.length,
    resolved,
    openMerged,
    openClosed,
    open,
    resolutionRate: decided === 0 ? null : resolved / decided,
  };
}

function groupBy(
  comments: readonly OutcomeComment[],
  key: (comment: OutcomeComment) => string
): Map<string, OutcomeComment[]> {
  const groups = new Map<string, OutcomeComment[]>();
  for (const comment of comments) {
    const group = groups.get(key(comment));
    if (group) group.push(comment);
    else groups.set(key(comment), [comment]);
  }
  return groups;
}

function countsByKey(
  comments: readonly OutcomeComment[],
  key: (comment: OutcomeComment) => string
): Record<string, OutcomeCounts> {
  return Object.fromEntries(
    [...groupBy(comments, key)]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([name, group]) => [name, countsOf(group)])
  );
}

/**
 * Collates scanned PRs into outcome statistics. Only counts; it holds no
 * per-author or per-comment data.
 *
 * @param prs - Every PR in the window that has a scan result
 */
export function aggregateOutcomes(prs: readonly ScannedPr[]): OutcomeStats {
  const comments = prs.flatMap((pr) => pr.comments);
  const months = groupBy(comments, (comment) => comment.month);

  return {
    ...countsOf(comments),
    prsScanned: prs.length,
    prsWithComments: prs.filter((pr) => pr.comments.length > 0).length,
    byCategory: countsByKey(comments, (comment) => comment.category),
    bySeverity: countsByKey(comments, (comment) => comment.severity),
    byMonth: [...months]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([month, group]) => ({ month, ...countsOf(group) })),
  };
}
