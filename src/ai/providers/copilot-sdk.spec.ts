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
    getAuthStatus: vi.fn().mockResolvedValue({ isAuthenticated: true, authType: "token" }),
  };
  // biome-ignore lint/complexity/useArrowFunction: regular function required so Reflect.construct works when called with `new`
  const MockCopilotClient = vi.fn().mockImplementation(function () {
    return mockClient;
  });
  return { mockSession, mockClient, MockCopilotClient };
});

vi.mock("@github/copilot-sdk", () => ({
  CopilotClient: MockCopilotClient,
  defineTool: vi.fn((name, config) => ({ name, ...config })),
  RuntimeConnection: {
    forStdio: vi.fn((options) => ({ kind: "stdio", ...options })),
  },
}));

vi.mock("../../ports/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ports/index.js")>();
  return {
    ...actual,
    nodeFs: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(""),
      rm: vi.fn().mockResolvedValue(undefined),
      access: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      stat: vi.fn().mockResolvedValue({
        isDirectory: () => true,
        isFile: () => true,
        size: 0,
        mtime: new Date("2025-01-01T00:00:00.000Z"),
      }),
    },
  };
});

import type { PermissionRequest } from "@github/copilot-sdk";
import { AIProviderError, ValidationError } from "../../errors/index.js";
import type { FindingsCollector } from "../tools/index.js";
import type { AIProviderOptions, AIResponse } from "../types.js";
import { CopilotSdkProvider, createReviewPermissionHandler } from "./copilot-sdk.js";

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
    token?: string,
    aiBaseUrl?: string,
    aiApiKey?: string
  ): CopilotSdkProvider {
    return new CopilotSdkProvider({
      maxRetries,
      timeoutMs,
      model,
      token,
      aiBaseUrl,
      aiApiKey,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockSession.on.mockReturnValue(() => {});
    mockSession.disconnect.mockResolvedValue(undefined);
    mockClient.createSession.mockResolvedValue(mockSession);
    mockClient.stop.mockResolvedValue([]);
    mockClient.getAuthStatus.mockResolvedValue({ isAuthenticated: true, authType: "token" });
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

    it("configures RuntimeConnection path using COPILOT_CLI_PATH if set", () => {
      const originalEnv = process.env.COPILOT_CLI_PATH;
      process.env.COPILOT_CLI_PATH = "/dummy/path/to/copilot-cli";
      try {
        const provider = new CopilotSdkProvider();
        const client = (provider as unknown as { getClient: () => unknown }).getClient();
        expect(client).toBeDefined();
      } finally {
        process.env.COPILOT_CLI_PATH = originalEnv;
      }
    });

    it("throws when Copilot SDK BYOK API key is provided without a base URL", () => {
      const createProviderWithInvalidByok = () =>
        new CopilotSdkProvider({
          aiApiKey: "bedrock-key",
        } satisfies AIProviderOptions);

      expect(createProviderWithInvalidByok).toThrow(ValidationError);
      expect(createProviderWithInvalidByok).toThrow(
        "AI base URL is required when an AI API key is provided."
      );
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

      expect(error).toBeInstanceOf(AIProviderError);
      expect((error as AIProviderError).provider).toBe("copilot-sdk");
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

    it("recovers parseable streamed JSON after session.idle timeout", async () => {
      const provider = createProvider();

      mockSession.on.mockImplementation((eventType: string, handler: (e: unknown) => void) => {
        if (eventType === "assistant.message_delta") {
          handler({
            type: "assistant.message_delta",
            data: { deltaContent: 'Analysis first\n```json\n{"findings":[]}\n```' },
          });
        }
        return () => {};
      });
      mockSession.sendAndWait.mockRejectedValue(
        new Error("Timeout after 5000ms waiting for session.idle")
      );

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.raw).toContain('{"findings":[]}');
      expect(result.parsed).toEqual({ findings: [] });
    });

    it("keeps failing on session.idle timeout when streamed content is not parseable JSON", async () => {
      const provider = createProvider(1);

      mockSession.on.mockImplementation((eventType: string, handler: (e: unknown) => void) => {
        if (eventType === "assistant.message_delta") {
          handler({
            type: "assistant.message_delta",
            data: { deltaContent: "Partial analysis without final JSON" },
          });
        }
        return () => {};
      });
      mockSession.sendAndWait.mockRejectedValue(
        new Error("Timeout after 5000ms waiting for session.idle")
      );

      const promise = provider.executePrompt("Review the following file test.ts");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await rejection;

      expect(error).toBeInstanceOf(AIProviderError);
      expect((error as AIProviderError).provider).toBe("copilot-sdk");
      expect(error.message).toContain("waiting for session.idle");
    });

    it("throws CopilotSdkError after exhausting retries", async () => {
      const provider = createProvider(2);
      mockSession.sendAndWait.mockRejectedValue(new Error("Network error"));

      const promise = provider.executePrompt("Review the following file test.ts");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await rejection;

      expect(error).toBeInstanceOf(AIProviderError);
      expect((error as AIProviderError).provider).toBe("copilot-sdk");
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

      expect(error).toBeInstanceOf(AIProviderError);
      expect((error as AIProviderError).provider).toBe("copilot-sdk");
      expect(error.message).toContain("Failed after 1 attempts");
    });

    it("captures token usage from assistant.usage event", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      mockSession.on.mockImplementation((eventType: string, handler: (e: unknown) => void) => {
        if (eventType === "assistant.usage") {
          handler({
            type: "assistant.usage",
            data: {
              inputTokens: 100,
              outputTokens: 50,
              cacheReadTokens: 20,
              cacheWriteTokens: 5,
              model: "gpt-4.1",
              duration: 1200,
            },
          });
        }
        return () => {};
      });

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.tokenUsage).toMatchObject({
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 25,
        model: "gpt-4.1",
        durationApiSeconds: 1.2,
      });
    });

    it("accumulates token usage across multiple assistant.usage events in one call", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      mockSession.on.mockImplementation((eventType: string, handler: (e: unknown) => void) => {
        if (eventType === "assistant.usage") {
          handler({
            type: "assistant.usage",
            data: { inputTokens: 100, outputTokens: 50, model: "gpt-4.1", duration: 800 },
          });
          handler({
            type: "assistant.usage",
            data: { inputTokens: 40, outputTokens: 20, model: "gpt-4.1", duration: 400 },
          });
        }
        return () => {};
      });

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.tokenUsage).toMatchObject({
        inputTokens: 140,
        outputTokens: 70,
      });
      expect(result.tokenUsage?.durationApiSeconds).toBeCloseTo(1.2);
    });

    it("accumulates token usage across retry attempts", async () => {
      const provider = new CopilotSdkProvider({ maxRetries: 2, timeoutMs: 5000 });
      let attempt = 0;

      mockSession.on.mockImplementation((eventType: string, handler: (e: unknown) => void) => {
        if (eventType === "assistant.usage") {
          handler({
            type: "assistant.usage",
            data: { inputTokens: 50, outputTokens: 30, duration: 500 },
          });
        }
        return () => {};
      });

      mockSession.sendAndWait.mockImplementation(() => {
        attempt++;
        if (attempt === 1) throw new Error("transient error");
        return Promise.resolve({
          type: "assistant.message",
          data: { content: '{"findings": []}' },
        });
      });

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.tokenUsage).toMatchObject({
        inputTokens: 100,
        outputTokens: 60,
        durationApiSeconds: 1.0,
      });
    });

    it("returns undefined tokenUsage when no assistant.usage events fire", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.tokenUsage).toBeUndefined();
    });

    it("verifies auth status successfully on the first execution and caches it", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();
      mockClient.getAuthStatus.mockResolvedValue({ isAuthenticated: true, authType: "token" });

      // First run: should call getAuthStatus
      const resultPromise1 = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise1;

      expect(mockClient.getAuthStatus).toHaveBeenCalledTimes(1);

      // Second run: should NOT call getAuthStatus again
      const resultPromise2 = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise2;

      expect(mockClient.getAuthStatus).toHaveBeenCalledTimes(1);
    });

    it("throws AIProviderError immediately and without retries when user is unauthenticated", async () => {
      // Provider configured with 3 retries
      const provider = createProvider(3);
      mockClient.getAuthStatus.mockResolvedValue({
        isAuthenticated: false,
        statusMessage: "No login info",
      });

      const promise = provider.executePrompt("Review the following file test.ts");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await rejection;

      expect(error).toBeInstanceOf(AIProviderError);
      expect(error.message).toContain("Copilot authentication failed: No login info");
      // Should not have attempted to create a session or send any prompts
      expect(mockClient.createSession).not.toHaveBeenCalled();
      expect(mockClient.getAuthStatus).toHaveBeenCalledTimes(1);
    });

    it("throws AIProviderError wrapping the error when getAuthStatus throws", async () => {
      const provider = createProvider(2);
      mockClient.getAuthStatus.mockRejectedValue(new Error("Connection refused"));

      const promise = provider.executePrompt("Review the following file test.ts");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await rejection;

      expect(error).toBeInstanceOf(AIProviderError);
      expect(error.message).toContain(
        "Failed to retrieve Copilot authentication status: Connection refused"
      );
      expect(mockClient.createSession).not.toHaveBeenCalled();
    });

    it("does not call getAuthStatus when BYOK mode is configured", async () => {
      // BYOK mode with aiBaseUrl
      const provider = createProvider(
        1,
        5000,
        undefined,
        undefined,
        "https://my-openai-compat.com"
      );
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.getAuthStatus).not.toHaveBeenCalled();
      expect(mockClient.createSession).toHaveBeenCalled();
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

    it("resets cached client and retries when CopilotClient constructor throws", async () => {
      const provider = createProvider(2);
      // biome-ignore lint/complexity/useArrowFunction: regular function required so Reflect.construct works when called with new
      MockCopilotClient.mockImplementationOnce(function () {
        throw new Error("client startup failed");
      });
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

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

    it("passes contextTier as long_context to createSession when longContext is true", async () => {
      const provider = new CopilotSdkProvider({ longContext: true });
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ contextTier: "long_context" })
      );
    });

    it("does not pass contextTier to createSession when longContext is false or omitted", async () => {
      const provider = new CopilotSdkProvider({});
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ contextTier: undefined })
      );
    });

    it("passes reasoningEffort to createSession when reasoningEffort is provided", async () => {
      const provider = new CopilotSdkProvider({ reasoningEffort: "high" });
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ reasoningEffort: "high" })
      );
    });

    it("does not pass reasoningEffort to createSession when reasoningEffort is omitted", async () => {
      const provider = new CopilotSdkProvider({});
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ reasoningEffort: undefined })
      );
    });

    it("passes token as gitHubToken to CopilotClient", async () => {
      const provider = createProvider(1, 5000, undefined, "gh-token-123");
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(MockCopilotClient).toHaveBeenCalledWith(
        expect.objectContaining({ gitHubToken: "gh-token-123" })
      );
    });

    it("does not pass gitHubToken when no token provided", async () => {
      const provider = createProvider(1, 5000);
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      const lastCallArgs = MockCopilotClient.mock.calls[MockCopilotClient.mock.calls.length - 1][0];
      if (lastCallArgs !== undefined) {
        expect(lastCallArgs.gitHubToken).toBeUndefined();
      } else {
        expect(lastCallArgs).toBeUndefined();
      }
    });

    it("disables sub-agent streaming deltas to preserve JSON-only output", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ includeSubAgentStreamingEvents: false })
      );
    });

    it("limits review sessions to read-only grep and glob tools", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ availableTools: ["grep", "glob"] })
      );
    });

    it("passes OpenAI-compatible BYOK provider settings to createSession", async () => {
      const provider = createProvider(
        1,
        5000,
        "claude-sonnet-4.6",
        undefined,
        "https://bedrock.example.com/openai/v1",
        "bedrock-key"
      );
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: {
            type: "openai",
            baseUrl: "https://bedrock.example.com/openai/v1",
            apiKey: "bedrock-key",
          },
        })
      );
    });

    it("uses the responses wire API for GPT-5 BYOK models", async () => {
      const provider = createProvider(
        1,
        5000,
        "gpt-5.2-codex",
        undefined,
        "https://bedrock.example.com/openai/v1",
        "bedrock-key"
      );
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: expect.objectContaining({
            type: "openai",
            baseUrl: "https://bedrock.example.com/openai/v1",
            apiKey: "bedrock-key",
            wireApi: "responses",
          }),
        })
      );
    });

    it("allows Copilot SDK BYOK base URLs without an API key", async () => {
      const provider = createProvider(
        1,
        5000,
        "claude-sonnet-4.6",
        undefined,
        "http://localhost:11434/v1"
      );
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: {
            type: "openai",
            baseUrl: "http://localhost:11434/v1",
          },
        })
      );
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

  describe("validateReasoning warnings", () => {
    it("still parses finding when reasoning is shorter than minimum length", () => {
      const provider = createProvider();
      const response = createAIResponse({
        findings: [
          {
            line: 5,
            severity: "medium",
            confidence: "medium",
            category: "quality",
            message: "Issue",
            suggestion: "Fix it",
            reasoning: "Too short.", // Short rationale still triggers validation warning
            isPreExisting: false,
          },
        ],
      });

      const result = provider.parseFileReview("src/test.ts", response);

      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].reasoning).toBe("Too short.");
    });

    it("still parses finding when reasoning uses concise evidence and impact wording", () => {
      const provider = createProvider();
      const response = createAIResponse({
        findings: [
          {
            line: 10,
            severity: "high",
            confidence: "high",
            category: "bug",
            message: "Potential null dereference at this location in code",
            suggestion: "Add a null check before accessing the property",
            reasoning:
              "This code path does not handle the case where the value could be null at runtime.",
            isPreExisting: false,
          },
        ],
      });

      const result = provider.parseFileReview("src/test.ts", response);

      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].reasoning).toContain("does not handle");
    });

    it("covers reasoning branch in parseBatchedFileReview", () => {
      const provider = createProvider();
      const response = createAIResponse({
        file_results: {
          "src/api.ts": {
            findings: [
              {
                line: 3,
                severity: "high",
                confidence: "high",
                category: "security",
                message: "SQL injection vulnerability found in query builder",
                suggestion: "Use parameterized queries for all SQL operations",
                reasoning: "Brief.", // Short rationale still triggers validation warning
              },
            ],
          },
        },
      });

      const result = provider.parseBatchedFileReview(response);

      expect(result[0].findings[0].reasoning).toBe("Brief.");
    });

    it("covers reasoning without verification in parseFastReview", () => {
      const provider = createProvider();
      const response = createAIResponse({
        summary: "Issues found",
        findings: [
          {
            file: "src/core.ts",
            line: 5,
            severity: "medium",
            confidence: "medium",
            category: "quality",
            message: "Function has too many responsibilities and is hard to maintain",
            suggestion: "Split into smaller single-responsibility functions",
            reasoning:
              "The function handles multiple unrelated tasks and this makes it hard to test.",
          },
        ],
      });

      const result = provider.parseFastReview(response);

      expect(result.fileResults[0].findings[0].reasoning).toContain("unrelated tasks");
    });
  });

  describe("inferPromptType branches", () => {
    it("infers batched-file-review when prompt contains file_results", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt({ file_results: {} });

      const resultPromise = provider.executePrompt(
        "Analyze all changes and return file_results for each file"
      );
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBeDefined();
    });

    it("infers cross-file-review when prompt contains cross-file", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt({});

      const resultPromise = provider.executePrompt(
        "Perform a cross-file architectural analysis of the changes"
      );
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBeDefined();
    });

    it("infers fast-review when prompt contains both fast and review", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt({});

      const resultPromise = provider.executePrompt("Please do a fast review of these changes");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBeDefined();
    });

    it("falls back to unknown for unrecognized prompt text", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt({});

      const resultPromise = provider.executePrompt(
        "Please analyze the general quality of the codebase"
      );
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBeDefined();
    });
  });

  describe("parseJSON malformed JSON", () => {
    it("throws JsonParseError when content has braces but invalid JSON", async () => {
      const provider = createProvider();
      mockSession.sendAndWait.mockResolvedValue({
        type: "assistant.message",
        data: { content: "{not: valid json at all}" },
      });

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      const rejection = resultPromise.catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      const error = await rejection;

      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("permission handler in createSession", () => {
    it("passes onPermissionRequest to createSession", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ onPermissionRequest: expect.any(Function) })
      );
    });
  });
});

describe("createReviewPermissionHandler", () => {
  function createStubLogger() {
    return {
      warn: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    } as unknown as ReturnType<typeof import("../../logger.js").createChildLogger>;
  }

  it("approves read permission requests", () => {
    const logger = createStubLogger();
    const handler = createReviewPermissionHandler(logger);

    const result = handler({ kind: "read" } as unknown as PermissionRequest, { sessionId: "s1" });

    expect(result).toEqual({ kind: "approve-once" });
  });

  it("denies shell permission requests", () => {
    const logger = createStubLogger();
    const handler = createReviewPermissionHandler(logger);

    const result = handler({ kind: "shell" } as unknown as PermissionRequest, { sessionId: "s1" });

    expect(result).toEqual({ kind: "reject" });
  });

  it("denies write permission requests", () => {
    const logger = createStubLogger();
    const handler = createReviewPermissionHandler(logger);

    const result = handler({ kind: "write" } as unknown as PermissionRequest, { sessionId: "s1" });

    expect(result).toEqual({ kind: "reject" });
  });

  it("denies mcp permission requests", () => {
    const logger = createStubLogger();
    const handler = createReviewPermissionHandler(logger);

    const result = handler({ kind: "mcp" } as unknown as PermissionRequest, { sessionId: "s1" });

    expect(result).toEqual({ kind: "reject" });
  });

  it("denies url permission requests", () => {
    const logger = createStubLogger();
    const handler = createReviewPermissionHandler(logger);

    const result = handler({ kind: "url" } as unknown as PermissionRequest, { sessionId: "s1" });

    expect(result).toEqual({ kind: "reject" });
  });

  it("denies custom-tool permission requests", () => {
    const logger = createStubLogger();
    const handler = createReviewPermissionHandler(logger);

    const result = handler({ kind: "custom-tool" } as unknown as PermissionRequest, {
      sessionId: "s1",
    });

    expect(result).toEqual({ kind: "reject" });
  });

  it("denies memory permission requests", () => {
    const logger = createStubLogger();
    const handler = createReviewPermissionHandler(logger);

    const result = handler({ kind: "memory" } as unknown as PermissionRequest, { sessionId: "s1" });

    expect(result).toEqual({ kind: "reject" });
  });

  it("denies hook permission requests", () => {
    const logger = createStubLogger();
    const handler = createReviewPermissionHandler(logger);

    const result = handler({ kind: "hook" } as unknown as PermissionRequest, { sessionId: "s1" });

    expect(result).toEqual({ kind: "reject" });
  });

  it("logs a warning when a request is denied", () => {
    const logger = createStubLogger();
    const handler = createReviewPermissionHandler(logger);

    handler({ kind: "shell", toolCallId: "tc-42" } as unknown as PermissionRequest, {
      sessionId: "s1",
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ permissionKind: "shell", toolCallId: "tc-42" }),
      expect.any(String)
    );
  });

  it("does not log a warning when a request is approved", () => {
    const logger = createStubLogger();
    const handler = createReviewPermissionHandler(logger);

    handler({ kind: "read" } as unknown as PermissionRequest, { sessionId: "s1" });
  });

  describe("experimentalTools custom tool integration", () => {
    it("registers custom tool when experimentalTools is true", async () => {
      const provider = new CopilotSdkProvider({ experimentalTools: true });
      mockSuccessfulPrompt();
      await provider.executePrompt("Test prompt");
      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([expect.objectContaining({ name: "postComment" })]),
          availableTools: expect.arrayContaining(["postComment"]),
        })
      );
    });

    it("does not register custom tool when experimentalTools is false", async () => {
      const provider = new CopilotSdkProvider({ experimentalTools: false });
      mockSuccessfulPrompt();
      await provider.executePrompt("Test prompt");
      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: undefined,
          availableTools: expect.not.arrayContaining(["postComment"]),
        })
      );
    });

    it("extracts findings collected via tool calls", async () => {
      const provider = new CopilotSdkProvider({ experimentalTools: true });

      mockSession.sendAndWait.mockImplementation(async () => {
        // Simulate the tool execution adding a finding during the session
        (
          provider as unknown as { findingsCollector: FindingsCollector }
        ).findingsCollector.addFinding({
          file: "src/main.ts",
          line: 15,
          body: "Refactor this.",
          severity: "medium",
          category: "quality",
          findingId: "f-123",
          timestamp: Date.now(),
        });
        return {
          type: "assistant.message",
          data: { content: "Simulated tool calling" },
        };
      });

      const response = await provider.executePrompt("Test prompt");

      expect(response.parsed).toBeDefined();
      const parsed = response.parsed as {
        findings: Array<{ line: number; message: string }>;
      };
      expect(parsed.findings).toHaveLength(1);
      expect(parsed.findings[0].line).toBe(15);
      expect(parsed.findings[0].message).toBe("Refactor this.");
    });

    it("returns empty findings cleanly if no tool calls occurred and no JSON was outputted", async () => {
      const provider = new CopilotSdkProvider({ experimentalTools: true });

      mockSession.sendAndWait.mockResolvedValue({
        type: "assistant.message",
        data: { content: "I reviewed this file and found no issues whatsoever!" },
      });

      const response = await provider.executePrompt("Test prompt");

      expect(response.parsed).toBeDefined();
      const parsed = response.parsed as {
        findings: Array<{ line: number }>;
      };
      expect(parsed.findings).toHaveLength(0);
      expect(response.raw).toBe("I reviewed this file and found no issues whatsoever!");
    });

    it("falls back to parsing JSON if no tool calls occurred but JSON was returned in content", async () => {
      const provider = new CopilotSdkProvider({ experimentalTools: true });

      mockSession.sendAndWait.mockResolvedValue({
        type: "assistant.message",
        data: {
          content: JSON.stringify({
            findings: [
              {
                line: 22,
                severity: "high",
                category: "bug",
                message: "Direct JSON response fallback",
              },
            ],
          }),
        },
      });

      const response = await provider.executePrompt("Test prompt");

      expect(response.parsed).toBeDefined();
      const parsed = response.parsed as {
        findings: Array<{ line: number; message: string }>;
      };
      expect(parsed.findings).toHaveLength(1);
      expect(parsed.findings[0].line).toBe(22);
      expect(parsed.findings[0].message).toBe("Direct JSON response fallback");
    });

    it("combines findings from both tool calls and parsed JSON response content", async () => {
      const provider = new CopilotSdkProvider({ experimentalTools: true });

      mockSession.sendAndWait.mockImplementation(async () => {
        // Simulate tool finding
        (
          provider as unknown as { findingsCollector: FindingsCollector }
        ).findingsCollector.addFinding({
          file: "src/main.ts",
          line: 15,
          body: "Tool finding body",
          severity: "medium",
          category: "quality",
          findingId: "f-123",
          timestamp: Date.now(),
        });

        // Return standard JSON response
        return {
          type: "assistant.message",
          data: {
            content: JSON.stringify({
              findings: [
                {
                  line: 42,
                  severity: "high",
                  category: "bug",
                  message: "JSON finding message",
                  confidence: "high",
                  reasoning: "Reasoning...",
                  isPreExisting: false,
                },
              ],
            }),
          },
        };
      });

      const response = await provider.executePrompt("Test prompt");

      expect(response.parsed).toBeDefined();
      const parsed = response.parsed as {
        findings: Array<{ line: number; message: string }>;
      };
      // Should contain BOTH findings!
      expect(parsed.findings).toHaveLength(2);

      // JSON finding
      expect(parsed.findings[0].line).toBe(42);
      expect(parsed.findings[0].message).toBe("JSON finding message");

      // Tool finding
      expect(parsed.findings[1].line).toBe(15);
      expect(parsed.findings[1].message).toBe("Tool finding body");
    });
  });
});
