/**
 * Server side of the PRD / FRD review page.
 *
 * The uploaded `.docx` is untrusted input (plan section 5.4):
 * - the 20 MB cap is checked against `Content-Length` before reading and again
 *   while the body streams in, so an oversized upload is never fully buffered;
 * - the bytes are validated with `validateDocxBuffer` (zip magic bytes, legacy
 *   `.doc`/OLE detection, zip-bomb guard), never by file extension;
 * - the file name is sanitised for display only and never used in a path; the
 *   engine copies the bytes into its own run directory (`prdRunPaths`);
 * - the request has already passed the per-launch token guard (`start.ts`),
 *   which only lets this path accept a raw `application/octet-stream` body.
 */

import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

import { type Config, loadConfig } from "@merge-mentor/config/config.js";
import {
  assertDocxSize,
  MAX_DOCX_BYTES,
  validateDocxBuffer,
} from "@merge-mentor/core/review/prd/docxValidator.js";
import { runPrdReview } from "@merge-mentor/core/review/prd/prdEngine.js";
import { ConfigurationError, ValidationError } from "@merge-mentor/shared/errors/index.js";
import { initLogger } from "@merge-mentor/shared/logger.js";

import { refreshEnv, resolveTempPath } from "./env.server.js";
import {
  PRD_UPLOAD_HEADERS,
  type PrdDocumentTypeInput,
  type PrdReviewRunInput,
  type PrdReviewSummary,
} from "./prd.types.js";
import { startOrAttach } from "./reviewRuns.server.js";
import type { SseEmitter } from "./sse.server.js";
import {
  createAiClient,
  createProgressHandler,
  createStreamOutput,
} from "./workItemReview.server.js";

/** An uploaded document and its options, before validation. */
interface PrdUpload {
  readonly buffer: Buffer;
  /** Untrusted (possibly URI-encoded) file name; sanitised before use. */
  readonly fileName: string;
  readonly documentType: PrdDocumentTypeInput;
  readonly includeImages: boolean;
}

/** Longest display file name kept from an upload. */
const MAX_FILE_NAME_LENGTH = 120;

const DEFAULT_FILE_NAME = "document.docx";

const DOCUMENT_TYPE_LABELS: Record<PrdDocumentTypeInput, string> = {
  prd: "PRD",
  frd: "FRD",
};

/**
 * Turns an untrusted, URI-encoded file name into a short display name.
 *
 * Drops any directory part (`../`, `C:\`), control and reserved characters and
 * leading dots, and caps the length. The result is shown in the report and the
 * UI only; run files are named by the engine's generated run id.
 */
export function sanitizeUploadFileName(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_FILE_NAME;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Not valid URI encoding; sanitise the raw value instead.
  }

  const base = decoded.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  if (cleaned.length === 0) return DEFAULT_FILE_NAME;

  const withExtension = /\.docx$/i.test(cleaned) ? cleaned : `${cleaned}.docx`;
  if (withExtension.length <= MAX_FILE_NAME_LENGTH) return withExtension;
  return `${withExtension.slice(0, MAX_FILE_NAME_LENGTH - 5).trimEnd()}.docx`;
}

/** Reads the document type and image opt-in from the upload headers. */
export function parseUploadOptions(headers: Headers): {
  readonly documentType: PrdDocumentTypeInput;
  readonly includeImages: boolean;
} {
  const documentType = headers.get(PRD_UPLOAD_HEADERS.documentType)?.trim().toLowerCase();
  if (documentType !== "prd" && documentType !== "frd") {
    throw new ValidationError("documentType", 'must be "prd" or "frd"');
  }
  const includeImages =
    headers.get(PRD_UPLOAD_HEADERS.includeImages)?.trim().toLowerCase() === "true";
  return { documentType, includeImages };
}

/**
 * Reads a request body up to `maxBytes`, refusing an oversized body from its
 * `Content-Length` before reading, and stopping as soon as the streamed bytes
 * pass the cap (a missing or false `Content-Length` cannot bypass it).
 *
 * @throws {ValidationError} when the body is larger than `maxBytes`
 */
export async function readUploadBody(
  request: Request,
  maxBytes: number = MAX_DOCX_BYTES
): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 0) assertDocxSize(declared, maxBytes);
  if (!request.body) return Buffer.alloc(0);

  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        assertDocxSize(total, maxBytes);
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts, total);
}

/** Strips the `Validation failed for docx:` prefix for plain-language messages. */
function plainMessage(error: unknown): string {
  if (error instanceof ValidationError) {
    const detail = error.message.replace(/^Validation failed for [^:]+:\s*/, "");
    return error.field === "docx"
      ? `This file can't be reviewed: ${detail}.`
      : `Invalid ${error.field}: ${detail}.`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Resolves the web server's configuration for an AI-only review. */
function resolvePrdConfig(): Config {
  refreshEnv();
  const config = loadConfig({ tempPath: resolveTempPath() });
  if (config.copilotToken && !config.copilotToken.startsWith("github_pat_")) {
    throw new ConfigurationError(
      "MM_COPILOT_TOKEN",
      "GitHub Copilot requires a fine-grained personal access token starting with 'github_pat_'."
    );
  }
  return config;
}

/**
 * Validates the uploaded bytes, then starts (or attaches to) a PRD review. A
 * second upload of the same bytes with the same options while the first is
 * running attaches to that run.
 *
 * @throws {ValidationError} when the bytes are not an acceptable `.docx`
 */
function startPrdReview(upload: PrdUpload): { runId: string; attached: boolean } {
  validateDocxBuffer(upload.buffer);
  const fileName = sanitizeUploadFileName(upload.fileName);
  const config = resolvePrdConfig();
  const digest = createHash("sha256").update(upload.buffer).digest("hex").slice(0, 16);
  const input: PrdReviewRunInput = {
    documentType: upload.documentType,
    includeImages: upload.includeImages,
    fileName,
    sizeBytes: upload.buffer.length,
    prdRunId: `web-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(4).toString("hex")}`,
  };

  return startOrAttach({
    kind: "prd",
    targetKey: `prd:${upload.documentType}:${digest}:images=${upload.includeImages}`,
    label: `${DOCUMENT_TYPE_LABELS[upload.documentType]} · ${fileName}`,
    input,
    execute: (emitter) =>
      executePrdReview({ ...upload, fileName }, config, emitter, input.prdRunId),
  });
}

/** Runs the review, streaming progress frames and the final summary. */
async function executePrdReview(
  upload: PrdUpload,
  config: Config,
  emit: SseEmitter,
  prdRunId?: string
): Promise<void> {
  initLogger(config.tempPath);
  emit.send({
    type: "status",
    message: `Starting ${DOCUMENT_TYPE_LABELS[upload.documentType]} review of ${upload.fileName}...`,
  });

  const { aiProvider, client } = createAiClient(config);
  const result = await runPrdReview(
    {
      source: { buffer: upload.buffer, fileName: upload.fileName },
      documentType: upload.documentType,
      includeImages: upload.includeImages,
      runId: prdRunId,
      tempPath: config.tempPath,
      aiProvider,
      aiModel: config.aiModel,
      output: createStreamOutput(emit),
      onStreamChunk: emit.pushChunk,
      onProgress: createProgressHandler(emit),
    },
    { aiClient: client }
  );

  const summary: PrdReviewSummary = {
    prdRunId: result.runId,
    reportName: path.basename(result.paths.reportMarkdown),
    report: result.report,
    reportMarkdown: result.reportMarkdown,
  };
  emit.send({ type: "result", summary });
}

/**
 * Handles `POST /api/prd/stream`: reads and validates the raw upload, then
 * starts a run and returns `{ runId }`. Validation failures are 400 (413 for
 * an oversized body) with a plain-language `{ error }`.
 */
export async function handlePrdUpload(request: Request): Promise<Response> {
  let options: ReturnType<typeof parseUploadOptions>;
  try {
    options = parseUploadOptions(request.headers);
  } catch (error) {
    return Response.json({ error: plainMessage(error) }, { status: 400 });
  }

  let buffer: Buffer;
  try {
    buffer = await readUploadBody(request);
  } catch (error) {
    const status = error instanceof ValidationError ? 413 : 400;
    return Response.json({ error: plainMessage(error) }, { status });
  }

  try {
    const fileName = request.headers.get(PRD_UPLOAD_HEADERS.fileName) ?? "";
    return Response.json(startPrdReview({ buffer, fileName, ...options }));
  } catch (error) {
    return Response.json({ error: plainMessage(error) }, { status: 400 });
  }
}
