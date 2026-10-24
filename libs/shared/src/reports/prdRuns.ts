import path from "node:path";

import { ValidationError } from "../errors/index.js";
import { type FileSystem, nodeFs } from "../ports/index.js";

/**
 * On-disk layout of a PRD / FRD review run.
 *
 * Everything a run produces lives under the temp path (`./.mergementor` by
 * default) so a single {@link deletePrdRun} call removes it all:
 *
 * ```
 * <tempPath>/reports/prd-<runId>-review-report.md    (listed on the Reports page, kind "prd")
 * <tempPath>/reports/prd-<runId>-review-report.json  (structured report)
 * <tempPath>/prd/<runId>/source.docx                 (copy of the reviewed document)
 * <tempPath>/prd/<runId>/document.json               (extracted document model and chunks)
 * <tempPath>/prd/<runId>/images/                     (images extracted for --include-images)
 * <tempPath>/prd/<runId>/transcripts/                (AI request transcripts for this run)
 * ```
 */
export interface PrdRunPaths {
  /** Directory holding the source copy and extracted data. */
  readonly runDir: string;
  /** Copy of the reviewed `.docx`. */
  readonly sourceDocx: string;
  /** Extracted document model and chunks, as JSON. */
  readonly documentJson: string;
  /** Images extracted for image review (`--include-images`). */
  readonly imagesDir: string;
  /**
   * AI request transcripts for this run (passed to the provider as
   * `transcriptDir`, instead of the shared `<tempPath>/transcripts`).
   */
  readonly transcriptsDir: string;
  /** Markdown report (picked up by the reports reader). */
  readonly reportMarkdown: string;
  /** Structured JSON report. */
  readonly reportJson: string;
}

const REPORT_PREFIX = "prd-";
const REPORT_SUFFIX = "-review-report";
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * Reports whether `runId` is safe to use as a single path segment: letters,
 * digits, `-` and `_` only, so it cannot traverse out of the runs directory.
 */
export function isSafePrdRunId(runId: string): boolean {
  return RUN_ID_PATTERN.test(runId);
}

/**
 * Resolves every path belonging to a PRD review run.
 *
 * @throws {ValidationError} when `runId` is not a safe path segment
 */
export function prdRunPaths(tempPath: string, runId: string): PrdRunPaths {
  assertSafeRunId(runId);
  const runDir = path.join(tempPath, "prd", runId);
  const reportBase = path.join(tempPath, "reports", `${REPORT_PREFIX}${runId}${REPORT_SUFFIX}`);
  return {
    runDir,
    sourceDocx: path.join(runDir, "source.docx"),
    documentJson: path.join(runDir, "document.json"),
    imagesDir: path.join(runDir, "images"),
    transcriptsDir: path.join(runDir, "transcripts"),
    reportMarkdown: `${reportBase}.md`,
    reportJson: `${reportBase}.json`,
  };
}

/**
 * Extracts the run id from a PRD report file name
 * (`prd-<runId>-review-report.md` or `.json`).
 *
 * @returns The run id, or `undefined` when the name is not a PRD report
 */
export function prdRunIdFromReportName(name: string): string | undefined {
  const match = /^prd-(.+)-review-report\.(?:md|json)$/.exec(name);
  const runId = match?.[1];
  return runId !== undefined && isSafePrdRunId(runId) ? runId : undefined;
}

/**
 * Deletes everything a PRD review run produced: the Markdown and JSON reports,
 * the copy of the source `.docx`, the extracted data and images, and the AI
 * request transcripts. Missing files are
 * ignored, so deleting a partially written run is safe.
 *
 * @throws {ValidationError} when `runId` is not a safe path segment
 */
export async function deletePrdRun(
  runId: string,
  options: { readonly tempPath?: string; readonly fs?: Pick<FileSystem, "rm"> } = {}
): Promise<void> {
  const fs = options.fs ?? nodeFs;
  const paths = prdRunPaths(options.tempPath ?? path.join(process.cwd(), ".mergementor"), runId);
  await fs.rm(paths.reportMarkdown, { force: true });
  await fs.rm(paths.reportJson, { force: true });
  await fs.rm(paths.runDir, { recursive: true, force: true });
}

function assertSafeRunId(runId: string): void {
  if (!isSafePrdRunId(runId)) {
    throw new ValidationError("runId", "must contain only letters, digits, '-' and '_'");
  }
}
