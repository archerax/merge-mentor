import { Code, Stack } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "../components/PageHeader.js";
import { PBIReviewResult, WorkItemReviewRunner } from "../components/WorkItemReviewRunner.js";
import type { PBIReviewSummary } from "../server/review.types.js";

export const Route = createFileRoute("/pbi")({
  validateSearch: (search: Record<string, unknown>): { run?: string } => ({
    run: typeof search.run === "string" && search.run.length > 0 ? search.run : undefined,
  }),
  component: PBIPage,
});

function PBIPage() {
  const { run } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <Stack gap="lg">
      <PageHeader
        title="PBI Review"
        description={
          <>
            Review a Product Backlog Item, user story, or issue for backlog quality. Paste a work
            item URL or enter an ID; post the review during the run or after a dry-run. Reports are
            saved to <Code>.mergementor/reports</Code>.
          </>
        }
      />

      <WorkItemReviewRunner<PBIReviewSummary>
        endpoint="/api/pbi/stream"
        kind="pbi"
        inputLabel="Work item"
        placeholder="https://dev.azure.com/org/project/_workitems/edit/12345 or PBI-55"
        writeLabel="Post comments to the work item"
        writeDescription="Off runs a dry-run; you can still post the review afterwards."
        actionLabel="Run PBI review"
        runId={run}
        onRunCreated={(runId) =>
          navigate({ search: (previous) => ({ ...previous, run: runId }), replace: true })
        }
        renderResult={(summary) => <PBIReviewResult summary={summary} />}
      />
    </Stack>
  );
}
