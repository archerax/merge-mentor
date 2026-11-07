import {
  Alert,
  Button,
  Checkbox,
  Code,
  Group,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import type { OutcomeCounts, OutcomeStats } from "@merge-mentor/core/review/outcomes/types.js";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { PageHeader } from "../components/PageHeader.js";
import { PageSkeleton } from "../components/PageSkeleton.js";
import { outcomesQuery, startOutcomesMutation } from "../queries/outcomes.js";

export const Route = createFileRoute("/outcomes")({
  loader: ({ context }) => context.queryClient.ensureQueryData(outcomesQuery),
  pendingComponent: () => <PageSkeleton tiles={4} rows={4} />,
  component: OutcomesPage,
});

function percent(rate: number | null): string {
  return rate === null ? "n/a" : `${Math.round(rate * 100)}%`;
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Paper withBorder radius="md" p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text fz={32} fw={700} lh={1.2}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Paper>
  );
}

function Breakdown({ title, rows }: { title: string; rows: readonly [string, OutcomeCounts][] }) {
  if (rows.length === 0) return null;
  return (
    <Stack gap="xs">
      <Text fw={600}>{title}</Text>
      <Table fz="sm" striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{title.replace("By ", "")}</Table.Th>
            <Table.Th>Threads</Table.Th>
            <Table.Th>Resolved</Table.Th>
            <Table.Th>Left open</Table.Th>
            <Table.Th>In flight</Table.Th>
            <Table.Th>Resolution rate</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map(([name, c]) => (
            <Table.Tr key={name}>
              <Table.Td>{name}</Table.Td>
              <Table.Td>{c.total}</Table.Td>
              <Table.Td>{c.resolved}</Table.Td>
              <Table.Td>{c.openMerged + c.openClosed}</Table.Td>
              <Table.Td>{c.open}</Table.Td>
              <Table.Td>{percent(c.resolutionRate)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function Results({ stats }: { stats: OutcomeStats }) {
  return (
    <>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <StatTile
          label="PRs with comments"
          value={stats.prsWithComments.toLocaleString()}
          hint={`of ${stats.prsScanned.toLocaleString()} scanned`}
        />
        <StatTile label="Review threads" value={stats.total.toLocaleString()} />
        <StatTile
          label="Resolved"
          value={stats.resolved.toLocaleString()}
          hint={`${(stats.openMerged + stats.openClosed).toLocaleString()} left open, ${stats.open.toLocaleString()} in flight`}
        />
        <StatTile
          label="Resolution rate"
          value={percent(stats.resolutionRate)}
          hint="resolved / threads that reached an outcome"
        />
      </SimpleGrid>
      <Breakdown title="By category" rows={Object.entries(stats.byCategory)} />
      <Breakdown title="By severity" rows={Object.entries(stats.bySeverity)} />
      <Breakdown title="By month" rows={stats.byMonth.map((m) => [m.month, m])} />
    </>
  );
}

function OutcomesPage() {
  // Polls by itself while a scan is running (see outcomesQuery).
  const { data: result } = useSuspenseQuery(outcomesQuery);
  const start = useMutation(startOutcomesMutation);
  const [refresh, setRefresh] = useState(false);
  const running = result.ok && result.view.scan.running;

  const view = result.ok ? result.view : undefined;
  const scan = view?.scan;

  return (
    <Stack gap="lg">
      <PageHeader
        title="Outcomes"
        description={
          <>
            What became of the review threads Merge Mentor started on pull requests from the last 12
            months: resolved, or left open. The numbers are shown for you to judge; nothing here
            changes how reviews are done.
          </>
        }
        actions={
          <Group>
            <Checkbox
              label="Rescan everything"
              checked={refresh}
              onChange={(event) => setRefresh(event.currentTarget.checked)}
              disabled={running}
            />
            <Button
              onClick={() => start.mutate(refresh)}
              loading={start.isPending || running}
              disabled={!result.ok}
            >
              {view?.cached ? "Rescan" : "Scan last 12 months"}
            </Button>
          </Group>
        }
      />

      {!result.ok && (
        <Alert title="Could not load outcomes" color="red">
          {result.error} Check the <Link to="/config">configuration</Link> for the platform token
          and repository.
        </Alert>
      )}

      {start.error && (
        <Alert title="Could not start the scan" color="red">
          {start.error.message}
        </Alert>
      )}

      {running && scan && (
        <Stack gap={4}>
          <Text size="sm">
            Scanning pull requests
            {scan.total > 0 ? `: ${scan.done} of ${scan.total}` : "..."}
          </Text>
          <Progress value={scan.total > 0 ? (scan.done / scan.total) * 100 : 0} animated />
        </Stack>
      )}

      {scan?.error && (
        <Alert title="The last scan failed" color="red">
          {scan.error}
        </Alert>
      )}
      {scan?.lastRun && scan.lastRun.prsFailed > 0 && (
        <Alert title="Some PRs could not be read" color="yellow">
          {scan.lastRun.prsFailed} PR(s) were left out because their comments could not be fetched.
        </Alert>
      )}
      {scan?.lastRun?.truncated && (
        <Alert title="PR limit reached" color="yellow">
          Only the most recent 1000 PRs were scanned. Use <Code>merge-mentor outcomes --since</Code>{" "}
          for a shorter window.
        </Alert>
      )}

      {view && !view.cached && !running && (
        <Alert color="blue" title="Not scanned yet">
          Scanning reads every pull request from the last 12 months, so the first scan can take a
          few minutes. Later scans only revisit PRs that changed.
        </Alert>
      )}

      {view?.cached && (
        <>
          <Text size="sm" c="dimmed">
            <Code>{view.cached.project}</Code> on {view.cached.platform}, last scanned{" "}
            {new Date(view.cached.generatedAt).toLocaleString()}.
            {view.cached.platform === "azure" &&
              " Azure DevOps can only filter by PR creation date, so older PRs that were active in the window are not included."}
          </Text>
          <Results stats={view.cached.stats} />
        </>
      )}
    </Stack>
  );
}
