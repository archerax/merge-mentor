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
