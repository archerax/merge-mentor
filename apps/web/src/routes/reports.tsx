import {
  Alert,
  Badge,
  Card,
  Code,
  Grid,
  Group,
  Loader,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import type {
  ReportDocument,
  ReportKind,
  ReportSummary,
} from "@merge-mentor/shared/reports/index.js";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { MarkdownReport } from "../components/MarkdownReport.js";
import { getReport, getReports } from "../server/reports.functions.js";

export const Route = createFileRoute("/reports")({
  loader: async () => {
    const reports = await getReports();
    const first = reports[0];
    const report = first ? await getReport({ data: { name: first.name } }) : null;
    return { reports, report };
  },
  component: ReportsPage,
});

const KIND_COLORS: Record<ReportKind, string> = {
  review: "blue",
  pbi: "grape",
  project: "teal",
  plan: "indigo",
  stage: "orange",
  report: "gray",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function ReportsPage() {
  const { reports, report: initialReport } = Route.useLoaderData();
  const [selected, setSelected] = useState<ReportDocument | null>(initialReport);
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Review Reports</Title>
        <Text c="dimmed">
          Rendered markdown reports saved in <Code>.mergementor/reports</Code>.
        </Text>
      </div>

      {reports.length === 0 ? (
        <Alert title="No reports found" color="gray">
          Run a review, PBI, project, or plan command with the Merge Mentor CLI to generate a
          markdown report, then reload this page.
        </Alert>
      ) : (
        <Grid gap="lg">
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Stack gap="sm">
              <TextInput
                placeholder="Search reports..."
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
              <ScrollArea.Autosize mah={560}>
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
            <Card withBorder padding="lg" radius="md">
              {selected ? (
                <MarkdownReport content={selected.content} />
              ) : (
                <Text c="dimmed">Select a report to view its contents.</Text>
              )}
            </Card>
          </Grid.Col>
        </Grid>
      )}
    </Stack>
  );
}

interface ReportNavItemProps {
  readonly report: ReportSummary;
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
