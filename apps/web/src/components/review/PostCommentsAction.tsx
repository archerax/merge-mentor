import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  ScrollArea,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconSend } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import type {
  PendingCommentView,
  PostCommentsInput,
  PostCommentsResult,
} from "../../server/review.types.js";

/** Target fields carried over from the original stream input. */
type PostTarget = Omit<PostCommentsInput, "kind" | "comments">;

interface PostCommentsActionProps {
  /** Which review kind produced the planned comments. */
  readonly kind: PostCommentsInput["kind"];
  /** Original stream input, used to resolve the target server-side. */
  readonly target: PostTarget | null;
  /** Comments a dry-run planned to post, with fingerprint and posted state. */
  readonly comments: readonly PendingCommentView[];
}

/** Short human-readable location for a planned comment. */
function commentLocation(comment: PendingCommentView): string {
  if (comment.path) {
    if (comment.line === undefined) return comment.path;
    return comment.startLine !== undefined && comment.startLine !== comment.line
      ? `${comment.path}:${comment.startLine}-${comment.line}`
      : `${comment.path}:${comment.line}`;
  }
  return comment.existingCommentId !== undefined
    ? `Work item comment (updates #${comment.existingCommentId})`
    : "Work item comment";
}

/** Collapses a comment body into a single-line preview. */
function commentPreview(body: string): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  return collapsed.length > 180 ? `${collapsed.slice(0, 177)}…` : collapsed;
}

/**
 * Posts a selected subset of the comments a dry-run review planned.
 *
 * The planned payload is round-tripped to the stateless post endpoint, so no
 * review or AI work is repeated. Already-posted comments (marked by the server
 * from a durable per-comment fingerprint) are shown disabled and excluded from
 * the batch, making repeated posts idempotent across re-renders and reloads.
 */
export function PostCommentsAction({ kind, target, comments }: PostCommentsActionProps) {
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

  if (comments.length === 0) return null;

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

  function handlePost(): void {
    void postComments(selectedPending);
  }

  function handlePostOne(comment: PendingCommentView): void {
    void postComments([comment]);
  }

  return (
    <Card withBorder padding="lg" radius="md">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={5}>Post planned comments</Title>
            <Text size="sm" c="dimmed">
              {pending.length === 0
                ? "All planned comments have been posted."
                : `Select from the ${pending.length} planned comment${
                    pending.length === 1 ? "" : "s"
                  } to post in a batch, or post one individually with its button.`}
            </Text>
          </div>
          {pending.length > 0 && (
            <Group gap="xs">
              <Button
                size="xs"
                variant="subtle"
                disabled={allSelected || busy}
                onClick={() => setSelected(new Set(pending.map((comment) => comment.fingerprint)))}
              >
                Select all
              </Button>
              <Button
                size="xs"
                variant="subtle"
                disabled={selectedPending.length === 0 || busy}
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
            </Group>
          )}
        </Group>

        <ScrollArea.Autosize mah={360} type="auto">
          <Stack gap="xs">
            {comments.map((comment) => {
              const isPosted = posted.has(comment.fingerprint);
              const rowError = rowErrors.get(comment.fingerprint);
              return (
                <Stack key={comment.fingerprint} gap={4}>
                  <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
                    <Checkbox
                      style={{ flex: 1 }}
                      checked={isPosted || selected.has(comment.fingerprint)}
                      disabled={isPosted || busy}
                      onChange={() => toggle(comment.fingerprint)}
                      label={
                        <Group gap="xs">
                          <Text size="sm" fw={500}>
                            {commentLocation(comment)}
                          </Text>
                          {isPosted && (
                            <Badge color="green" variant="light" size="sm">
                              posted
                            </Badge>
                          )}
                        </Group>
                      }
                      description={commentPreview(comment.body)}
                    />
                    {!isPosted && (
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconSend size={14} />}
                        loading={postingFingerprints.has(comment.fingerprint)}
                        disabled={target === null || busy}
                        aria-label={`Post ${commentLocation(comment)}`}
                        onClick={() => handlePostOne(comment)}
                      >
                        Post
                      </Button>
                    )}
                  </Group>
                  {rowError && (
                    <Text size="xs" c="red">
                      {rowError}
                    </Text>
                  )}
                </Stack>
              );
            })}
          </Stack>
        </ScrollArea.Autosize>

        {result && (
          <Alert
            color={result.commentErrors.length > 0 ? "yellow" : "green"}
            title={
              result.commentErrors.length > 0 ? "Comments partially posted" : "Comments posted"
            }
          >
            <Stack gap={2}>
              <Text size="sm">
                {result.commentsCreated} comment{result.commentsCreated === 1 ? "" : "s"} posted.
                {result.commentsSkipped > 0
                  ? ` ${result.commentsSkipped} already posted, skipped.`
                  : ""}
              </Text>
              {result.commentErrors.map((message) => (
                <Text key={message} size="sm" c="dimmed">
                  {message}
                </Text>
              ))}
            </Stack>
          </Alert>
        )}

        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}

        {pending.length > 0 && (
          <Group>
            <Button
              leftSection={<IconSend size={16} />}
              onClick={handlePost}
              loading={busy}
              disabled={busy || target === null || selectedPending.length === 0}
            >
              Post {selectedPending.length} comment{selectedPending.length === 1 ? "" : "s"}
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  );
}
