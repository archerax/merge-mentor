import { Code, Stack } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "../components/PageHeader.js";
import { ReviewRunner } from "../components/ReviewRunner.js";

export const Route = createFileRoute("/review")({
  component: ReviewPage,
});

function ReviewPage() {
  return (
    <Stack gap="lg">
      <PageHeader
        title="Interactive PR Review"
        description={
          <>
            Trigger a review and follow structured progress as the AI works, then read the formatted
            findings. Post comments during the run with write mode, or post the planned comments
            after a dry-run; use <Code>.mergementor/reports</Code> for saved reports.
          </>
        }
      />

      <ReviewRunner />
    </Stack>
  );
}
