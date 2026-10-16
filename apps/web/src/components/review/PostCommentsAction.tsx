import { Alert, Button, Card, Group, ScrollArea, Stack, Text, Title } from "@mantine/core";
import { IconSend } from "@tabler/icons-react";

import type { PendingCommentView, PostCommentsInput } from "../../server/review.types.js";
import { PostableCommentRow } from "./commentView.js";
import { type PostTarget, usePostComments } from "./usePostComments.js";

interface PostCommentsActionProps {
  /** Which review kind produced the planned comments. */
  readonly kind: PostCommentsInput["kind"];
  /** Original stream input, used to resolve the target server-side. */
  readonly target: PostTarget | null;
  /** Comments a dry-run planned to post, with fingerprint and posted state. */
  readonly comments: readonly PendingCommentView[];
}

/**
 * Posts a selected subset of the comments a dry-run review planned.
 *
 * Used by work item reviews, where the planned comment is a single report with
 * no finding cards to attach controls to. PR reviews render findings as
 * postable cards instead, sharing the same {@link usePostComments} controller.
 */
export function PostCommentsAction({ kind, target, comments }: PostCommentsActionProps) {
  const controller = usePostComments(kind, target, comments);

  if (comments.length === 0) return null;

  const { pending, selectedPending } = controller;

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
                disabled={controller.allSelected || controller.busy}
                onClick={controller.selectAll}
              >
                Select all
              </Button>
              <Button
                size="xs"
                variant="subtle"
                disabled={selectedPending.length === 0 || controller.busy}
                onClick={controller.clearSelection}
              >
                Clear
              </Button>
            </Group>
          )}
        </Group>

        <ScrollArea.Autosize mah={360} type="auto">
          <Stack gap="xs">
            {comments.map((comment) => (
              <PostableCommentRow
                key={comment.fingerprint}
                comment={comment}
                controller={controller}
              />
            ))}
          </Stack>
        </ScrollArea.Autosize>

        {controller.result && (
          <Alert
            color={controller.result.commentErrors.length > 0 ? "yellow" : "green"}
            title={
              controller.result.commentErrors.length > 0
                ? "Comments partially posted"
                : "Comments posted"
            }
          >
            <Stack gap={2}>
              <Text size="sm">
                {controller.result.commentsCreated} comment
                {controller.result.commentsCreated === 1 ? "" : "s"} posted.
                {controller.result.commentsSkipped > 0
                  ? ` ${controller.result.commentsSkipped} already posted, skipped.`
                  : ""}
              </Text>
              {controller.result.commentErrors.map((message) => (
                <Text key={message} size="sm" c="dimmed">
                  {message}
                </Text>
              ))}
            </Stack>
          </Alert>
        )}

        {controller.error && (
          <Text size="sm" c="red">
            {controller.error}
          </Text>
        )}

        {pending.length > 0 && (
          <Group>
            <Button
              leftSection={<IconSend size={16} />}
              onClick={controller.postSelected}
              loading={controller.busy}
              disabled={controller.busy || !controller.targetReady || selectedPending.length === 0}
            >
              Post {selectedPending.length} comment{selectedPending.length === 1 ? "" : "s"}
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  );
}
