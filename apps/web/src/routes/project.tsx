import { Code, Stack } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "../components/PageHeader.js";
import { ProjectReviewResult, WorkItemReviewRunner } from "../components/WorkItemReviewRunner.js";
import type { ProjectReviewSummary } from "../server/review.types.js";

export const Route = createFileRoute("/project")({
  validateSearch: (search: Record<string, unknown>): { run?: string } => ({
    run: typeof search.run === "string" && search.run.length > 0 ? search.run : undefined,
  }),
  component: ProjectPage,
});

function ProjectPage() {
  const { run } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <Stack gap="lg">
      <PageHeader
        title="Project Review"
        description={
          <>
            Review a project or feature plan hierarchy for planning quality. Paste a work item URL
            or enter an ID; post the review during the run or after a dry-run. Reports are saved to{" "}
            <Code>.mergementor/reports</Code>.
          </>
        }
      />

      <WorkItemReviewRunner<ProjectReviewSummary>
        endpoint="/api/project/stream"
        kind="project"
        inputLabel="Project root"
        placeholder="https://dev.azure.com/org/project/_workitems/edit/100 or 100"
        writeLabel="Post comments to the project root"
        writeDescription="Off runs a dry-run; you can still post the review afterwards."
        actionLabel="Run project review"
        runId={run}
        onRunCreated={(runId) =>
          navigate({ search: (previous) => ({ ...previous, run: runId }), replace: true })
        }
        renderResult={(summary) => <ProjectReviewResult summary={summary} />}
      />
    </Stack>
  );
}
