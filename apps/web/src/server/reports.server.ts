import path from "node:path";

import { ValidationError } from "@merge-mentor/shared/errors/index.js";
import {
  deletePrdRun,
  isSafePrdRunId,
  listReports,
  prdRunIdFromReportName,
  readReport,
  type ReportDocument,
  type ReportSummary,
} from "@merge-mentor/shared/reports/index.js";

import { resolveTempPath } from "./env.server.js";
import { deleteRunsWhere } from "./reviewRunStore.server.js";

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
export async function loadReports(limit = 200): Promise<ReportListItem[]> {
  const reports = await listReports({ limit, reportsDir: resolveReportsDir() });
  return reports.map((report) => {
    const prdRunId = report.kind === "prd" ? prdRunIdFromReportName(report.name) : undefined;
    return prdRunId === undefined ? report : { ...report, prdRunId };
  });
}

/** A report summary, plus the PRD run id for `prd` reports (which can be deleted). */
export interface ReportListItem extends ReportSummary {
  readonly prdRunId?: string;
}

/**
 * Server-only helper that reads a single markdown report by file name.
 */
export async function loadReport(name: string): Promise<ReportDocument | undefined> {
  return readReport(name, { reportsDir: resolveReportsDir() });
}

/**
 * Deletes a PRD review run: its reports, the stored copy of the uploaded
 * document and the extracted data, plus the web UI's stream log of the run
 * (its stored summary holds the report, and so quotes from the document).
 *
 * @throws {ValidationError} when `runId` is not a safe run id (so it can never
 *   name a path outside the PRD run directory)
 */
export async function removePrdRun(runId: unknown): Promise<void> {
  if (typeof runId !== "string" || !isSafePrdRunId(runId)) {
    throw new ValidationError("runId", "is not a valid PRD run id");
  }
  const tempPath = resolveTempPath();
  await deletePrdRun(runId, { tempPath });
  deleteRunsWhere(
    tempPath,
    (manifest, summary) =>
      manifest.kind === "prd" &&
      typeof summary === "object" &&
      summary !== null &&
      (summary as { prdRunId?: unknown }).prdRunId === runId
  );
}
