import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempPath = "";

vi.mock("./env.server.js", () => ({
  refreshEnv: vi.fn(),
  resolveTempPath: () => tempPath,
}));

const { annotatedDownloadName, handleAnnotatedDownload } = await import("./prdAnnotated.server.js");

function download(run: string): Request {
  return new Request(`http://127.0.0.1:3000/api/prd/annotated?run=${encodeURIComponent(run)}`);
}

describe("annotatedDownloadName", () => {
  it("adds -reviewed and keeps a safe name", () => {
    expect(annotatedDownloadName("Checkout PRD.docx")).toBe("Checkout PRD-reviewed.docx");
  });

  it("falls back to a generic name and strips header-unsafe characters", () => {
    expect(annotatedDownloadName(undefined)).toBe("document-reviewed.docx");
    expect(annotatedDownloadName('a"b\r\nc.docx')).not.toMatch(/["\r\n]/);
  });
});

describe("handleAnnotatedDownload", () => {
  beforeEach(async () => {
    tempPath = await mkdtemp(path.join(tmpdir(), "mm-annotated-"));
  });
  afterEach(async () => {
    await rm(tempPath, { recursive: true, force: true });
  });

  it("serves the run's annotated copy as an attachment named after the document", async () => {
    await mkdir(path.join(tempPath, "prd", "run-1"), { recursive: true });
    await mkdir(path.join(tempPath, "reports"), { recursive: true });
    await writeFile(path.join(tempPath, "prd", "run-1", "annotated.docx"), "DOCX");
    await writeFile(
      path.join(tempPath, "reports", "prd-run-1-review-report.json"),
      JSON.stringify({ source: { fileName: "Spec.docx" } })
    );

    const response = await handleAnnotatedDownload(download("run-1"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Spec-reviewed.docx"'
    );
    expect(await response.text()).toBe("DOCX");
  });

  it("returns 404 when the run has no annotated copy", async () => {
    expect((await handleAnnotatedDownload(download("run-1"))).status).toBe(404);
  });

  it("rejects a run id that is not a single path segment", async () => {
    expect((await handleAnnotatedDownload(download("../secret"))).status).toBe(400);
    expect((await handleAnnotatedDownload(download(""))).status).toBe(400);
  });
});
