import {
  Alert,
  Code,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { PageHeader } from "../components/PageHeader.js";
import { getLiveStats } from "../server/stats.functions.js";

const WINDOWS = [7, 30, 90] as const;
const DEFAULT_DAYS = 30;

export const Route = createFileRoute("/stats")({
  validateSearch: (search: Record<string, unknown>): { days: number } => ({
    days: WINDOWS.find((days) => days === Number(search.days)) ?? DEFAULT_DAYS,
  }),
  loaderDeps: ({ search }) => ({ days: search.days }),
  staleTime: 60_000,
  preloadStaleTime: 60_000,
  loader: ({ deps }) => getLiveStats({ data: { days: deps.days } }),
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

function StatsPage() {
  const result = Route.useLoaderData();
  const { days } = Route.useSearch();
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
          <SegmentedControl
            value={String(days)}
            onChange={(value) => void navigate({ search: { days: Number(value) } })}
            data={WINDOWS.map((window) => ({ label: `${window}d`, value: String(window) }))}
          />
        }
      />

      {!result.ok ? (
        <Alert title="Could not load live stats" color="red">
          {result.error} Check the <Link to="/config">configuration</Link> for the platform token
          and repository.
        </Alert>
      ) : (
        <LiveStats stats={result.stats} days={days} />
      )}
    </Stack>
  );
}

function LiveStats({
  stats,
  days,
}: {
  stats: Extract<Awaited<ReturnType<typeof getLiveStats>>, { ok: true }>["stats"];
  days: number;
}) {
  return (
    <>
      <Text size="sm" c="dimmed">
        <Code>{stats.project}</Code> on {stats.platform}, PRs from the last {days} days.
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
