import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock must be at top level before any imports that use it
// Use "node:child_process" to match the import in copilot.ts
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  // Mock execSync to return a Windows .exe path so tests expect shell: false
  execSync: vi.fn(() => "C:\\Program Files\\copilot\\copilot.exe"),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
  },
}));

import { spawn } from "node:child_process";
import { CopilotCliError } from "../../errors/index.js";
import type { AIResponse } from "../types.js";
import { CopilotProvider } from "./copilot.js";

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
        expect.any(String), // Resolved executable path
        ["-p", shortPrompt],
        expect.objectContaining({ shell: false })
      );
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it("uses temp file for long prompts", async () => {
      const provider = createCopilotProvider();
      const longPrompt = "a".repeat(200); // Exceeds PROMPT_LENGTH_THRESHOLD (100)
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
      expect(mockFs.mkdir).toHaveBeenCalledWith(expect.stringMatching(/\.merge-mentor[/\\]temp/), {
        recursive: true,
      });
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/prompt-.*\.md$/),
        longPrompt,
        "utf-8"
      );
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String), // Resolved executable path
        expect.arrayContaining([
          "-p",
          // Now uses absolute path: @C:\\full\\path\\to\\prompt-timestamp-id.md
          expect.stringMatching(/^Please follow the instructions in @.*prompt-.*\.md$/),
          "--allow-all-tools",
        ]),
        expect.objectContaining({ shell: false })
      );
      expect(mockFs.unlink).toHaveBeenCalled();
    });

    it("cleans up temp file even on failure", async () => {
      const provider = createCopilotProvider();
      const longPrompt = "a".repeat(200);
      const mockProcess = createMockProcess({
        stderr: "CLI error",
        exitCode: 1,
      });
      mockSpawn.mockReturnValue(mockProcess);

      const promise = provider.executePrompt(longPrompt);

      // Run timers and handle rejection simultaneously
      await Promise.all([
        vi.runAllTimersAsync(),
        promise.catch(() => {}), // Catch to prevent unhandled rejection
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
        expect.any(String), // Resolved executable path
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
        isPreExisting: false,
        confidence: "high",
        reasoning: "Reasoning not provided by the model.",
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
        confidence: "high",
        reasoning: "Reasoning not provided by the model.",
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

  describe("parseTokenUsage", () => {
    it("parses complete token usage stats from stderr", async () => {
      const provider = createCopilotProvider();
      const mockResponse = { findings: [] };
      const stderr = `Total usage est:       0 Premium requests
Total duration (API):  21s
Total duration (wall): 26s
Total code changes:    0 lines added, 0 lines removed
Usage by model:
    gpt-5-mini           33.0k input, 773 output, 22.0k cache read (Est. 0 Premium requests)`;

      const mockProcess = createMockProcess({
        stdout: JSON.stringify(mockResponse),
        stderr,
        exitCode: 0,
      });
      mockSpawn.mockReturnValue(mockProcess);

      const promise = provider.executePrompt("test prompt");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.tokenUsage).toEqual({
        inputTokens: 33000,
        outputTokens: 773,
        cachedTokens: 22000,
        premiumRequests: 0,
        model: "gpt-5-mini",
        durationApiSeconds: 21,
        durationWallSeconds: 26,
      });
    });

    it("parses token usage without cache reads", async () => {
      const provider = createCopilotProvider();
      const mockResponse = { findings: [] };
      const stderr = `Total usage est:       5 Premium requests
Total duration (API):  15s
Total duration (wall): 18s
Usage by model:
    gpt-5                120.5k input, 1500 output (Est. 5 Premium requests)`;

      const mockProcess = createMockProcess({
        stdout: JSON.stringify(mockResponse),
        stderr,
        exitCode: 0,
      });
      mockSpawn.mockReturnValue(mockProcess);

      const promise = provider.executePrompt("test prompt");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.tokenUsage).toEqual({
        inputTokens: 120500,
        outputTokens: 1500,
        cachedTokens: undefined,
        premiumRequests: 5,
        model: "gpt-5",
        durationApiSeconds: 15,
        durationWallSeconds: 18,
      });
    });

    it("returns undefined when stderr has no token usage", async () => {
      const provider = createCopilotProvider();
      const mockResponse = { findings: [] };

      const mockProcess = createMockProcess({
        stdout: JSON.stringify(mockResponse),
        stderr: "",
        exitCode: 0,
      });
      mockSpawn.mockReturnValue(mockProcess);

      const promise = provider.executePrompt("test prompt");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.tokenUsage).toBeUndefined();
    });

    it("parses partial token usage data", async () => {
      const provider = createCopilotProvider();
      const mockResponse = { findings: [] };
      const stderr = `Usage by model:
    claude-opus          50k input, 200 output`;

      const mockProcess = createMockProcess({
        stdout: JSON.stringify(mockResponse),
        stderr,
        exitCode: 0,
      });
      mockSpawn.mockReturnValue(mockProcess);

      const promise = provider.executePrompt("test prompt");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.tokenUsage).toEqual({
        inputTokens: 50000,
        outputTokens: 200,
        cachedTokens: undefined,
        premiumRequests: undefined,
        model: "claude-opus",
        durationApiSeconds: undefined,
        durationWallSeconds: undefined,
      });
    });
  });
});
