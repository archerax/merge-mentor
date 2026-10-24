import { Alert, Code, Paper, SimpleGrid, Stack, Table, Text } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "../components/PageHeader.js";
import { getAuditStats } from "../server/audit.functions.js";

export const Route = createFileRoute("/stats")({
  loader: () => getAuditStats(),
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
  const stats = Route.useLoaderData();
  const { comments } = stats;

  return (
    <Stack gap="lg">
      <PageHeader
        title="Stats"
        description={
          <>
            Pull requests reviewed and comments posted, derived from the audit events in{" "}
            <Code>.mergementor/logs</Code>.
          </>
        }
      />

      {stats.reviewRuns === 0 && comments.total === 0 ? (
        <Alert title="No review activity found" color="gray">
          Run a review with the Merge Mentor CLI to generate audit logs, then reload this page.
        </Alert>
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
            <StatTile label="PRs reviewed" value={stats.prsReviewed} />
            <StatTile label="Review runs" value={stats.reviewRuns} />
            <StatTile label="Files reviewed" value={stats.filesReviewed} />
            <StatTile
              label="Comments posted"
              value={comments.total}
              hint={`${comments.inline} inline, ${comments.replies} replies, ${comments.general} general${comments.failed > 0 ? `, ${comments.failed} failed` : ""}`}
            />
          </SimpleGrid>

          <Table fz="sm" striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Platform</Table.Th>
                <Table.Th>PRs reviewed</Table.Th>
                <Table.Th>Review runs</Table.Th>
                <Table.Th>Comments posted</Table.Th>
                <Table.Th>Comments failed</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {stats.byPlatform.map((p) => (
                <Table.Tr key={p.platform}>
                  <Table.Td>{p.platform}</Table.Td>
                  <Table.Td>{p.prsReviewed}</Table.Td>
                  <Table.Td>{p.reviewRuns}</Table.Td>
                  <Table.Td>{p.comments.total}</Table.Td>
                  <Table.Td>{p.comments.failed}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}
    </Stack>
  );
}
