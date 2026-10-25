import { Alert, Paper, SimpleGrid, Table, Text, Title } from "@mantine/core";
import type { UsageGroupTotals, UsageSummary } from "@merge-mentor/shared/reports/usageReport.js";
import {
  formatNanoAiuCost,
  nanoAiuToCredits,
  nanoAiuToUsd,
} from "@merge-mentor/shared/utils/aiCredits.js";

interface UsagePanelProps {
  readonly usage: UsageSummary;
  readonly days: number;
}

function tokens(group: UsageGroupTotals): number {
  return group.inputTokens + group.outputTokens + (group.reasoningTokens ?? 0);
}

function count(value: number | undefined): string {
  return value === undefined ? "not reported" : value.toLocaleString();
}

function UsageTile({
  label,
  value,
  hint,
  muted,
}: {
  label: string;
  value: string;
  hint?: string;
  muted?: boolean;
}) {
  return (
    <Paper withBorder radius="md" p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text fz={muted ? 20 : 28} fw={700} lh={1.2} c={muted ? "dimmed" : undefined}>
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

function GroupTable({
  title,
  groups,
}: {
  title: string;
  groups: ReadonlyArray<UsageGroupTotals & { readonly key: string }>;
}) {
  return (
    <div>
      <Text fw={600} size="sm" mb="xs">
        {title}
      </Text>
      <Table fz="sm" striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{title.replace("By ", "")}</Table.Th>
            <Table.Th>Reviews</Table.Th>
            <Table.Th>Tokens</Table.Th>
            <Table.Th>Cost</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {groups.map((group) => (
            <Table.Tr key={group.key}>
              <Table.Td>{group.key}</Table.Td>
              <Table.Td>{group.runs}</Table.Td>
              <Table.Td>{tokens(group).toLocaleString()}</Table.Td>
              <Table.Td>{formatNanoAiuCost(group.nanoAiu)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </div>
  );
}

/**
 * AI token usage and cost for PR reviews, read from local review reports.
 *
 * Fields the provider did not report read "not reported" rather than zero, and
 * reviews with partial or missing usage are called out.
 */
export function UsagePanel({ usage, days }: UsagePanelProps) {
  const totalReviews = usage.runs + usage.notReportedRuns;

  return (
    <>
      <Title order={3}>AI usage</Title>
      <Text size="sm" c="dimmed">
        From PR reviews run from this project in the last {days} days. Read from local report files;
        nothing is sent anywhere.
      </Text>

      {totalReviews === 0 ? (
        <Alert color="gray" title="No usage recorded">
          Usage is recorded when a PR review finishes. Run a review to start tracking it.
        </Alert>
      ) : usage.runs === 0 ? (
        <Alert color="yellow" title="Usage not reported">
          {totalReviews} review(s) ran in this window, but the AI provider did not report token
          usage for any of them.
        </Alert>
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
            <UsageTile
              label="Total tokens"
              value={tokens(usage).toLocaleString()}
              hint={[
                `${usage.inputTokens.toLocaleString()} in`,
                `${usage.outputTokens.toLocaleString()} out`,
                ...(usage.reasoningTokens === undefined
                  ? []
                  : [`${usage.reasoningTokens.toLocaleString()} reasoning`]),
              ].join(", ")}
            />
            <UsageTile
              label="Cached tokens"
              value={count(usage.cachedTokens)}
              muted={usage.cachedTokens === undefined}
              hint="served from the provider's cache"
            />
            <UsageTile
              label="Cost"
              value={
                usage.nanoAiu === undefined
                  ? "not reported"
                  : `${nanoAiuToCredits(usage.nanoAiu).toFixed(2)} AI credits`
              }
              muted={usage.nanoAiu === undefined}
              hint={
                usage.nanoAiu === undefined
                  ? "the provider did not report cost"
                  : `~$${nanoAiuToUsd(usage.nanoAiu).toFixed(2)}, as reported by the provider`
              }
            />
            <UsageTile
              label="Avg per PR"
              value={Math.round(tokens(usage) / usage.reportedPrs).toLocaleString()}
              hint={`tokens over ${usage.reportedPrs} PR(s), ${usage.runs} review(s)`}
            />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, lg: 2 }}>
            <GroupTable title="By model" groups={usage.byModel} />
            <GroupTable title="By provider" groups={usage.byProvider} />
          </SimpleGrid>

          {usage.partialRuns > 0 && (
            <Alert color="yellow" title="Partial usage">
              {usage.partialRuns} review(s) reported usage for only some of their AI calls, so their
              totals are lower bounds.
            </Alert>
          )}
          {usage.notReportedRuns > 0 && (
            <Alert color="yellow" title="Some reviews did not report usage">
              {usage.notReportedRuns} review(s) are excluded from the totals above.
            </Alert>
          )}
        </>
      )}
    </>
  );
}
