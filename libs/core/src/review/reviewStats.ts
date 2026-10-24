import type { PlatformAdapter, PullRequestLister } from "@merge-mentor/domain/platform.js";

/**
 * Live review statistics gathered from a platform's real pull requests.
 *
 * A PR counts as reviewed when it carries at least one comment written by Merge
 * Mentor (the adapter matches the configured bot identifier, and on GitHub also the
 * bot account). Azure DevOps counts the comment threads Merge Mentor started;
 * replies inside a thread are not counted.
 */

/** Per-PR review activity. */
interface PullRequestReviewStats {
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "closed";
  /** Inline comments anchored to a file. */
  readonly inlineComments: number;
  /** PR-level comments, including the review summary. */
  readonly generalComments: number;
}

/** Aggregated live statistics. */
export interface LiveReviewStats {
  /** Platform the statistics were gathered from. */
  readonly platform: string;
  /** Repository identifier the statistics were gathered from. */
  readonly project: string;
  /** Number of PRs inspected. */
  readonly prsScanned: number;
  /** Number of inspected PRs with at least one Merge Mentor comment. */
  readonly prsReviewed: number;
  /** Total Merge Mentor comments across inspected PRs. */
  readonly totalComments: number;
  readonly inlineComments: number;
  readonly generalComments: number;
  /** PRs whose comments could not be fetched and are excluded from the totals. */
  readonly prsFailed: number;
  /** True when the PR limit was reached, so older PRs may not be counted. */
  readonly truncated: boolean;
  /** Reviewed PRs, most recently updated first. */
  readonly reviewedPullRequests: readonly PullRequestReviewStats[];
}

/** Options for {@link collectLiveReviewStats}. */
interface CollectLiveReviewStatsOptions {
  /** Only inspect PRs with activity at or after this instant. */
  readonly since?: Date;
  /** Maximum number of PRs to inspect. */
  readonly limit: number;
  /** Number of PRs whose comments are fetched in parallel. Default: 5. */
  readonly concurrency?: number;
}

const DEFAULT_CONCURRENCY = 5;

/**
 * Counts how many PRs Merge Mentor reviewed and how many comments it posted by
 * querying the platform directly.
 *
 * @param adapter - Platform adapter for the repository to inspect
 * @param options - Time window, PR limit, and fetch concurrency
 * @returns Totals plus the list of reviewed PRs
 */
export async function collectLiveReviewStats(
  adapter: PlatformAdapter & PullRequestLister,
  options: CollectLiveReviewStatsOptions
): Promise<LiveReviewStats> {
  const pulls = await adapter.listPullRequests({ since: options.since, limit: options.limit });
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);

  const results: (PullRequestReviewStats | "failed" | undefined)[] = Array.from({
    length: pulls.length,
  });
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < pulls.length) {
      const index = next;
      next += 1;
      const pr = pulls[index];
      try {
        const comments = await adapter.getExistingBotComments(pr.number);
        const inlineComments = comments.filter((c) => c.path !== undefined).length;
        results[index] =
          comments.length === 0
            ? undefined
            : {
                number: pr.number,
                title: pr.title,
                state: pr.state,
                inlineComments,
                generalComments: comments.length - inlineComments,
              };
      } catch {
        results[index] = "failed";
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pulls.length) }, worker));

  const reviewed = results.filter(
    (result): result is PullRequestReviewStats => result !== undefined && result !== "failed"
  );
  const inlineComments = reviewed.reduce((total, pr) => total + pr.inlineComments, 0);
  const generalComments = reviewed.reduce((total, pr) => total + pr.generalComments, 0);

  return {
    platform: adapter.getPlatformName(),
    project: adapter.getProjectIdentifier(),
    prsScanned: pulls.length,
    prsReviewed: reviewed.length,
    totalComments: inlineComments + generalComments,
    inlineComments,
    generalComments,
    prsFailed: results.filter((result) => result === "failed").length,
    truncated: pulls.length >= options.limit,
    reviewedPullRequests: reviewed,
  };
}
