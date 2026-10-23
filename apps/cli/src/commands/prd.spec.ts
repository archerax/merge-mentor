import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Config } from "@merge-mentor/config/config.js";
import { loadConfig } from "@merge-mentor/config/config.js";
import { createAIProvider } from "@merge-mentor/core/ai/providerFactory.js";
import type { PrdReviewResult } from "@merge-mentor/core/review/prd/prdEngine.js";
import { runPrdReview } from "@merge-mentor/core/review/prd/prdEngine.js";
import type { FileSystem } from "@merge-mentor/shared/ports/index.js";
import { createCapturingOutputWriter } from "@merge-mentor/shared/ports/outputWriter.test-helper.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { program } from "../program.js";
import { executePrdReview, parsePrdDocumentType } from "./prd.js";

vi.mock("@merge-mentor/config/config.js", () => ({
  loadConfig: vi.fn(),
  validateConfig: vi.fn(),
}));

vi.mock("@merge-mentor/core/ai/providerFactory.js", () => ({
  createAIProvider: vi.fn(() => ({ executePrompt: vi.fn() })),
}));

vi.mock("@merge-mentor/core/review/prd/prdEngine.js", () => ({
  runPrdReview: vi.fn(),
}));

const TEMP_PATH = "/work/.mergementor";

function createMockConfig(overrides: Partial<Config> = {}): Config {
  return {
    aiProvider: "copilot-sdk",
    aiModel: "claude-sonnet-4.6",
    copilotToken: "copilot-token",
    aiTimeoutMs: 120_000,
    tempPath: TEMP_PATH,
    ...overrides,
  } as Config;
}

function createResult(overrides: { complete?: boolean } = {}): PrdReviewResult {
  const runId = "20261023-120000-checkout-abc123";
  return {
    runId,
    reportMarkdown: "# Report",
    report: {
      complete: overrides.complete ?? true,
      readiness: { verdict: "Needs work", summary: "Some gaps." },
      counts: { Blocker: 1, Major: 2, Minor: 3 },
      notReviewed: [],
    } as unknown as PrdReviewResult["report"],
    paths: {
      runDir: `${TEMP_PATH}/prd/${runId}`,
      sourceDocx: `${TEMP_PATH}/prd/${runId}/source.docx`,
      documentJson: `${TEMP_PATH}/prd/${runId}/document.json`,
      imagesDir: `${TEMP_PATH}/prd/${runId}/images`,
      transcriptsDir: `${TEMP_PATH}/prd/${runId}/transcripts`,
      reportMarkdown: `${TEMP_PATH}/reports/prd-${runId}-review-report.md`,
      reportJson: `${TEMP_PATH}/reports/prd-${runId}-review-report.json`,
    },
  };
}

function fakeFs(stats: { size: number; isFile?: boolean } | Error): Pick<FileSystem, "stat"> {
  return {
    stat: vi.fn(async () => {
      if (stats instanceof Error) throw stats;
      return { size: stats.size, isFile: () => stats.isFile ?? true } as Awaited<
        ReturnType<FileSystem["stat"]>
      >;
    }),
  };
}

describe("parsePrdDocumentType", () => {
  it("defaults to prd", () => {
    expect(parsePrdDocumentType(undefined)).toBe("prd");
  });

  it("accepts prd and frd case-insensitively", () => {
    expect(parsePrdDocumentType("PRD")).toBe("prd");
    expect(parsePrdDocumentType(" frd ")).toBe("frd");
  });

  it("rejects other values", () => {
    expect(() => parsePrdDocumentType("brd")).toThrow('"brd" is not a document type');
  });
});

describe("executePrdReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockReturnValue(createMockConfig());
    vi.mocked(runPrdReview).mockResolvedValue(createResult());
  });

  it("runs the engine with the resolved config and a least-privilege AI client", async () => {
    const output = createCapturingOutputWriter();

    const result = await executePrdReview(
      "docs/checkout.docx",
      { type: "frd", provider: "opencode-sdk", aiModel: "gpt-5", tempPath: "/tmp/mm" },
      { output, fileSystem: fakeFs({ size: 1024 }) }
    );

    expect(result.runId).toBe("20261023-120000-checkout-abc123");
    expect(loadConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        aiProvider: "opencode-sdk",
        aiModel: "gpt-5",
        tempPath: "/tmp/mm",
      })
    );
    expect(createAIProvider).toHaveBeenCalledWith(
      "opencode-sdk",
      expect.objectContaining({
        model: "claude-sonnet-4.6",
        token: "copilot-token",
        timeoutMs: 120_000,
        tempPath: TEMP_PATH,
        enableWriteTools: false,
        enableShellTools: false,
      })
    );
    expect(runPrdReview).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { path: path.resolve("docs/checkout.docx") },
        documentType: "frd",
        includeImages: false,
        tempPath: TEMP_PATH,
        aiProvider: "opencode-sdk",
        aiModel: "claude-sonnet-4.6",
        output,
      }),
      expect.objectContaining({ aiClient: expect.any(Object) })
    );
  });

  it("uses the configured provider and prd rubric by default", async () => {
    await executePrdReview(
      "a.docx",
      {},
      { output: createCapturingOutputWriter(), fileSystem: fakeFs({ size: 10 }) }
    );

    expect(createAIProvider).toHaveBeenCalledWith("copilot-sdk", expect.any(Object));
    expect(runPrdReview).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: "prd", aiProvider: "copilot-sdk" }),
      expect.any(Object)
    );
  });

  it("prints where the run's files are and how to delete them", async () => {
    const output = createCapturingOutputWriter();

    await executePrdReview("a.docx", {}, { output, fileSystem: fakeFs({ size: 10 }) });

    const text = output.output.map((entry) => entry.data).join("\n");
    expect(text).toContain("prd-20261023-120000-checkout-abc123-review-report.md");
    expect(text).toContain("prd-20261023-120000-checkout-abc123-review-report.json");
    expect(text).toContain(`${TEMP_PATH}/prd/20261023-120000-checkout-abc123`);
    expect(text).toContain("Reports page");
    expect(text).not.toContain("were not reviewed");
  });

  it("warns when parts of the document were not reviewed", async () => {
    vi.mocked(runPrdReview).mockResolvedValueOnce(createResult({ complete: false }));
    const output = createCapturingOutputWriter();

    await executePrdReview("a.docx", {}, { output, fileSystem: fakeFs({ size: 10 }) });

    expect(output.output.map((entry) => entry.data).join("\n")).toContain(
      "Parts of the document were not reviewed"
    );
  });

  it("passes --include-images through without a not-available note", async () => {
    const output = createCapturingOutputWriter();

    await executePrdReview(
      "a.docx",
      { includeImages: true },
      { output, fileSystem: fakeFs({ size: 10 }) }
    );

    expect(runPrdReview).toHaveBeenCalledWith(
      expect.objectContaining({ includeImages: true }),
      expect.any(Object)
    );
    expect(output.output.map((entry) => entry.data).join("\n")).not.toContain("not available");
  });

  it("warns when --include-images was set but the model cannot read images", async () => {
    const result = createResult();
    vi.mocked(runPrdReview).mockResolvedValueOnce({
      ...result,
      report: {
        ...result.report,
        imageReview: {
          supported: false,
          reason: 'the model "x" does not accept images',
          reviewed: 0,
        },
      },
    });
    const output = createCapturingOutputWriter();

    await executePrdReview(
      "a.docx",
      { includeImages: true },
      { output, fileSystem: fakeFs({ size: 10 }) }
    );

    expect(output.output.map((entry) => entry.data).join("\n")).toContain(
      '--include-images was set, but images were not reviewed: the model "x" does not accept images.'
    );
  });

  it("rejects an invalid --type before doing any work", async () => {
    const fileSystem = fakeFs({ size: 10 });

    await expect(executePrdReview("a.docx", { type: "spec" }, { fileSystem })).rejects.toThrow(
      'Validation failed for --type: "spec" is not a document type; use prd or frd'
    );
    expect(fileSystem.stat).not.toHaveBeenCalled();
    expect(runPrdReview).not.toHaveBeenCalled();
  });

  it("rejects a missing file", async () => {
    await expect(
      executePrdReview("missing.docx", {}, { fileSystem: fakeFs(new Error("ENOENT")) })
    ).rejects.toThrow("missing.docx was not found");
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it("rejects a directory", async () => {
    await expect(
      executePrdReview("folder", {}, { fileSystem: fakeFs({ size: 0, isFile: false }) })
    ).rejects.toThrow("folder is not a file");
  });

  it("rejects a file over the 20 MB limit before starting the AI provider", async () => {
    await expect(
      executePrdReview("big.docx", {}, { fileSystem: fakeFs({ size: 21 * 1024 * 1024 }) })
    ).rejects.toThrow("big.docx is 21 MB, which is over the 20 MB limit");
    expect(createAIProvider).not.toHaveBeenCalled();
    expect(runPrdReview).not.toHaveBeenCalled();
  });

  it("propagates engine errors", async () => {
    vi.mocked(runPrdReview).mockRejectedValueOnce(new Error("file is not a .docx"));

    await expect(
      executePrdReview(
        "a.docx",
        {},
        { output: createCapturingOutputWriter(), fileSystem: fakeFs({ size: 10 }) }
      )
    ).rejects.toThrow("file is not a .docx");
  });
});

describe("prd command", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let dir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(loadConfig).mockReturnValue(createMockConfig());
    vi.mocked(runPrdReview).mockResolvedValue(createResult());
    dir = await mkdtemp(path.join(os.tmpdir(), "mm-prd-cli-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("reviews a document and exits 0", async () => {
    const file = path.join(dir, "checkout.docx");
    await writeFile(file, "placeholder");

    await program.parseAsync([
      "node",
      "test",
      "prd",
      file,
      "--type",
      "frd",
      "--include-images",
      "--ai-timeout",
      "5000",
    ]);

    expect(loadConfig).toHaveBeenCalledWith(expect.objectContaining({ aiTimeout: 5000 }));
    expect(runPrdReview).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { path: file },
        documentType: "frd",
        includeImages: true,
      }),
      expect.any(Object)
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("prints an error and exits 1 for an invalid --type", async () => {
    const file = path.join(dir, "checkout.docx");
    await writeFile(file, "placeholder");

    await program.parseAsync(["node", "test", "prd", file, "--type", "brd"]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"brd" is not a document type')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("prints an error and exits 1 when the engine fails", async () => {
    const file = path.join(dir, "notes.txt");
    await writeFile(file, "plain text");
    vi.mocked(runPrdReview).mockRejectedValueOnce(
      new Error("Validation failed for docx: file is not a .docx (missing zip signature)")
    );

    await program.parseAsync(["node", "test", "prd", file]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("file is not a .docx (missing zip signature)")
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
