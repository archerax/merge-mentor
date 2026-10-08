import { Code, Stack, Text, Title } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

import { ProjectReviewResult, WorkItemReviewRunner } from "../components/WorkItemReviewRunner.js";
import type { ProjectReviewSummary } from "../server/review.types.js";

export const Route = createFileRoute("/project")({
  component: ProjectPage,
});

function ProjectPage() {
  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Interactive Project Review</Title>
        <Text c="dimmed">
          Review a project or feature plan hierarchy for planning quality. Paste a work item URL or
          enter an ID; comments are not posted unless write mode is enabled. Reports are saved to{" "}
          <Code>.mergementor/reports</Code>.
        </Text>
      </div>

      <WorkItemReviewRunner<ProjectReviewSummary>
        endpoint="/api/project/stream"
        inputLabel="Project root"
        placeholder="https://dev.azure.com/org/project/_workitems/edit/100 or 100"
        writeLabel="Post comments to the project root"
        writeDescription="Off runs a dry-run and only reports what would be posted."
        actionLabel="Run project review"
        renderResult={(summary) => <ProjectReviewResult summary={summary} />}
      />
    </Stack>
  );
}
