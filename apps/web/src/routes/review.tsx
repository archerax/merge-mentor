import { Code, Stack, Text, Title } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

import { ReviewRunner } from "../components/ReviewRunner.js";

export const Route = createFileRoute("/review")({
  component: ReviewPage,
});

function ReviewPage() {
  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Interactive PR Review</Title>
        <Text c="dimmed">
          Trigger a review and watch raw output stream in live. Comments are not posted unless write
          mode is enabled; use <Code>.mergementor/reports</Code> for saved reports.
        </Text>
      </div>

      <ReviewRunner />
    </Stack>
  );
}
