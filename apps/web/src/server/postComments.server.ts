/**
 * Stateless dispatcher for posting comments a dry-run review planned.
 *
 * The web UI round-trips the planned payload from the review summary back to
 * this endpoint, which resolves the target from configuration, reuses the same
 * platform adapters as the streaming endpoints, and posts each comment.
 */

import type { PendingComment } from "@merge-mentor/core/review/commentPosting.js";

import { postPRComments } from "./review.server.js";
import type { PostCommentsInput, PostCommentsResult } from "./review.types.js";
import { postWorkItemComments } from "./workItemReview.server.js";

const KINDS = new Set(["pr", "pbi", "project"]);

/** Coerces one raw comment into a safe {@link PendingComment}, or drops it. */
function toComment(raw: unknown): PendingComment | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { path, line, startLine, body, existingCommentId } = raw as Record<string, unknown>;
  if (typeof body !== "string") return null;

  const comment: PendingComment = {
    body,
    ...(typeof path === "string" ? { path } : {}),
    ...(typeof line === "number" && Number.isFinite(line) ? { line } : {}),
    ...(typeof startLine === "number" && Number.isFinite(startLine) ? { startLine } : {}),
    ...(typeof existingCommentId === "string" || typeof existingCommentId === "number"
      ? { existingCommentId }
      : {}),
  };
  return comment;
}

/** Validates and normalizes arbitrary request input into a {@link PostCommentsInput}. */
function toPostInput(data: unknown): PostCommentsInput {
  if (typeof data !== "object" || data === null) {
    throw new Error("Invalid request body.");
  }

  const { kind, prUrl, pr, url, id, comments } = data as Record<string, unknown>;
  if (typeof kind !== "string" || !KINDS.has(kind)) {
    throw new Error('Invalid "kind": expected "pr", "pbi", or "project".');
  }
  if (!Array.isArray(comments)) {
    throw new Error('Invalid "comments": expected an array.');
  }

  const normalized = comments
    .map(toComment)
    .filter((comment): comment is PendingComment => !!comment);

  return {
    kind: kind as PostCommentsInput["kind"],
    ...(typeof prUrl === "string" ? { prUrl } : {}),
    ...(typeof pr === "number" && Number.isFinite(pr) ? { pr } : {}),
    ...(typeof url === "string" ? { url } : {}),
    ...(typeof id === "string" ? { id } : {}),
    comments: normalized,
  };
}

/** Posts the planned comments for any review kind, dispatching on `kind`. */
export async function postComments(data: unknown): Promise<PostCommentsResult> {
  const input = toPostInput(data);

  if (input.comments.length === 0) {
    return { commentsCreated: 0, commentsSkipped: 0, commentErrors: [], postedFingerprints: [] };
  }

  switch (input.kind) {
    case "pr":
      return postPRComments(input);
    case "pbi":
      return postWorkItemComments(input, "PBI");
    case "project":
      return postWorkItemComments(input, "project");
  }
}
