import { Alert, Code, Stack } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

import { AuditLogTable } from "../components/AuditLogTable.js";
import { PageHeader } from "../components/PageHeader.js";
import { getAuditEvents } from "../server/audit.functions.js";

export const Route = createFileRoute("/audit")({
  loader: () => getAuditEvents(),
  component: AuditLogPage,
});

function AuditLogPage() {
  const entries = Route.useLoaderData();

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
