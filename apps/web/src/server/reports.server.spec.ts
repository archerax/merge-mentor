import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReviewRunManifest } from "./reviewRunStore.server.js";

const mockListReports = vi.fn<() => Promise<unknown[]>>(async () => []);
const mockReadReport = vi.fn(async () => undefined);
const mockDeletePrdRun = vi.fn(async () => undefined);

vi.mock("@merge-mentor/shared/reports/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@merge-mentor/shared/reports/index.js")>();
  return {
    isSafePrdRunId: actual.isSafePrdRunId,
    prdRunIdFromReportName: actual.prdRunIdFromReportName,
    listReports: mockListReports,
    readReport: mockReadReport,
    deletePrdRun: mockDeletePrdRun,
  };
});

const { loadReport, loadReports, removePrdRun } = await import("./reports.server.js");
const { writeManifest, writeSummary } = await import("./reviewRunStore.server.js");
const { startOrAttach } = await import("./reviewRuns.server.js");

describe("reports.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MM_TEMP_PATH = "/tmp/mm-reports";
  });

  it("lists reports from the temp reports directory", async () => {
    await loadReports();

    expect(mockListReports).toHaveBeenCalledWith({
      limit: 200,
      reportsDir: path.resolve("/tmp/mm-reports", "reports"),
    });
  });

  it("honours a custom limit", async () => {
    await loadReports(5);

    expect(mockListReports).toHaveBeenCalledWith({
      limit: 5,
      reportsDir: path.resolve("/tmp/mm-reports", "reports"),
    });
  });

  it("reads a single report by name from the temp reports directory", async () => {
    await loadReport("report-1.md");

    expect(mockReadReport).toHaveBeenCalledWith("report-1.md", {
      reportsDir: path.resolve("/tmp/mm-reports", "reports"),
    });
  });

  it("adds the PRD run id to prd reports only", async () => {
    mockListReports.mockResolvedValueOnce([
      { name: "prd-20261023-120000-spec-abc123-review-report.md", kind: "prd" },
      { name: "pbi-42-review-report.md", kind: "pbi" },
    ]);

    const reports = await loadReports();

    expect(reports[0]).toMatchObject({ prdRunId: "20261023-120000-spec-abc123" });
    expect(reports[1]).not.toHaveProperty("prdRunId");
  });

  describe("removePrdRun", () => {
    it("deletes a run with a safe id under the temp path", async () => {
      await removePrdRun("20261023-120000-spec-abc123");

      expect(mockDeletePrdRun).toHaveBeenCalledWith("20261023-120000-spec-abc123", {
        tempPath: path.resolve("/tmp/mm-reports"),
      });
    });

    it("also deletes the web stream log that holds the run's report", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-prd-delete-"));
      process.env.MM_TEMP_PATH = tempDir;
      try {
        const base: Omit<ReviewRunManifest, "runId" | "createdAt"> = {
          kind: "prd",
          targetKey: "t",
          input: {},
          label: "l",
          status: "done",
        };
        writeManifest(tempDir, { ...base, runId: "web-run-1", createdAt: 1 });
        writeSummary(tempDir, "web-run-1", { prdRunId: "20261023-120000-spec-abc123" });
        writeManifest(tempDir, { ...base, runId: "web-run-2", createdAt: 2 });
        writeSummary(tempDir, "web-run-2", { prdRunId: "20261023-120000-other-def456" });

        await removePrdRun("20261023-120000-spec-abc123");

        expect(fs.existsSync(path.join(tempDir, "runs", "web-run-1"))).toBe(false);
        expect(fs.existsSync(path.join(tempDir, "runs", "web-run-2"))).toBe(true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("refuses to delete a run whose review is still running", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-prd-delete-"));
      process.env.MM_TEMP_PATH = tempDir;
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      try {
        startOrAttach({
          kind: "prd",
          targetKey: "prd:active-delete",
          label: "l",
          input: { prdRunId: "web-20261023120000-11223344" },
          execute: () => finished,
        });

        await expect(removePrdRun("web-20261023120000-11223344")).rejects.toThrow(/still running/);
        expect(mockDeletePrdRun).not.toHaveBeenCalled();

        finish();
        await vi.waitFor(async () => {
          await removePrdRun("web-20261023120000-11223344");
        });
        expect(mockDeletePrdRun).toHaveBeenCalled();
      } finally {
        finish();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("finds the stream log through the manifest when no summary was saved", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-prd-delete-"));
      process.env.MM_TEMP_PATH = tempDir;
      try {
        writeManifest(tempDir, {
          kind: "prd",
          targetKey: "t",
          input: { prdRunId: "web-20261023120000-aabbccdd" },
          label: "l",
          status: "running",
          runId: "web-run-crashed",
          createdAt: 1,
        });

        await removePrdRun("web-20261023120000-aabbccdd");

        expect(fs.existsSync(path.join(tempDir, "runs", "web-run-crashed"))).toBe(false);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it.each([
      "../reports",
      "..",
      "a/b",
      "a\\b",
      "/etc/passwd",
      "",
      "run id",
      "run.id",
      "x".repeat(200),
    ])("rejects the unsafe run id %j without deleting anything", async (runId) => {
      await expect(removePrdRun(runId)).rejects.toThrow(/not a valid PRD run id/);
      expect(mockDeletePrdRun).not.toHaveBeenCalled();
    });

    it("rejects a non-string run id", async () => {
      await expect(removePrdRun({ runId: "x" })).rejects.toThrow(/not a valid PRD run id/);
      expect(mockDeletePrdRun).not.toHaveBeenCalled();
    });
  });
});
