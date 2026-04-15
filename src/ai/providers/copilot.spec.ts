import { afterEach, beforeEach, describe, expect, it, type Mocked, vi } from "vitest";
import { CopilotCliError } from "../../errors/index.js";
import type { Clock } from "../../ports/clock.js";
import { createFixedClock } from "../../ports/clock.test-helper.js";
import type { ExecutableFinder } from "../../ports/executableFinder.js";
import { createStubExecutableFinder } from "../../ports/executableFinder.test-helper.js";
import type { FileSystem } from "../../ports/fileSystem.js";
import { createStubFileSystem } from "../../ports/fileSystem.test-helper.js";
import type { ProcessRunner } from "../../ports/processRunner.js";
import {
  createStubChildProcess,
  createStubProcessRunner,
} from "../../ports/processRunner.test-helper.js";
import type { AIResponse } from "../types.js";
import { CopilotProvider } from "./copilot.js";

function createAIResponse(parsed: unknown): AIResponse {
  return { raw: JSON.stringify(parsed), parsed };
}

describe("CopilotProvider", () => {
  let processRunner: Mocked<ProcessRunner>;
  let executableFinder: ExecutableFinder;
  let fileSystem: Mocked<FileSystem>;
  let clock: Clock;

  function createCopilotProvider(
    maxRetries = 1,
    timeoutMs = 5000,
    model?: string
  ): CopilotProvider {
    return new CopilotProvider({
      maxRetries,
      timeoutMs,
      model,
      processRunner,
      executableFinder,
      fileSystem,
      clock,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    processRunner = createStubProcessRunner() as Mocked<ProcessRunner>;
    executableFinder = createStubExecutableFinder({
      copilot: "C:\\Program Files\\copilot\\copilot.exe",
    });
    fileSystem = createStubFileSystem() as Mocked<FileSystem>;
    clock = createFixedClock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("executePrompt", () => {
    it("uses file-based approach for all prompts", async () => {
      const provider = createCopilotProvider();
      const prompt = "Review this code";
      const mockResponse = { findings: [] };
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: "Agent thinking process here...",
          exitCode: 0,
        })
      );
      fileSystem.readFile.mockResolvedValue(JSON.stringify(mockResponse));

      const promise = provider.executePrompt(prompt);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.parsed).toEqual(mockResponse);
      expect(fileSystem.mkdir).toHaveBeenCalledWith(
        expect.stringMatching(/\.mergementor[/\\]temp/),
        {
          recursive: true,
        }
      );
      // Should create prompt file
      expect(fileSystem.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/prompt-.*\.md$/),
        prompt,
        "utf-8"
      );
      // Should create transcript file
      expect(fileSystem.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/transcript-.*\.txt$/),
        expect.stringContaining("COPILOT AI AGENT TRANSCRIPT"),
        "utf-8"
      );
      // Should read from output file
      expect(fileSystem.readFile).toHaveBeenCalledWith(
        expect.stringMatching(/output-.*\.json$/),
        "utf-8"
      );
      expect(processRunner.spawn).toHaveBeenCalledWith(
        expect.any(String), // Resolved executable path
        expect.arrayContaining([
          "-p",
          // Prompt tells agent to write JSON to output file
          expect.stringMatching(
            /^Please follow the instructions in @.*prompt-.*\.md and write your JSON output to/
          ),
          "--allow-all-tools",
        ]),
        expect.objectContaining({ shell: false })
      );
      expect(fileSystem.unlink).toHaveBeenCalled();
    });

    it("cleans up temp file even on failure", async () => {
      const provider = createCopilotProvider();
      const longPrompt = "a".repeat(200);
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stderr: "CLI error",
          exitCode: 1,
        })
      );

      const promise = provider.executePrompt(longPrompt);

      // Run timers and handle rejection simultaneously
      await Promise.all([
        vi.runAllTimersAsync(),
        promise.catch(() => {}), // Catch to prevent unhandled rejection
      ]);

      // Now verify the error was thrown
      await expect(promise).rejects.toThrow(CopilotCliError);

      expect(fileSystem.unlink).toHaveBeenCalled();
    });

    it("passes model parameter when configured", async () => {
      const provider = createCopilotProvider(1, 5000, "claude-haiku-4.5");
      const mockResponse = { findings: [] };
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: JSON.stringify(mockResponse),
          exitCode: 0,
        })
      );
      fileSystem.readFile.mockResolvedValue(JSON.stringify(mockResponse));

      const promise = provider.executePrompt("test prompt");
      await vi.runAllTimersAsync();
      await promise;

      expect(processRunner.spawn).toHaveBeenCalledWith(
        expect.any(String), // Resolved executable path
        expect.arrayContaining(["--model", "claude-haiku-4.5"]),
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

      processRunner.spawn.mockImplementation(() => {
        attemptCount++;
        if (attemptCount === 1) {
          return createStubChildProcess({ stderr: "error", exitCode: 1 });
        }
        return createStubChildProcess({
          stdout: JSON.stringify(mockResponse),
          exitCode: 0,
        });
      });

      fileSystem.readFile.mockResolvedValue(JSON.stringify(mockResponse));

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
    claude-haiku-4.5     33.0k input, 773 output, 22.0k cache read (Est. 0 Premium requests)`;

      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: JSON.stringify(mockResponse),
          stderr,
          exitCode: 0,
        })
      );
      fileSystem.readFile.mockResolvedValue(JSON.stringify(mockResponse));

      const promise = provider.executePrompt("test prompt");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.tokenUsage).toEqual({
        inputTokens: 33000,
        outputTokens: 773,
        cachedTokens: 22000,
        premiumRequests: 0,
        model: "claude-haiku-4.5",
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
    claude-haiku-4.5     120.5k input, 1500 output (Est. 5 Premium requests)`;

      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: JSON.stringify(mockResponse),
          stderr,
          exitCode: 0,
        })
      );
      fileSystem.readFile.mockResolvedValue(JSON.stringify(mockResponse));

      const promise = provider.executePrompt("test prompt");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.tokenUsage).toEqual({
        inputTokens: 120500,
        outputTokens: 1500,
        cachedTokens: undefined,
        premiumRequests: 5,
        model: "claude-haiku-4.5",
        durationApiSeconds: 15,
        durationWallSeconds: 18,
      });
    });

    it("returns undefined when stderr has no token usage", async () => {
      const provider = createCopilotProvider();
      const mockResponse = { findings: [] };

      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: JSON.stringify(mockResponse),
          exitCode: 0,
        })
      );
      fileSystem.readFile.mockResolvedValue(JSON.stringify(mockResponse));

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

      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: JSON.stringify(mockResponse),
          stderr,
          exitCode: 0,
        })
      );
      fileSystem.readFile.mockResolvedValue(JSON.stringify(mockResponse));

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

    it("saves transcript on successful execution", async () => {
      const provider = createCopilotProvider();
      const prompt = "Review this code";
      const mockResponse = { findings: [] };
      const mockStdout = "Agent thinking process here...";
      const mockStderr = "Total usage est:       0 Premium requests";
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stdout: mockStdout,
          stderr: mockStderr,
          exitCode: 0,
        })
      );
      fileSystem.readFile.mockResolvedValue(JSON.stringify(mockResponse));

      const promise = provider.executePrompt(prompt);
      await vi.runAllTimersAsync();
      await promise;

      // Verify transcript directory was created
      expect(fileSystem.mkdir).toHaveBeenCalledWith(
        expect.stringMatching(/\.mergementor[/\\]transcripts/),
        { recursive: true }
      );

      // Verify transcript file was written
      const transcriptCalls = fileSystem.writeFile.mock.calls.filter((call) =>
        String(call[0]).includes("transcript-")
      );
      expect(transcriptCalls.length).toBeGreaterThan(0);

      const transcriptCall = transcriptCalls[0];
      const transcriptContent = transcriptCall[1] as string;

      // Verify transcript contains all required sections
      expect(transcriptContent).toContain("COPILOT AI AGENT TRANSCRIPT");
      expect(transcriptContent).toContain("CLI Command:");
      expect(transcriptContent).toContain("INPUT PROMPT");
      expect(transcriptContent).toContain(prompt);
      expect(transcriptContent).toContain("STDOUT OUTPUT");
      expect(transcriptContent).toContain(mockStdout);
      expect(transcriptContent).toContain("STDERR OUTPUT");
      expect(transcriptContent).toContain(mockStderr);
      expect(transcriptContent).toContain("JSON OUTPUT");
      expect(transcriptContent).toContain(JSON.stringify(mockResponse));
      expect(transcriptContent).toContain("Status: success");
    });

    it("saves transcript on failure", async () => {
      const provider = createCopilotProvider();
      const prompt = "Review this code";
      processRunner.spawn.mockReturnValue(
        createStubChildProcess({
          stderr: "CLI error occurred",
          exitCode: 1,
        })
      );

      const promise = provider.executePrompt(prompt);
      await Promise.all([
        vi.runAllTimersAsync(),
        promise.catch(() => {}), // Catch to prevent unhandled rejection
      ]);

      await expect(promise).rejects.toThrow(CopilotCliError);

      // Verify transcript file was written even on failure
      const transcriptCalls = fileSystem.writeFile.mock.calls.filter((call) =>
        String(call[0]).includes("transcript-")
      );
      expect(transcriptCalls.length).toBeGreaterThan(0);

      const transcriptCall = transcriptCalls[0];
      const transcriptContent = transcriptCall[1] as string;

      // Verify transcript contains error information
      expect(transcriptContent).toContain("COPILOT AI AGENT TRANSCRIPT");
      expect(transcriptContent).toContain("Status: failure");
      expect(transcriptContent).toContain("ERROR");
      expect(transcriptContent).toContain(prompt);
    });
  });

  describe("validateReasoning warnings", () => {
    it("still parses finding when reasoning is shorter than minimum length", () => {
      const provider = createCopilotProvider();
      const response = createAIResponse({
        findings: [
          {
            line: 3,
            severity: "medium",
            confidence: "medium",
            category: "quality",
            message: "Missing type",
            suggestion: "Add type annotation",
            reasoning: "Too short.", // < 50 chars triggers warn
            isPreExisting: false,
          },
        ],
      });

      const result = provider.parseFileReview("src/foo.ts", response);

      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].reasoning).toBe("Too short.");
    });

    it("still parses finding when reasoning lacks verification keywords", () => {
      const provider = createCopilotProvider();
      const response = createAIResponse({
        findings: [
          {
            line: 7,
            severity: "high",
            confidence: "high",
            category: "bug",
            message: "Unhandled promise rejection in this async call path",
            suggestion: "Wrap in try/catch or add .catch() handler to the promise",
            reasoning:
              "The async call does not appear to handle rejection and this could cause problems.",
            isPreExisting: false,
          },
        ],
      });

      const result = provider.parseFileReview("src/foo.ts", response);

      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].reasoning).toContain("does not appear to handle");
    });
  });

  describe("parseBatchedFileReview", () => {
    it("returns empty array when file_results is missing", () => {
      const provider = createCopilotProvider();
      const response = createAIResponse({});

      const result = provider.parseBatchedFileReview(response);

      expect(result).toHaveLength(0);
    });

    it("parses findings for multiple files", () => {
      const provider = createCopilotProvider();
      const response = createAIResponse({
        file_results: {
          "src/a.ts": {
            findings: [
              {
                line: 5,
                severity: "high",
                confidence: "high",
                category: "bug",
                message: "Null pointer",
                suggestion: "Add null check",
                reasoning: "Value is null at this point. Verified by tracing the call chain.",
                isPreExisting: false,
              },
            ],
          },
          "src/b.ts": { findings: [] },
        },
      });

      const result = provider.parseBatchedFileReview(response);

      expect(result).toHaveLength(2);
      const fileA = result.find((r) => r.filename === "src/a.ts");
      expect(fileA?.findings).toHaveLength(1);
      expect(fileA?.findings[0].severity).toBe("high");
    });

    it("warns on short reasoning in batched findings", () => {
      const provider = createCopilotProvider();
      const response = createAIResponse({
        file_results: {
          "src/c.ts": {
            findings: [
              {
                line: 2,
                severity: "medium",
                confidence: "medium",
                category: "quality",
                message: "Missing return type",
                suggestion: "Add return type",
                reasoning: "Short.", // < 50 chars
              },
            ],
          },
        },
      });

      const result = provider.parseBatchedFileReview(response);

      expect(result[0].findings[0].reasoning).toBe("Short.");
    });

    it("warns on reasoning without verification keywords in batched findings", () => {
      const provider = createCopilotProvider();
      const response = createAIResponse({
        file_results: {
          "src/d.ts": {
            findings: [
              {
                line: 8,
                severity: "high",
                confidence: "high",
                category: "security",
                message: "User input used in SQL without sanitization is dangerous",
                suggestion: "Use parameterized queries for all database operations",
                reasoning:
                  "The value from req.body is passed directly into the SQL expression string.",
              },
            ],
          },
        },
      });

      const result = provider.parseBatchedFileReview(response);

      expect(result[0].findings[0].reasoning).toContain("passed directly");
    });
  });

  describe("parseFastReview", () => {
    it("splits file findings and cross-file findings", () => {
      const provider = createCopilotProvider();
      const response = createAIResponse({
        summary: "Fast review complete",
        findings: [
          {
            file: "src/main.ts",
            line: 10,
            severity: "high",
            confidence: "high",
            category: "bug",
            message: "Null dereference",
            suggestion: "Add null check",
            reasoning: "The value is null here. Verified by tracing the assignment.",
            isPreExisting: false,
          },
          {
            severity: "medium",
            confidence: "medium",
            category: "architecture",
            message: "Tight coupling between modules",
            reasoning: "Confirmed coupling by checking the import graph dependencies.",
          },
        ],
      });

      const result = provider.parseFastReview(response);

      expect(result.fileResults).toHaveLength(1);
      expect(result.fileResults[0].filename).toBe("src/main.ts");
      expect(result.crossFileResult.findings).toHaveLength(1);
      expect(result.crossFileResult.overallAssessment).toBe("Fast review complete");
    });

    it("handles finding with no file or line (cross-file finding)", () => {
      const provider = createCopilotProvider();
      const response = createAIResponse({
        summary: "Some issues",
        findings: [
          {
            severity: "low",
            confidence: "medium",
            category: "design",
            message: "God object pattern detected in codebase",
            reasoning: "Scanned the entire codebase and found one class handles too many things.",
          },
        ],
      });

      const result = provider.parseFastReview(response);

      expect(result.fileResults).toHaveLength(0);
      expect(result.crossFileResult.findings).toHaveLength(1);
    });

    it("handles empty findings", () => {
      const provider = createCopilotProvider();
      const response = createAIResponse({ summary: "Clean", findings: [] });

      const result = provider.parseFastReview(response);

      expect(result.fileResults).toHaveLength(0);
      expect(result.crossFileResult.findings).toHaveLength(0);
    });

    it("warns on short reasoning in fast review findings", () => {
      const provider = createCopilotProvider();
      const response = createAIResponse({
        summary: "Done",
        findings: [
          {
            file: "src/x.ts",
            line: 1,
            severity: "medium",
            confidence: "medium",
            category: "quality",
            message: "Missing validation",
            suggestion: "Add validation",
            reasoning: "Short.", // < 50 chars
          },
        ],
      });

      const result = provider.parseFastReview(response);

      expect(result.fileResults[0].findings[0].reasoning).toBe("Short.");
    });
  });
});
