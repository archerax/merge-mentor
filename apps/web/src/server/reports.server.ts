import path from "node:path";

import {
  listReports,
  readReport,
  type ReportDocument,
  type ReportSummary,
} from "@merge-mentor/shared/reports/index.js";

import { resolveTempPath } from "./env.server.js";

/**
 * Resolves the reports directory the CLI writes to.
 *
 * The CLI writes markdown reports to `<MM_TEMP_PATH>/reports` (default
 * `./.mergementor/reports` relative to its working directory). `resolveTempPath`
 * anchors that path to the CLI working directory so the web UI reads the same
 * files.
 */
function resolveReportsDir(): string {
  return path.join(resolveTempPath(), "reports");
}

/**
 * Server-only helper that lists persisted markdown reports for the web UI.
 *
 * Kept separate from the server-function wrapper so `node:fs`-based code never
 * reaches the client bundle.
 */
export async function loadReports(limit = 200): Promise<ReportSummary[]> {
  return listReports({ limit, reportsDir: resolveReportsDir() });
}

/**
 * Server-only helper that reads a single markdown report by file name.
 */
export async function loadReport(name: string): Promise<ReportDocument | undefined> {
  return readReport(name, { reportsDir: resolveReportsDir() });
}
