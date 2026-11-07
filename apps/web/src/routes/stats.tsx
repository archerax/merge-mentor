import {
  Alert,
  Button,
  Code,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { PageHeader } from "../components/PageHeader.js";
import { PageSkeleton } from "../components/PageSkeleton.js";
import { statsQuery } from "../queries/stats.js";
import type { LiveStatsResult } from "../server/stats.functions.js";

const WINDOWS = [7, 30, 90] as const;
const DEFAULT_DAYS = 30;

export const Route = createFileRoute("/stats")({
  validateSearch: (search: Record<string, unknown>): { days: number } => ({
    days: WINDOWS.find((days) => days === Number(search.days)) ?? DEFAULT_DAYS,
  }),
  loaderDeps: ({ search }) => ({ days: search.days }),
  loader: async ({ deps, context, cause }) => {
    const stats = context.queryClient.prefetchQuery(statsQuery(deps.days));
    // Entering the page (and SSR) waits for the data. Switching the window on the
    // page does not: the page keeps showing the previous window until the new one
    // arrives, instead of a pending screen.
    if (cause !== "stay") await stats;
  },
  pendingComponent: () => <PageSkeleton tiles={3} rows={4} />,
  component: StatsPage,
});

function StatTile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Paper withBorder radius="md" p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text fz={32} fw={700} lh={1.2}>
        {value.toLocaleString()}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Paper>
  );
}

/** Shown beside the window picker while the chosen window loads. */
function UpdatingIndicator({ days }: { days: number }) {
  return (
    <Group gap={6} wrap="nowrap" role="status" aria-live="polite">
      <Loader size="xs" />
      <Text size="sm" c="dimmed">
        Loading {days}d
      </Text>
    </Group>
  );
}

function StatsPage() {
  const { days } = Route.useSearch();
  // `useQuery` rather than `useSuspenseQuery`: suspense would ignore placeholder
  // data and blank the page on every window change. A failed load is shown
  // inline (with a retry) so the numbers already on screen survive it.
  const {
    data: result,
    error: loadError,
    isError,
    isPlaceholderData,
    refetch,
  } = useQuery(statsQuery(days));
  const navigate = useNavigate({ from: "/stats" });

  return (
    <Stack gap="lg">
      <PageHeader
        title="Stats"
        description={
          <>
            Live counts from the pull requests in the configured repository: PRs carrying a Merge
            Mentor comment, and the comments it has posted.
          </>
        }
        actions={
          <Group gap="sm" wrap="nowrap">
            {isPlaceholderData && <UpdatingIndicator days={days} />}
            <SegmentedControl
              value={String(days)}
              onChange={(value) => void navigate({ search: { days: Number(value) } })}
              data={WINDOWS.map((window) => ({ label: `${window}d`, value: String(window) }))}
            />
          </Group>
        }
      />

      {isError && (
        <Alert title="Could not load stats" color="red">
          {loadError.message}{" "}
          <Button variant="light" color="red" size="compact-xs" onClick={() => void refetch()}>
            Try again
          </Button>
        </Alert>
      )}

      {result === undefined ? (
        isError ? null : (
          <Skeleton h={160} />
        )
      ) : !result.ok ? (
        <Alert title="Could not load live stats" color="red">
          {result.error} Check the <Link to="/config">configuration</Link> for the platform token
          and repository.
        </Alert>
      ) : (
        // The previous window's totals, dimmed, until the chosen window arrives.
        <Stack
          gap="lg"
          aria-busy={isPlaceholderData}
          style={{ opacity: isPlaceholderData ? 0.6 : 1, transition: "opacity 150ms" }}
        >
          <LiveStats stats={result.stats} days={days} updating={isPlaceholderData} />
        </Stack>
      )}
    </Stack>
  );
}

function LiveStats({
  stats,
  days,
  updating,
}: {
  stats: Extract<LiveStatsResult, { ok: true }>["stats"];
  days: number;
  updating: boolean;
}) {
  return (
    <>
      <Text size="sm" c="dimmed">
        <Code>{stats.project}</Code> on {stats.platform},{" "}
        {updating
          ? `previous window shown while the last ${days} days load.`
          : `PRs from the last ${days} days.`}
      </Text>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <StatTile label="PRs scanned" value={stats.prsScanned} />
        <StatTile label="PRs reviewed" value={stats.prsReviewed} />
        <StatTile
          label="Comments posted"
          value={stats.totalComments}
          hint={`${stats.inlineComments} inline, ${stats.generalComments} general`}
        />
      </SimpleGrid>

      {stats.truncated && (
        <Alert color="yellow" title="PR limit reached">
          Only the {stats.prsScanned} most recent PRs were inspected. Choose a shorter window, or
          use <Code>merge-mentor stats --limit</Code> for a larger scan.
        </Alert>
      )}
      {stats.prsFailed > 0 && (
        <Alert color="yellow" title="Some PRs could not be read">
          {stats.prsFailed} PR(s) were excluded from the totals because their comments could not be
          fetched.
        </Alert>
      )}

      {stats.reviewedPullRequests.length > 0 && (
        <Table fz="sm" striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>PR</Table.Th>
              <Table.Th>Title</Table.Th>
              <Table.Th>State</Table.Th>
              <Table.Th>Inline</Table.Th>
              <Table.Th>General</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {stats.reviewedPullRequests.map((pr) => (
              <Table.Tr key={pr.number}>
                <Table.Td>#{pr.number}</Table.Td>
                <Table.Td>{pr.title}</Table.Td>
                <Table.Td>{pr.state}</Table.Td>
                <Table.Td>{pr.inlineComments}</Table.Td>
                <Table.Td>{pr.generalComments}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </>
  );
}
