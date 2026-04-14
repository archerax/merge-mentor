import { afterEach, beforeEach, describe, expect, it, type Mocked, vi } from "vitest";
import type { ExecutableFinder } from "../../ports/executableFinder.js";
import { createStubExecutableFinder } from "../../ports/executableFinder.test-helper.js";
import type { ProcessRunner } from "../../ports/processRunner.js";
import {
  createStubChildProcess,
  createStubProcessRunner,
} from "../../ports/processRunner.test-helper.js";
import type { AIResponse } from "../types.js";
import { OpenCodeCliError, OpenCodeProvider } from "./opencode.js";

function createAIResponse(parsed: unknown): AIResponse {
  return { raw: JSON.stringify(parsed), parsed };
}

describe("OpenCodeProvider", () => {
  let processRunner: Mocked<ProcessRunner>;
  let executableFinder: ExecutableFinder;

  function createOpenCodeProvider(maxRetries = 1, timeoutMs = 5000): OpenCodeProvider {
    return new OpenCodeProvider({ maxRetries, timeoutMs, processRunner, executableFinder });
  }

  beforeEach(() => {
    processRunner = createStubProcessRunner() as Mocked<ProcessRunner>;
    executableFinder = createStubExecutableFinder({
      opencode: "C:\\Program Files\\opencode\\opencode.exe",
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("parseFileReview", () => {
    it("should parse valid file review response", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          {
            line: 10,
            severity: "high",
            category: "bug",
            message: "Potential null pointer",
            suggestion: "Add null check",
          },
        ],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.filename).toBe("test.ts");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toEqual({
        line: 10,
        severity: "high",
        category: "bug",
        message: "Potential null pointer",
        suggestion: "Add null check",
        isPreExisting: false,
        confidence: "high",
        reasoning: "Reasoning not provided by the model.",
      });
    });

    it("should handle empty findings", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({ findings: [] });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.filename).toBe("test.ts");
      expect(result.findings).toHaveLength(0);
    });

    it("should handle missing findings array", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({});

      const result = provider.parseFileReview("test.ts", response);

      expect(result.filename).toBe("test.ts");
      expect(result.findings).toHaveLength(0);
    });

    it("should use default severity for invalid values", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          { line: 1, severity: "invalid", category: "bug", message: "test", suggestion: "fix" },
        ],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings[0].severity).toBe("medium");
    });

    it("should use default category for invalid values", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          { line: 1, severity: "high", category: "invalid", message: "test", suggestion: "fix" },
        ],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings[0].category).toBe("quality");
    });
  });

  describe("parseCrossFileReview", () => {
    it("should parse valid cross-file review response", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        overall_assessment: "Good PR overall",
        findings: [
          {
            severity: "medium",
            category: "architecture",
            message: "Consider separating concerns",
            affected_files: ["src/a.ts", "src/b.ts"],
          },
        ],
        recommendations: ["Add more tests", "Update docs"],
      });

      const result = provider.parseCrossFileReview(response);

      expect(result.overallAssessment).toBe("Good PR overall");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toEqual({
        severity: "medium",
        category: "architecture",
        message: "Consider separating concerns",
        affectedFiles: ["src/a.ts", "src/b.ts"],
        confidence: "high",
        reasoning: "Reasoning not provided by the model.",
      });
      expect(result.recommendations).toEqual(["Add more tests", "Update docs"]);
    });

    it("should handle empty response", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({});

      const result = provider.parseCrossFileReview(response);

      expect(result.overallAssessment).toBe("Review completed");
      expect(result.findings).toHaveLength(0);
      expect(result.recommendations).toHaveLength(0);
    });

    it("should handle all valid cross-file categories", () => {
      const provider = createOpenCodeProvider();
      const categories = [
        "architecture",
        "design",
        "testing",
        "documentation",
        "bug",
        "security",
        "performance",
        "quality",
      ];

      for (const category of categories) {
        const response = createAIResponse({
          findings: [{ severity: "low", category, message: "test" }],
        });
        const result = provider.parseCrossFileReview(response);
        expect(result.findings[0].category).toBe(category);
      }
    });
  });

  describe("constructor", () => {
    it("should use default values when no options provided", () => {
      const provider = new OpenCodeProvider();
      expect(provider).toBeDefined();
    });

    it("should accept custom maxRetries and timeoutMs", () => {
      const provider = new OpenCodeProvider({ maxRetries: 5, timeoutMs: 30000 });
      expect(provider).toBeDefined();
    });
  });

  describe("executePrompt", () => {
    it("should throw ValidationError when prompt is empty", async () => {
      const provider = createOpenCodeProvider(1, 5000);

      await expect(provider.executePrompt("")).rejects.toThrow("Prompt cannot be empty");
    });

    it("should throw ValidationError when prompt is whitespace only", async () => {
      const provider = createOpenCodeProvider(1, 5000);

      await expect(provider.executePrompt("   ")).rejects.toThrow("Prompt cannot be empty");
    });

    it("should return parsed JSON response on success", async () => {
      const provider = createOpenCodeProvider(1, 5000);
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: '{"findings": []}',
          exitCode: 0,
        })
      );

      const resultPromise = provider.executePrompt("test prompt");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.raw).toContain('{"findings": []}');
      expect(result.parsed).toEqual({ findings: [] });
    });

    it("should throw error when no JSON found", async () => {
      const provider = createOpenCodeProvider(1, 5000);
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: "plain text without json",
          exitCode: 0,
        })
      );

      const promise = provider.executePrompt("test");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await rejection;
      expect(error.message).toContain("No JSON object found");
    });

    it("should throw OpenCodeCliError when opencode not found", async () => {
      const provider = createOpenCodeProvider(1, 5000);
      const error = Object.assign(new Error("spawn opencode ENOENT"), { code: "ENOENT" });
      processRunner.spawn.mockReturnValue(createStubChildProcess({ error }));

      const promise = provider.executePrompt("test");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await rejection;
      // Error now comes from process error handler since execSync is mocked to succeed
      expect(err.message).toContain("CLI execution failed");
    });

    it("should throw OpenCodeCliError on process error", async () => {
      const provider = createOpenCodeProvider(1, 5000);
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          error: new Error("Unknown error"),
        })
      );

      const promise = provider.executePrompt("test");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await rejection;
      expect(err.message).toContain("CLI execution failed");
    });

    it("should throw OpenCodeCliError on non-zero exit code", async () => {
      const provider = createOpenCodeProvider(1, 5000);
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stderr: "Error occurred",
          exitCode: 1,
        })
      );

      const promise = provider.executePrompt("test");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await rejection;
      expect(err.message).toContain("Exited with code 1");
    });

    it("should retry on failure", async () => {
      const provider = new OpenCodeProvider({
        maxRetries: 3,
        timeoutMs: 5000,
        processRunner,
        executableFinder,
      });
      let attempt = 0;

      processRunner.spawn.mockImplementation(() => {
        attempt++;
        if (attempt === 3) {
          return createStubChildProcess({ stdout: '{"success": true}', exitCode: 0 });
        }
        return createStubChildProcess({ exitCode: 1 });
      });

      const resultPromise = provider.executePrompt("test");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.parsed).toEqual({ success: true });
      expect(attempt).toBe(3);
    });

    it("should throw after max retries exceeded", async () => {
      const provider = new OpenCodeProvider({
        maxRetries: 2,
        timeoutMs: 5000,
        processRunner,
        executableFinder,
      });
      processRunner.spawn.mockImplementation(() => createStubChildProcess({ exitCode: 1 }));

      const promise = provider.executePrompt("test");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await rejection;
      expect(err.message).toContain("Failed after 2 attempts");
    });

    it("should pass model parameter to opencode CLI when specified", async () => {
      const provider = new OpenCodeProvider({
        model: "claude-4.5-sonnet",
        maxRetries: 1,
        processRunner,
        executableFinder,
      });
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: '{"success": true}',
          exitCode: 0,
        })
      );

      const promise = provider.executePrompt("test prompt");
      await vi.runAllTimersAsync();
      await promise;

      expect(processRunner.spawn).toHaveBeenCalledWith(
        expect.any(String), // Resolved executable path
        ["-p", "test prompt", "--model", "claude-4.5-sonnet"],
        expect.objectContaining({ stdio: ["inherit", "pipe", "pipe"] })
      );
    });

    it("should not pass model parameter when not specified", async () => {
      const provider = new OpenCodeProvider({
        maxRetries: 1,
        processRunner,
        executableFinder,
      });
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: '{"success": true}',
          exitCode: 0,
        })
      );

      const promise = provider.executePrompt("test prompt");
      await vi.runAllTimersAsync();
      await promise;

      expect(processRunner.spawn).toHaveBeenCalledWith(
        expect.any(String), // Resolved executable path
        ["-p", "test prompt"],
        expect.objectContaining({ stdio: ["inherit", "pipe", "pipe"] })
      );
    });
  });

  describe("parseCrossFileReview - additional edge cases", () => {
    it("should use default category for invalid cross-file category", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [{ severity: "low", category: "invalid", message: "test" }],
      });

      const result = provider.parseCrossFileReview(response);

      expect(result.findings[0].category).toBe("design");
    });

    it("should include reasoning when provided in cross-file finding", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        overall_assessment: "Issues found",
        findings: [
          {
            severity: "medium",
            category: "architecture",
            message: "Coupling issue",
            affected_files: ["src/a.ts", "src/b.ts"],
            reasoning:
              "I checked both modules and confirmed they share a tight coupling through direct imports of internal details",
          },
        ],
      });

      const result = provider.parseCrossFileReview(response);

      expect(result.findings[0].reasoning).toContain("checked");
    });

    it("should handle finding without affected_files", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          {
            severity: "low",
            category: "design",
            message: "General design concern",
          },
        ],
      });

      const result = provider.parseCrossFileReview(response);

      expect(result.findings[0].affectedFiles).toEqual([]);
    });

    it("should handle non-array recommendations", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        overall_assessment: "OK",
        findings: [],
        recommendations: "not an array",
      });

      const result = provider.parseCrossFileReview(response);

      expect(result.recommendations).toEqual([]);
    });

    it("should handle short reasoning in cross-file finding", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          {
            severity: "low",
            category: "design",
            message: "Issue",
            affected_files: ["a.ts"],
            reasoning: "Brief",
          },
        ],
      });

      const result = provider.parseCrossFileReview(response);

      expect(result.findings[0].reasoning).toBe("Brief");
    });

    it("should validate reasoning when affected_files is not an array", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          {
            severity: "low",
            category: "design",
            message: "Issue",
            reasoning:
              "I verified this coupling exists across the modules and confirmed it causes maintenance burden",
          },
        ],
      });

      const result = provider.parseCrossFileReview(response);

      expect(result.findings[0].reasoning).toContain("verified");
      expect(result.findings[0].affectedFiles).toEqual([]);
    });
  });

  describe("parseFileReview - reasoning and edge cases", () => {
    it("should handle isPreExisting flag", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          {
            line: 1,
            severity: "high",
            category: "bug",
            message: "test",
            suggestion: "fix",
            isPreExisting: true,
          },
        ],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings[0].isPreExisting).toBe(true);
    });

    it("should include reasoning when provided", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          {
            line: 10,
            severity: "high",
            category: "bug",
            message: "Issue",
            suggestion: "Fix",
            reasoning:
              "I verified the code path and confirmed this null pointer dereference occurs when input is empty",
          },
        ],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings[0].reasoning).toBe(
        "I verified the code path and confirmed this null pointer dereference occurs when input is empty"
      );
    });

    it("should handle finding with non-numeric line", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          {
            line: "unknown",
            severity: "high",
            category: "bug",
            message: "Issue",
            suggestion: "Fix",
          },
        ],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings[0].line).toBe(0);
    });

    it("should default invalid confidence to high", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          {
            line: 1,
            severity: "high",
            confidence: "invalid-value",
            category: "bug",
            message: "Issue",
            suggestion: "Fix",
          },
        ],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings[0].confidence).toBe("high");
    });

    it("should accept valid confidence values", () => {
      const provider = createOpenCodeProvider();
      for (const confidence of ["high", "medium", "low"]) {
        const response = createAIResponse({
          findings: [{ line: 1, severity: "high", confidence, category: "bug", message: "test" }],
        });
        const result = provider.parseFileReview("test.ts", response);
        expect(result.findings[0].confidence).toBe(confidence);
      }
    });

    it("should handle non-boolean isPreExisting as false", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          {
            line: 1,
            severity: "high",
            category: "bug",
            message: "Issue",
            suggestion: "Fix",
            isPreExisting: "yes",
          },
        ],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings[0].isPreExisting).toBe(false);
    });

    it("should validate short reasoning and still use it", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          {
            line: 10,
            severity: "high",
            category: "bug",
            message: "Issue",
            suggestion: "Fix",
            reasoning: "Short",
          },
        ],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings[0].reasoning).toBe("Short");
    });

    it("should validate reasoning missing verification keywords", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          {
            line: 10,
            severity: "high",
            category: "bug",
            message: "Issue",
            suggestion: "Fix",
            reasoning:
              "This code path has a potential problem because the variable is not initialized before use in the loop body.",
          },
        ],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings[0].reasoning).toContain("potential problem");
    });

    it("should use string line for reasoning validation when line is non-numeric", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          {
            line: "not-a-number",
            severity: "high",
            category: "bug",
            message: "Issue",
            suggestion: "Fix",
            reasoning:
              "I verified this is a problem because the type is incompatible with the expected interface contract",
          },
        ],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings[0].reasoning).toContain("verified");
      expect(result.findings[0].line).toBe(0);
    });
  });

  describe("parseBatchedFileReview", () => {
    it("should parse valid batched response with multiple files", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        file_results: {
          "src/a.ts": {
            findings: [
              {
                line: 5,
                severity: "high",
                category: "bug",
                message: "Null check missing",
                suggestion: "Add null check",
              },
            ],
          },
          "src/b.ts": {
            findings: [
              {
                line: 12,
                severity: "low",
                category: "quality",
                message: "Use const",
                suggestion: "Replace let with const",
              },
            ],
          },
        },
      });

      const results = provider.parseBatchedFileReview(response);

      expect(results).toHaveLength(2);
      expect(results[0].filename).toBe("src/a.ts");
      expect(results[0].findings).toHaveLength(1);
      expect(results[0].findings[0].severity).toBe("high");
      expect(results[1].filename).toBe("src/b.ts");
      expect(results[1].findings).toHaveLength(1);
      expect(results[1].findings[0].message).toBe("Use const");
    });

    it("should return empty array when file_results is missing", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({});

      const results = provider.parseBatchedFileReview(response);

      expect(results).toEqual([]);
    });

    it("should return empty array when file_results is not an object", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({ file_results: "invalid" });

      const results = provider.parseBatchedFileReview(response);

      expect(results).toEqual([]);
    });

    it("should handle files with empty findings", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        file_results: {
          "src/empty.ts": { findings: [] },
        },
      });

      const results = provider.parseBatchedFileReview(response);

      expect(results).toHaveLength(1);
      expect(results[0].findings).toHaveLength(0);
    });

    it("should handle files with missing findings array", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        file_results: {
          "src/no-findings.ts": {},
        },
      });

      const results = provider.parseBatchedFileReview(response);

      expect(results).toHaveLength(1);
      expect(results[0].findings).toHaveLength(0);
    });

    it("should validate reasoning in batched findings", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        file_results: {
          "src/a.ts": {
            findings: [
              {
                line: 5,
                severity: "high",
                category: "bug",
                message: "Issue found",
                suggestion: "Fix it",
                reasoning:
                  "I verified this is a real bug by checking the call site and confirmed no null guard exists",
              },
            ],
          },
        },
      });

      const results = provider.parseBatchedFileReview(response);

      expect(results[0].findings[0].reasoning).toBe(
        "I verified this is a real bug by checking the call site and confirmed no null guard exists"
      );
    });

    it("should default non-numeric line to 0 in batched findings", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        file_results: {
          "src/a.ts": {
            findings: [
              {
                line: "not-a-number",
                severity: "high",
                category: "bug",
                message: "Issue",
                suggestion: "Fix",
              },
            ],
          },
        },
      });

      const results = provider.parseBatchedFileReview(response);

      expect(results[0].findings[0].line).toBe(0);
    });

    it("should default non-boolean isPreExisting to false in batched findings", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        file_results: {
          "src/a.ts": {
            findings: [
              {
                line: 1,
                severity: "high",
                category: "bug",
                message: "Issue",
                suggestion: "Fix",
                isPreExisting: "yes",
              },
            ],
          },
        },
      });

      const results = provider.parseBatchedFileReview(response);

      expect(results[0].findings[0].isPreExisting).toBe(false);
    });
  });

  describe("parseFastReview", () => {
    it("should parse file-specific findings", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        summary: "Found issues",
        findings: [
          {
            file: "src/main.ts",
            line: 10,
            severity: "high",
            confidence: "high",
            category: "bug",
            message: "Null pointer",
            suggestion: "Add check",
          },
        ],
      });

      const result = provider.parseFastReview(response);

      expect(result.fileResults).toHaveLength(1);
      expect(result.fileResults[0].filename).toBe("src/main.ts");
      expect(result.fileResults[0].findings[0].line).toBe(10);
      expect(result.fileResults[0].findings[0].severity).toBe("high");
      expect(result.crossFileResult.overallAssessment).toBe("Found issues");
    });

    it("should parse cross-file findings when file is absent", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        summary: "Architecture concern",
        findings: [
          {
            severity: "medium",
            confidence: "medium",
            category: "architecture",
            message: "Circular dependency detected",
          },
        ],
      });

      const result = provider.parseFastReview(response);

      expect(result.fileResults).toHaveLength(0);
      expect(result.crossFileResult.findings).toHaveLength(1);
      expect(result.crossFileResult.findings[0].category).toBe("architecture");
      expect(result.crossFileResult.findings[0].message).toBe("Circular dependency detected");
    });

    it("should split mixed file and cross-file findings", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        summary: "Mixed review",
        findings: [
          {
            file: "src/a.ts",
            line: 5,
            severity: "high",
            category: "bug",
            message: "File issue",
            suggestion: "Fix file",
          },
          {
            severity: "low",
            category: "design",
            message: "Cross-file issue",
          },
          {
            file: "src/a.ts",
            line: 20,
            severity: "medium",
            category: "quality",
            message: "Another file issue",
            suggestion: "Improve",
          },
        ],
      });

      const result = provider.parseFastReview(response);

      expect(result.fileResults).toHaveLength(1);
      expect(result.fileResults[0].filename).toBe("src/a.ts");
      expect(result.fileResults[0].findings).toHaveLength(2);
      expect(result.crossFileResult.findings).toHaveLength(1);
    });

    it("should handle empty findings array", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({ summary: "Clean", findings: [] });

      const result = provider.parseFastReview(response);

      expect(result.fileResults).toHaveLength(0);
      expect(result.crossFileResult.findings).toHaveLength(0);
      expect(result.crossFileResult.overallAssessment).toBe("Clean");
    });

    it("should handle missing findings", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({});

      const result = provider.parseFastReview(response);

      expect(result.fileResults).toHaveLength(0);
      expect(result.crossFileResult.findings).toHaveLength(0);
      expect(result.crossFileResult.overallAssessment).toBe("Review completed");
    });

    it("should handle file finding with no line number", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          {
            file: "src/main.ts",
            severity: "low",
            category: "quality",
            message: "General quality issue",
            suggestion: "Refactor",
          },
        ],
      });

      const result = provider.parseFastReview(response);

      expect(result.fileResults[0].findings[0].line).toBe(0);
    });

    it("should group findings by file", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          { file: "a.ts", line: 1, severity: "high", category: "bug", message: "Bug in a" },
          { file: "b.ts", line: 2, severity: "low", category: "quality", message: "Style in b" },
          { file: "a.ts", line: 10, severity: "medium", category: "security", message: "Sec in a" },
        ],
      });

      const result = provider.parseFastReview(response);

      expect(result.fileResults).toHaveLength(2);
      const fileA = result.fileResults.find((f) => f.filename === "a.ts");
      const fileB = result.fileResults.find((f) => f.filename === "b.ts");
      expect(fileA?.findings).toHaveLength(2);
      expect(fileB?.findings).toHaveLength(1);
    });

    it("should default non-boolean isPreExisting to false", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          {
            file: "src/a.ts",
            line: 1,
            severity: "high",
            category: "bug",
            message: "Issue",
            isPreExisting: "maybe",
          },
        ],
      });

      const result = provider.parseFastReview(response);

      expect(result.fileResults[0].findings[0].isPreExisting).toBe(false);
    });

    it("should preserve isPreExisting boolean true", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          {
            file: "src/a.ts",
            line: 1,
            severity: "high",
            category: "bug",
            message: "Pre-existing issue",
            isPreExisting: true,
          },
        ],
      });

      const result = provider.parseFastReview(response);

      expect(result.fileResults[0].findings[0].isPreExisting).toBe(true);
    });

    it("should use default reasoning when not provided", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          { file: "src/a.ts", line: 1, severity: "high", category: "bug", message: "Issue" },
        ],
      });

      const result = provider.parseFastReview(response);

      expect(result.fileResults[0].findings[0].reasoning).toBe(
        "Reasoning not provided by the model."
      );
    });

    it("should handle reasoning with verification keyword for file finding", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          {
            file: "src/a.ts",
            line: 5,
            severity: "high",
            category: "bug",
            message: "Issue",
            reasoning:
              "I verified the call chain and confirmed this leads to a null pointer dereference at runtime",
          },
        ],
      });

      const result = provider.parseFastReview(response);

      expect(result.fileResults[0].findings[0].reasoning).toContain("verified");
    });

    it("should handle reasoning with verification keyword for cross-file finding", () => {
      const provider = createOpenCodeProvider();
      const response = createAIResponse({
        findings: [
          {
            severity: "medium",
            category: "design",
            message: "Coupling issue",
            reasoning:
              "I checked both modules and confirmed they share an implicit dependency on global state",
          },
        ],
      });

      const result = provider.parseFastReview(response);

      expect(result.crossFileResult.findings[0].reasoning).toContain("checked");
    });
  });

  describe("executePrompt - additional paths", () => {
    it("should parse JSON from markdown code blocks", async () => {
      const provider = createOpenCodeProvider(1, 5000);
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: 'Here is the review:\n```json\n{"findings": [{"line": 1}]}\n```\nDone.',
          exitCode: 0,
        })
      );

      const resultPromise = provider.executePrompt("test prompt");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.parsed).toEqual({ findings: [{ line: 1 }] });
    });

    it("should fall back to regex when markdown JSON is invalid", async () => {
      const provider = createOpenCodeProvider(1, 5000);
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: 'Review:\n```json\nnot valid json\n```\nBut here is valid: {"findings": []}',
          exitCode: 0,
        })
      );

      const resultPromise = provider.executePrompt("test prompt");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.parsed).toEqual({ findings: [] });
    });

    it("should throw on malformed JSON with parse error details", async () => {
      const provider = createOpenCodeProvider(1, 5000);
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: "{ broken json }",
          exitCode: 0,
        })
      );

      const promise = provider.executePrompt("test");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await rejection;

      expect(err.message).toContain("Failed after");
    });

    it("should reject when CLI is not found in PATH", async () => {
      const notFoundFinder = createStubExecutableFinder({});
      const provider = new OpenCodeProvider({
        maxRetries: 1,
        timeoutMs: 5000,
        processRunner,
        executableFinder: notFoundFinder,
      });

      const promise = provider.executePrompt("test prompt");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await rejection;

      expect(err.message).toContain("not installed or not in PATH");
    });

    it("should handle timeout with null exit code", async () => {
      const provider = createOpenCodeProvider(1, 5000);

      const { EventEmitter } = await import("node:events");
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const proc = Object.assign(new EventEmitter(), {
        stdout,
        stderr,
        stdin: null,
        pid: 99999,
      }) as import("node:child_process").ChildProcess;

      processRunner.spawn.mockReturnValue(proc);

      const promise = provider.executePrompt("test");
      const rejection = promise.catch((e) => e);

      process.nextTick(() => proc.emit("close", null));

      await vi.runAllTimersAsync();
      const err = await rejection;

      expect(err.message).toContain("timed out");
    });

    it("should call onStreamData callback with stdout chunks", async () => {
      const provider = createOpenCodeProvider(1, 5000);
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: '{"result": true}',
          exitCode: 0,
        })
      );

      const streamedChunks: string[] = [];
      const resultPromise = provider.executePrompt("test prompt", {
        onStreamData: (chunk) => streamedChunks.push(chunk),
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(streamedChunks).toHaveLength(1);
      expect(streamedChunks[0]).toBe('{"result": true}');
    });

    it("should pass working directory to spawn", async () => {
      const provider = createOpenCodeProvider(1, 5000);
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: '{"ok": true}',
          exitCode: 0,
        })
      );

      const resultPromise = provider.executePrompt("test", {
        workingDirectory: "/custom/path",
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(processRunner.spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ cwd: "/custom/path" })
      );
    });

    it("should use stdout in error message when stderr is empty on non-zero exit", async () => {
      const provider = createOpenCodeProvider(1, 5000);
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: "stdout error info",
          exitCode: 2,
        })
      );

      const promise = provider.executePrompt("test");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await rejection;

      expect(err.message).toContain("stdout error info");
    });

    it("should infer file-review prompt type", async () => {
      const provider = createOpenCodeProvider(1, 5000);
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: '{"findings": []}',
          exitCode: 0,
        })
      );

      const promise = provider.executePrompt("Review the following file for issues");
      await vi.runAllTimersAsync();
      await promise;

      expect(processRunner.spawn).toHaveBeenCalled();
    });

    it("should infer cross-file-review prompt type", async () => {
      const provider = createOpenCodeProvider(1, 5000);
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: '{"overall_assessment": "ok"}',
          exitCode: 0,
        })
      );

      const promise = provider.executePrompt("Perform cross-file analysis");
      await vi.runAllTimersAsync();
      await promise;

      expect(processRunner.spawn).toHaveBeenCalled();
    });

    it("should infer unknown prompt type for unrecognized prompts", async () => {
      const provider = createOpenCodeProvider(1, 5000);
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: '{"data": true}',
          exitCode: 0,
        })
      );

      const promise = provider.executePrompt("some random prompt");
      await vi.runAllTimersAsync();
      await promise;

      expect(processRunner.spawn).toHaveBeenCalled();
    });

    it("should accept model option", () => {
      const provider = new OpenCodeProvider({ model: "gpt-4" });
      expect(provider).toBeDefined();
    });
  });

  describe("OpenCodeCliError", () => {
    it("should create error with message", () => {
      const error = new OpenCodeCliError("Test error");
      expect(error.message).toBe("Test error");
      expect(error.name).toBe("OpenCodeCliError");
    });

    it("should create error with cause", () => {
      const cause = new Error("Original error");
      const error = new OpenCodeCliError("Test error", cause);
      expect(error.message).toBe("Test error");
      expect(error.cause).toBe(cause);
    });
  });
});
