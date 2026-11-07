import { useMutation, useMutationState } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { postCommentsMutation, type PostCommentsVariables } from "../../queries/reviewRuns.js";
import type {
  PendingCommentView,
  PostCommentsInput,
  PostCommentsResult,
} from "../../server/review.types.js";

/** Target fields carried over from the original stream input. */
export type PostTarget = PostCommentsVariables["target"];

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
  const [rowErrors, setRowErrors] = useState<ReadonlyMap<string, string>>(new Map());
  // Batch posts report their result and error at the top; single-comment posts
  // report next to the comment, and several can be in flight at once.
  const batch = useMutation(postCommentsMutation);
  const single = useMutation(postCommentsMutation);
  const postingFingerprints = useMutationState({
    filters: { mutationKey: postCommentsMutation.mutationKey, status: "pending" },
    select: (mutation) =>
      (mutation.state.variables as PostCommentsVariables | undefined)?.comments ?? [],
  });
  const posting = useMemo(
    () => new Set(postingFingerprints.flat().map((comment) => comment.fingerprint)),
    [postingFingerprints]
  );

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
  const busy = posting.size > 0;

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

  function markPosted(postedResult: PostCommentsResult): void {
    setSessionPosted((previous) => {
      const next = new Set(previous);
      for (const fingerprint of postedResult.postedFingerprints) next.add(fingerprint);
      return next;
    });
  }

  function postComments(subset: readonly PendingCommentView[]): void {
    if (target === null || subset.length === 0) return;
    const variables: PostCommentsVariables = { kind, target, comments: subset };
    if (batch.isError) batch.reset();

    if (subset.length > 1) {
      batch.mutate(variables, { onSuccess: markPosted });
      return;
    }

    // `mutateAsync` settles per call, so each row hears about its own post even
    // when several are in flight (per-call `mutate` callbacks only fire for the latest).
    const [comment] = subset;
    clearRowError(comment.fingerprint);
    single.mutateAsync(variables).then(
      (postedResult) => {
        markPosted(postedResult);
        if (postedResult.commentErrors.length > 0) {
          setRowError(comment.fingerprint, postedResult.commentErrors.join(" "));
        }
      },
      (caught: unknown) => {
        setRowError(comment.fingerprint, caught instanceof Error ? caught.message : String(caught));
      }
    );
  }

  return {
    pending,
    selectedPending,
    allSelected,
    busy,
    targetReady: target !== null,
    result: batch.data ?? null,
    error: batch.error?.message ?? null,
    isPosted: (fingerprint) => posted.has(fingerprint),
    isSelected: (fingerprint) => selected.has(fingerprint),
    isPosting: (fingerprint) => posting.has(fingerprint),
    rowError: (fingerprint) => rowErrors.get(fingerprint),
    toggle,
    selectAll: () => setSelected(new Set(pending.map((comment) => comment.fingerprint))),
    clearSelection: () => setSelected(new Set()),
    postOne: (comment) => postComments([comment]),
    postSelected: () => postComments(selectedPending),
  };
}
