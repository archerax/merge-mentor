import { Stack } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "../components/PageHeader.js";
import { PrdReviewRunner } from "../components/PrdReviewRunner.js";

export const Route = createFileRoute("/prd")({
  validateSearch: (search: Record<string, unknown>): { run?: string; breakdown?: string } => ({
    run: typeof search.run === "string" && search.run.length > 0 ? search.run : undefined,
    breakdown:
      typeof search.breakdown === "string" && search.breakdown.length > 0
        ? search.breakdown
        : undefined,
  }),
  component: PrdPage,
});

function PrdPage() {
  const { run, breakdown } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <Stack gap="lg">
      <PageHeader
        title="PRD / FRD Review"
        description="Get a first-pass review of a product (PRD) or functional (FRD) requirements document before development starts. Upload the Word file and Merge Mentor points out gaps, unclear wording, and requirements that are hard to test, with a suggested fix for each. Then break the document down into an ordered backlog of epics, features and PBIs."
      />

      <PrdReviewRunner
        runId={run}
        // A new review starts without the breakdown of the previous one.
        onRunCreated={(runId) =>
          navigate({
            search: (previous) => ({ ...previous, run: runId, breakdown: undefined }),
            replace: true,
          })
        }
        breakdownRunId={breakdown}
        onBreakdownRunCreated={(breakdownId) =>
          navigate({
            search: (previous) => ({ ...previous, breakdown: breakdownId }),
            replace: true,
          })
        }
      />
    </Stack>
  );
}
