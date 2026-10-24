import type { AuditLogEntry } from "./auditReader.js";

/**
 * Review activity statistics derived from persisted audit events.
 *
 * Reviews are counted from `review.complete` events and comments from successful
 * `comment.post.*` events, so dry-run reviews (which post nothing) never inflate the
 * comment totals. Audit events only record the PR number, so PRs are de-duplicated
 * per platform and number; two repositories that share a PR number on one platform
 * count as a single PR.
 */

/** Counts of comments successfully posted to a platform. */
interface CommentStats {
  /** Inline comments anchored to a file and line. */
  readonly inline: number;
  /** Replies posted into an existing comment thread. */
  readonly replies: number;
  /** PR-level comments not tied to a file or line. */
  readonly general: number;
  /** Total of inline, reply, and general comments. */
  readonly total: number;
  /** Comment posts that failed. */
  readonly failed: number;
}

/** Activity totals for a single platform. */
interface PlatformStats {
  readonly platform: string;
  readonly reviewRuns: number;
  readonly prsReviewed: number;
  readonly comments: CommentStats;
}

/** Aggregated review activity. */
export interface AuditStats {
  /** Number of completed review runs (a PR re-reviewed twice counts twice). */
  readonly reviewRuns: number;
  /** Number of distinct PRs that have been reviewed. */
  readonly prsReviewed: number;
  /** Files reviewed across all runs. */
  readonly filesReviewed: number;
  /** Comments posted across all runs. */
  readonly comments: CommentStats;
  /** Per-platform breakdown, sorted by platform name. */
  readonly byPlatform: readonly PlatformStats[];
  /** Timestamp of the earliest counted event, if any. */
  readonly firstEventAt?: string;
  /** Timestamp of the latest counted event, if any. */
  readonly lastEventAt?: string;
}

/** Options for {@link computeAuditStats}. */
interface ComputeAuditStatsOptions {
  /** Only count events at or after this instant. */
  readonly since?: Date;
}

const UNKNOWN_PLATFORM = "unknown";

interface PlatformAccumulator {
  reviewRuns: number;
  prs: Set<string>;
  inline: number;
  replies: number;
  general: number;
  failed: number;
}

/**
 * Aggregates audit entries into review and comment statistics.
 *
 * @param entries - Entries from `readAuditEvents`
 * @param options - Optional time window
 * @returns Totals overall and per platform
 */
export function computeAuditStats(
  entries: readonly AuditLogEntry[],
  options: ComputeAuditStatsOptions = {}
): AuditStats {
  const sinceMs = options.since?.getTime();
  const platforms = new Map<string, PlatformAccumulator>();
  let filesReviewed = 0;
  let firstMs: number | undefined;
  let lastMs: number | undefined;
  let firstEventAt: string | undefined;
  let lastEventAt: string | undefined;

  const accumulatorFor = (platform: string): PlatformAccumulator => {
    let acc = platforms.get(platform);
    if (!acc) {
      acc = { reviewRuns: 0, prs: new Set(), inline: 0, replies: 0, general: 0, failed: 0 };
      platforms.set(platform, acc);
    }
    return acc;
  };

  for (const entry of entries) {
    const timeMs = Date.parse(entry.timestamp);
    if (sinceMs !== undefined && !(timeMs >= sinceMs)) continue;

    const platform = readString(entry.metadata?.platform) ?? UNKNOWN_PLATFORM;
    let counted = true;

    if (entry.eventType === "review.complete") {
      const acc = accumulatorFor(platform);
      acc.reviewRuns += 1;
      const prNumber = readPrNumber(entry);
      if (prNumber !== undefined) acc.prs.add(prNumber);
      filesReviewed += readNumber(entry.metadata?.filesReviewed);
    } else if (
      entry.eventType === "comment.post.inline" ||
      entry.eventType === "comment.post.general"
    ) {
      const acc = accumulatorFor(platform);
      if (entry.result === "failure") {
        acc.failed += 1;
      } else if (entry.eventType === "comment.post.general") {
        acc.general += 1;
      } else if (entry.metadata?.path === "thread") {
        acc.replies += 1;
      } else {
        acc.inline += 1;
      }
    } else {
      counted = false;
    }

    if (counted && Number.isFinite(timeMs)) {
      if (firstMs === undefined || timeMs < firstMs) {
        firstMs = timeMs;
        firstEventAt = entry.timestamp;
      }
      if (lastMs === undefined || timeMs > lastMs) {
        lastMs = timeMs;
        lastEventAt = entry.timestamp;
      }
    }
  }

  const byPlatform = [...platforms.entries()]
    .map(([platform, acc]): PlatformStats => ({
      platform,
      reviewRuns: acc.reviewRuns,
      prsReviewed: acc.prs.size,
      comments: toCommentStats(acc),
    }))
    .toSorted((a, b) => a.platform.localeCompare(b.platform));

  const allPrs = new Set<string>();
  for (const [platform, acc] of platforms) {
    for (const pr of acc.prs) allPrs.add(`${platform}#${pr}`);
  }

  return {
    reviewRuns: byPlatform.reduce((sum, p) => sum + p.reviewRuns, 0),
    prsReviewed: allPrs.size,
    filesReviewed,
    comments: toCommentStats({
      inline: total(byPlatform, (p) => p.comments.inline),
      replies: total(byPlatform, (p) => p.comments.replies),
      general: total(byPlatform, (p) => p.comments.general),
      failed: total(byPlatform, (p) => p.comments.failed),
    }),
    byPlatform,
    ...(firstEventAt ? { firstEventAt } : {}),
    ...(lastEventAt ? { lastEventAt } : {}),
  };
}

function toCommentStats(
  counts: Pick<PlatformAccumulator, "inline" | "replies" | "general" | "failed">
): CommentStats {
  return {
    inline: counts.inline,
    replies: counts.replies,
    general: counts.general,
    total: counts.inline + counts.replies + counts.general,
    failed: counts.failed,
  };
}

function total<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((acc, item) => acc + pick(item), 0);
}

function readPrNumber(entry: AuditLogEntry): string | undefined {
  const fromMetadata = entry.metadata?.prNumber;
  if (typeof fromMetadata === "number" || typeof fromMetadata === "string") {
    return String(fromMetadata);
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
