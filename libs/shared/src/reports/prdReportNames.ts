/**
 * File-name conventions of PRD / FRD run reports.
 *
 * Kept free of Node imports so browser code (the dashboard's Reports page) can
 * share them with the code that writes the files.
 */

/** Prefix of every PRD / FRD report file name. */
export const REPORT_PREFIX = "prd-";

/** Suffix (before the extension) of a review report. */
export const REPORT_SUFFIX = "-review-report";

/** Suffix (before the extension) of a work breakdown. */
export const BREAKDOWN_SUFFIX = "-breakdown";

/** Reports whether a report file name is a work breakdown (`prd-<run-id>-breakdown.md`). */
export function isPrdBreakdownReportName(name: string): boolean {
  return (
    name.startsWith(REPORT_PREFIX) &&
    name.endsWith(`${BREAKDOWN_SUFFIX}.md`) &&
    name.length > REPORT_PREFIX.length + BREAKDOWN_SUFFIX.length + ".md".length
  );
}
