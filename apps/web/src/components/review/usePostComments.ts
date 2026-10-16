import { useEffect, useMemo, useState } from "react";

import type {
  PendingCommentView,
  PostCommentsInput,
  PostCommentsResult,
} from "../../server/review.types.js";

/** Target fields carried over from the original stream input. */
export type PostTarget = Omit<PostCommentsInput, "kind" | "comments">;

/** Selection and posting state for a set of planned dry-run comments. */
export interface PostCommentsController {
  /** Planned comments that have not been posted yet. */
  readonly pending: readonly PendingCommentView[];
  /** Pending comments the user has selected for the next batch. */
  readonly selectedPending: readonly PendingCommentView[];
  /** Whether every pending comment is currently selected. */
  readonly allSelected: boolean;
  /** Whether a post request is in flight. */
  readonly busy: boolean;
  /** Whether the original target input is available to post against. */
  readonly targetReady: boolean;
  /** Result of the last batch post, when one has completed. */
  readonly result: PostCommentsResult | null;
  /** Error from the last failed batch post. */
  readonly error: string | null;
  isPosted(fingerprint: string): boolean;
  isSelected(fingerprint: string): boolean;
  isPosting(fingerprint: string): boolean;
  rowError(fingerprint: string): string | undefined;
  toggle(fingerprint: string): void;
  selectAll(): void;
  clearSelection(): void;
  postOne(comment: PendingCommentView): void;
  postSelected(): void;
}

/**
 * Owns selection and posting state for the comments a dry-run review planned.
 *
 * The planned payload is round-tripped to the stateless post endpoint, so no
 * review or AI work is repeated. Already-posted comments (marked by the server
 * from a durable per-comment fingerprint) are excluded from the batch and shown
 * disabled, making repeated posts idempotent across re-renders and reloads.
 */
export function usePostComments(
  kind: PostCommentsInput["kind"],
  target: PostTarget | null,
  comments: readonly PendingCommentView[]
): PostCommentsController {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sessionPosted, setSessionPosted] = useState<ReadonlySet<string>>(new Set());
  const [postingFingerprints, setPostingFingerprints] = useState<ReadonlySet<string>>(new Set());
  const [result, setResult] = useState<PostCommentsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<ReadonlyMap<string, string>>(new Map());

  const posted = useMemo(() => {
    const fingerprints = new Set(sessionPosted);
    for (const comment of comments) {
      if (comment.posted) fingerprints.add(comment.fingerprint);
    }
    return fingerprints;
  }, [comments, sessionPosted]);

  const pending = useMemo(
    () => comments.filter((comment) => !posted.has(comment.fingerprint)),
    [comments, posted]
  );

  const pendingKey = pending.map((comment) => comment.fingerprint).join("\n");
  const busy = postingFingerprints.size > 0;

  useEffect(() => {
    setSelected(new Set(pending.map((comment) => comment.fingerprint)));
  }, [pendingKey]);

  const selectedPending = pending.filter((comment) => selected.has(comment.fingerprint));
  const allSelected = pending.length > 0 && selectedPending.length === pending.length;

  function toggle(fingerprint: string): void {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(fingerprint)) next.delete(fingerprint);
      else next.add(fingerprint);
      return next;
    });
  }

  function setRowError(fingerprint: string, message: string): void {
    setRowErrors((previous) => new Map(previous).set(fingerprint, message));
  }

  function clearRowError(fingerprint: string): void {
    setRowErrors((previous) => {
      if (!previous.has(fingerprint)) return previous;
      const next = new Map(previous);
      next.delete(fingerprint);
      return next;
    });
  }

  async function postComments(subset: readonly PendingCommentView[]): Promise<void> {
    if (target === null || subset.length === 0) return;
    const fingerprints = subset.map((comment) => comment.fingerprint);
    setPostingFingerprints((previous) => new Set([...previous, ...fingerprints]));
    setError(null);
    if (subset.length === 1) clearRowError(subset[0].fingerprint);
    try {
      const response = await fetch("/api/review/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          ...target,
          comments: subset,
        } satisfies PostCommentsInput),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `Failed to post comments (HTTP ${response.status}).`);
      }
      const postedResult = (await response.json()) as PostCommentsResult;
      if (subset.length > 1) setResult(postedResult);
      setSessionPosted((previous) => {
        const next = new Set(previous);
        for (const fingerprint of postedResult.postedFingerprints) next.add(fingerprint);
        return next;
      });
      if (subset.length === 1 && postedResult.commentErrors.length > 0) {
        setRowError(subset[0].fingerprint, postedResult.commentErrors.join(" "));
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (subset.length === 1) setRowError(subset[0].fingerprint, message);
      else setError(message);
    } finally {
      setPostingFingerprints((previous) => {
        const next = new Set(previous);
        for (const fingerprint of fingerprints) next.delete(fingerprint);
        return next;
      });
    }
  }

  return {
    pending,
    selectedPending,
    allSelected,
    busy,
    targetReady: target !== null,
    result,
    error,
    isPosted: (fingerprint) => posted.has(fingerprint),
    isSelected: (fingerprint) => selected.has(fingerprint),
    isPosting: (fingerprint) => postingFingerprints.has(fingerprint),
    rowError: (fingerprint) => rowErrors.get(fingerprint),
    toggle,
    selectAll: () => setSelected(new Set(pending.map((comment) => comment.fingerprint))),
    clearSelection: () => setSelected(new Set()),
    postOne: (comment) => void postComments([comment]),
    postSelected: () => void postComments(selectedPending),
  };
}
