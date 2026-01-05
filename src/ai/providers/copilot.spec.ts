import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock must be at top level before any imports that use it
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
  },
}));

import { spawn } from "node:child_process";
import type { AIResponse } from "../types.js";
import { CopilotProvider } from "./copilot.js";
import { CopilotCliError } from "../../errors/index.js";

const mockSpawn = vi.mocked(spawn);
const mockFs = vi.mocked(fs);

function createCopilotProvider(maxRetries = 1, timeoutMs = 5000, model?: string): CopilotProvider {
  return new CopilotProvider({ maxRetries, timeoutMs, model });
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

describe("CopilotProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.unlink.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("executePrompt", () => {
    it("executes short prompt directly via CLI argument", async () => {
      const provider = createCopilotProvider();
      const shortPrompt = "Review this code";
      const mockResponse = { findings: [] };
      const mockProcess = createMockProcess({
        stdout: JSON.stringify(mockResponse),
        exitCode: 0,
      });
      mockSpawn.mockReturnValue(mockProcess);

      const promise = provider.executePrompt(shortPrompt);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.parsed).toEqual(mockResponse);
      expect(mockSpawn).toHaveBeenCalledWith(
        "copilot",
        ["-p", shortPrompt],
        expect.objectContaining({ shell: false })
      );
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it("uses temp file for long prompts", async () => {
      const provider = createCopilotProvider();
      const longPrompt = "a".repeat(5000); // Exceeds PROMPT_LENGTH_THRESHOLD
      const mockResponse = { findings: [] };
      const mockProcess = createMockProcess({
        stdout: JSON.stringify(mockResponse),
        exitCode: 0,
      });
      mockSpawn.mockReturnValue(mockProcess);

      const promise = provider.executePrompt(longPrompt);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.parsed).toEqual(mockResponse);
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining(".merge-mentor/temp"),
        { recursive: true }
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/prompt-.*\.md$/),
        longPrompt,
        "utf-8"
      );
      expect(mockSpawn).toHaveBeenCalledWith(
        "copilot",
        expect.arrayContaining([
          "-p",
          expect.stringMatching(/^Please follow the instructions in @prompt-.*\.md$/),
          "--allow-all-tools",
        ]),
        expect.objectContaining({ shell: false })
      );
      expect(mockFs.unlink).toHaveBeenCalled();
    });

    it("cleans up temp file even on failure", async () => {
      const provider = createCopilotProvider();
      const longPrompt = "a".repeat(5000);
      const mockProcess = createMockProcess({
        stderr: "CLI error",
        exitCode: 1,
      });
      mockSpawn.mockReturnValue(mockProcess);

      const promise = provider.executePrompt(longPrompt);
      
      // Run timers and handle rejection simultaneously
      await Promise.all([
        vi.runAllTimersAsync(),
        promise.catch(() => {}) // Catch to prevent unhandled rejection
      ]);
      
      // Now verify the error was thrown
      await expect(promise).rejects.toThrow(CopilotCliError);

      expect(mockFs.unlink).toHaveBeenCalled();
    });

    it("passes model parameter when configured", async () => {
      const provider = createCopilotProvider(1, 5000, "gpt-4");
      const mockResponse = { findings: [] };
      const mockProcess = createMockProcess({
        stdout: JSON.stringify(mockResponse),
        exitCode: 0,
      });
      mockSpawn.mockReturnValue(mockProcess);

      const promise = provider.executePrompt("test prompt");
      await vi.runAllTimersAsync();
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "copilot",
        expect.arrayContaining(["--model", "gpt-4"]),
        expect.any(Object)
      );
    });

    it("throws error for empty prompt", async () => {
      const provider = createCopilotProvider();
      await expect(provider.executePrompt("")).rejects.toThrow("Prompt cannot be empty");
    });

    it("retries on failure", async () => {
      const provider = createCopilotProvider(2, 5000);
      const mockResponse = { findings: [] };
      let attemptCount = 0;
      
      // Reset mock to clear previous test calls
      mockSpawn.mockReset();

      mockSpawn.mockImplementation(() => {
        attemptCount++;
        if (attemptCount === 1) {
          return createMockProcess({ stderr: "error", exitCode: 1 });
        }
        return createMockProcess({
          stdout: JSON.stringify(mockResponse),
          exitCode: 0,
        });
      });

      const promise = provider.executePrompt("test");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.parsed).toEqual(mockResponse);
      expect(attemptCount).toBe(2);
    });
  });

  describe("parseFileReview", () => {
    it("parses valid file review response", () => {
      const provider = createCopilotProvider();
      const response = createAIResponse({
        findings: [
          {
            line: 10,
            severity: "high",
            category: "bug",
            message: "Potential null pointer",
            suggestion: "Add null check",
            confidence: "high",
            isPreExisting: false,
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
        confidence: "high",
        isPreExisting: false,
      });
    });

    it("handles resolved comments", () => {
      const provider = createCopilotProvider();
      const response = createAIResponse({
        findings: [],
        resolved_comments: [
          { line: 5, reason: "Issue was fixed" },
          { line: 10, reason: "Code was refactored" },
        ],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.resolvedComments).toHaveLength(2);
      expect(result.resolvedComments?.[0]).toEqual({
        line: 5,
        reason: "Issue was fixed",
      });
    });

    it("normalizes invalid severity values", () => {
      const provider = createCopilotProvider();
      const response = createAIResponse({
        findings: [{ line: 1, severity: "invalid", category: "bug", message: "test" }],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings[0].severity).toBe("medium");
    });

    it("normalizes invalid confidence values", () => {
      const provider = createCopilotProvider();
      const response = createAIResponse({
        findings: [{ line: 1, severity: "high", category: "bug", message: "test", confidence: "invalid" }],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings[0].confidence).toBe("medium");
    });
  });

  describe("parseCrossFileReview", () => {
    it("parses valid cross-file review response", () => {
      const provider = createCopilotProvider();
      const response = createAIResponse({
        overall_assessment: "Code looks good",
        findings: [
          {
            severity: "medium",
            category: "design",
            message: "Consider refactoring",
            affected_files: ["file1.ts", "file2.ts"],
          },
        ],
        recommendations: ["Add more tests"],
      });

      const result = provider.parseCrossFileReview(response);

      expect(result.overallAssessment).toBe("Code looks good");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toEqual({
        severity: "medium",
        category: "design",
        message: "Consider refactoring",
        affectedFiles: ["file1.ts", "file2.ts"],
      });
      expect(result.recommendations).toEqual(["Add more tests"]);
    });

    it("handles empty response", () => {
      const provider = createCopilotProvider();
      const response = createAIResponse({});

      const result = provider.parseCrossFileReview(response);

      expect(result.overallAssessment).toBe("Review completed");
      expect(result.findings).toEqual([]);
      expect(result.recommendations).toEqual([]);
    });

    it("normalizes invalid cross-file category values", () => {
      const provider = createCopilotProvider();
      const response = createAIResponse({
        findings: [{ severity: "high", category: "invalid", message: "test" }],
      });

      const result = provider.parseCrossFileReview(response);

      expect(result.findings[0].category).toBe("design");
    });
  });
});
