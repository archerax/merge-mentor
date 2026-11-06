import type { Dirent } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { LATEST_REVIEW, loadPreviousReview } from "./previousReview.js";

function report(runId: string, fileName: string, documentType = "prd"): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "prd",
    runId,
    documentType,
    source: { fileName },
    findings: [],
  });
}

function dirent(name: string): Dirent {
  return { name, isFile: () => true } as unknown as Dirent;
}

function fsWith(files: Record<string, string>) {
  return {
    readFile: vi.fn(async (file: string) => {
      const hit = Object.entries(files).find(([name]) => file.endsWith(name));
      if (!hit) throw new Error("ENOENT");
      return hit[1];
    }),
    readdir: vi.fn(async () => Object.keys(files).map(dirent)) as never,
  };
}

describe("loadPreviousReview", () => {
  it("loads a report by run id", async () => {
    const fs = fsWith({ "prd-run-a-review-report.json": report("run-a", "spec.docx") });
    const loaded = await loadPreviousReview("/t", "run-a", "spec.docx", "prd", fs);
    expect(loaded.runId).toBe("run-a");
  });

  it("picks the newest review of the same file for `latest`", async () => {
    const fs = fsWith({
      "prd-20261001-000000-spec-aaaaaa-review-report.json": report(
        "20261001-000000-spec-aaaaaa",
        "spec.docx"
      ),
      "prd-20261003-000000-other-bbbbbb-review-report.json": report(
        "20261003-000000-other-bbbbbb",
        "other.docx"
      ),
      "prd-20261002-000000-spec-cccccc-review-report.json": report(
        "20261002-000000-spec-cccccc",
        "spec.docx"
      ),
    });
    const loaded = await loadPreviousReview("/t", LATEST_REVIEW, "spec.docx", "prd", fs);
    expect(loaded.runId).toBe("20261002-000000-spec-cccccc");
  });

  it("rejects an unknown run id", async () => {
    await expect(loadPreviousReview("/t", "nope", "spec.docx", "prd", fsWith({}))).rejects.toThrow(
      /no review with run id/
    );
  });

  it("rejects `latest` when there is no earlier review of the file", async () => {
    await expect(
      loadPreviousReview("/t", "latest", "spec.docx", "prd", fsWith({}))
    ).rejects.toThrow(/no earlier review of spec.docx/);
  });

  it("rejects a review of a different document type", async () => {
    const fs = fsWith({ "prd-run-a-review-report.json": report("run-a", "spec.docx", "frd") });
    await expect(loadPreviousReview("/t", "run-a", "spec.docx", "prd", fs)).rejects.toThrow(
      /use the same --type/
    );
  });

  it("ignores a report file that is not valid", async () => {
    const fs = fsWith({ "prd-run-a-review-report.json": "{not json" });
    await expect(loadPreviousReview("/t", "run-a", "spec.docx", "prd", fs)).rejects.toThrow(
      /no review with run id/
    );
  });

  it("rejects an unsafe run id", async () => {
    await expect(
      loadPreviousReview("/t", "../etc", "spec.docx", "prd", fsWith({}))
    ).rejects.toThrow(/no review with run id/);
  });
});
