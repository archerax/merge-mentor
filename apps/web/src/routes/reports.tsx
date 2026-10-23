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
import type { ReportDocument, ReportKind } from "@merge-mentor/shared/reports/index.js";
import { IconTrash } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { MarkdownReport } from "../components/MarkdownReport.js";
import { PageHeader } from "../components/PageHeader.js";
import { deletePrdReport, getReport, getReports } from "../server/reports.functions.js";
import type { ReportListItem } from "../server/reports.server.js";

export const Route = createFileRoute("/reports")({
  validateSearch: (search: Record<string, unknown>): { report?: string } => ({
    report:
      typeof search.report === "string" && search.report.length > 0 ? search.report : undefined,
  }),
  loaderDeps: ({ search }) => ({ report: search.report }),
  loader: async ({ deps }) => {
    const reports: ReportListItem[] = await getReports();
    const initial = reports.find((item) => item.name === deps.report) ?? reports[0];
    const report = initial ? await getReport({ data: { name: initial.name } }) : null;
    return { reports, report };
  },
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
  const { reports: loadedReports, report: initialReport } = Route.useLoaderData();
  const [reports, setReports] = useState<readonly ReportListItem[]>(loadedReports);
  const [selected, setSelected] = useState<ReportDocument | null>(initialReport);
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ReportListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const selectedItem = reports.find((report) => report.name === selected?.name);

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

  async function select(name: string) {
    setLoadingName(name);
    try {
      const document = await getReport({ data: { name } });
      setSelected(document);
    } finally {
      setLoadingName(null);
    }
  }

  async function confirmDelete() {
    const target = pendingDelete;
    if (!target?.prdRunId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deletePrdReport({ data: { runId: target.prdRunId } });
      setReports((previous) => previous.filter((report) => report.prdRunId !== target.prdRunId));
      if (selected?.name === target.name) setSelected(null);
      setPendingDelete(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
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
                      onSelect={() => select(report.name)}
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
              {loadingName !== null ? (
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
                      <Button
                        color="red"
                        variant="light"
                        size="xs"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => {
                          setDeleteError(null);
                          setPendingDelete(selectedItem);
                        }}
                      >
                        Delete run
                      </Button>
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
            This permanently deletes the report for <b>{pendingDelete?.title}</b>, the stored copy
            of the uploaded document, the data and images extracted from it, and the AI transcripts
            of the review. This cannot be undone.
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
