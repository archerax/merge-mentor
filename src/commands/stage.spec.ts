import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIResponse } from "../ai/types.js";
import type { FileFinding } from "../platforms/types.js";
import type { OutputWriter } from "../ports/index.js";
import type { ReviewResult } from "../review/engine.js";
import { createScratchRepo, type ScratchRepo } from "../review/gitClients/gitRepo.test-helper.js";
import {
  countStageIssuesBySeverity,
  displayStageResults,
  emptyStageResult,
  executeStage,
  generateStageMarkdownReport,
  hasBlockingFindings,
  stageReviewToJson,
} from "./stage.js";

const providers: Array<{
  executePrompt: ReturnType<typeof vi.fn>;
  parseFastReview: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("../ai/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ai/index.js")>();
  return {
    ...actual,
    createAIProvider: vi.fn(() => {
      const provider = {
        executePrompt: vi
          .fn()
          .mockResolvedValue({ raw: "[]", parsed: {}, tokenUsage: undefined } as AIResponse),
        parseFileReview: vi.fn(),
        parseCrossFileReview: vi.fn(),
        parseBatchedFileReview: vi.fn(),
        parseFastReview: vi.fn().mockReturnValue({
          fileResults: [
            {
              filename: "src/bug.ts",
              findings: [makeFinding({ line: 1, severity: "critical" })],
            },
          ],
          crossFileResult: {
            overallAssessment: "One blocking issue found.",
            findings: [],
            recommendations: [],
          },
        }),
      };
      providers.push(provider);
      return provider;
    }),
  };
});

function makeFinding(overrides: Partial<FileFinding> = {}): FileFinding {
  return {
    line: 1,
    severity: "high",
    confidence: "high",
    category: "bug",
    message: "off-by-one error",
    suggestion: "increment the counter",
    reasoning: "the counter is never advanced",
    ...overrides,
  };
}

function makeReviewResult(): ReviewResult {
  return {
    prDetails: {
      number: -1,
      title: "",
      description: "",
      author: "local",
      baseBranch: "HEAD",
      headBranch: "main",
    },
    filesReviewed: 1,
    filesSkipped: 0,
    filesIgnored: 0,
    ignoredFiles: [],
    fileResults: [{ filename: "src/bug.ts", findings: [makeFinding({ severity: "high" })] }],
    linesAdded: 1,
    linesDeleted: 0,
    crossFileResult: {
      overallAssessment: "Assessment",
      findings: [],
      recommendations: ["Add tests"],
    },
    commentsCreated: 0,
    commentErrors: [],
  };
}

function makeOutput(): OutputWriter & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    log: (msg) => lines.push(msg),
    error: (msg) => lines.push(`ERROR: ${msg}`),
    write: (data) => {
      lines.push(data);
      return true;
    },
  };
}

describe("executeStage", () => {
  let repo: ScratchRepo;
  let tempPath: string;

  beforeEach(() => {
    repo = createScratchRepo();
    tempPath = mkdtempSync(join(tmpdir(), "mm-stage-cmd-"));
    providers.length = 0;
  });

  afterEach(() => {
    repo.cleanup();
    rmSync(tempPath, { recursive: true, force: true });
  });

  it("reports no changes on a clean working tree without initializing the AI provider", async () => {
    const output = makeOutput();
    const { result } = await executeStage(
      { dir: repo.path, tempPath, streamingEnabled: false },
      { output }
    );

    expect(result.filesReviewed).toBe(0);
    expect(providers).toHaveLength(0);
    expect(output.lines.join("\n")).toContain("No changes detected");
  });

  it("reviews staged changes and reports findings", async () => {
    repo.write("src/bug.ts", "export function double(x: number) {\n  return x + 1;\n}\n");
    repo.git("add", "src/bug.ts");

    const { result } = await executeStage({
      dir: repo.path,
      tempPath,
      staged: true,
      streamingEnabled: false,
    });

    expect(result.filesReviewed).toBe(1);
    expect(result.fileResults[0].filename).toBe("src/bug.ts");
    expect(result.fileResults[0].findings[0].severity).toBe("critical");
    expect(result.prDetails.headBranch).toBe("main");
  });

  it("reuses the per-file cache across runs (no AI calls on an unchanged tree)", async () => {
    repo.write("src/bug.ts", "export function double(x: number) {\n  return x + 1;\n}\n");
    repo.git("add", "src/bug.ts");

    const options = { dir: repo.path, tempPath, staged: true, streamingEnabled: false };

    await executeStage(options);
    expect(providers).toHaveLength(1);
    expect(providers[0].executePrompt).toHaveBeenCalledTimes(1);

    await executeStage(options);
    expect(providers).toHaveLength(2);
    expect(providers[1].executePrompt).not.toHaveBeenCalled();
  });

  it("skips the cache when --no-cache is set", async () => {
    repo.write("src/bug.ts", "export function double(x: number) {\n  return x + 1;\n}\n");
    repo.git("add", "src/bug.ts");

    const options = {
      dir: repo.path,
      tempPath,
      staged: true,
      streamingEnabled: false,
      noCache: true,
    };

    await executeStage(options);
    await executeStage(options);

    expect(providers).toHaveLength(2);
    expect(providers[1].executePrompt).toHaveBeenCalledTimes(1);
  });

  it("re-reviews all files with --re-review but still writes fresh cache", async () => {
    repo.write("src/bug.ts", "export function double(x: number) {\n  return x + 1;\n}\n");
    repo.git("add", "src/bug.ts");

    const baseOptions = { dir: repo.path, tempPath, staged: true, streamingEnabled: false };
    const reReviewOptions = { ...baseOptions, reReview: true };

    await executeStage(reReviewOptions);
    expect(providers[0].executePrompt).toHaveBeenCalledTimes(1);

    await executeStage(reReviewOptions);
    expect(providers[1].executePrompt).toHaveBeenCalledTimes(1);

    await executeStage(baseOptions);
    expect(providers[2].executePrompt).not.toHaveBeenCalled();
  });
});

describe("stage helpers", () => {
  it("hasBlockingFindings flags critical/high findings", () => {
    const result = makeReviewResult();
    expect(hasBlockingFindings(result)).toBe(true);

    const clean = emptyStageResult(result.prDetails);
    expect(hasBlockingFindings(clean)).toBe(false);

    const mediumOnly: ReviewResult = {
      ...result,
      fileResults: [{ filename: "a.ts", findings: [makeFinding({ severity: "medium" })] }],
    };
    expect(hasBlockingFindings(mediumOnly)).toBe(false);
  });

  it("counts issues by severity", () => {
    const counts = countStageIssuesBySeverity(makeReviewResult());
    expect(counts.high).toBe(1);
    expect(counts.critical).toBe(0);
  });

  it("emptyStageResult returns a stable clean result", () => {
    const result = emptyStageResult({
      number: -1,
      title: "",
      description: "",
      author: "local",
      baseBranch: "HEAD",
      headBranch: "main",
    });
    expect(result.filesReviewed).toBe(0);
    expect(result.commentsCreated).toBe(0);
    expect(result.crossFileResult.overallAssessment).toBe("No changes detected");
  });

  it("generateStageMarkdownReport includes findings and branch info", () => {
    const report = generateStageMarkdownReport(makeReviewResult(), "opencode-sdk");
    expect(report).toContain("# Staged Review Report");
    expect(report).toContain("off-by-one error");
    expect(report).toContain("`main` → `HEAD`");
  });

  it("stageReviewToJson produces a stable schema", () => {
    const json = JSON.parse(stageReviewToJson(makeReviewResult(), "opencode-sdk")) as {
      tool: string;
      command: string;
      branch: { head: string; base: string };
      fileResults: Array<{ filename: string; findings: Array<{ line: number; severity: string }> }>;
    };
    expect(json.tool).toBe("merge-mentor");
    expect(json.command).toBe("stage");
    expect(json.branch).toEqual({ head: "main", base: "HEAD" });
    expect(json.fileResults[0].filename).toBe("src/bug.ts");
    expect(json.fileResults[0].findings[0].severity).toBe("high");
  });

  it("displayStageResults writes a JSON report file with --format json --output", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "mm-stage-report-"));
    try {
      const outputFile = join(outputDir, "stage.json");
      displayStageResults(
        makeReviewResult(),
        "opencode-sdk",
        { format: "json", output: outputFile },
        "general",
        undefined,
        "fast",
        "./.mergementor",
        { output: makeOutput() }
      );

      const parsed = JSON.parse(readFileSync(outputFile, "utf-8")) as { tool: string };
      expect(parsed.tool).toBe("merge-mentor");
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("displayStageResults writes a markdown report in terminal mode", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "mm-stage-report-"));
    try {
      const tempPath = join(outputDir, ".mergementor");
      mkdirSync(tempPath, { recursive: true });
      const output = makeOutput();
      displayStageResults(
        makeReviewResult(),
        "opencode-sdk",
        {},
        "general",
        undefined,
        "fast",
        tempPath,
        { output }
      );

      const reportFile = join(tempPath, "reports", "stage-main.md");
      const report = readFileSync(reportFile, "utf-8");
      expect(report).toContain("# Staged Review Report");
      expect(output.lines.join("\n")).toContain("Stage Review Complete");
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
