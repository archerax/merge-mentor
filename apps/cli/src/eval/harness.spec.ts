import type { Dirent, Stats } from "node:fs";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { FileFinding } from "@merge-mentor/domain/platform.js";
import { AIProviderError, CorpusEvalError } from "@merge-mentor/shared/errors/index.js";
import type { FileSystem } from "@merge-mentor/shared/ports/fileSystem.js";
import { describe, expect, it, vi } from "vitest";

import {
  evaluateCorpus,
  evaluateScenario,
  formatTerminalSummary,
  matchFinding,
  matchForbiddenFinding,
} from "./harness.js";
import type { ExpectedFinding, ForbiddenFinding, FullEvalReport } from "./types.js";

const mockProviderExecute = vi.fn(async () => ({ raw: "{}", parsed: { fileResults: [] } }));
vi.mock("@merge-mentor/core/ai/providerFactory.js", () => ({
  createAIProvider: vi.fn(() => ({
    executePrompt: mockProviderExecute,
    parseBatchedFileReview: () => [],
    parseFastReview: () => ({
      fileResults: [],
      crossFileResult: {
        overallAssessment: "No cross-file issues identified.",
        findings: [],
        recommendations: [],
      },
      reviewedFiles: [],
    }),
  })),
}));

function makeFinding(overrides: Partial<FileFinding & { filePath: string }> = {}) {
  return {
    filePath: "src/auth/login.ts",
    line: 1,
    category: "security",
    severity: "critical",
    confidence: "high",
    message: "message",
    suggestion: "fix",
    reasoning: "why",
    ...overrides,
  } as FileFinding & { filePath: string };
}

function securityFinding(overrides: Record<string, unknown>) {
  return {
    line: 1,
    severity: "high",
    category: "security",
    confidence: "high",
    suggestion: "x",
    reasoning: "y",
    ...overrides,
  };
}

function scenarioFs(files: Record<string, string>, accessFails: string[] = []): FileSystem {
  return {
    access: async (p: string) => {
      if (accessFails.some((suffix) => p.endsWith(suffix))) throw new Error("no access");
      if (p.endsWith("diffs/manifest.json") && !Object.keys(files).some((k) => p.endsWith(k))) {
        throw new Error("no access");
      }
    },
    readFile: async (p: string) => {
      for (const [suffix, content] of Object.entries(files)) {
        if (p.endsWith(suffix)) return content;
      }
      throw new Error(`File not found: ${p}`);
    },
    writeFile: vi.fn(async () => {}),
    mkdir: async () => undefined,
    stat: async () => ({ isDirectory: () => false, isFile: () => true, size: 0 }) as Stats,
    readdir: async () => [],
    unlink: async () => {},
    rm: async () => {},
  };
}

describe("Evaluation Harness Engine", () => {
  describe("matchFinding", () => {
    it("matches finding when path, category, minSeverity and keywords match", () => {
      const finding: FileFinding & { filePath: string } = {
        filePath: "src/auth/login.ts",
        line: 25,
        category: "security",
        severity: "critical",
        confidence: "high",
        message: "SQL Injection detected in login flow",
        suggestion: "Use parameterized query",
        reasoning: "Direct string concatenation with user input",
      };

      const expected: ExpectedFinding = {
        id: "exp-1",
        filePath: "src/auth/login.ts",
        category: "security",
        minSeverity: "high",
        containsKeywords: ["sql injection", "parameterized"],
      };

      expect(matchFinding(finding, expected)).toBe(true);
    });

    it("returns false if keyword is missing", () => {
      const finding: FileFinding & { filePath: string } = {
        filePath: "src/auth/login.ts",
        line: 25,
        category: "security",
        severity: "critical",
        confidence: "high",
        message: "SQL Injection detected",
        suggestion: "Fix query",
        reasoning: "Concatenation",
      };

      const expected: ExpectedFinding = {
        id: "exp-1",
        filePath: "src/auth/login.ts",
        category: "security",
        containsKeywords: ["missing-keyword"],
      };

      expect(matchFinding(finding, expected)).toBe(false);
    });

    it("matches finding using pipe-separated keyword alternatives and categories", () => {
      const finding: FileFinding & { filePath: string } = {
        filePath: "src/services/queueWorker.ts",
        line: 10,
        category: "quality",
        severity: "high",
        confidence: "high",
        message: "Floating unawaited promise detected",
        suggestion: "Await the promise",
        reasoning: "Unawaited promise call",
      };

      const expected: ExpectedFinding = {
        id: "exp-1",
        filePath: "src/services/queueWorker.ts",
        category: "quality|performance|architecture",
        containsKeywords: ["unhandled promise|unawaited promise|floating promise", "async|promise"],
      };

      expect(matchFinding(finding, expected)).toBe(true);
    });
  });

  describe("matchForbiddenFinding", () => {
    it("matches forbidden finding on matching file path", () => {
      const finding: FileFinding & { filePath: string } = {
        filePath: "src/auth/logger.ts",
        line: 10,
        category: "quality",
        severity: "low",
        confidence: "high",
        message: "Unnecessary logger refactor",
        suggestion: "Remove",
        reasoning: "Logger",
      };

      const forbidden: ForbiddenFinding = {
        id: "forbid-1",
        filePath: "src/auth/logger.ts",
        reason: "Logger refactor is benign",
      };

      expect(matchForbiddenFinding(finding, forbidden)).toBe(true);
    });
  });

  describe("evaluateScenario & evaluateCorpus with mock FileSystem", () => {
    it("evaluates scenario successfully with high recall and precision", async () => {
      const groundTruthJson = JSON.stringify({
        scenarioId: "01-sql-auth",
        name: "SQL Injection Scenario",
        description: "Tests SQL injection",
        expectedFindings: [
          {
            id: "exp-1",
            filePath: "src/auth/login.ts",
            category: "security",
            minSeverity: "critical",
            containsKeywords: ["sql injection"],
          },
        ],
        forbiddenFindings: [
          {
            id: "forbid-1",
            filePath: "src/auth/logger.ts",
            reason: "Logger is benign",
          },
        ],
        maxAllowedDuplicates: 0,
      });

      const mockResponseJson = JSON.stringify({
        fileResults: [
          {
            filename: "src/auth/login.ts",
            findings: [
              {
                line: 20,
                severity: "critical",
                category: "security",
                confidence: "high",
                message: "Critical SQL Injection vulnerability",
                suggestion: "Use prepared statements",
                reasoning: "Raw query construction",
              },
            ],
          },
        ],
      });

      const mockFs: FileSystem = {
        readFile: async (p: string) => {
          if (p.endsWith("ground-truth.json")) return groundTruthJson;
          if (p.endsWith("mock-response.json")) return mockResponseJson;
          throw new Error("File not found");
        },
        access: async (p: string) => {
          if (p.endsWith("diffs/manifest.json")) throw new Error("no access");
        },
        writeFile: async () => {},
        mkdir: async () => undefined,
        stat: async () => ({ isDirectory: () => false, isFile: () => true, size: 100 }) as Stats,
        readdir: async (p: string) =>
          p.includes("corpus")
            ? [{ name: "01-sql-auth", isDirectory: () => true, isFile: () => false } as Dirent]
            : [],
        unlink: async () => {},
        rm: async () => {},
      };

      const scenarioResult = await evaluateScenario("/test/corpus/01-sql-auth", {
        fileSystem: mockFs,
        provider: "mock",
      });

      expect(scenarioResult.passed).toBe(true);
      expect(scenarioResult.recall).toBe(1.0);
      expect(scenarioResult.precision).toBe(1.0);
      expect(scenarioResult.caughtFindings).toContain("exp-1");

      const corpusReport = await evaluateCorpus({
        corpusDir: "/test/corpus",
        fileSystem: mockFs,
        provider: "mock",
      });

      expect(corpusReport.overallPassed).toBe(true);
      expect(corpusReport.meanRecall).toBe(1.0);
      expect(corpusReport.scenarioResults).toHaveLength(1);

      const summaryText = formatTerminalSummary(corpusReport);
      expect(summaryText).toContain("GOLDEN-PR EVALUATION HARNESS REPORT");
      expect(summaryText).toContain("01-sql-auth");
    });
  });

  describe("matchFinding edge cases", () => {
    it("returns false on mismatched file paths", () => {
      expect(
        matchFinding(makeFinding(), {
          id: "e",
          filePath: "src/other/place.ts",
        } as ExpectedFinding)
      ).toBe(false);
    });

    it("returns false when severity is below the minimum", () => {
      expect(
        matchFinding(makeFinding({ severity: "low" }), {
          id: "e",
          filePath: "src/auth/login.ts",
          minSeverity: "critical",
        } as ExpectedFinding)
      ).toBe(false);
    });
  });

  describe("evaluateScenario failure and duplicate paths", () => {
    it("throws when ground-truth.json is missing", async () => {
      const fs = scenarioFs({}, ["ground-truth.json"]);
      await expect(evaluateScenario("/test/corpus/x", { fileSystem: fs })).rejects.toThrow(
        CorpusEvalError
      );
    });

    it("throws when ground-truth.json is malformed", async () => {
      const fs = scenarioFs({ "ground-truth.json": "{not json" });
      await expect(evaluateScenario("/test/corpus/x", { fileSystem: fs })).rejects.toThrow(
        "Failed to parse ground-truth.json"
      );
    });

    it("supports non-mock providers", async () => {
      const fs = scenarioFs({
        "ground-truth.json": JSON.stringify({
          scenarioId: "s",
          name: "S",
          expectedFindings: [],
          forbiddenFindings: [],
          maxAllowedDuplicates: 0,
        }),
      });

      const result = await evaluateScenario("/test/corpus/x", {
        fileSystem: fs,
        provider: "opencode-sdk",
      });

      expect(result.passed).toBe(true);
      expect(mockProviderExecute).toHaveBeenCalled();
    });

    it("runs non-mock providers in a diff-only sandbox without ground truth", async () => {
      const writes: string[] = [];
      const removed: string[] = [];
      const fs: FileSystem = {
        ...scenarioFs({
          "ground-truth.json": JSON.stringify({
            scenarioId: "s",
            name: "S",
            expectedFindings: [],
            forbiddenFindings: [],
            maxAllowedDuplicates: 0,
          }),
          "diffs/manifest.json": JSON.stringify({
            prIdentifier: "s",
            files: [
              {
                filename: "a.ts",
                status: "modified",
                diffPath: "a.diff",
                additions: 1,
                deletions: 0,
              },
            ],
          }),
          "a.diff": "+x",
        }),
        writeFile: async (p: string) => {
          writes.push(p);
        },
        rm: async (p: string) => {
          removed.push(p);
        },
      };
      mockProviderExecute.mockClear();

      await evaluateScenario("/test/corpus/x", { fileSystem: fs, provider: "copilot-sdk" });

      const [prompt, options] = mockProviderExecute.mock.calls[0] as unknown as [
        string,
        { workingDirectory: string; diffFiles: string[] },
      ];
      expect(prompt).toContain("EVALUATION SANDBOX");
      expect(options.workingDirectory).not.toContain("/test/corpus/x");
      expect(options.diffFiles).toHaveLength(1);
      expect(options.diffFiles[0].startsWith(options.workingDirectory)).toBe(true);
      expect(writes).toEqual([
        ...options.diffFiles,
        options.diffFiles[0].replace(".mergementor/diffs", "diffs"),
      ]);
      expect(removed).toEqual([options.workingDirectory]);
    });

    it("records a provider failure as a failed scenario instead of throwing", async () => {
      const fs = scenarioFs({
        "ground-truth.json": JSON.stringify({
          scenarioId: "s",
          name: "S",
          expectedFindings: [
            {
              id: "exp-1",
              filePath: "a.ts",
              category: "security",
              minSeverity: "high",
              containsKeywords: ["x"],
            },
          ],
          forbiddenFindings: [],
          maxAllowedDuplicates: 0,
        }),
      });
      mockProviderExecute.mockRejectedValueOnce(
        new AIProviderError("copilot-sdk", "No content in response from Copilot SDK")
      );

      const result = await evaluateScenario("/test/corpus/x", {
        fileSystem: fs,
        provider: "copilot-sdk",
      });

      expect(result.passed).toBe(false);
      expect(result.recall).toBe(0);
      expect(result.missedFindings).toEqual(["exp-1"]);
      expect(result.error).toContain("No content in response");
    });

    it("rethrows non-provider errors", async () => {
      const fs = scenarioFs({
        "ground-truth.json": JSON.stringify({
          scenarioId: "s",
          name: "S",
          expectedFindings: [],
          forbiddenFindings: [],
          maxAllowedDuplicates: 0,
        }),
      });
      mockProviderExecute.mockRejectedValueOnce(new TypeError("boom"));

      await expect(
        evaluateScenario("/test/corpus/x", { fileSystem: fs, provider: "copilot-sdk" })
      ).rejects.toThrow("boom");
    });

    it("records missed findings and false positives", async () => {
      const fs = scenarioFs({
        "ground-truth.json": JSON.stringify({
          scenarioId: "s",
          name: "S",
          expectedFindings: [
            {
              id: "exp-1",
              filePath: "src/auth/login.ts",
              category: "security",
              minSeverity: "critical",
              containsKeywords: ["sql injection"],
            },
          ],
          forbiddenFindings: [{ id: "f1", filePath: "src/auth/logger.ts", reason: "benign" }],
          maxAllowedDuplicates: 0,
        }),
        "mock-response.json": JSON.stringify({
          fileResults: [
            {
              filename: "src/auth/logger.ts",
              findings: [
                {
                  line: 1,
                  severity: "low",
                  category: "quality",
                  confidence: "high",
                  message: "logger refactor",
                  suggestion: "x",
                  reasoning: "y",
                },
              ],
            },
            {
              filename: "src/other.ts",
              findings: [
                {
                  line: 2,
                  severity: "low",
                  category: "quality",
                  confidence: "high",
                  message: "extra finding",
                  suggestion: "x",
                  reasoning: "y",
                },
              ],
            },
          ],
        }),
      });

      const result = await evaluateScenario("/test/corpus/s", { fileSystem: fs, provider: "mock" });

      expect(result.passed).toBe(false);
      expect(result.missedFindings).toEqual(["exp-1"]);
      expect(result.falsePositives).toHaveLength(2);
    });

    it("treats acceptable findings as neutral but still penalises unlisted ones", async () => {
      const fs = scenarioFs({
        "ground-truth.json": JSON.stringify({
          scenarioId: "s",
          name: "S",
          expectedFindings: [
            {
              id: "exp-1",
              filePath: "src/auth/login.ts",
              category: "security",
              containsKeywords: ["sql injection"],
            },
          ],
          forbiddenFindings: [],
          acceptableFindings: [
            {
              id: "ok-1",
              filePath: "src/auth/login.ts",
              category: "security",
              containsKeywords: ["plaintext"],
            },
          ],
          maxAllowedDuplicates: 0,
        }),
        "mock-response.json": JSON.stringify({
          fileResults: [
            {
              filename: "src/auth/login.ts",
              findings: [
                securityFinding({ message: "SQL injection in query" }),
                securityFinding({ line: 2, message: "Password compared in plaintext" }),
              ],
            },
          ],
        }),
      });

      const accepted = await evaluateScenario("/test/corpus/s", {
        fileSystem: fs,
        provider: "mock",
      });
      expect(accepted.falsePositives).toEqual([]);
      expect(accepted.precision).toBe(1);
      expect(accepted.passed).toBe(true);

      const strict = await evaluateScenario("/test/corpus/s", {
        fileSystem: scenarioFs({
          "ground-truth.json": JSON.stringify({
            scenarioId: "s",
            name: "S",
            expectedFindings: [
              {
                id: "exp-1",
                filePath: "src/auth/login.ts",
                category: "security",
                containsKeywords: ["sql injection"],
              },
            ],
            forbiddenFindings: [],
            maxAllowedDuplicates: 0,
          }),
          "mock-response.json": JSON.stringify({
            fileResults: [
              {
                filename: "src/auth/login.ts",
                findings: [
                  securityFinding({ message: "SQL injection in query" }),
                  securityFinding({ line: 2, message: "Password compared in plaintext" }),
                ],
              },
            ],
          }),
        }),
        provider: "mock",
      });
      expect(strict.falsePositives).toHaveLength(1);
      expect(strict.precision).toBe(0.5);
    });

    it("rejects a manifest entry without diffPath instead of silently skipping diffs", async () => {
      const fs = scenarioFs({
        "ground-truth.json": JSON.stringify({
          scenarioId: "s",
          name: "S",
          expectedFindings: [],
          forbiddenFindings: [],
          maxAllowedDuplicates: 0,
        }),
        "diffs/manifest.json": JSON.stringify({
          files: [{ filename: "a.ts", status: "modified", patchFile: "a.diff" }],
        }),
      });

      await expect(
        evaluateScenario("/test/corpus/s", { fileSystem: fs, provider: "mock" })
      ).rejects.toThrow(/no "diffPath"/);
    });

    it("counts duplicate findings", async () => {
      const duplicate = {
        line: 1,
        severity: "high",
        category: "bug",
        confidence: "high",
        message: "dup issue",
        suggestion: "x",
        reasoning: "y",
      };
      const fs = scenarioFs({
        "ground-truth.json": JSON.stringify({
          scenarioId: "s",
          name: "S",
          expectedFindings: [
            {
              id: "exp-1",
              filePath: "src/a.ts",
              category: "bug",
              minSeverity: "low",
              containsKeywords: ["dup"],
            },
          ],
          forbiddenFindings: [],
          maxAllowedDuplicates: 0,
        }),
        "mock-response.json": JSON.stringify({
          fileResults: [{ filename: "src/a.ts", findings: [duplicate, duplicate] }],
        }),
      });

      const result = await evaluateScenario("/test/corpus/s", { fileSystem: fs, provider: "mock" });

      expect(result.duplicateCount).toBe(1);
    });
  });

  describe("evaluateCorpus error paths", () => {
    it("throws when the corpus directory is missing", async () => {
      const fs = {
        access: async () => {
          throw new Error("missing");
        },
        readFile: async () => "",
        writeFile: async () => {},
        mkdir: async () => undefined,
        stat: async () => ({ isDirectory: () => false, isFile: () => true, size: 0 }) as Stats,
        readdir: async () => [],
        unlink: async () => {},
        rm: async () => {},
      } satisfies FileSystem;

      await expect(evaluateCorpus({ corpusDir: "/test/missing", fileSystem: fs })).rejects.toThrow(
        "Evaluation corpus directory not found"
      );
    });

    it("throws when no scenarios are found", async () => {
      const fs: FileSystem = {
        access: async (p: string) => {
          if (p.endsWith("ground-truth.json")) throw new Error("no access");
        },
        readFile: async () => "",
        writeFile: async () => {},
        mkdir: async () => undefined,
        stat: async () => ({ isDirectory: () => false, isFile: () => true, size: 0 }) as Stats,
        readdir: async () => [
          { name: "empty", isDirectory: () => true, isFile: () => false } as Dirent,
        ],
        unlink: async () => {},
        rm: async () => {},
      };

      await expect(evaluateCorpus({ corpusDir: "/test/corpus", fileSystem: fs })).rejects.toThrow(
        "No evaluation scenarios found"
      );
    });

    it("writes the report to outputFile when requested", async () => {
      const writeFile = vi.fn(async () => {});
      const fs: FileSystem = {
        access: async (p: string) => {
          if (p.endsWith("diffs/manifest.json")) throw new Error("no access");
        },
        readFile: async (p: string) => {
          if (p.endsWith("ground-truth.json")) {
            return JSON.stringify({
              scenarioId: "s",
              name: "S",
              expectedFindings: [],
              forbiddenFindings: [],
              maxAllowedDuplicates: 0,
            });
          }
          return JSON.stringify({ fileResults: [] });
        },
        writeFile,
        mkdir: async () => undefined,
        stat: async () => ({ isDirectory: () => false, isFile: () => true, size: 0 }) as Stats,
        readdir: async () => [
          { name: "s", isDirectory: () => true, isFile: () => false } as Dirent,
        ],
        unlink: async () => {},
        rm: async () => {},
      };

      await evaluateCorpus({
        corpusDir: "/test/corpus",
        fileSystem: fs,
        provider: "mock",
        outputFile: "/out/report.json",
      });

      expect(writeFile).toHaveBeenCalledWith(
        "/out/report.json",
        expect.stringContaining("overallPassed"),
        "utf-8"
      );
    });
  });

  describe("formatTerminalSummary failure details", () => {
    it("lists missed findings and false positives for failed scenarios", () => {
      const report: FullEvalReport = {
        timestamp: "2026-01-01T00:00:00.000Z",
        overallPassed: false,
        meanRecall: 0.5,
        meanPrecision: 0.5,
        totalDuplicates: 0,
        scenarioResults: [
          {
            scenarioId: "failing",
            name: "Failing",
            passed: false,
            recall: 0.5,
            precision: 0.5,
            duplicateCount: 0,
            caughtFindings: [],
            missedFindings: ["exp-1"],
            falsePositives: ["src/a.ts:1 - noise"],
          },
        ],
      };

      const summary = formatTerminalSummary(report);
      expect(summary).toContain("Missed Findings: exp-1");
      expect(summary).toContain("False Positives: src/a.ts:1 - noise");
      expect(summary).toContain("Overall Status: ❌ FAIL");
    });
  });
});

describe("Evaluation corpus integrity", () => {
  const corpusDir = path.join(process.cwd(), "test/eval/corpus");
  const scenarios = readdirSync(corpusDir, { withFileTypes: true }).filter((d) => d.isDirectory());

  it("contains scenarios", () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });

  it.each(scenarios.map((d) => d.name))(
    "%s: every manifest entry points at a diff file",
    (name) => {
      const diffsDir = path.join(corpusDir, name, "diffs");
      const manifest = JSON.parse(readFileSync(path.join(diffsDir, "manifest.json"), "utf-8")) as {
        files: Array<{ filename: string; diffPath?: string }>;
      };
      expect(manifest.files.length).toBeGreaterThan(0);
      for (const entry of manifest.files) {
        expect(typeof entry.diffPath, `${entry.filename} needs diffPath`).toBe("string");
        expect(existsSync(path.join(diffsDir, entry.diffPath as string))).toBe(true);
      }
    }
  );
});
