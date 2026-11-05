import { Alert, Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { IconListTree } from "@tabler/icons-react";

import {
  PRD_BREAKDOWN_ENDPOINT,
  type PrdBreakdownRunInput,
  type PrdBreakdownSummary,
  type PrdReviewSummary,
} from "../server/prd.types.js";
import { PrdBreakdownResult } from "./PrdBreakdownResult.js";
import { LiveThinking } from "./review/LiveThinking.js";
import { ProgressTimeline } from "./review/ProgressTimeline.js";
import { useReviewStream } from "./review/useReviewStream.js";

interface PrdBreakdownPanelProps {
  /** The finished review whose document is broken down. */
  readonly review: PrdReviewSummary;
  /** Breakdown run id from the URL, re-attached on mount to resume a run. */
  readonly breakdownRunId?: string;
  /** Called with the new run id so the page can persist it in the URL. */
  readonly onBreakdownRunCreated?: (runId: string) => void;
}

/**
 * Offers to break a reviewed document down into epics, features and PBIs, runs
 * the breakdown with live progress, and shows the result as a tree. The
 * Markdown is saved next to the review and can be downloaded.
 */
export function PrdBreakdownPanel({
  review,
  breakdownRunId,
  onBreakdownRunCreated,
}: PrdBreakdownPanelProps) {
  const { run, stop, running, phases, steps, activity, live, summary, error, elapsedMs } =
    useReviewStream<PrdBreakdownSummary>({
      endpoint: PRD_BREAKDOWN_ENDPOINT,
      runId: breakdownRunId,
      onRunCreated: onBreakdownRunCreated,
    });

  const blocked = review.report.readiness.verdict === "not-ready";
  const started = running || summary !== null || error !== null || phases.length > 0;

  async function start(force: boolean) {
    const input: PrdBreakdownRunInput = { mode: "breakdown", prdRunId: review.prdRunId, force };
    await run(input);
  }

  return (
    <Stack gap="lg">
      {!started && (
        <Card withBorder padding="lg" radius="md">
          <Stack gap="sm">
            <Title order={4}>Break it down into work items</Title>
            <Text size="sm" c="dimmed">
              Turn this document into an ordered backlog of epics, features and product backlog
              items (PBIs), with acceptance criteria and dependencies. The result is a first draft
              you can download as Markdown and refine.
            </Text>
            {blocked && (
              <Alert variant="light" color="red" title="The review found blockers">
                A breakdown built on a document with blockers will contain gaps. It is better to fix
                the blockers first.
              </Alert>
            )}
            <Group>
              <Button
                leftSection={<IconListTree size={16} />}
                onClick={() => start(false)}
                disabled={blocked}
              >
                Break down into work items
              </Button>
              {blocked && (
                <Button variant="default" onClick={() => start(true)}>
                  Break down anyway
                </Button>
              )}
            </Group>
          </Stack>
        </Card>
      )}

      {running && (
        <Group>
          <Button
            variant="default"
            onClick={stop}
            title="Detach from this run — the breakdown keeps running on the server and resumes if you reload."
          >
            Stop watching
          </Button>
        </Group>
      )}

      {error && (
        <Alert title="The work breakdown could not be completed" color="red">
          <Stack gap="xs">
            <Text size="sm">{error}</Text>
            {!running && (
              <Group>
                <Button size="xs" variant="default" onClick={() => start(blocked)}>
                  Try again
                </Button>
              </Group>
            )}
          </Stack>
        </Alert>
      )}

      <ProgressTimeline
        phases={phases}
        steps={steps}
        activity={activity}
        elapsedMs={elapsedMs}
        running={running}
      />

      <LiveThinking live={live} running={running} />

      {summary && <PrdBreakdownResult summary={summary} />}
    </Stack>
  );
}
