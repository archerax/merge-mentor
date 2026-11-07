import { Alert, Code, Stack } from "@mantine/core";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { AuditLogTable } from "../components/AuditLogTable.js";
import { PageHeader } from "../components/PageHeader.js";
import { auditQuery } from "../queries/audit.js";

export const Route = createFileRoute("/audit")({
  loader: ({ context }) => context.queryClient.ensureQueryData(auditQuery),
  component: AuditLogPage,
});

function AuditLogPage() {
  const { data: entries } = useSuspenseQuery(auditQuery);

  return (
    <Stack gap="lg">
      <PageHeader
        title="Audit Log"
        description={
          <>
            Structured audit events recorded in <Code>.mergementor/logs</Code>.
          </>
        }
      />

      {entries.length === 0 ? (
        <Alert title="No audit events found" color="gray">
          Run a review with the Merge Mentor CLI to generate audit logs, then reload this page.
        </Alert>
      ) : (
        <AuditLogTable entries={entries} />
      )}
    </Stack>
  );
}
