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
            Trigger a review and watch raw output stream in live. Comments are not posted unless
            write mode is enabled; use <Code>.mergementor/reports</Code> for saved reports.
          </>
        }
      />

      <ReviewRunner />
    </Stack>
  );
}
