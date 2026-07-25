import type { Dirent, Stats } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FileFinding } from "../platforms/types.js";
import type { FileSystem } from "../ports/fileSystem.js";
import {
  evaluateCorpus,
  evaluateScenario,
  formatTerminalSummary,
  matchFinding,
  matchForbiddenFinding,
} from "./harness.js";
import type { ExpectedFinding, ForbiddenFinding } from "./types.js";

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
        access: async () => {},
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
});
