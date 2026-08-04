import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted ensures these are available when vi.mock() factory runs (which is hoisted)
const { mockClient, mockServer, mockCreateOpencode } = vi.hoisted(() => {
  const mockClient = {
    event: {
      subscribe: vi.fn(),
    },
    session: {
      create: vi.fn(),
      prompt: vi.fn(),
      delete: vi.fn(),
    },
  };
  const mockServer = {
    close: vi.fn(),
  };
  const mockCreateOpencode = vi.fn().mockResolvedValue({
    client: mockClient,
    server: mockServer,
  });
  return { mockClient, mockServer, mockCreateOpencode };
});

vi.mock("@opencode-ai/sdk", () => ({
  createOpencode: mockCreateOpencode,
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

import { AIProviderError, ValidationError } from "../../errors/index.js";
import type { AIResponse } from "../types.js";
import { OpenCodeSdkProvider } from "./opencode-sdk.js";

function createAIResponse(parsed: unknown): AIResponse {
  return { raw: JSON.stringify(parsed), parsed };
}

/** Standard mock for a successful structured-output prompt response. */
function mockSuccessfulPrompt(output: unknown = { findings: [] }): void {
  mockClient.session.prompt.mockResolvedValue({
    data: {
      info: { structured_output: output },
      parts: [],
    },
  });
}

describe("OpenCodeSdkProvider", () => {
  function createProvider(maxRetries = 1, timeoutMs = 5000, model?: string): OpenCodeSdkProvider {
    return new OpenCodeSdkProvider({ maxRetries, timeoutMs, model });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockClient.session.create.mockResolvedValue({ data: { id: "session-123" } });
    mockClient.session.delete.mockResolvedValue(undefined);
    mockClient.event.subscribe.mockResolvedValue({
      stream: (async function* () {})(),
    });
    mockServer.close.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("should use default values when no options provided", () => {
      const provider = new OpenCodeSdkProvider();
      expect(provider).toBeDefined();
    });

    it("should accept custom maxRetries and timeoutMs", () => {
      const provider = new OpenCodeSdkProvider({ maxRetries: 5, timeoutMs: 30000 });
      expect(provider).toBeDefined();
    });

    it("should reject BYOK options instead of silently ignoring them", () => {
      expect(() => new OpenCodeSdkProvider({ aiBaseUrl: "https://ai.example.test/v1" })).toThrow(
        'BYOK options ("aiBaseUrl" and "aiApiKey") are not supported by "opencode-sdk"'
      );
      expect(() => new OpenCodeSdkProvider({ aiApiKey: "secret" })).toThrow(ValidationError);
    });
  });

  describe("executePrompt", () => {
    it("should throw ValidationError when prompt is empty", async () => {
      const provider = createProvider();
      await expect(provider.executePrompt("")).rejects.toThrow(ValidationError);
      await expect(provider.executePrompt("")).rejects.toThrow("Prompt cannot be empty");
    });

    it("should throw ValidationError when prompt is whitespace only", async () => {
      const provider = createProvider();
      await expect(provider.executePrompt("   ")).rejects.toThrow("Prompt cannot be empty");
    });

    it("should return structured output when available", async () => {
      const provider = createProvider();
      const structuredOutput = {
        findings: [{ line: 10, severity: "high", category: "bug", message: "Issue" }],
      };
      mockSuccessfulPrompt(structuredOutput);

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.parsed).toEqual(structuredOutput);
    });

    it("should pass workingDirectory to session.create and session.prompt", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts", {
        workingDirectory: "/tmp/my-repo",
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.session.create).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { directory: "/tmp/my-repo" },
        })
      );
      expect(mockClient.session.prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { directory: "/tmp/my-repo" },
        })
      );
    });

    it("should send diff files as OpenCode file parts", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the changes", {
        diffFiles: ["/tmp/first.diff", "/tmp/second.diff"],
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.session.prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            parts: [
              { type: "text", text: "Review the changes" },
              expect.objectContaining({
                type: "file",
                filename: "first.diff",
                mime: "text/plain",
                url: "file:///tmp/first.diff",
              }),
              expect.objectContaining({
                type: "file",
                filename: "second.diff",
              }),
            ],
          }),
        })
      );
    });

    it("should forward streamed text deltas to onStreamData", async () => {
      const provider = createProvider();
      const onStreamData = vi.fn();
      mockSuccessfulPrompt();
      mockClient.event.subscribe.mockResolvedValue({
        stream: (async function* () {
          yield {
            type: "message.part.updated",
            properties: {
              part: { sessionID: "session-123", type: "text" },
              delta: "partial output",
            },
          };
          yield {
            type: "message.part.updated",
            properties: {
              part: { sessionID: "session-123", type: "reasoning" },
              delta: "internal reasoning",
            },
          };
        })(),
      });

      const resultPromise = provider.executePrompt("Review the changes", { onStreamData });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(onStreamData).toHaveBeenCalledWith("partial output");
      expect(onStreamData).not.toHaveBeenCalledWith("internal reasoning");
    });

    it("should return OpenCode token usage", async () => {
      const provider = createProvider();
      mockClient.session.prompt.mockResolvedValue({
        data: {
          info: {
            structured_output: { findings: [] },
            providerID: "openai",
            modelID: "gpt-5",
            tokens: {
              input: 100,
              output: 50,
              reasoning: 10,
              cache: { read: 20, write: 5 },
            },
            time: { created: 1000, completed: 2500 },
          },
          parts: [],
        },
      });

      const resultPromise = provider.executePrompt("Review the changes");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.tokenUsage).toEqual({
        inputTokens: 100,
        outputTokens: 60,
        cachedTokens: 25,
        model: "openai/gpt-5",
        durationWallSeconds: 1.5,
      });
    });

    it("should accumulate token usage across retry attempts", async () => {
      const provider = new OpenCodeSdkProvider({ maxRetries: 2, timeoutMs: 5000 });
      let attempt = 0;
      mockClient.session.prompt.mockImplementation(() => {
        attempt++;
        if (attempt === 1) {
          return Promise.resolve({
            data: {
              info: {
                tokens: { input: 10, output: 5 },
              },
              parts: [{ type: "text", text: "not json" }],
            },
          });
        }
        return Promise.resolve({
          data: {
            info: {
              structured_output: { findings: [] },
              tokens: { input: 20, output: 15 },
            },
            parts: [],
          },
        });
      });

      const resultPromise = provider.executePrompt("Review the changes");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.tokenUsage).toMatchObject({ inputTokens: 30, outputTokens: 20 });
    });

    it("should not pass directory query when workingDirectory is not provided", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.session.create).toHaveBeenCalledWith(
        expect.objectContaining({
          query: undefined,
        })
      );
      expect(mockClient.session.prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          query: undefined,
        })
      );
    });

    it("should fall back to text parsing when no structured output", async () => {
      const provider = createProvider();

      mockClient.session.prompt.mockResolvedValue({
        data: {
          info: {},
          parts: [{ type: "text", text: '{"findings": []}' }],
        },
      });

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.parsed).toEqual({ findings: [] });
    });

    it("should handle text with markdown code blocks", async () => {
      const provider = createProvider();

      mockClient.session.prompt.mockResolvedValue({
        data: {
          info: {},
          parts: [{ type: "text", text: '```json\n{"findings": []}\n```' }],
        },
      });

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.parsed).toEqual({ findings: [] });
    });

    it("should throw error when StructuredOutputError is returned", async () => {
      const provider = createProvider();

      mockClient.session.prompt.mockResolvedValue({
        data: {
          info: {
            error: { name: "StructuredOutputError", message: "Schema validation failed" },
          },
          parts: [],
        },
      });

      const promise = provider.executePrompt("Review the following file test.ts");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await rejection;

      expect(error.message).toContain("Structured output failed");
    });

    it("should throw error when response has no content", async () => {
      const provider = createProvider();

      mockClient.session.prompt.mockResolvedValue({
        data: {
          info: {},
          parts: [],
        },
      });

      const promise = provider.executePrompt("Review the following file test.ts");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await rejection;

      expect(error.message).toContain("No content in response");
    });

    it("should retry on failure", async () => {
      const provider = new OpenCodeSdkProvider({ maxRetries: 3, timeoutMs: 5000 });
      let attempt = 0;

      mockClient.session.prompt.mockImplementation(() => {
        attempt++;
        if (attempt === 3) {
          return Promise.resolve({
            data: {
              info: { structured_output: { findings: [] } },
              parts: [],
            },
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

    it("should throw after max retries exceeded", async () => {
      const provider = new OpenCodeSdkProvider({ maxRetries: 2, timeoutMs: 5000 });
      mockClient.session.prompt.mockRejectedValue(new Error("SDK error"));

      const promise = provider.executePrompt("Review the following file test.ts");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await rejection;

      expect(error.message).toContain("Failed after 2 attempts");
    });

    it("should throw when session creation returns no ID", async () => {
      const provider = createProvider();
      mockClient.session.create.mockResolvedValue({});

      const promise = provider.executePrompt("Review the following file test.ts");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await rejection;

      expect(error.message).toContain("no session ID");
    });

    it("should handle fields-style response (no data wrapper)", async () => {
      const provider = createProvider();

      mockClient.session.prompt.mockResolvedValue({
        info: { structured_output: { findings: [] } },
        parts: [],
      });

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.parsed).toEqual({ findings: [] });
    });

    it("should throw JsonParseError when text fallback contains no valid JSON", async () => {
      const provider = createProvider();

      mockClient.session.prompt.mockResolvedValue({
        data: {
          info: {},
          parts: [{ type: "text", text: "This is plain text with no JSON at all." }],
        },
      });

      const promise = provider.executePrompt("Review the following file test.ts");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await rejection;

      expect(error.message).toContain("No JSON object found");
    });

    it("should throw when text fallback contains malformed JSON", async () => {
      const provider = createProvider();

      mockClient.session.prompt.mockResolvedValue({
        data: {
          info: {},
          parts: [{ type: "text", text: '{ "findings": [broken }' }],
        },
      });

      const promise = provider.executePrompt("Review the following file test.ts");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await rejection;

      expect(error).toBeInstanceOf(AIProviderError);
      expect((error as AIProviderError).provider).toBe("opencode-sdk");
      expect(error.message).toContain("Failed after 1 attempts");
    });
  });

  describe("session cleanup", () => {
    it("should delete session after successful prompt", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.session.delete).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: "session-123" } })
      );
    });

    it("should delete session even when prompt fails", async () => {
      const provider = createProvider();
      mockClient.session.prompt.mockRejectedValue(new Error("SDK error"));

      const promise = provider.executePrompt("Review the following file test.ts");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockClient.session.delete).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: "session-123" } })
      );
    });

    it("should not fail if session.delete throws", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();
      mockClient.session.delete.mockRejectedValue(new Error("delete failed"));

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.parsed).toEqual({ findings: [] });
    });
  });

  describe("server reuse", () => {
    it("should reuse SDK server across multiple executePrompt calls", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const p1 = provider.executePrompt("Review the following file a.ts");
      await vi.runAllTimersAsync();
      await p1;

      const p2 = provider.executePrompt("Review the following file b.ts");
      await vi.runAllTimersAsync();
      await p2;

      expect(mockCreateOpencode).toHaveBeenCalledTimes(1);
    });

    it("should recreate server after destroy()", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const p1 = provider.executePrompt("Review the following file a.ts");
      await vi.runAllTimersAsync();
      await p1;

      provider.destroy();
      expect(mockServer.close).toHaveBeenCalledTimes(1);

      const p2 = provider.executePrompt("Review the following file b.ts");
      await vi.runAllTimersAsync();
      await p2;

      expect(mockCreateOpencode).toHaveBeenCalledTimes(2);
    });

    it("should reset cache and propagate error when server startup fails", async () => {
      const provider = createProvider();
      mockCreateOpencode.mockRejectedValueOnce(new Error("Server startup failed"));

      const promise = provider.executePrompt("Review the following file test.ts");
      const rejection = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await rejection;

      expect(error.message).toContain("Failed after 1 attempts");

      // Second call should attempt to create server again (cache was reset)
      mockCreateOpencode.mockResolvedValueOnce({ client: mockClient, server: mockServer });
      mockSuccessfulPrompt();

      const p2 = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await p2;

      expect(mockCreateOpencode).toHaveBeenCalledTimes(2);
    });
  });

  describe("model config passthrough", () => {
    it("should pass model to createOpencode config", async () => {
      const provider = createProvider(1, 5000, "claude-sonnet-4");
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockCreateOpencode).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ model: "claude-sonnet-4" }),
        })
      );
    });

    it("should not set model in config when not provided", async () => {
      const provider = createProvider(1, 5000);
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockCreateOpencode).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.not.objectContaining({ model: expect.anything() }),
        })
      );
    });

    it("should configure reasoning effort for qualified OpenCode models", async () => {
      const provider = new OpenCodeSdkProvider({
        maxRetries: 1,
        timeoutMs: 5000,
        model: "openai/gpt-5",
        reasoningEffort: "high",
      });
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockCreateOpencode).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            provider: {
              openai: { options: { reasoningEffort: "high" } },
            },
          }),
        })
      );
    });
  });

  describe("permission config", () => {
    it("passes permission restrictions to createOpencode config", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockCreateOpencode).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            permission: {
              edit: "deny",
              bash: "deny",
              webfetch: "deny",
              doom_loop: "deny",
              external_directory: "deny",
            },
          }),
        })
      );
    });

    it("includes permission restrictions alongside model when both are set", async () => {
      const provider = createProvider(1, 5000, "gpt-4.1");
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockCreateOpencode).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            model: "gpt-4.1",
            permission: expect.objectContaining({ bash: "deny", edit: "deny" }),
          }),
        })
      );
    });

    it("allows edit but keeps bash denied when only write tools are enabled", async () => {
      const provider = new OpenCodeSdkProvider({
        maxRetries: 1,
        timeoutMs: 5000,
        enableWriteTools: true,
      });
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockCreateOpencode).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            permission: expect.objectContaining({ edit: "allow", bash: "deny" }),
          }),
        })
      );
    });

    it("allows bash only when shell tools are explicitly enabled", async () => {
      const provider = new OpenCodeSdkProvider({
        maxRetries: 1,
        timeoutMs: 5000,
        enableWriteTools: true,
        enableShellTools: true,
      });
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockCreateOpencode).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            permission: expect.objectContaining({ edit: "allow", bash: "allow" }),
          }),
        })
      );
    });
  });

  describe("explicit promptType hint", () => {
    it("should use promptType from options for schema selection", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt({ file_results: {} });

      const resultPromise = provider.executePrompt("Please analyze this code", {
        promptType: "batched-file-review",
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.session.prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            format: expect.objectContaining({ type: "json_schema" }),
          }),
        })
      );
    });

    it("should fall back to inferPromptType when promptType not provided", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockClient.session.prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            format: expect.objectContaining({ type: "json_schema" }),
          }),
        })
      );
    });

    it("should not send schema for unknown prompt type", async () => {
      const provider = createProvider();

      mockClient.session.prompt.mockResolvedValue({
        data: {
          info: {},
          parts: [{ type: "text", text: '{"result": "ok"}' }],
        },
      });

      const resultPromise = provider.executePrompt("Do something random");
      await vi.runAllTimersAsync();
      await resultPromise;

      const promptCallBody = mockClient.session.prompt.mock.calls[0][0].body;
      expect(promptCallBody.format).toBeUndefined();
    });
  });

  describe("timeout", () => {
    it("should use fixed server startup timeout, not user timeoutMs", async () => {
      const provider = createProvider(1, 120_000);
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockCreateOpencode).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 30_000,
        })
      );
    });

    it("should throw OpenCodeSdkError when prompt exceeds timeoutMs", async () => {
      const provider = createProvider(1, 1000);
      mockClient.session.prompt.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      const promise = provider.executePrompt("Review the following file test.ts");
      const rejection = promise.catch((e) => e);
      await vi.advanceTimersByTimeAsync(1500);
      const error = await rejection;

      expect(error).toBeInstanceOf(AIProviderError);
      expect((error as AIProviderError).provider).toBe("opencode-sdk");
      expect(error.message).toContain("timed out after 1000ms");
    });
  });

  describe("destroy", () => {
    it("should close server on destroy", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      provider.destroy();

      expect(mockServer.close).toHaveBeenCalled();
    });

    it("should be safe to call destroy multiple times", async () => {
      const provider = createProvider();
      mockSuccessfulPrompt();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      provider.destroy();
      provider.destroy();
      expect(mockServer.close).toHaveBeenCalledTimes(1);
    });

    it("should be safe to call destroy before any executePrompt", () => {
      const provider = createProvider();
      provider.destroy();
      expect(mockServer.close).not.toHaveBeenCalled();
    });
  });

  describe("parseFileReview", () => {
    it("should parse valid file review response", () => {
      const provider = createProvider();
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
      const provider = createProvider();
      const response = createAIResponse({ findings: [] });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.filename).toBe("test.ts");
      expect(result.findings).toHaveLength(0);
    });

    it("should handle missing findings array", () => {
      const provider = createProvider();
      const response = createAIResponse({});

      const result = provider.parseFileReview("test.ts", response);

      expect(result.filename).toBe("test.ts");
      expect(result.findings).toHaveLength(0);
    });

    it("should use default severity for invalid values", () => {
      const provider = createProvider();
      const response = createAIResponse({
        findings: [
          { line: 1, severity: "invalid", category: "bug", message: "test", suggestion: "fix" },
        ],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings[0].severity).toBe("medium");
    });

    it("should use default category for invalid values", () => {
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
    it("should parse valid cross-file review response", () => {
      const provider = createProvider();
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
      const provider = createProvider();
      const response = createAIResponse({});

      const result = provider.parseCrossFileReview(response);

      expect(result.overallAssessment).toBe("Review completed");
      expect(result.findings).toHaveLength(0);
      expect(result.recommendations).toHaveLength(0);
    });

    it("should handle all valid cross-file categories", () => {
      const provider = createProvider();
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

  describe("parseBatchedFileReview", () => {
    it("should parse valid batched response", () => {
      const provider = createProvider();
      const response = createAIResponse({
        file_results: {
          "src/a.ts": {
            findings: [{ line: 5, severity: "high", category: "bug", message: "Issue A" }],
          },
          "src/b.ts": {
            findings: [{ line: 10, severity: "low", category: "quality", message: "Issue B" }],
          },
        },
      });

      const results = provider.parseBatchedFileReview(response);

      expect(results).toHaveLength(2);
      expect(results[0].filename).toBe("src/a.ts");
      expect(results[0].findings[0].severity).toBe("high");
      expect(results[1].filename).toBe("src/b.ts");
      expect(results[1].findings[0].severity).toBe("low");
    });

    it("should handle empty file_results", () => {
      const provider = createProvider();
      const response = createAIResponse({});

      const results = provider.parseBatchedFileReview(response);

      expect(results).toHaveLength(0);
    });
  });

  describe("parseFastReview", () => {
    it("should split findings into file and cross-file results", () => {
      const provider = createProvider();
      const response = createAIResponse({
        summary: "Some issues found",
        findings: [
          { file: "src/a.ts", line: 5, severity: "high", category: "bug", message: "File finding" },
          { severity: "medium", category: "architecture", message: "Cross-file finding" },
        ],
      });

      const result = provider.parseFastReview(response);

      expect(result.fileResults).toHaveLength(1);
      expect(result.fileResults[0].filename).toBe("src/a.ts");
      expect(result.crossFileResult.findings).toHaveLength(1);
      expect(result.crossFileResult.overallAssessment).toBe("Some issues found");
    });

    it("should handle empty findings", () => {
      const provider = createProvider();
      const response = createAIResponse({ summary: "Clean", findings: [] });

      const result = provider.parseFastReview(response);

      expect(result.fileResults).toHaveLength(0);
      expect(result.crossFileResult.findings).toHaveLength(0);
    });
  });

  describe("validateReasoning warnings", () => {
    it("should still parse finding when reasoning is shorter than minimum length", () => {
      const provider = createProvider();
      const response = createAIResponse({
        findings: [
          {
            line: 2,
            severity: "medium",
            confidence: "medium",
            category: "quality",
            message: "Missing validation",
            suggestion: "Add input validation",
            reasoning: "Too short.", // Short rationale still triggers validation warning
            isPreExisting: false,
          },
        ],
      });

      const result = provider.parseFileReview("src/handler.ts", response);

      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].reasoning).toBe("Too short.");
    });

    it("should still parse finding when reasoning uses concise evidence and impact wording", () => {
      const provider = createProvider();
      const response = createAIResponse({
        findings: [
          {
            line: 15,
            severity: "high",
            confidence: "high",
            category: "security",
            message: "User input is used in SQL query without sanitization",
            suggestion: "Use parameterized queries to prevent SQL injection attacks here",
            reasoning:
              "The input from the request is concatenated directly into the SQL string expression.",
            isPreExisting: false,
          },
        ],
      });

      const result = provider.parseFileReview("src/db.ts", response);

      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].reasoning).toContain("concatenated directly");
    });

    it("should cover reasoning branch in parseBatchedFileReview", () => {
      const provider = createProvider();
      const response = createAIResponse({
        file_results: {
          "src/api.ts": {
            findings: [
              {
                line: 5,
                severity: "high",
                confidence: "high",
                category: "bug",
                message: "Missing error handler",
                suggestion: "Add error handler",
                reasoning: "Short.", // Short rationale still triggers validation warning
              },
            ],
          },
        },
      });

      const result = provider.parseBatchedFileReview(response);

      expect(result[0].findings[0].reasoning).toBe("Short.");
    });

    it("should cover reasoning without verification in parseFastReview", () => {
      const provider = createProvider();
      const response = createAIResponse({
        summary: "Review done",
        findings: [
          {
            file: "src/utils.ts",
            line: 20,
            severity: "medium",
            confidence: "medium",
            category: "quality",
            message: "Function is too large and has too many responsibilities here",
            suggestion: "Split into smaller focused functions to improve readability",
            reasoning:
              "The function body is very long and handles multiple unrelated things at once.",
          },
        ],
      });

      const result = provider.parseFastReview(response);

      expect(result.fileResults[0].findings[0].reasoning).toContain("unrelated things");
    });
  });

  describe("experimentalTools tool calling", () => {
    it("registers postComment tool in opencodeConfig when experimentalTools is true", async () => {
      const provider = new OpenCodeSdkProvider({
        maxRetries: 1,
        timeoutMs: 5000,
        experimentalTools: true,
      });
      mockSuccessfulPrompt({ findings: [] });

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockCreateOpencode).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            tools: expect.objectContaining({
              postComment: expect.objectContaining({
                name: "postComment",
              }),
            }),
          }),
        })
      );
    });

    it("captures tool findings during execution and combines with structured response", async () => {
      const provider = new OpenCodeSdkProvider({
        maxRetries: 1,
        timeoutMs: 5000,
        experimentalTools: true,
      });

      mockClient.session.prompt.mockImplementation(async () => {
        const createCall = mockCreateOpencode.mock.calls[0][0];
        const registeredTool = createCall.config.tools.postComment;
        await registeredTool.handler({
          file: "src/index.ts",
          line: 42,
          body: "Buffer overflow risk",
          severity: "high",
          category: "security",
        });

        return {
          data: {
            info: {
              structured_output: {
                findings: [
                  {
                    file: "src/other.ts",
                    line: 1,
                    severity: "low",
                    category: "quality",
                    message: "Unused var",
                  },
                ],
              },
            },
            parts: [],
          },
        };
      });

      const resultPromise = provider.executePrompt("Review code");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      const parsed = result.parsed as { findings: Array<Record<string, unknown>> };
      expect(parsed.findings).toHaveLength(2);
      expect(parsed.findings[1]).toMatchObject({
        file: "src/index.ts",
        line: 42,
        severity: "high",
        category: "security",
        message: "Buffer overflow risk",
      });
    });

    it("converts tool findings on JSON parse failure when tool calls occurred", async () => {
      const provider = new OpenCodeSdkProvider({
        maxRetries: 1,
        timeoutMs: 5000,
        experimentalTools: true,
      });

      mockClient.session.prompt.mockImplementation(async () => {
        const createCall = mockCreateOpencode.mock.calls[0][0];
        const registeredTool = createCall.config.tools.postComment;
        await registeredTool.handler({
          file: "src/app.ts",
          line: 10,
          body: "Unhandled exception",
          severity: "critical",
          category: "bug",
        });

        return {
          data: {
            info: {},
            parts: [{ type: "text", text: "Invalid non-json output" }],
          },
        };
      });

      const resultPromise = provider.executePrompt("Review code");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      const parsed = result.parsed as { summary: string; findings: Array<Record<string, unknown>> };
      expect(parsed.summary).toContain("Collected 1 findings via tool calls");
      expect(parsed.findings).toHaveLength(1);
      expect(parsed.findings[0]).toMatchObject({
        line: 10,
        severity: "critical",
        category: "bug",
        message: "Unhandled exception",
      });
    });
  });
});
