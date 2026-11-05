import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ValidationError } from "@merge-mentor/shared/errors/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@merge-mentor/core/ai/providerFactory.js", () => ({
  createAIProvider: vi.fn(() => ({})),
}));

const runPrdBreakdown = vi.fn();
vi.mock("@merge-mentor/core/review/prd/breakdownEngine.js", () => ({ runPrdBreakdown }));

const { handlePrdBreakdownStart, parseBreakdownRequest } = await import("./prdBreakdown.server.js");
const { isPrdReviewActive, isPrdRunActive, startOrAttach, streamRun } =
  await import("./reviewRuns.server.js");

const RUN_ID = "web-20261023120000-aabbccdd";

function request(body: unknown, raw = false): Request {
  return new Request("http://127.0.0.1:3000/api/prd/breakdown", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

/** A promise that settles when `resolve` is called, to hold a run open. */
function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let release: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    release = done;
  });
  return { promise, resolve: () => release?.() };
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

describe("prdBreakdown.server", () => {
  let tempDir: string;
  const originalEnvFile = process.env.MM_ENV_FILE;
  const originalTempPath = process.env.MM_TEMP_PATH;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-prd-breakdown-web-"));
    const envFile = path.join(tempDir, ".env");
    fs.writeFileSync(envFile, "MM_AI_PROVIDER=copilot\n", "utf8");
    process.env.MM_ENV_FILE = envFile;
    process.env.MM_TEMP_PATH = tempDir;
    runPrdBreakdown.mockImplementation(async (options: { tempPath: string }) => ({
      runId: RUN_ID,
      report: { kind: "prd-breakdown", counts: { epics: 1, features: 1, pbis: 1 } },
      reportMarkdown: "# Work breakdown",
      paths: {
        breakdownMarkdown: path.join(options.tempPath, "reports", `prd-${RUN_ID}-breakdown.md`),
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

  describe("parseBreakdownRequest", () => {
    it("reads the run id and force flag", () => {
      expect(parseBreakdownRequest({ prdRunId: RUN_ID })).toEqual({
        mode: "breakdown",
        prdRunId: RUN_ID,
        force: false,
      });
      expect(parseBreakdownRequest({ prdRunId: RUN_ID, force: true })).toMatchObject({
        force: true,
      });
    });

    it.each([
      ["not an object", "run"],
      ["null", null],
      ["no run id", {}],
      ["a path as the run id", { prdRunId: "../../etc" }],
      ["a non-string run id", { prdRunId: 7 }],
      ["a non-boolean force", { prdRunId: RUN_ID, force: "yes" }],
    ])("rejects %s", (_name, body) => {
      expect(() => parseBreakdownRequest(body)).toThrow(ValidationError);
    });
  });

  describe("handlePrdBreakdownStart", () => {
    it("starts a breakdown of the named run and streams the summary", async () => {
      const response = await handlePrdBreakdownStart(request({ prdRunId: RUN_ID, force: true }));
      expect(response.status).toBe(200);
      const { runId } = (await response.json()) as { runId: string };

      const frames = await collectFrames(streamRun(runId, 0) as ReadableStream<Uint8Array>);
      expect(frames.find((frame) => frame.type === "result")?.summary).toMatchObject({
        prdRunId: RUN_ID,
        reportName: `prd-${RUN_ID}-breakdown.md`,
        reportMarkdown: "# Work breakdown",
      });
      expect(frames.at(-1)).toMatchObject({ type: "done" });
      expect(runPrdBreakdown).toHaveBeenCalledWith(
        expect.objectContaining({
          source: { fromRun: RUN_ID },
          force: true,
          tempPath: tempDir,
        }),
        expect.anything()
      );
    });

    it("records the run id in the manifest so deleting the run can find the stream log", async () => {
      const response = await handlePrdBreakdownStart(request({ prdRunId: RUN_ID }));
      const { runId } = (await response.json()) as { runId: string };
      await collectFrames(streamRun(runId, 0) as ReadableStream<Uint8Array>);

      const manifest = JSON.parse(
        fs.readFileSync(path.join(tempDir, "runs", runId, "manifest.json"), "utf8")
      ) as { kind: string; input: Record<string, unknown> };
      expect(manifest.kind).toBe("prd");
      expect(manifest.input).toEqual({ mode: "breakdown", prdRunId: RUN_ID, force: false });
    });

    it("attaches to a breakdown of the same run that is still running", async () => {
      const gate = deferred();
      runPrdBreakdown.mockImplementation(async () => {
        await gate.promise;
        return { paths: {} };
      });
      const first = (await (
        await handlePrdBreakdownStart(request({ prdRunId: RUN_ID }))
      ).json()) as { runId: string; attached: boolean };
      const second = (await (
        await handlePrdBreakdownStart(request({ prdRunId: RUN_ID }))
      ).json()) as { runId: string; attached: boolean };
      expect(second).toEqual({ runId: first.runId, attached: true });
      expect(isPrdRunActive(RUN_ID)).toBe(true);
      // A breakdown is not the review, so the review is not reported as running.
      expect(isPrdReviewActive(RUN_ID)).toBe(false);
      gate.resolve();
    });

    it("refuses to break a document down while its review is still running", async () => {
      const gate = deferred();
      startOrAttach({
        kind: "prd",
        targetKey: "prd:prd:review-in-progress",
        label: "PRD · Checkout.docx",
        input: { documentType: "prd", prdRunId: RUN_ID },
        execute: () => gate.promise,
      });
      expect(isPrdReviewActive(RUN_ID)).toBe(true);

      const response = await handlePrdBreakdownStart(request({ prdRunId: RUN_ID }));
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toContain("still running");
      expect(runPrdBreakdown).not.toHaveBeenCalled();
      gate.resolve();
    });

    it("shows engine validation errors as plain sentences", async () => {
      runPrdBreakdown.mockRejectedValue(
        new ValidationError("review", "the review of this document found blockers")
      );
      const response = await handlePrdBreakdownStart(request({ prdRunId: RUN_ID }));
      const { runId } = (await response.json()) as { runId: string };
      const frames = await collectFrames(streamRun(runId, 0) as ReadableStream<Uint8Array>);
      expect(frames.find((frame) => frame.type === "error")).toMatchObject({
        message: "the review of this document found blockers.",
      });
    });

    it("rejects invalid bodies with 400", async () => {
      const unsafe = await handlePrdBreakdownStart(request({ prdRunId: "../x" }));
      expect(unsafe.status).toBe(400);
      expect(((await unsafe.json()) as { error: string }).error).toBe("the run id is not valid.");

      const notJson = await handlePrdBreakdownStart(request("{nope", true));
      expect(notJson.status).toBe(400);
      expect(((await notJson.json()) as { error: string }).error).toContain("not valid JSON");
      expect(runPrdBreakdown).not.toHaveBeenCalled();
    });
  });
});
