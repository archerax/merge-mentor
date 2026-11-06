import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Config } from "@merge-mentor/config/config.js";
import { loadConfig } from "@merge-mentor/config/config.js";
import { createAIProvider } from "@merge-mentor/core/ai/providerFactory.js";
import type { PrdBreakdownResult } from "@merge-mentor/core/review/prd/breakdownEngine.js";
import { runPrdBreakdown } from "@merge-mentor/core/review/prd/breakdownEngine.js";
import type { FileSystem } from "@merge-mentor/shared/ports/index.js";
import { createCapturingOutputWriter } from "@merge-mentor/shared/ports/outputWriter.test-helper.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { program } from "../program.js";
import { executePrdBreakdown } from "./prdBreakdown.js";

vi.mock("@merge-mentor/config/config.js", () => ({
  loadConfig: vi.fn(),
  validateConfig: vi.fn(),
}));

vi.mock("@merge-mentor/core/ai/providerFactory.js", () => ({
  createAIProvider: vi.fn(() => ({ executePrompt: vi.fn() })),
}));

vi.mock("@merge-mentor/core/review/prd/breakdownEngine.js", () => ({
  runPrdBreakdown: vi.fn(),
}));

const TEMP_PATH = "/work/.mergementor";
const RUN_ID = "20261023-120000-checkout-abc123";

function createMockConfig(): Config {
  return {
    aiProvider: "copilot-sdk",
    aiModel: "claude-sonnet-4.6",
    copilotToken: "copilot-token",
    aiTimeoutMs: 120_000,
    tempPath: TEMP_PATH,
  } as Config;
}

function createResult(
  overrides: { ordered?: boolean; complete?: boolean } = {}
): PrdBreakdownResult {
  return {
    runId: RUN_ID,
    reportMarkdown: "# Work breakdown",
    report: {
      ordered: overrides.ordered ?? true,
      complete: overrides.complete ?? true,
    } as unknown as PrdBreakdownResult["report"],
    paths: {
      runDir: `${TEMP_PATH}/prd/${RUN_ID}`,
      sourceDocx: `${TEMP_PATH}/prd/${RUN_ID}/source.docx`,
      documentJson: `${TEMP_PATH}/prd/${RUN_ID}/document.json`,
      annotatedDocx: `${TEMP_PATH}/prd/${RUN_ID}/annotated.docx`,
      imagesDir: `${TEMP_PATH}/prd/${RUN_ID}/images`,
      transcriptsDir: `${TEMP_PATH}/prd/${RUN_ID}/transcripts`,
      reportMarkdown: `${TEMP_PATH}/reports/prd-${RUN_ID}-review-report.md`,
      reportJson: `${TEMP_PATH}/reports/prd-${RUN_ID}-review-report.json`,
      breakdownMarkdown: `${TEMP_PATH}/reports/prd-${RUN_ID}-breakdown.md`,
      breakdownJson: `${TEMP_PATH}/reports/prd-${RUN_ID}-breakdown.json`,
    },
  };
}

function fakeFs(size = 10): Pick<FileSystem, "stat"> {
  return {
    stat: vi.fn(
      async () => ({ size, isFile: () => true }) as Awaited<ReturnType<FileSystem["stat"]>>
    ),
  };
}

describe("executePrdBreakdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockReturnValue(createMockConfig());
    vi.mocked(runPrdBreakdown).mockResolvedValue(createResult());
  });

  it("breaks a file down with a least-privilege AI client", async () => {
    const output = createCapturingOutputWriter();

    const result = await executePrdBreakdown(
      "docs/checkout.docx",
      { type: "frd", provider: "opencode-sdk", force: true, tempPath: "/tmp/mm" },
      { output, fileSystem: fakeFs() }
    );

    expect(result.runId).toBe(RUN_ID);
    expect(createAIProvider).toHaveBeenCalledWith(
      "opencode-sdk",
      expect.objectContaining({ enableWriteTools: false, enableShellTools: false })
    );
    expect(runPrdBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { path: path.resolve("docs/checkout.docx") },
        documentType: "frd",
        force: true,
        tempPath: TEMP_PATH,
        aiProvider: "opencode-sdk",
        output,
      }),
      expect.objectContaining({ aiClient: expect.any(Object) })
    );
  });

  it("breaks down the stored document of a review without reading a file", async () => {
    const fileSystem = fakeFs();
    await executePrdBreakdown(
      undefined,
      { fromReview: ` ${RUN_ID} ` },
      { output: createCapturingOutputWriter(), fileSystem }
    );

    expect(fileSystem.stat).not.toHaveBeenCalled();
    expect(runPrdBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({ source: { fromRun: RUN_ID }, documentType: "prd", force: false }),
      expect.any(Object)
    );
  });

  it("prints where the breakdown is and how to delete it", async () => {
    const output = createCapturingOutputWriter();
    await executePrdBreakdown("a.docx", {}, { output, fileSystem: fakeFs() });

    const text = output.output.map((entry) => entry.data).join("\n");
    expect(text).toContain(`prd-${RUN_ID}-breakdown.md`);
    expect(text).toContain(`prd-${RUN_ID}-breakdown.json`);
    expect(text).toContain("Reports page");
    expect(text).not.toContain("could not run");
    expect(text).not.toContain("not covered");
  });

  it("warns when the items could not be ordered or parts were not covered", async () => {
    vi.mocked(runPrdBreakdown).mockResolvedValueOnce(
      createResult({ ordered: false, complete: false })
    );
    const output = createCapturingOutputWriter();
    await executePrdBreakdown("a.docx", {}, { output, fileSystem: fakeFs() });

    const text = output.output.map((entry) => entry.data).join("\n");
    expect(text).toContain("could not run, so the items follow the order of the document");
    expect(text).toContain("Parts of the document were not covered");
  });

  it("needs exactly one of a file and --from-review", async () => {
    await expect(executePrdBreakdown(undefined, {}, { fileSystem: fakeFs() })).rejects.toThrow(
      "give the Word document to break down"
    );
    await expect(
      executePrdBreakdown("a.docx", { fromReview: RUN_ID }, { fileSystem: fakeFs() })
    ).rejects.toThrow("not both");
    expect(loadConfig).not.toHaveBeenCalled();
    expect(runPrdBreakdown).not.toHaveBeenCalled();
  });

  it("rejects an invalid --type and an oversized file before starting the AI provider", async () => {
    await expect(
      executePrdBreakdown("a.docx", { type: "spec" }, { fileSystem: fakeFs() })
    ).rejects.toThrow('"spec" is not a document type');
    await expect(
      executePrdBreakdown("big.docx", {}, { fileSystem: fakeFs(21 * 1024 * 1024) })
    ).rejects.toThrow("big.docx is 21 MB, which is over the 20 MB limit");
    expect(createAIProvider).not.toHaveBeenCalled();
  });

  it("propagates engine errors", async () => {
    vi.mocked(runPrdBreakdown).mockRejectedValueOnce(new Error("review found blockers"));
    await expect(
      executePrdBreakdown(undefined, { fromReview: RUN_ID }, { fileSystem: fakeFs() })
    ).rejects.toThrow("review found blockers");
  });
});

describe("prd-breakdown command", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let dir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(loadConfig).mockReturnValue(createMockConfig());
    vi.mocked(runPrdBreakdown).mockResolvedValue(createResult());
    dir = await mkdtemp(path.join(os.tmpdir(), "mm-prd-breakdown-cli-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("breaks a file down and exits 0", async () => {
    const file = path.join(dir, "checkout.docx");
    await writeFile(file, "placeholder");

    await program.parseAsync(["node", "test", "prd-breakdown", file, "--type", "frd", "--force"]);

    expect(runPrdBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({ source: { path: file }, documentType: "frd", force: true }),
      expect.any(Object)
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("breaks down a reviewed document with --from-review", async () => {
    await program.parseAsync(["node", "test", "prd-breakdown", "--from-review", RUN_ID]);

    expect(runPrdBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({ source: { fromRun: RUN_ID } }),
      expect.any(Object)
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("prints an error and exits 1 when no document is given", async () => {
    await program.parseAsync(["node", "test", "prd-breakdown"]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("give the Word document to break down")
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
