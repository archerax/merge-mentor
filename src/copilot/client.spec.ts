import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock must be at top level before any imports that use it
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { CopilotCliError } from "../errors/index.js";
import { CopilotClient, type CopilotResponse } from "./client.js";

const mockSpawn = vi.mocked(spawn);

function createCopilotClient(maxRetries = 1, timeoutMs = 5000): CopilotClient {
  return new CopilotClient({ maxRetries, timeoutMs });
}

function createCopilotResponse(parsed: unknown): CopilotResponse {
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

describe("CopilotClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("parseFileReview", () => {
    it("should parse valid file review response", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
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

      const result = client.parseFileReview("test.ts", response);

      expect(result.filename).toBe("test.ts");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toEqual({
        line: 10,
        severity: "high",
        category: "bug",
        message: "Potential null pointer",
        suggestion: "Add null check",
        confidence: "medium", // Default when not provided
        isPreExisting: false, // Default when not provided
      });
    });

    it("should handle empty findings", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({ findings: [] });

      const result = client.parseFileReview("test.ts", response);

      expect(result.filename).toBe("test.ts");
      expect(result.findings).toHaveLength(0);
    });

    it("should handle missing findings array", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({});

      const result = client.parseFileReview("test.ts", response);

      expect(result.filename).toBe("test.ts");
      expect(result.findings).toHaveLength(0);
    });

    it("should use default severity for invalid values", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [
          { line: 1, severity: "invalid", category: "bug", message: "test", suggestion: "fix" },
        ],
      });

      const result = client.parseFileReview("test.ts", response);

      expect(result.findings[0].severity).toBe("medium");
    });

    it("should use default category for invalid values", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [
          { line: 1, severity: "high", category: "invalid", message: "test", suggestion: "fix" },
        ],
      });

      const result = client.parseFileReview("test.ts", response);

      expect(result.findings[0].category).toBe("quality");
    });

    it("should handle missing line number", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [{ severity: "high", category: "bug", message: "test", suggestion: "fix" }],
      });

      const result = client.parseFileReview("test.ts", response);

      expect(result.findings[0].line).toBe(0);
    });

    it("should handle missing message", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [
          { line: 1, severity: "high", category: "bug", message: null, suggestion: "fix" },
        ],
      });

      const result = client.parseFileReview("test.ts", response);

      expect(result.findings[0].message).toBe("");
    });

    it("should handle undefined message", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [{ line: 1, severity: "high", category: "bug", suggestion: "fix" }],
      });

      const result = client.parseFileReview("test.ts", response);

      expect(result.findings[0].message).toBe("");
    });

    it("should handle missing suggestion", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [
          { line: 1, severity: "high", category: "bug", message: "test", suggestion: null },
        ],
      });

      const result = client.parseFileReview("test.ts", response);

      expect(result.findings[0].suggestion).toBe("");
    });

    it("should handle undefined suggestion", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [{ line: 1, severity: "high", category: "bug", message: "test" }],
      });

      const result = client.parseFileReview("test.ts", response);

      expect(result.findings[0].suggestion).toBe("");
    });

    it("should handle empty string message", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [{ line: 1, severity: "high", category: "bug", message: "", suggestion: "fix" }],
      });

      const result = client.parseFileReview("test.ts", response);

      expect(result.findings[0].message).toBe("");
    });

    it("should handle empty string suggestion", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [{ line: 1, severity: "high", category: "bug", message: "test", suggestion: "" }],
      });

      const result = client.parseFileReview("test.ts", response);

      expect(result.findings[0].suggestion).toBe("");
    });
  });

  describe("parseCrossFileReview", () => {
    it("should parse valid cross-file review response", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
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

      const result = client.parseCrossFileReview(response);

      expect(result.overallAssessment).toBe("Good PR overall");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toEqual({
        severity: "medium",
        category: "architecture",
        message: "Consider separating concerns",
        affectedFiles: ["src/a.ts", "src/b.ts"],
      });
      expect(result.recommendations).toEqual(["Add more tests", "Update docs"]);
    });

    it("should handle empty response", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({});

      const result = client.parseCrossFileReview(response);

      expect(result.overallAssessment).toBe("Review completed");
      expect(result.findings).toHaveLength(0);
      expect(result.recommendations).toHaveLength(0);
    });

    it("should handle missing affected_files", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [{ severity: "low", category: "design", message: "test" }],
      });

      const result = client.parseCrossFileReview(response);

      expect(result.findings[0].affectedFiles).toEqual([]);
    });

    it("should use default category for invalid cross-file category", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [{ severity: "high", category: "invalid", message: "test" }],
      });

      const result = client.parseCrossFileReview(response);

      expect(result.findings[0].category).toBe("design");
    });

    it("should handle all valid cross-file categories", () => {
      const client = createCopilotClient();
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
        const response = createCopilotResponse({
          findings: [{ severity: "low", category, message: "test" }],
        });
        const result = client.parseCrossFileReview(response);
        expect(result.findings[0].category).toBe(category);
      }
    });

    it("should handle missing message in cross-file finding", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [{ severity: "high", category: "design", message: null }],
      });

      const result = client.parseCrossFileReview(response);

      expect(result.findings[0].message).toBe("");
    });

    it("should handle undefined message in cross-file finding", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [{ severity: "high", category: "design" }],
      });

      const result = client.parseCrossFileReview(response);

      expect(result.findings[0].message).toBe("");
    });

    it("should handle empty string message in cross-file finding", () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [{ severity: "high", category: "design", message: "" }],
      });

      const result = client.parseCrossFileReview(response);

      expect(result.findings[0].message).toBe("");
    });
  });

  describe("constructor", () => {
    it("should use default values when no options provided", () => {
      const client = new CopilotClient();
      expect(client).toBeDefined();
    });

    it("should accept custom maxRetries and timeoutMs", () => {
      const client = new CopilotClient({ maxRetries: 5, timeoutMs: 30000 });
      expect(client).toBeDefined();
    });
  });

  describe("executePrompt", () => {
    it("should throw ValidationError when prompt is empty", async () => {
      const client = createCopilotClient(1, 5000);

      await expect(client.executePrompt("")).rejects.toThrow("Prompt cannot be empty");
    });

    it("should throw ValidationError when prompt is whitespace only", async () => {
      const client = createCopilotClient(1, 5000);

      await expect(client.executePrompt("   ")).rejects.toThrow("Prompt cannot be empty");
    });

    it("should return parsed JSON response on success", async () => {
      const client = createCopilotClient(1, 5000);
      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: '{"findings": []}',
          exitCode: 0,
        })
      );

      const resultPromise = client.executePrompt("test prompt");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.raw).toContain('{"findings": []}');
      expect(result.parsed).toEqual({ findings: [] });
    });

    it("should throw JsonParseError when no JSON found", async () => {
      const client = createCopilotClient(1, 5000);
      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: "plain text without json",
          exitCode: 0,
        })
      );

      const promise1 = client.executePrompt("test");
      const rejection1 = promise1.catch((e) => e);
      await vi.runAllTimersAsync();
      await expect(rejection1).resolves.toBeInstanceOf(CopilotCliError);

      const promise2 = client.executePrompt("test");
      const rejection2 = promise2.catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await rejection2;
      expect(error.message).toContain("No JSON object found");
    });

    it("should throw JsonParseError when JSON is malformed", async () => {
      const client = createCopilotClient(1, 5000);
      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: "{invalid json}",
          exitCode: 0,
        })
      );

      const promise = client.executePrompt("test");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      await expect(rejection).resolves.toBeInstanceOf(CopilotCliError);
    });

    it("should throw CopilotCliError when copilot not found", async () => {
      const client = createCopilotClient(1, 5000);
      const error: any = new Error("spawn copilot ENOENT");
      error.code = "ENOENT";
      mockSpawn.mockReturnValue(createMockProcess({ error }));

      const promise = client.executePrompt("test");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await rejection;
      expect(err.message).toContain("Copilot CLI is not installed or not in PATH");
    });

    it("should throw CopilotCliError on process error", async () => {
      const client = createCopilotClient(1, 5000);
      mockSpawn.mockReturnValue(
        createMockProcess({
          error: new Error("Unknown error"),
        })
      );

      const promise = client.executePrompt("test");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await rejection;
      expect(err.message).toContain("CLI execution failed");
    });

    it("should throw CopilotCliError on non-zero exit code", async () => {
      const client = createCopilotClient(1, 5000);
      mockSpawn.mockReturnValue(
        createMockProcess({
          stderr: "Error occurred",
          exitCode: 1,
        })
      );

      const promise = client.executePrompt("test");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await rejection;
      expect(err.message).toContain("Exited with code 1");
    });

    it("should retry on failure", async () => {
      const client = new CopilotClient({ maxRetries: 3, timeoutMs: 5000 });
      let attempt = 0;

      mockSpawn.mockImplementation(() => {
        attempt++;
        if (attempt === 3) {
          return createMockProcess({ stdout: '{"success": true}', exitCode: 0 });
        }
        return createMockProcess({ exitCode: 1 });
      });

      const resultPromise = client.executePrompt("test");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.parsed).toEqual({ success: true });
      expect(attempt).toBe(3);
    });

    it("should throw after max retries exceeded", async () => {
      const client = new CopilotClient({ maxRetries: 2, timeoutMs: 5000 });
      mockSpawn.mockReturnValue(createMockProcess({ exitCode: 1 }));

      const promise = client.executePrompt("test");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await rejection;
      expect(err.message).toContain("Failed after 2 attempts");
    });

    it("should handle null lastError in retry failure", async () => {
      const client = new CopilotClient({ maxRetries: 2, timeoutMs: 5000 });
      mockSpawn.mockImplementation(() => {
        const mockProc: any = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event: string, handler: (arg: any) => void) => {
            if (event === "close") {
              setTimeout(() => handler(1), 10);
            }
          }),
        };
        return mockProc;
      });

      const promise = client.executePrompt("test");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await rejection;
      expect(err.message).toContain("Failed after 2 attempts");
    });

    it("should throw CopilotCliError when error has no code", async () => {
      const client = createCopilotClient(1, 5000);
      const error = new Error("Generic error");
      mockSpawn.mockReturnValue(createMockProcess({ error }));

      const promise = client.executePrompt("test");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await rejection;
      expect(err.message).toContain("CLI execution failed");
    });

    it("should pass model parameter to copilot CLI when specified", async () => {
      const client = new CopilotClient({ model: "gpt-4o", maxRetries: 1 });
      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: '{"success": true}',
          exitCode: 0,
        })
      );

      const promise = client.executePrompt("test prompt");
      await vi.runAllTimersAsync();
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "copilot",
        ["-p", "test prompt", "--model", "gpt-4o"],
        expect.objectContaining({ stdio: ["inherit", "pipe", "pipe"] })
      );
    });

    it("should not pass model parameter when not specified", async () => {
      const client = new CopilotClient({ maxRetries: 1 });
      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: '{"success": true}',
          exitCode: 0,
        })
      );

      const promise = client.executePrompt("test prompt");
      await vi.runAllTimersAsync();
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "copilot",
        ["-p", "test prompt"],
        expect.objectContaining({ stdio: ["inherit", "pipe", "pipe"] })
      );
    });
  });
});
