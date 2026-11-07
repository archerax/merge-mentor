/**
 * Posts inline PR comments together as one review where the platform supports
 * it, so reviewers get one notification instead of one per comment.
 *
 * @module
 */

import type { InlineCommentInput, PlatformAdapter } from "@merge-mentor/domain/platform.js";

/** What happened when trying to post a batch of inline comments. */
export type InlineBatchOutcome =
  /** Every comment was posted. */
  | { readonly status: "posted" }
  /**
   * The batch failed in a way that may have posted anything, so it must not be
   * retried and every comment in it counts as failed.
   */
  | { readonly status: "failed"; readonly error: Error }
  /** Nothing was posted: post each comment on its own instead. */
  | { readonly status: "fallback" };

/**
 * Tries to post `comments` as a single review.
 *
 * Falls back (posting nothing) when the platform cannot batch, when there is
 * only one comment, or when the platform rejects the batch's content, for
 * example one comment on a line outside the diff. That keeps one bad comment
 * from costing the rest.
 *
 * @param adapter - Platform adapter to post with.
 * @param prNumber - PR the comments belong to.
 * @param comments - Inline comments to post together.
 */
export async function postInlineBatch(
  adapter: PlatformAdapter,
  prNumber: number,
  comments: readonly InlineCommentInput[]
): Promise<InlineBatchOutcome> {
  if (comments.length < 2 || !adapter.postInlineCommentBatch) return { status: "fallback" };

  try {
    const posted = await adapter.postInlineCommentBatch(prNumber, comments);
    return posted ? { status: "posted" } : { status: "fallback" };
  } catch (error) {
    return { status: "failed", error: error as Error };
  }
}
