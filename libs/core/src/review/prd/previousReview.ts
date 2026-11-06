/**
 * Loads an earlier PRD / FRD review report to compare a new review against.
 */
import path from "node:path";

import { ValidationError } from "@merge-mentor/shared/errors/index.js";
import type { FileSystem } from "@merge-mentor/shared/ports/index.js";
import { prdRunIdFromReportName, prdRunPaths } from "@merge-mentor/shared/reports/index.js";

import type { PrdReviewReport } from "./prdReport.js";

/** Value of `--against` that picks the newest earlier review of the same file name. */
export const LATEST_REVIEW = "latest";

type ReportFs = Pick<FileSystem, "readFile" | "readdir">;

function isReport(value: unknown): value is PrdReviewReport {
  if (typeof value !== "object" || value === null) return false;
  const report = value as Partial<PrdReviewReport>;
  return (
    report.kind === "prd" &&
    report.schemaVersion === 1 &&
    typeof report.runId === "string" &&
    Array.isArray(report.findings) &&
    typeof report.source?.fileName === "string"
  );
}

async function readReport(
  tempPath: string,
  runId: string,
  fs: ReportFs
): Promise<PrdReviewReport | undefined> {
  let text: string;
  try {
    text = await fs.readFile(prdRunPaths(tempPath, runId).reportJson, "utf-8");
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isReport(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Finds the earlier review to compare against.
 *
 * @param tempPath - Base folder of reports and run data
 * @param reference - A run id, or {@link LATEST_REVIEW}
 * @param fileName - Display name of the document being reviewed (for `latest`)
 * @param documentType - Type of the document being reviewed; a different type is rejected
 * @throws {ValidationError} when the review cannot be found or is of another document type
 */
export async function loadPreviousReview(
  tempPath: string,
  reference: string,
  fileName: string,
  documentType: string,
  fs: ReportFs
): Promise<PrdReviewReport> {
  const normalized = reference.trim();
  const report =
    normalized.toLowerCase() === LATEST_REVIEW
      ? await findLatestReview(tempPath, fileName, fs)
      : await readReport(tempPath, normalized, fs);

  if (!report) {
    throw new ValidationError(
      "--against",
      normalized.toLowerCase() === LATEST_REVIEW
        ? `no earlier review of ${fileName} was found; run \`prd\` once without --against first`
        : `no review with run id "${normalized}" was found`
    );
  }
  if (report.documentType !== documentType) {
    throw new ValidationError(
      "--against",
      `that review was a ${report.documentType.toUpperCase()} review but this is a ${documentType.toUpperCase()}; use the same --type`
    );
  }
  return report;
}

async function findLatestReview(
  tempPath: string,
  fileName: string,
  fs: ReportFs
): Promise<PrdReviewReport | undefined> {
  let entries: string[];
  try {
    const dirents = await fs.readdir(path.join(tempPath, "reports"), { withFileTypes: true });
    entries = dirents.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return undefined;
  }
  // Run ids start with a sortable timestamp, so the last one is the newest.
  const runIds = entries
    .filter((name) => name.endsWith("-review-report.json"))
    .map((name) => prdRunIdFromReportName(name))
    .filter((runId): runId is string => runId !== undefined)
    .toSorted()
    .toReversed();
  for (const runId of runIds) {
    const report = await readReport(tempPath, runId, fs);
    if (report && report.source.fileName === fileName) return report;
  }
  return undefined;
}
