import { Badge, Button, Checkbox, Group, Stack, Text } from "@mantine/core";
import { IconSend } from "@tabler/icons-react";

import type { PendingCommentView } from "../../server/review.types.js";
import type { PostCommentsController } from "./usePostComments.js";

/** Short human-readable location for a planned comment. */
export function commentLocation(comment: PendingCommentView): string {
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

interface PostableCommentRowProps {
  readonly comment: PendingCommentView;
  readonly controller: PostCommentsController;
}

/** A single planned comment with its selection checkbox and Post button. */
export function PostableCommentRow({ comment, controller }: PostableCommentRowProps) {
  const isPosted = controller.isPosted(comment.fingerprint);
  const rowError = controller.rowError(comment.fingerprint);

  return (
    <Stack gap={4}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
        <Checkbox
          style={{ flex: 1 }}
          checked={isPosted || controller.isSelected(comment.fingerprint)}
          disabled={isPosted || controller.busy}
          onChange={() => controller.toggle(comment.fingerprint)}
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
            loading={controller.isPosting(comment.fingerprint)}
            disabled={!controller.targetReady || controller.busy}
            aria-label={`Post ${commentLocation(comment)}`}
            onClick={() => controller.postOne(comment)}
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
}
