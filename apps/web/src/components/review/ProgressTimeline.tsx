import { Badge, Card, Divider, Group, Loader, Stack, Text, Timeline, Title } from "@mantine/core";
import { IconCircleCheck, IconCircleX } from "@tabler/icons-react";

import { formatClock, formatDuration } from "./format.js";
import type { ProgressPhaseView, ProgressStepView } from "./useReviewStream.js";

interface ProgressTimelineProps {
  readonly phases: readonly ProgressPhaseView[];
  readonly steps: readonly ProgressStepView[];
  readonly activity: string | null;
  readonly elapsedMs: number;
  readonly running: boolean;
}

/** Colored bullet reflecting a phase or step lifecycle status. */
function statusBullet(status: ProgressPhaseView["status"]): React.ReactNode {
  if (status === "done") return <IconCircleCheck size={15} />;
  if (status === "error") return <IconCircleX size={15} />;
  return <Loader size={11} />;
}

function statusColor(status: ProgressPhaseView["status"]): string {
  if (status === "done") return "teal";
  if (status === "error") return "red";
  return "brand";
}

function phaseSummary(phase: ProgressPhaseView): string {
  if (phase.status === "start") return "In progress…";
  if (phase.status === "error") return "Failed";
  const duration = phase.endedAt ? formatDuration(phase.endedAt - phase.startedAt) : "";
  return duration ? `Done in ${duration}` : "Done";
}

/**
 * Renders the structured phase timeline emitted by a review engine, plus the
 * per-subagent steps and the elapsed run timer.
 */
export function ProgressTimeline({
  phases,
  steps,
  activity,
  elapsedMs,
  running,
}: ProgressTimelineProps) {
  if (phases.length === 0 && !running) return null;

  const activeIndex = phases.reduce(
    (acc, phase, index) => (phase.status === "start" ? index : acc),
    phases.length
  );

  return (
    <Card padding="lg">
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={5}>Progress</Title>
          <Group gap="xs">
            <Text size="sm" c="dimmed" ff="monospace">
              {formatClock(elapsedMs)}
            </Text>
            {running && <Loader size="xs" />}
          </Group>
        </Group>

        {phases.length === 0 ? (
          <Group gap="sm">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Starting…
            </Text>
          </Group>
        ) : (
          <Timeline active={activeIndex} bulletSize={22} lineWidth={2} mt="xs">
            {phases.map((phase) => (
              <Timeline.Item
                key={phase.id}
                bullet={statusBullet(phase.status)}
                color={statusColor(phase.status)}
                title={phase.label}
              >
                <Text size="xs" c="dimmed">
                  {phaseSummary(phase)}
                </Text>
              </Timeline.Item>
            ))}
          </Timeline>
        )}

        {activity && (
          <Text size="sm" c="brand">
            {activity}
          </Text>
        )}

        {steps.length > 0 && (
          <>
            <Divider />
            <div>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                Subagents
              </Text>
              <Group gap="xs" mt={6}>
                {steps.map((step) => (
                  <Badge
                    key={step.id}
                    variant="light"
                    color={statusColor(step.status)}
                    leftSection={statusBullet(step.status)}
                    tt="none"
                  >
                    {step.label}
                    {step.detail ? ` · ${step.detail}` : ""}
                  </Badge>
                ))}
              </Group>
            </div>
          </>
        )}
      </Stack>
    </Card>
  );
}
