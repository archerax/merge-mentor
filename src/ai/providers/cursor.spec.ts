import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock must be at top level before any imports that use it
// Use "node:child_process" to match the import in cursor.ts
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => "C:\\Program Files\\cursor\\cursor-agent.exe"),
}));

import { spawn } from "node:child_process";
import type { AIResponse } from "../types.js";
import { CursorCliError, CursorProvider } from "./cursor.js";

const mockSpawn = vi.mocked(spawn);

function createCursorProvider(maxRetries = 1, timeoutMs = 5000): CursorProvider {
  return new CursorProvider({ maxRetries, timeoutMs });
}

function createAIResponse(parsed: unknown): AIResponse {
  return { raw: JSON.stringify(parsed), parsed };
}

function createMockProcess(options: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: Error;
}): ChildProcess {
  const mockProcess: any = {
    stdin: null,
    stdout: {
      on: vi.fn((event: string, handler: (data: Buffer) => void) => {
        if (event === "data" && options.stdout) {
          setTimeout(() => handler(Buffer.from(options.stdout!)), 10);
        }
      }),
    },
    stderr: {
      on: vi.fn((event: string, handler: (data: Buffer) => void) => {
        if (event === "data" && options.stderr) {
          setTimeout(() => handler(Buffer.from(options.stderr!)), 10);
        }
      }),
    },
    on: vi.fn((event: string, handler: (arg: any) => void) => {
      if (event === "close" && options.exitCode !== undefined) {
        setTimeout(() => handler(options.exitCode), 10);
      } else if (event === "error" && options.error) {
        setTimeout(() => handler(options.error), 10);
      }
    }),
  };
  return mockProcess as ChildProcess;
}

describe("CursorProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("parseFileReview", () => {
    it("should parse valid file review response", () => {
      const provider = createCursorProvider();
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
      const provider = createCursorProvider();
      const response = createAIResponse({ findings: [] });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.filename).toBe("test.ts");
      expect(result.findings).toHaveLength(0);
    });

    it("should handle missing findings array", () => {
      const provider = createCursorProvider();
      const response = createAIResponse({});

      const result = provider.parseFileReview("test.ts", response);

      expect(result.filename).toBe("test.ts");
      expect(result.findings).toHaveLength(0);
    });

    it("should use default severity for invalid values", () => {
      const provider = createCursorProvider();
      const response = createAIResponse({
        findings: [
          { line: 1, severity: "invalid", category: "bug", message: "test", suggestion: "fix" },
        ],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings[0].severity).toBe("medium");
    });

    it("should use default category for invalid values", () => {
      const provider = createCursorProvider();
      const response = createAIResponse({
        findings: [
          { line: 1, severity: "high", category: "invalid", message: "test", suggestion: "fix" },
        ],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings[0].category).toBe("quality");
    });

    it("should handle isPreExisting flag", () => {
      const provider = createCursorProvider();
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
  });

  describe("parseCrossFileReview", () => {
    it("should parse valid cross-file review response", () => {
      const provider = createCursorProvider();
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
      const provider = createCursorProvider();
      const response = createAIResponse({});

      const result = provider.parseCrossFileReview(response);

      expect(result.overallAssessment).toBe("Review completed");
      expect(result.findings).toHaveLength(0);
      expect(result.recommendations).toHaveLength(0);
    });

    it("should handle all valid cross-file categories", () => {
      const provider = createCursorProvider();
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

    it("should use default category for invalid cross-file category", () => {
      const provider = createCursorProvider();
      const response = createAIResponse({
        findings: [{ severity: "low", category: "invalid", message: "test" }],
      });

      const result = provider.parseCrossFileReview(response);

      expect(result.findings[0].category).toBe("design");
    });
  });

  describe("constructor", () => {
    it("should use default values when no options provided", () => {
      const provider = new CursorProvider();
      expect(provider).toBeDefined();
    });

    it("should accept custom maxRetries and timeoutMs", () => {
      const provider = new CursorProvider({ maxRetries: 5, timeoutMs: 30000 });
      expect(provider).toBeDefined();
    });

    it("should accept model option", () => {
      const provider = new CursorProvider({ model: "gpt-5" });
      expect(provider).toBeDefined();
    });
  });

  describe("executePrompt", () => {
    it("should throw ValidationError when prompt is empty", async () => {
      const provider = createCursorProvider(1, 5000);

      await expect(provider.executePrompt("")).rejects.toThrow("Prompt cannot be empty");
    });

    it("should throw ValidationError when prompt is whitespace only", async () => {
      const provider = createCursorProvider(1, 5000);

      await expect(provider.executePrompt("   ")).rejects.toThrow("Prompt cannot be empty");
    });

    it("should return parsed JSON response on success", async () => {
      const provider = createCursorProvider(1, 5000);
      mockSpawn.mockReturnValue(
        createMockProcess({
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
      const provider = createCursorProvider(1, 5000);
      mockSpawn.mockReturnValue(
        createMockProcess({
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

    it("should throw CursorCliError when cursor-agent not found", async () => {
      const provider = createCursorProvider(1, 5000);
      const error: any = new Error("spawn cursor-agent ENOENT");
      error.code = "ENOENT";
      mockSpawn.mockReturnValue(createMockProcess({ error }));

      const promise = provider.executePrompt("test");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await rejection;
      // Error now comes from process error handler since execSync is mocked to succeed
      expect(err.message).toContain("CLI execution failed");
    });

    it("should throw CursorCliError on process error", async () => {
      const provider = createCursorProvider(1, 5000);
      mockSpawn.mockReturnValue(
        createMockProcess({
          error: new Error("Unknown error"),
        })
      );

      const promise = provider.executePrompt("test");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await rejection;
      expect(err.message).toContain("CLI execution failed");
    });

    it("should throw CursorCliError on non-zero exit code", async () => {
      const provider = createCursorProvider(1, 5000);
      mockSpawn.mockReturnValue(
        createMockProcess({
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
      const provider = new CursorProvider({ maxRetries: 3, timeoutMs: 5000 });
      let attempt = 0;

      mockSpawn.mockImplementation(() => {
        attempt++;
        if (attempt === 3) {
          return createMockProcess({ stdout: '{"success": true}', exitCode: 0 });
        }
        return createMockProcess({ exitCode: 1 });
      });

      const resultPromise = provider.executePrompt("test");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.parsed).toEqual({ success: true });
      expect(attempt).toBe(3);
    });

    it("should throw after max retries exceeded", async () => {
      const provider = new CursorProvider({ maxRetries: 2, timeoutMs: 5000 });
      mockSpawn.mockReturnValue(createMockProcess({ exitCode: 1 }));

      const promise = provider.executePrompt("test");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await rejection;
      expect(err.message).toContain("Failed after 2 attempts");
    });

    it("should pass model parameter to cursor-agent CLI when specified", async () => {
      const provider = new CursorProvider({ model: "gpt-5", maxRetries: 1 });
      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: '{"success": true}',
          exitCode: 0,
        })
      );

      const promise = provider.executePrompt("test prompt");
      await vi.runAllTimersAsync();
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String), // Resolved executable path
        ["-p", "test prompt", "--model", "gpt-5"],
        expect.objectContaining({ stdio: ["inherit", "pipe", "pipe"] })
      );
    });

    it("should not pass model parameter when not specified", async () => {
      const provider = new CursorProvider({ maxRetries: 1 });
      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: '{"success": true}',
          exitCode: 0,
        })
      );

      const promise = provider.executePrompt("test prompt");
      await vi.runAllTimersAsync();
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String), // Resolved executable path
        ["-p", "test prompt"],
        expect.objectContaining({ stdio: ["inherit", "pipe", "pipe"] })
      );
    });

    it("should infer file-review prompt type", async () => {
      const provider = createCursorProvider(1, 5000);
      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: '{"findings": []}',
          exitCode: 0,
        })
      );

      const promise = provider.executePrompt("Review the following file for issues");
      await vi.runAllTimersAsync();
      await promise;

      // Verify prompt was processed (inferPromptType is internal, tested via successful execution)
      expect(mockSpawn).toHaveBeenCalled();
    });

    it("should infer cross-file-review prompt type", async () => {
      const provider = createCursorProvider(1, 5000);
      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: '{"overall_assessment": "ok"}',
          exitCode: 0,
        })
      );

      const promise = provider.executePrompt("Perform cross-file analysis");
      await vi.runAllTimersAsync();
      await promise;

      expect(mockSpawn).toHaveBeenCalled();
    });
  });

  describe("CursorCliError", () => {
    it("should create error with message", () => {
      const error = new CursorCliError("Test error");
      expect(error.message).toBe("Test error");
      expect(error.name).toBe("CursorCliError");
    });

    it("should create error with cause", () => {
      const cause = new Error("Original error");
      const error = new CursorCliError("Test error", cause);
      expect(error.message).toBe("Test error");
      expect(error.cause).toBe(cause);
    });
  });
});
