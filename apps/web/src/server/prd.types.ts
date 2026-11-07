/**
 * Client-safe types and constants for the PRD / FRD review page.
 *
 * No server imports: route components import these without pulling the review
 * engine or `node:fs` into the client bundle.
 */

import type { PrdBreakdownReport } from "@merge-mentor/core/review/prd/breakdownReport.js";
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
  /** Run id of an earlier review to compare with (optional). */
  against: "x-mm-against",
  /** `true` to also produce a copy of the document with the findings as Word comments. */
  annotate: "x-mm-annotate",
} as const;

/** Endpoint that downloads the annotated copy of a review (`?run=<prdRunId>`). */
export const PRD_ANNOTATED_ENDPOINT = "/api/prd/annotated";

/** Document types the reviewer has a rubric for. */
export const PRD_DOCUMENT_TYPE_OPTIONS = ["prd", "frd"] as const;

/** Document types the reviewer has a rubric for. */
export type PrdDocumentTypeInput = (typeof PRD_DOCUMENT_TYPE_OPTIONS)[number];

/** Options of an upload, persisted in the run manifest (never the file itself). */
export interface PrdReviewRunInput {
  readonly documentType: PrdDocumentTypeInput;
  readonly includeImages: boolean;
  /** Run id of the earlier review this one is compared with. */
  readonly againstRunId?: string;
  /** Whether a copy with the findings as Word comments is produced. */
  readonly annotate?: boolean;
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
  /** Set when an annotated copy was requested: how many findings became Word comments. */
  readonly annotation?: { readonly placed: number; readonly unplaced: number };
}

/** Endpoint that starts a work breakdown (POST) and streams its run (GET). */
export const PRD_BREAKDOWN_ENDPOINT = "/api/prd/breakdown";

/** Input of a work breakdown run, persisted in the run manifest. */
export interface PrdBreakdownRunInput {
  readonly mode: "breakdown";
  /** Id of the stored PRD run (the review) to break down. */
  readonly prdRunId: string;
  /** Break the document down even when its review found blockers. */
  readonly force: boolean;
}

/** Final summary of a completed work breakdown. */
export interface PrdBreakdownSummary {
  /** Id of the PRD run on disk (shared with the review it was made from). */
  readonly prdRunId: string;
  /** File name of the Markdown breakdown on the Reports page. */
  readonly reportName: string;
  /** The structured breakdown. */
  readonly report: PrdBreakdownReport;
  /** The rendered Markdown breakdown, for download and copy. */
  readonly reportMarkdown: string;
}
