/**
 * Replays previously-planned review comments against a platform adapter.
 *
 * A dry-run review computes the exact comments it would post — PR inline or
 * general comments, or a single work item comment — but discards them once it
 * has logged them. The web UI round-trips that planned payload back to a
 * stateless endpoint, which uses {@link postPlannedComments} to post it for
 * real without re-running any AI work.
 *
 * @module
 */

import { createHash } from "node:crypto";

import type { PlatformAdapter } from "@merge-mentor/domain/platform.js";
import { createChildLogger } from "@merge-mentor/shared/logger.js";

/**
 * A comment produced by a dry-run review that the UI is asking to post.
 *
 * Mirrors the subset of {@link CommentAction} that matters when posting: an
 * inline PR comment carries `path`/`line` (`startLine` for a range), every
 * other comment is posted as a general work item comment with an optional
 * existing comment to overwrite in place.
 */
export interface PendingComment {
  /** File path for an inline PR comment. */
  readonly path?: string;
  /** Line number for an inline PR comment. */
  readonly line?: number;
  /** Start line for a multi-line inline PR comment. */
  readonly startLine?: number;
  /** Comment body (markdown). */
  readonly body: string;
  /** Existing work item comment to overwrite in place, when known. */
  readonly existingCommentId?: number | string;
}

/** Where a batch of {@link PendingComment}s should be posted. */
export type PostTarget =
  | { readonly kind: "pr"; readonly prNumber: number }
  | { readonly kind: "pbi" | "project"; readonly id: string };

/** Outcome of posting a batch of planned comments. */
export interface PostCommentsResult {
  /** Number of comments successfully posted or updated. */
  readonly commentsCreated: number;
  /** Number of comments skipped because they were already posted. */
  readonly commentsSkipped: number;
  /** Error messages for comments that failed to post. */
  readonly commentErrors: readonly string[];
  /** Fingerprints of the comments posted (or updated) by this call. */
  readonly postedFingerprints: readonly string[];
}

/** Optional behavior for {@link postPlannedComments}. */
export interface PostPlannedCommentsOptions {
  /**
   * Fingerprints already recorded as posted for the target. Matching comments
   * are skipped so repeated post requests stay idempotent.
   */
  readonly postedFingerprints?: ReadonlySet<string>;
}

/**
 * Computes a stable fingerprint for a planned comment.
 *
 * The fingerprint is derived solely from the fields that determine the
 * comment's external effect (its target-relative location and body), so the same
 * planned comment yields the same value across runs, page reloads, and server
 * processes. It is used as the durable posted-state marker.
 *
 * @param comment - Planned comment to fingerprint.
 */
export function commentFingerprint(comment: PendingComment): string {
  const identity = [
    comment.path ?? "",
    comment.line ?? "",
    comment.startLine ?? "",
    comment.existingCommentId ?? "",
    comment.body,
  ].join("\u0000");
  return createHash("sha256").update(identity).digest("hex");
}

const logger = createChildLogger({ component: "CommentPosting" });

/** Posts a single pending comment, dispatching inline vs. general PR comments. */
async function postPRComment(
  adapter: PlatformAdapter,
  prNumber: number,
  comment: PendingComment
): Promise<void> {
  if (comment.path && comment.line) {
    if (comment.startLine !== undefined) {
      await adapter.postInlineComment(
        prNumber,
        comment.path,
        comment.line,
        comment.body,
        comment.startLine
      );
    } else {
      await adapter.postInlineComment(prNumber, comment.path, comment.line, comment.body);
    }
    return;
  }

  await adapter.postGeneralComment(prNumber, comment.body);
}

/**
 * Posts each planned comment, collecting per-comment failures instead of
 * aborting the whole batch.
 *
 * Comments whose fingerprint already appears in
 * {@link PostPlannedCommentsOptions.postedFingerprints} are skipped, keeping
 * repeated requests idempotent for callers that persist posted state.
 *
 * @param adapter - Platform adapter used to post the comments.
 * @param target  - PR number or work item id the comments belong to.
 * @param comments - Planned comments produced by a dry-run review.
 * @param options - Optional already-posted fingerprints to skip.
 */
export async function postPlannedComments(
  adapter: PlatformAdapter,
  target: PostTarget,
  comments: readonly PendingComment[],
  options: PostPlannedCommentsOptions = {}
): Promise<PostCommentsResult> {
  const alreadyPosted = options.postedFingerprints ?? new Set<string>();
  let commentsCreated = 0;
  let commentsSkipped = 0;
  const commentErrors: string[] = [];
  const postedFingerprints: string[] = [];

  for (const comment of comments) {
    const fingerprint = commentFingerprint(comment);
    if (alreadyPosted.has(fingerprint)) {
      commentsSkipped++;
      continue;
    }

    try {
      if (target.kind === "pr") {
        await postPRComment(adapter, target.prNumber, comment);
      } else {
        await adapter.postPBIComment(target.id, comment.body, comment.existingCommentId);
      }
      commentsCreated++;
      postedFingerprints.push(fingerprint);
    } catch (error) {
      const message = `Failed to post comment: ${(error as Error).message}`;
      logger.error(
        {
          target,
          path: comment.path,
          line: comment.line,
          error: (error as Error).message,
        },
        "Planned comment failed to post"
      );
      commentErrors.push(message);
    }
  }

  return { commentsCreated, commentsSkipped, commentErrors, postedFingerprints };
}
