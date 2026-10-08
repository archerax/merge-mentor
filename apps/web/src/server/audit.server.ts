import path from "node:path";

import { readAuditEvents, type AuditLogEntry } from "@merge-mentor/shared/audit/index.js";

import { resolveTempPath } from "./env.server.js";

/**
 * Resolves the audit logs directory the CLI writes to.
 *
 * The CLI writes logs to `<MM_TEMP_PATH>/logs` (default `./.mergementor/logs`
 * relative to its working directory). `resolveTempPath` anchors that path to the
 * CLI working directory so the web UI reads the same files.
 */
function resolveLogsDir(): string {
  return path.join(resolveTempPath(), "logs");
}

/**
 * Server-only helper that loads persisted audit events for the web UI.
 *
 * Kept separate from the server-function wrapper so `node:fs`-based code never
 * reaches the client bundle.
 */
export async function loadAuditEvents(limit = 500): Promise<AuditLogEntry[]> {
  return readAuditEvents({ limit, logsDir: resolveLogsDir() });
}
