import { Badge, Group, SegmentedControl, Stack, Table, Text, TextInput } from "@mantine/core";
import type { AuditLogEntry, AuditLogSeverity } from "@merge-mentor/shared/audit/index.js";
import { useMemo, useState } from "react";

const SEVERITY_COLORS: Record<AuditLogSeverity, string> = {
  info: "blue",
  warn: "yellow",
  error: "red",
};

type SeverityFilter = "all" | AuditLogSeverity;

interface AuditLogTableProps {
  readonly entries: readonly AuditLogEntry[];
}

export function AuditLogTable({ entries }: AuditLogTableProps) {
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return entries.filter((entry) => {
      if (severity !== "all" && entry.severity !== severity) return false;
      if (needle.length === 0) return true;

      return (
        entry.eventType.toLowerCase().includes(needle) ||
        entry.action.toLowerCase().includes(needle) ||
        entry.actor.toLowerCase().includes(needle) ||
        entry.resource.id.toLowerCase().includes(needle)
      );
    });
  }, [entries, query, severity]);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <SegmentedControl
          value={severity}
          onChange={(value) => setSeverity(value as SeverityFilter)}
          data={[
            { label: "All", value: "all" },
            { label: "Info", value: "info" },
            { label: "Warn", value: "warn" },
            { label: "Error", value: "error" },
          ]}
        />
        <TextInput
          placeholder="Search events..."
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </Group>

      <Table.ScrollContainer minWidth={900}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Timestamp</Table.Th>
              <Table.Th>Severity</Table.Th>
              <Table.Th>Event</Table.Th>
              <Table.Th>Actor</Table.Th>
              <Table.Th>Resource</Table.Th>
              <Table.Th>Action</Table.Th>
              <Table.Th>Result</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filtered.map((entry) => (
              <Table.Tr key={`${entry.sourceFile}:${entry.lineNumber}`}>
                <Table.Td>
                  <Text size="sm" ff="monospace">
                    {entry.timestamp}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge color={SEVERITY_COLORS[entry.severity]} variant="light">
                    {entry.severity}
                  </Badge>
                </Table.Td>
                <Table.Td>{entry.eventType}</Table.Td>
                <Table.Td>{entry.actor}</Table.Td>
                <Table.Td>
                  {entry.resource.type}:{entry.resource.id}
                </Table.Td>
                <Table.Td>{entry.action}</Table.Td>
                <Table.Td>{entry.result}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {filtered.length === 0 ? (
        <Text c="dimmed" ta="center">
          No events match the current filters.
        </Text>
      ) : (
        <Text c="dimmed" size="sm">
          Showing {filtered.length} of {entries.length} events.
        </Text>
      )}
    </Stack>
  );
}
