import { Code, Stack } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "../components/PageHeader.js";
import { ReviewRunner } from "../components/ReviewRunner.js";

export const Route = createFileRoute("/review")({
  validateSearch: (search: Record<string, unknown>): { run?: string } => ({
    run: typeof search.run === "string" && search.run.length > 0 ? search.run : undefined,
  }),
  component: ReviewPage,
});

function ReviewPage() {
  const { run } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <Stack gap="lg">
      <PageHeader
        title="PR Review"
        description={
          <>
            Trigger a review and follow structured progress as the AI works, then read the formatted
            findings. Post comments during the run with write mode, or post the planned comments
            after a dry-run; use <Code>.mergementor/reports</Code> for saved reports.
          </>
        }
      />

      <ReviewRunner
        runId={run}
        onRunCreated={(runId) =>
          navigate({ search: (previous) => ({ ...previous, run: runId }), replace: true })
        }
      />
    </Stack>
  );
}
