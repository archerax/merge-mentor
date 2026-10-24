/**
 * Client-safe types and constants for the PRD / FRD review page.
 *
 * No server imports: route components import these without pulling the review
 * engine or `node:fs` into the client bundle.
 */

import type { PrdReviewReport } from "@merge-mentor/core/review/prd/prdReport.js";

/** Endpoint that accepts an upload (POST) and streams a run (GET). */
export const PRD_STREAM_ENDPOINT = "/api/prd/stream";

/** Request headers that carry the upload's options next to the raw body. */
export const PRD_UPLOAD_HEADERS = {
  /** `prd` or `frd`. */
  documentType: "x-mm-document-type",
  /** `true` to opt in to image review. */
  includeImages: "x-mm-include-images",
  /** The original file name, URI-encoded. Display only; never used in a path. */
  fileName: "x-mm-file-name",
} as const;

/** Document types the reviewer has a rubric for. */
export type PrdDocumentTypeInput = "prd" | "frd";

/** Options of an upload, persisted in the run manifest (never the file itself). */
export interface PrdReviewRunInput {
  readonly documentType: PrdDocumentTypeInput;
  readonly includeImages: boolean;
  /** Sanitised display name of the uploaded file. */
  readonly fileName: string;
  /** Size of the uploaded file in bytes. */
  readonly sizeBytes: number;
  /**
   * Id of the PRD run the review will write under `prd/` and `reports/`,
   * assigned before execution starts so deleting the report can find this
   * run's stream log even if the server crashed before the summary was saved.
   */
  readonly prdRunId?: string;
}

/** Final summary of a completed PRD / FRD review. */
export interface PrdReviewSummary {
  /** Id of the PRD run on disk (used to delete it). */
  readonly prdRunId: string;
  /** File name of the Markdown report on the Reports page. */
  readonly reportName: string;
  /** The structured report. */
  readonly report: PrdReviewReport;
  /** The rendered Markdown report. */
  readonly reportMarkdown: string;
}
