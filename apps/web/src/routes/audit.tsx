import { Alert, Code, Stack } from "@mantine/core";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { AuditLogTable } from "../components/AuditLogTable.js";
import { PageHeader } from "../components/PageHeader.js";
import { PageSkeleton } from "../components/PageSkeleton.js";
import { auditQuery } from "../queries/audit.js";

export const Route = createFileRoute("/audit")({
  // Waits for the data without returning it: the page reads the query cache, and
  // returning it would serialise the payload a second time as loader data.
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(auditQuery);
  },
  pendingComponent: () => <PageSkeleton rows={8} />,
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
