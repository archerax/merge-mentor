import { mutationOptions, queryOptions } from "@tanstack/react-query";

import type {
  PendingCommentView,
  PostCommentsInput,
  PostCommentsResult,
} from "../server/review.types.js";
import type { RunSnapshot } from "../server/reviewRuns.server.js";

const reviewRunKeys = {
  all: ["reviewRuns"] as const,
  detail: (runId: string) => [...reviewRunKeys.all, "detail", runId] as const,
};

/** Reads a run's manifest and summary; `null` when the server does not know the run. */
async function fetchRun(runId: string): Promise<RunSnapshot | null> {
  const response = await fetch(`/api/review/runs/${encodeURIComponent(runId)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Review run lookup failed (HTTP ${response.status}).`);
  return (await response.json()) as RunSnapshot;
}

/**
 * One review run's stored status, original input and summary, without
 * streaming. `null` for an unknown or cleaned-up run.
 */
export function runQuery(runId: string) {
  return queryOptions({
    queryKey: reviewRunKeys.detail(runId),
    queryFn: () => fetchRun(runId),
  });
}

/** The original input a run was started with, or `null` when it is not known. */
export function runInputOf(snapshot: RunSnapshot | null | undefined): unknown {
  return snapshot?.manifest?.input ?? null;
}

/** What {@link postCommentsMutation} posts: the comments and the target they belong to. */
export interface PostCommentsVariables {
  readonly kind: PostCommentsInput["kind"];
  readonly target: Omit<PostCommentsInput, "kind" | "comments">;
  readonly comments: readonly PendingCommentView[];
}

/** Sends planned comments to the stateless post endpoint. */
async function postComments({
  kind,
  target,
  comments,
}: PostCommentsVariables): Promise<PostCommentsResult> {
  const response = await fetch("/api/review/post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, ...target, comments } satisfies PostCommentsInput),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Failed to post comments (HTTP ${response.status}).`);
  }
  return (await response.json()) as PostCommentsResult;
}

/**
 * Posts comments a dry-run review planned. No review or AI work is repeated.
 * Once posted, stored runs are re-read so their posted state stays current.
 * Every call shares this key, so the comments being posted can be read back
 * with `useMutationState`.
 */
export const postCommentsMutation = mutationOptions({
  mutationKey: [...reviewRunKeys.all, "postComments"] as const,
  mutationFn: postComments,
  onSuccess: (_result, _variables, _onMutateResult, { client }) => {
    // Not awaited: the post is done, and the re-read should not hold up the UI.
    void client.invalidateQueries({ queryKey: reviewRunKeys.all });
  },
});
