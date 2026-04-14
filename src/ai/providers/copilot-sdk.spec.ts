import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted ensures these are available when vi.mock() factory runs (which is hoisted)
const { mockSession, mockClient, MockCopilotClient } = vi.hoisted(() => {
  const mockSession = {
    on: vi.fn(),
    sendAndWait: vi.fn(),
    disconnect: vi.fn(),
  };
  const mockClient = {
    createSession: vi.fn().mockResolvedValue(mockSession),
    stop: vi.fn().mockResolvedValue([]),
  };
  // biome-ignore lint/complexity/useArrowFunction: regular function required so Reflect.construct works when called with `new`
  const MockCopilotClient = vi.fn().mockImplementation(function () {
    return mockClient;
  });
  return { mockSession, mockClient, MockCopilotClient };
});

vi.mock("@github/copilot-sdk", () => ({
  CopilotClient: MockCopilotClient,
  approveAll: vi.fn(),
}));

import { CopilotSdkError, ValidationError } from "../../errors/index.js";
import type { AIResponse } from "../types.js";
import { CopilotSdkProvider } from "./copilot-sdk.js";

function createAIResponse(parsed: unknown): AIResponse {
  return { raw: JSON.stringify(parsed), parsed };
}

/** Standard mock for a successful prompt response returning JSON in content. */
function mockSuccessfulPrompt(output: unknown = { findings: [] }): void {
  mockSession.sendAndWait.mockResolvedValue({
    type: "assistant.message",
    data: { content: JSON.stringify(output) },
  });
}

describe("CopilotSdkProvider", () => {
  function createProvider(
    maxRetries = 1,
    timeoutMs = 5000,
    model?: string,
    token?: string
  ): CopilotSdkProvider {
    return new CopilotSdkProvider({ maxRetries, timeoutMs, model, token });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockSession.on.mockReturnValue(() => {});
    mockSession.disconnect.mockResolvedValue(undefined);
    mockClient.createSession.mockResolvedValue(mockSession);
    mockClient.stop.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("uses default values when no options provided", () => {
      const provider = new CopilotSdkProvider();
      expect(provider).toBeDefined();
    });

    it("accepts custom maxRetries and timeoutMs", () => {
      const provider = new CopilotSdkProvider({ maxRetries: 5, timeoutMs: 30000 });
      expect(provider).toBeDefined();
    });
  });

  describe("executePrompt", () => {
    it("throws ValidationError when prompt is empty", async () => {
      const provider = createProvider();
      await expect(provider.executePrompt("")).rejects.toThrow(ValidationError);
      await expect(provider.executePrompt("")).rejects.toThrow("Prompt cannot be empty");
    });

    it("throws ValidationError when prompt is whitespace only", async () => {
      const provider = createProvider();
      await expect(provider.executePrompt("   ")).rejects.toThrow("Prompt cannot be empty");
    });

    it("returns parsed JSON from response content", async () => {
      const provider = createProvider();
      const expectedOutput = {
        findings: [{ line: 1, severity: "high", category: "bug", message: "Issue" }],
      };
      mockSuccessfulPrompt(expectedOutput);

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.parsed).toEqual(expectedOutput);
    });

    it("passes prompt directly to sendAndWait", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockSession.sendAndWait).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "Review the following file test.ts" }),
        expect.any(Number)
      );
    });

    it("passes workingDirectory to createSession", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts", {
        workingDirectory: "/tmp/my-repo",
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workingDirectory: "/tmp/my-repo",
        })
      );
    });

    it("attaches diff files as attachments", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts", {
        diffFiles: ["/tmp/diff1.patch", "/tmp/diff2.patch"],
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockSession.sendAndWait).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            { type: "file", path: "/tmp/diff1.patch" },
            { type: "file", path: "/tmp/diff2.patch" },
          ],
        }),
        expect.any(Number)
      );
    });

    it("handles response with markdown JSON code blocks", async () => {
      const provider = createProvider();
      mockSession.sendAndWait.mockResolvedValue({
        type: "assistant.message",
        data: { content: '```json\n{"findings": []}\n```' },
      });

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.parsed).toEqual({ findings: [] });
    });

    it("throws CopilotSdkError when response has no content", async () => {
      const provider = createProvider();
      mockSession.sendAndWait.mockResolvedValue({
        type: "assistant.message",
        data: { content: "" },
      });
      mockSession.on.mockReturnValue(() => {});

      const promise = provider.executePrompt("Review the following file test.ts");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await rejection;

      expect(error).toBeInstanceOf(CopilotSdkError);
      expect(error.message).toContain("No content in response");
    });

    it("falls back to accumulated chunks when sendAndWait returns undefined", async () => {
      const provider = createProvider();

      mockSession.on.mockImplementation((eventType: string, handler: (e: unknown) => void) => {
        if (eventType === "assistant.message_delta") {
          handler({ type: "assistant.message_delta", data: { deltaContent: '{"findings"' } });
          handler({ type: "assistant.message_delta", data: { deltaContent: ": []}" } });
        }
        return () => {};
      });
      mockSession.sendAndWait.mockResolvedValue(undefined);

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.parsed).toEqual({ findings: [] });
    });

    it("calls onStreamData with delta content from events", async () => {
      const provider = createProvider();
      const onStreamData = vi.fn();
      mockSuccessfulPrompt();

      mockSession.on.mockImplementation((eventType: string, handler: (e: unknown) => void) => {
        if (eventType === "assistant.message_delta") {
          handler({ type: "assistant.message_delta", data: { deltaContent: "hello " } });
        }
        return () => {};
      });

      const resultPromise = provider.executePrompt("Review the following file test.ts", {
        onStreamData,
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(onStreamData).toHaveBeenCalledWith("hello ");
    });

    it("creates session with specified model", async () => {
      const provider = createProvider(1, 5000, "gpt-4.1");
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ model: "gpt-4.1" })
      );
    });

    it("retries on failure and succeeds on subsequent attempt", async () => {
      const provider = new CopilotSdkProvider({ maxRetries: 3, timeoutMs: 5000 });
      let attempt = 0;

      mockSession.sendAndWait.mockImplementation(() => {
        attempt++;
        if (attempt === 3) {
          return Promise.resolve({
            type: "assistant.message",
            data: { content: '{"findings": []}' },
          });
        }
        return Promise.reject(new Error("SDK error"));
      });

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.parsed).toEqual({ findings: [] });
      expect(attempt).toBe(3);
    });

    it("throws CopilotSdkError after exhausting retries", async () => {
      const provider = createProvider(2);
      mockSession.sendAndWait.mockRejectedValue(new Error("Network error"));

      const promise = provider.executePrompt("Review the following file test.ts");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await rejection;

      expect(error).toBeInstanceOf(CopilotSdkError);
      expect(error.message).toContain("Failed after 2 attempts");
    });

    it("throws when response contains no valid JSON", async () => {
      const provider = createProvider();
      mockSession.sendAndWait.mockResolvedValue({
        type: "assistant.message",
        data: { content: "This is plain text with no JSON at all." },
      });

      const promise = provider.executePrompt("Review the following file test.ts");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await rejection;

      expect(error).toBeInstanceOf(CopilotSdkError);
      expect(error.message).toContain("Failed after 1 attempts");
    });
  });

  describe("session cleanup", () => {
    it("disconnects session after successful prompt", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockSession.disconnect).toHaveBeenCalled();
    });

    it("disconnects session even when prompt fails", async () => {
      const provider = createProvider();
      mockSession.sendAndWait.mockRejectedValue(new Error("SDK error"));

      const promise = provider.executePrompt("Review the following file test.ts");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockSession.disconnect).toHaveBeenCalled();
    });

    it("does not fail if session.disconnect throws", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();
      mockSession.disconnect.mockRejectedValue(new Error("disconnect failed"));

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.parsed).toEqual({ findings: [] });
    });
  });

  describe("client reuse", () => {
    it("reuses CopilotClient across multiple executePrompt calls", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const p1 = provider.executePrompt("Review the following file a.ts");
      await vi.runAllTimersAsync();
      await p1;

      const p2 = provider.executePrompt("Review the following file b.ts");
      await vi.runAllTimersAsync();
      await p2;

      expect(MockCopilotClient).toHaveBeenCalledTimes(1);
    });

    it("recreates client after destroy()", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const p1 = provider.executePrompt("Review the following file a.ts");
      await vi.runAllTimersAsync();
      await p1;

      provider.destroy();
      expect(mockClient.stop).toHaveBeenCalledTimes(1);

      const p2 = provider.executePrompt("Review the following file b.ts");
      await vi.runAllTimersAsync();
      await p2;

      expect(MockCopilotClient).toHaveBeenCalledTimes(2);
    });
  });

  describe("model and token config", () => {
    it("passes model to createSession", async () => {
      const provider = createProvider(1, 5000, "claude-sonnet-4");
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ model: "claude-sonnet-4" })
      );
    });

    it("passes token as githubToken to CopilotClient", async () => {
      const provider = createProvider(1, 5000, undefined, "gh-token-123");
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(MockCopilotClient).toHaveBeenCalledWith(
        expect.objectContaining({ githubToken: "gh-token-123" })
      );
    });

    it("does not pass config when no token provided", async () => {
      const provider = createProvider(1, 5000);
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(MockCopilotClient).toHaveBeenCalledWith(undefined);
    });
  });

  describe("explicit promptType hint", () => {
    it("uses promptType from options", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt({ file_results: {} });

      const resultPromise = provider.executePrompt("Please analyze this code", {
        promptType: "batched-file-review",
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      // Should not throw - promptType hint is used for audit logging
      expect(mockSession.sendAndWait).toHaveBeenCalled();
    });

    it("falls back to inferPromptType when promptType not provided", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      // inferPromptType detects "file-review" from the prompt text
      expect(mockSession.sendAndWait).toHaveBeenCalled();
    });
  });

  describe("destroy", () => {
    it("calls client.stop() on destroy", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      provider.destroy();

      expect(mockClient.stop).toHaveBeenCalled();
    });

    it("is safe to call destroy multiple times", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      provider.destroy();
      provider.destroy();
      expect(mockClient.stop).toHaveBeenCalledTimes(1);
    });

    it("is safe to call destroy before any executePrompt", () => {
      const provider = createProvider();
      provider.destroy();
      expect(mockClient.stop).not.toHaveBeenCalled();
    });
  });

  describe("parseFileReview", () => {
    it("returns empty findings for response with no findings", () => {
      const provider = createProvider();
      const response = createAIResponse({ findings: [] });

      const result = provider.parseFileReview("src/index.ts", response);

      expect(result.filename).toBe("src/index.ts");
      expect(result.findings).toHaveLength(0);
    });

    it("parses a valid finding with all fields", () => {
      const provider = createProvider();
      const response = createAIResponse({
        findings: [
          {
            line: 42,
            severity: "high",
            confidence: "high",
            category: "bug",
            message: "Potential null dereference",
            suggestion: "Add null check",
            reasoning:
              "The variable may be null when accessed here. I verified this by checking the assignment.",
            isPreExisting: false,
          },
        ],
      });

      const result = provider.parseFileReview("src/index.ts", response);

      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toMatchObject({
        line: 42,
        severity: "high",
        confidence: "high",
        category: "bug",
        message: "Potential null dereference",
      });
    });

    it("handles missing findings array", () => {
      const provider = createProvider();
      const response = createAIResponse({});

      const result = provider.parseFileReview("test.ts", response);

      expect(result.filename).toBe("test.ts");
      expect(result.findings).toHaveLength(0);
    });

    it("defaults to medium severity for unknown severity values", () => {
      const provider = createProvider();
      const response = createAIResponse({
        findings: [
          {
            line: 1,
            severity: "unknown-severity",
            confidence: "high",
            category: "bug",
            message: "Test",
            suggestion: "Fix it",
            reasoning: "Some reasoning provided and verified here.",
          },
        ],
      });

      const result = provider.parseFileReview("src/index.ts", response);

      expect(result.findings[0].severity).toBe("medium");
    });

    it("defaults to quality category for unknown category values", () => {
      const provider = createProvider();
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
    it("returns empty findings for response with no findings", () => {
      const provider = createProvider();
      const response = createAIResponse({
        overall_assessment: "Looks good",
        findings: [],
        recommendations: [],
      });

      const result = provider.parseCrossFileReview(response);

      expect(result.overallAssessment).toBe("Looks good");
      expect(result.findings).toHaveLength(0);
    });

    it("parses a cross-file finding with affected files", () => {
      const provider = createProvider();
      const response = createAIResponse({
        overall_assessment: "Some issues found",
        findings: [
          {
            severity: "medium",
            confidence: "high",
            category: "architecture",
            message: "Circular dependency detected",
            reasoning: "Confirmed circular import chain between these files by scanning them.",
            affected_files: ["src/a.ts", "src/b.ts"],
          },
        ],
        recommendations: ["Refactor to remove circular dependency"],
      });

      const result = provider.parseCrossFileReview(response);

      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].affectedFiles).toEqual(["src/a.ts", "src/b.ts"]);
      expect(result.recommendations).toEqual(["Refactor to remove circular dependency"]);
    });

    it("handles empty response", () => {
      const provider = createProvider();
      const response = createAIResponse({});

      const result = provider.parseCrossFileReview(response);

      expect(result.overallAssessment).toBe("Review completed");
      expect(result.findings).toHaveLength(0);
      expect(result.recommendations).toHaveLength(0);
    });
  });

  describe("parseBatchedFileReview", () => {
    it("returns empty array when file_results is missing", () => {
      const provider = createProvider();
      const response = createAIResponse({});

      const result = provider.parseBatchedFileReview(response);

      expect(result).toHaveLength(0);
    });

    it("parses findings for each file", () => {
      const provider = createProvider();
      const response = createAIResponse({
        file_results: {
          "src/a.ts": {
            findings: [
              {
                line: 5,
                severity: "low",
                confidence: "medium",
                category: "quality",
                message: "Unused variable",
                suggestion: "Remove it",
                reasoning:
                  "Variable x is declared but never used. Verified by scanning all usages.",
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
      expect(fileA?.findings[0].severity).toBe("low");
    });
  });

  describe("parseFastReview", () => {
    it("splits file findings and cross-file findings correctly", () => {
      const provider = createProvider();
      const response = createAIResponse({
        summary: "Fast review done",
        findings: [
          {
            file: "src/a.ts",
            line: 10,
            severity: "high",
            confidence: "high",
            category: "bug",
            message: "Null check missing",
            suggestion: "Add null check",
            reasoning: "The value is null at this point. Verified by tracing the call chain.",
            isPreExisting: false,
          },
          {
            severity: "medium",
            confidence: "medium",
            category: "design",
            message: "Coupling is too tight",
            reasoning: "Confirmed tight coupling between modules by scanning dependencies.",
          },
        ],
      });

      const result = provider.parseFastReview(response);

      expect(result.fileResults).toHaveLength(1);
      expect(result.fileResults[0].filename).toBe("src/a.ts");
      expect(result.crossFileResult.findings).toHaveLength(1);
      expect(result.crossFileResult.overallAssessment).toBe("Fast review done");
    });

    it("handles empty findings", () => {
      const provider = createProvider();
      const response = createAIResponse({ summary: "Clean", findings: [] });

      const result = provider.parseFastReview(response);

      expect(result.fileResults).toHaveLength(0);
      expect(result.crossFileResult.findings).toHaveLength(0);
    });
  });
});
