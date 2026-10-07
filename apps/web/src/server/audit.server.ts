import path from "node:path";

import { readAuditEvents, type AuditLogEntry } from "@merge-mentor/shared/audit/index.js";

/**
 * Resolves the audit logs directory from `MM_TEMP_PATH`, matching the CLI.
 *
 * The CLI writes logs to `<MM_TEMP_PATH>/logs` (default `./.mergementor/logs`
 * relative to the working directory). The web server runs from its own package
 * directory, so pointing `MM_TEMP_PATH` at the same location keeps both in sync.
 * When unset, the shared reader falls back to `./.mergementor/logs` in the cwd.
 */
function resolveLogsDir(): string | undefined {
  const tempPath = process.env.MM_TEMP_PATH;
  return tempPath ? path.join(tempPath, "logs") : undefined;
}

/**
 * Server-only helper that loads persisted audit events for the web UI.
 *
 * Kept separate from the server-function wrapper so `node:fs`-based code never
 * reaches the client bundle.
 */
export async function loadAuditEvents(limit = 500): Promise<AuditLogEntry[]> {
  const logsDir = resolveLogsDir();
  return readAuditEvents(logsDir ? { limit, logsDir } : { limit });
}
