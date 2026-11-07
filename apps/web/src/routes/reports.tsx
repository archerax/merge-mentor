import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Grid,
  Group,
  Loader,
  Modal,
  NavLink,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import type { ReportKind } from "@merge-mentor/shared/reports/index.js";
import { isPrdBreakdownReportName } from "@merge-mentor/shared/reports/prdReportNames.js";
import { IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { MarkdownReport } from "../components/MarkdownReport.js";
import { PageHeader } from "../components/PageHeader.js";
import { PageSkeleton } from "../components/PageSkeleton.js";
import { DownloadMarkdownButton } from "../components/review/DownloadMarkdownButton.js";
import { describeRouteError } from "../components/RouteError.js";
import {
  deletePrdRunMutation,
  reportQuery,
  reportsQuery,
  selectedReportName,
} from "../queries/reports.js";
import type { ReportListItem } from "../server/reports.server.js";
import { useReportPick, useReportsQuery, useReportsViewStore } from "../stores/reportsView.js";

export const Route = createFileRoute("/reports")({
  validateSearch: (search: Record<string, unknown>): { report?: string } => ({
    report:
      typeof search.report === "string" && search.report.length > 0 ? search.report : undefined,
  }),
  loaderDeps: ({ search }) => ({ report: search.report }),
  loader: async ({ deps, context }) => {
    const reports = await context.queryClient.ensureQueryData(reportsQuery);
    // The saved pick is only known in the browser; on the server this is the default.
    const initial = selectedReportName(reports, deps.report, useReportsViewStore.getState().pick);
    if (initial !== null) await context.queryClient.ensureQueryData(reportQuery(initial));
  },
  pendingComponent: () => <PageSkeleton rows={6} />,
  component: ReportsPage,
});

const KIND_COLORS: Record<ReportKind, string> = {
  review: "blue",
  pbi: "grape",
  project: "teal",
  prd: "cyan",
  plan: "indigo",
  stage: "orange",
  report: "gray",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function ReportsPage() {
  const { report: requested } = Route.useSearch();
  const { data: reports } = useSuspenseQuery(reportsQuery);
  // The remembered pick wins until the URL asks for a different report, or its report is gone.
  const { pick, setPick } = useReportPick();
  const selectedName = selectedReportName(reports, requested, pick);
  // Clearing the selection forgets the pick, so the next visit shows the default report again.
  const selectReport = (name: string | null) =>
    setPick(name === null ? null : { search: requested, name });

  const detail = useQuery({ ...reportQuery(selectedName ?? ""), enabled: selectedName !== null });
  const selected = selectedName === null ? null : (detail.data ?? null);
  const loadingName = selectedName !== null && detail.isLoading ? selectedName : null;

  const { query, setQuery } = useReportsQuery();
  const [pendingDelete, setPendingDelete] = useState<ReportListItem | null>(null);
  const deleteRun = useMutation(deletePrdRunMutation);
  const deleting = deleteRun.isPending;
  const deleteError = deleteRun.error?.message ?? null;

  const selectedItem = reports.find((item) => item.name === selected?.name);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return reports;

    return reports.filter(
      (report) =>
        report.title.toLowerCase().includes(needle) ||
        report.name.toLowerCase().includes(needle) ||
        report.kind.includes(needle)
    );
  }, [query, reports]);

  function confirmDelete() {
    const target = pendingDelete;
    if (!target?.prdRunId) return;
    // Read before the optimistic update takes the run's reports out of the list.
    const showingDeletedRun = selectedItem?.prdRunId === target.prdRunId;
    deleteRun.mutate(target.prdRunId, {
      onSuccess: () => {
        if (showingDeletedRun) selectReport(null);
        setPendingDelete(null);
      },
    });
  }

  return (
    <Stack gap="lg">
      <PageHeader
        title="Review Reports"
        description={
          <>
            Rendered markdown reports saved in <Code>.mergementor/reports</Code>.
          </>
        }
      />

      {reports.length === 0 ? (
        <Alert title="No reports found" color="gray">
          Run a review from the PR, PBI, project or PRD review pages, or the Merge Mentor CLI, to
          generate a markdown report, then reload this page.
        </Alert>
      ) : (
        <Grid gap="lg">
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Stack gap="sm" style={{ position: "sticky", top: 88 }}>
              <TextInput
                placeholder="Search reports..."
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
              <Text size="xs" c="dimmed">
                {filtered.length} of {reports.length} reports
              </Text>
              <ScrollArea.Autosize mah={560} type="auto">
                <Stack gap={4}>
                  {filtered.map((report) => (
                    <ReportNavItem
                      key={report.name}
                      report={report}
                      active={selected?.name === report.name && loadingName === null}
                      loading={loadingName === report.name}
                      onSelect={() => selectReport(report.name)}
                    />
                  ))}
                  {filtered.length === 0 && (
                    <Text c="dimmed" size="sm" ta="center" py="md">
                      No reports match your search.
                    </Text>
                  )}
                </Stack>
              </ScrollArea.Autosize>
            </Stack>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 8 }}>
            <Card padding="lg">
              {detail.isError && selected === null ? (
                <Alert color="red" title="Could not load this report">
                  {describeRouteError(detail.error)}
                </Alert>
              ) : loadingName !== null ? (
                <Stack gap="sm">
                  <Skeleton height={28} width="40%" />
                  <Skeleton height={14} />
                  <Skeleton height={14} />
                  <Skeleton height={14} width="80%" />
                  <Skeleton height={14} />
                  <Skeleton height={14} width="60%" />
                </Stack>
              ) : selected ? (
                <Stack gap="md">
                  {selectedItem?.prdRunId && (
                    <Group justify="space-between" align="center">
                      <Text size="sm" c="dimmed">
                        This review keeps a copy of the uploaded document in{" "}
                        <Code>.mergementor</Code>.
                      </Text>
                      <Group gap="xs">
                        {isPrdBreakdownReportName(selected.name) && (
                          <DownloadMarkdownButton
                            text={selected.content}
                            fileName={selected.name}
                          />
                        )}
                        <Button
                          color="red"
                          variant="light"
                          size="xs"
                          leftSection={<IconTrash size={14} />}
                          onClick={() => {
                            deleteRun.reset();
                            setPendingDelete(selectedItem);
                          }}
                        >
                          Delete run
                        </Button>
                      </Group>
                    </Group>
                  )}
                  <MarkdownReport content={selected.content} />
                </Stack>
              ) : (
                <Text c="dimmed">Select a report to view its contents.</Text>
              )}
            </Card>
          </Grid.Col>
        </Grid>
      )}

      <Modal
        opened={pendingDelete !== null}
        onClose={() => {
          if (!deleting) setPendingDelete(null);
        }}
        title="Delete this review?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            This permanently deletes the report for <b>{pendingDelete?.title}</b>, any work
            breakdown made from the same document, the stored copy of the uploaded document, the
            data and images extracted from it, and the AI transcripts. This cannot be undone.
          </Text>
          {deleteError && (
            <Alert color="red" title="Could not delete">
              {deleteError}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button color="red" onClick={confirmDelete} loading={deleting}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

interface ReportNavItemProps {
  readonly report: ReportListItem;
  readonly active: boolean;
  readonly loading: boolean;
  readonly onSelect: () => void;
}

function ReportNavItem({ report, active, loading, onSelect }: ReportNavItemProps) {
  return (
    <NavLink
      active={active}
      onClick={onSelect}
      variant="light"
      label={
        <Text fw={500} lineClamp={1}>
          {report.title}
        </Text>
      }
      description={
        <Group gap="xs" wrap="nowrap">
          <Badge size="xs" variant="light" color={KIND_COLORS[report.kind]}>
            {report.kind}
          </Badge>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {new Date(report.modifiedAt).toLocaleString()} · {formatBytes(report.size)}
          </Text>
        </Group>
      }
      rightSection={loading ? <Loader size="xs" /> : undefined}
    />
  );
}
