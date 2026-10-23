import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@merge-mentor/core/ai/providerFactory.js", () => ({
  createAIProvider: vi.fn(() => ({})),
}));

const runPrdReview = vi.fn();
vi.mock("@merge-mentor/core/review/prd/prdEngine.js", () => ({ runPrdReview }));

const { buildDocx, heading, para } =
  await import("@merge-mentor/core/review/prd/docxFixture.test-helper.js");
const { MAX_DOCX_BYTES } = await import("@merge-mentor/core/review/prd/docxValidator.js");
const { handlePrdUpload, parseUploadOptions, readUploadBody, sanitizeUploadFileName } =
  await import("./prdReview.server.js");
const { streamRun } = await import("./reviewRuns.server.js");
const { PRD_UPLOAD_HEADERS } = await import("./prd.types.js");

/** Builds an upload request with the given body and option headers. */
function uploadRequest(
  body: BodyInit | null,
  headers: Record<string, string> = {},
  init: { readonly duplex?: "half" } = {}
): Request {
  return new Request("http://127.0.0.1:3000/api/prd/stream", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/octet-stream",
      [PRD_UPLOAD_HEADERS.documentType]: "prd",
      [PRD_UPLOAD_HEADERS.fileName]: encodeURIComponent("Checkout PRD.docx"),
      ...headers,
    },
    ...init,
  } as RequestInit);
}

async function collectFrames(
  stream: ReadableStream<Uint8Array>
): Promise<Record<string, unknown>[]> {
  const text = await new Response(stream).text();
  return text
    .split("\n\n")
    .map((chunk) => chunk.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => !!line)
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

/** A stream that yields `chunks` chunks of `size` bytes, recording how many were pulled. */
function countingStream(
  size: number,
  chunks: number
): {
  readonly stream: ReadableStream<Uint8Array>;
  readonly pulled: () => number;
} {
  let count = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (count >= chunks) {
        controller.close();
        return;
      }
      count += 1;
      controller.enqueue(new Uint8Array(size).fill(0x50));
    },
  });
  return { stream, pulled: () => count };
}

describe("prdReview.server", () => {
  let tempDir: string;
  let docx: Buffer;
  const originalEnvFile = process.env.MM_ENV_FILE;
  const originalTempPath = process.env.MM_TEMP_PATH;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-prd-web-"));
    const envFile = path.join(tempDir, ".env");
    fs.writeFileSync(envFile, "MM_AI_PROVIDER=copilot\n", "utf8");
    process.env.MM_ENV_FILE = envFile;
    process.env.MM_TEMP_PATH = tempDir;
    docx = await buildDocx({ body: heading(1, "Goals") + para("Users can pay by card.") });
    runPrdReview.mockImplementation(async (options: { tempPath: string }) => ({
      runId: "20261023-120000-checkout-prd-abc123",
      report: { kind: "prd", readiness: { verdict: "ready" } },
      reportMarkdown: "# PRD review",
      paths: {
        reportMarkdown: path.join(
          options.tempPath,
          "reports",
          "prd-20261023-120000-checkout-prd-abc123-review-report.md"
        ),
      },
    }));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalEnvFile === undefined) delete process.env.MM_ENV_FILE;
    else process.env.MM_ENV_FILE = originalEnvFile;
    if (originalTempPath === undefined) delete process.env.MM_TEMP_PATH;
    else process.env.MM_TEMP_PATH = originalTempPath;
  });

  describe("handlePrdUpload", () => {
    it("starts a run for a valid .docx and streams the summary", async () => {
      const response = await handlePrdUpload(
        uploadRequest(new Uint8Array(docx), { [PRD_UPLOAD_HEADERS.includeImages]: "true" })
      );
      expect(response.status).toBe(200);
      const { runId } = (await response.json()) as { runId: string };

      const frames = await collectFrames(streamRun(runId, 0) as ReadableStream<Uint8Array>);
      const result = frames.find((frame) => frame.type === "result");
      expect(result?.summary).toMatchObject({
        prdRunId: "20261023-120000-checkout-prd-abc123",
        reportName: "prd-20261023-120000-checkout-prd-abc123-review-report.md",
        reportMarkdown: "# PRD review",
      });
      expect(frames.at(-1)).toMatchObject({ type: "done" });

      const [options] = runPrdReview.mock.calls[0] as [Record<string, unknown>];
      expect(options).toMatchObject({
        documentType: "prd",
        includeImages: true,
        tempPath: tempDir,
        source: { fileName: "Checkout PRD.docx" },
      });
      expect(Buffer.compare((options.source as { buffer: Buffer }).buffer, docx)).toBe(0);
    });

    it("persists the options but never the file in the run manifest", async () => {
      const response = await handlePrdUpload(uploadRequest(new Uint8Array(docx)));
      const { runId } = (await response.json()) as { runId: string };
      await collectFrames(streamRun(runId, 0) as ReadableStream<Uint8Array>);

      const manifest = JSON.parse(
        fs.readFileSync(path.join(tempDir, "runs", runId, "manifest.json"), "utf8")
      ) as { kind: string; input: Record<string, unknown> };
      expect(manifest.kind).toBe("prd");
      expect(manifest.input).toEqual({
        documentType: "prd",
        includeImages: false,
        fileName: "Checkout PRD.docx",
        sizeBytes: docx.length,
      });
    });

    it("rejects an oversized body from Content-Length with 413 before reading it", async () => {
      const { stream, pulled } = countingStream(1024, 10);
      const response = await handlePrdUpload(
        uploadRequest(stream, { "content-length": String(MAX_DOCX_BYTES + 1) }, { duplex: "half" })
      );
      expect(response.status).toBe(413);
      expect(((await response.json()) as { error: string }).error).toMatch(
        /which is over the 20 MB limit/
      );
      // The stream itself pre-fills one chunk (its high-water mark); nothing more is read.
      expect(pulled()).toBeLessThanOrEqual(1);
      expect(runPrdReview).not.toHaveBeenCalled();
    });

    it("rejects a non-zip file with a .docx name", async () => {
      const response = await handlePrdUpload(
        uploadRequest(new TextEncoder().encode("just some text, not a zip"))
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe(
        "This file can't be reviewed: file is not a .docx (missing zip signature)."
      );
      expect(runPrdReview).not.toHaveBeenCalled();
    });

    it("rejects a legacy .doc (OLE compound file) renamed to .docx", async () => {
      const ole = new Uint8Array(64);
      ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
      const response = await handlePrdUpload(uploadRequest(ole));
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(/legacy \.doc/);
    });

    it("rejects an empty body", async () => {
      const response = await handlePrdUpload(uploadRequest(null));
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(/file is empty/);
    });

    it("rejects an unknown document type", async () => {
      const response = await handlePrdUpload(
        uploadRequest(new Uint8Array(docx), { [PRD_UPLOAD_HEADERS.documentType]: "brd" })
      );
      expect(response.status).toBe(400);
      expect(runPrdReview).not.toHaveBeenCalled();
    });

    it("strips path traversal from the uploaded file name", async () => {
      const response = await handlePrdUpload(
        uploadRequest(new Uint8Array(docx), {
          [PRD_UPLOAD_HEADERS.fileName]: encodeURIComponent("../../etc/passwd.docx"),
        })
      );
      const { runId } = (await response.json()) as { runId: string };
      await collectFrames(streamRun(runId, 0) as ReadableStream<Uint8Array>);

      const [options] = runPrdReview.mock.calls[0] as [{ source: { fileName: string } }];
      expect(options.source.fileName).toBe("passwd.docx");
      expect(runId).not.toContain("..");
      expect(runId).not.toContain("passwd");
    });
  });

  describe("readUploadBody", () => {
    it("stops reading once the streamed bytes pass the cap", async () => {
      const { stream, pulled } = countingStream(1024, 100);
      await expect(
        readUploadBody(uploadRequest(stream, {}, { duplex: "half" }), 4096)
      ).rejects.toThrow(/which is over the/);
      expect(pulled()).toBeLessThan(10);
    });

    it("returns the whole body when it fits", async () => {
      const body = await readUploadBody(uploadRequest(new Uint8Array([1, 2, 3])), 4096);
      expect([...body]).toEqual([1, 2, 3]);
    });
  });

  describe("sanitizeUploadFileName", () => {
    it.each([
      ["../../etc/passwd.docx", "passwd.docx"],
      ["..\\..\\Windows\\win.ini", "win.ini.docx"],
      [encodeURIComponent("C:\\Users\\me\\Spec v2.docx"), "Spec v2.docx"],
      ["..", "document.docx"],
      [".hidden.docx", "hidden.docx"],
      ["a\u0000b\u001fc<>|.docx", "abc.docx"],
      ["%E0%A4%A", "%E0%A4%A.docx"],
      ["", "document.docx"],
      [null, "document.docx"],
    ])("sanitises %j to %j", (raw, expected) => {
      expect(sanitizeUploadFileName(raw)).toBe(expected);
    });

    it("caps the length and keeps the extension", () => {
      const name = sanitizeUploadFileName(`${"x".repeat(500)}.docx`);
      expect(name.length).toBeLessThanOrEqual(120);
      expect(name.endsWith(".docx")).toBe(true);
    });
  });

  describe("parseUploadOptions", () => {
    it("reads the document type and image opt-in", () => {
      const headers = new Headers({
        [PRD_UPLOAD_HEADERS.documentType]: "FRD",
        [PRD_UPLOAD_HEADERS.includeImages]: "true",
      });
      expect(parseUploadOptions(headers)).toEqual({ documentType: "frd", includeImages: true });
    });

    it("defaults images to off", () => {
      const headers = new Headers({ [PRD_UPLOAD_HEADERS.documentType]: "prd" });
      expect(parseUploadOptions(headers).includeImages).toBe(false);
    });

    it("requires a document type", () => {
      expect(() => parseUploadOptions(new Headers())).toThrow(/documentType/);
    });
  });
});
