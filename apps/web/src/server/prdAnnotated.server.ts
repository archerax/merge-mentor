/**
 * Download of the annotated copy of a reviewed document (findings as Word
 * comments). The run id is validated as a single path segment and the file is
 * only ever read from that run's own folder.
 */
import { readFile } from "node:fs/promises";

import { isSafePrdRunId, prdRunPaths } from "@merge-mentor/shared/reports/index.js";

import { refreshEnv, resolveTempPath } from "./env.server.js";
import { sanitizeUploadFileName } from "./prdReview.server.js";

const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** `Spec v2.docx` → `Spec v2-reviewed.docx`, safe inside a Content-Disposition header. */
export function annotatedDownloadName(fileName: string | undefined): string {
  const base = sanitizeUploadFileName(fileName).replace(/\.docx$/i, "");
  return `${base.replace(/[^\w .()-]/g, "_")}-reviewed.docx`;
}

/** Handles `GET /api/prd/annotated?run=<prdRunId>`. */
export async function handleAnnotatedDownload(request: Request): Promise<Response> {
  const runId = new URL(request.url).searchParams.get("run") ?? "";
  if (!isSafePrdRunId(runId)) {
    return Response.json({ error: "Invalid review id." }, { status: 400 });
  }
  refreshEnv();
  const paths = prdRunPaths(resolveTempPath(), runId);

  let bytes: Buffer;
  try {
    bytes = await readFile(paths.annotatedDocx);
  } catch {
    return Response.json({ error: "There is no annotated copy for this review." }, { status: 404 });
  }

  let fileName: string | undefined;
  try {
    const report = JSON.parse(await readFile(paths.reportJson, "utf-8")) as {
      source?: { fileName?: unknown };
    };
    if (typeof report.source?.fileName === "string") fileName = report.source.fileName;
  } catch {
    // The download name falls back to a generic one.
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": DOCX_CONTENT_TYPE,
      "content-disposition": `attachment; filename="${annotatedDownloadName(fileName)}"`,
      "cache-control": "no-store",
    },
  });
}
