import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ValidationError } from "../errors/index.js";
import { deletePrdRun, isSafePrdRunId, prdRunIdFromReportName, prdRunPaths } from "./prdRuns.js";
import { classifyReport } from "./reportReader.js";

describe("prdRuns", () => {
  describe("isSafePrdRunId", () => {
    it.each(["20261023-101500-checkout-a1b2c3", "run_1", "A"])("accepts %s", (id) => {
      expect(isSafePrdRunId(id)).toBe(true);
    });

    it.each(["", "../etc", "a/b", "a\\b", "-leading", "a.b", "x".repeat(129)])(
      "rejects %j",
      (id) => {
        expect(isSafePrdRunId(id)).toBe(false);
      }
    );
  });

  describe("prdRunPaths", () => {
    it("keeps reports in the reports directory and data in a per-run directory", () => {
      const paths = prdRunPaths("/tmp/mm", "run-1");
      expect(paths).toEqual({
        runDir: path.join("/tmp/mm", "prd", "run-1"),
        sourceDocx: path.join("/tmp/mm", "prd", "run-1", "source.docx"),
        documentJson: path.join("/tmp/mm", "prd", "run-1", "document.json"),
        imagesDir: path.join("/tmp/mm", "prd", "run-1", "images"),
        reportMarkdown: path.join("/tmp/mm", "reports", "prd-run-1-review-report.md"),
        reportJson: path.join("/tmp/mm", "reports", "prd-run-1-review-report.json"),
      });
      expect(classifyReport(path.basename(paths.reportMarkdown))).toBe("prd");
    });

    it("rejects unsafe run ids", () => {
      expect(() => prdRunPaths("/tmp/mm", "../x")).toThrow(ValidationError);
    });
  });

  describe("prdRunIdFromReportName", () => {
    it("extracts the run id from Markdown and JSON report names", () => {
      expect(prdRunIdFromReportName("prd-run-1-review-report.md")).toBe("run-1");
      expect(prdRunIdFromReportName("prd-run-1-review-report.json")).toBe("run-1");
    });

    it("returns undefined for other reports and unsafe ids", () => {
      expect(prdRunIdFromReportName("pbi-7-review-report.md")).toBeUndefined();
      expect(prdRunIdFromReportName("prd-a.b-review-report.md")).toBeUndefined();
    });
  });

  describe("deletePrdRun", () => {
    let tempPath: string;

    beforeEach(async () => {
      tempPath = await mkdtemp(path.join(tmpdir(), "prd-runs-spec-"));
    });

    afterEach(async () => {
      await rm(tempPath, { recursive: true, force: true });
    });

    it("removes the reports, the source copy and the extracted data of one run only", async () => {
      const run = prdRunPaths(tempPath, "run-1");
      const other = prdRunPaths(tempPath, "run-2");
      for (const paths of [run, other]) {
        await mkdir(paths.runDir, { recursive: true });
        await mkdir(path.dirname(paths.reportMarkdown), { recursive: true });
        await writeFile(paths.sourceDocx, "docx");
        await writeFile(paths.documentJson, "{}");
        await writeFile(paths.reportMarkdown, "# Report");
        await writeFile(paths.reportJson, "{}");
      }

      await deletePrdRun("run-1", { tempPath });

      expect(await readdir(path.join(tempPath, "prd"))).toEqual(["run-2"]);
      expect((await readdir(path.join(tempPath, "reports"))).toSorted()).toEqual([
        "prd-run-2-review-report.json",
        "prd-run-2-review-report.md",
      ]);
    });

    it("ignores a run that was never written", async () => {
      await expect(deletePrdRun("missing", { tempPath })).resolves.toBeUndefined();
    });

    it("defaults to ./.mergementor and rejects unsafe ids before touching the filesystem", async () => {
      const fs = { rm: vi.fn().mockResolvedValue(undefined) };
      await deletePrdRun("run-1", { fs });
      expect(fs.rm).toHaveBeenCalledWith(path.join(process.cwd(), ".mergementor", "prd", "run-1"), {
        recursive: true,
        force: true,
      });

      fs.rm.mockClear();
      await expect(deletePrdRun("../../etc", { fs })).rejects.toThrow(ValidationError);
      expect(fs.rm).not.toHaveBeenCalled();
    });
  });
});
