import { Code, Stack, Text, Title } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

import { PBIReviewResult, WorkItemReviewRunner } from "../components/WorkItemReviewRunner.js";
import type { PBIReviewSummary } from "../server/review.types.js";

export const Route = createFileRoute("/pbi")({
  component: PBIPage,
});

function PBIPage() {
  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Interactive PBI Review</Title>
        <Text c="dimmed">
          Review a Product Backlog Item, user story, or issue for backlog quality. Paste a work item
          URL or enter an ID; comments are not posted unless write mode is enabled. Reports are
          saved to <Code>.mergementor/reports</Code>.
        </Text>
      </div>

      <WorkItemReviewRunner<PBIReviewSummary>
        endpoint="/api/pbi/stream"
        inputLabel="Work item"
        placeholder="https://dev.azure.com/org/project/_workitems/edit/12345 or PBI-55"
        writeLabel="Post comments to the work item"
        writeDescription="Off runs a dry-run and only reports what would be posted."
        actionLabel="Run PBI review"
        renderResult={(summary) => <PBIReviewResult summary={summary} />}
      />
    </Stack>
  );
}
