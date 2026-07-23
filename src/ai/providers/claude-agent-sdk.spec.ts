import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted ensures these are available when vi.mock() factory runs
const { mockQueryStream } = vi.hoisted(() => {
  const mockQueryStream = vi.fn();
  return { mockQueryStream };
});

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: mockQueryStream,
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
import { ClaudeAgentSdkProvider } from "./claude-agent-sdk.js";

async function* createMockStream(events: unknown[]) {
  for (const event of events) {
    yield event;
  }
}

describe("ClaudeAgentSdkProvider", () => {
  function createProvider(
    maxRetries = 1,
    timeoutMs = 5000,
    model?: string
  ): ClaudeAgentSdkProvider {
    return new ClaudeAgentSdkProvider({ maxRetries, timeoutMs, model });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("should use default values when no options provided", () => {
      const provider = new ClaudeAgentSdkProvider();
      expect(provider).toBeDefined();
    });

    it("should accept custom options", () => {
      const provider = new ClaudeAgentSdkProvider({
        maxRetries: 5,
        timeoutMs: 30000,
        model: "claude-3-5-sonnet",
        aiApiKey: "test-api-key",
      });
      expect(provider).toBeDefined();
    });
  });

  describe("tool permissions", () => {
    function mockSuccessStream(): void {
      mockQueryStream.mockReturnValue(
        createMockStream([
          { session_id: "session-123", type: "system" },
          {
            type: "result",
            subtype: "success",
            session_id: "session-123",
            result: JSON.stringify({ findings: [] }),
            structured_output: { findings: [] },
          },
        ])
      );
    }

    function lastCallTools(): string[] {
      const call = mockQueryStream.mock.calls[0][0] as { options: { tools: string[] } };
      return call.options.tools;
    }

    function lastCallOptions(): {
      tools: string[];
      allowedTools: string[];
      canUseTool: (
        toolName: string,
        input: Record<string, unknown>
      ) => Promise<{ behavior: "allow" } | { behavior: "deny"; message: string }>;
    } {
      const call = mockQueryStream.mock.calls[0][0] as { options: never };
      return call.options;
    }

    it("exposes read-only tools by default", async () => {
      const provider = new ClaudeAgentSdkProvider({ maxRetries: 1, timeoutMs: 5000 });
      mockSuccessStream();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(lastCallTools()).toEqual(["Read", "Glob", "Grep"]);
    });

    it("exposes Write/Edit but not Bash when only write tools are enabled", async () => {
      const provider = new ClaudeAgentSdkProvider({
        maxRetries: 1,
        timeoutMs: 5000,
        enableWriteTools: true,
      });
      mockSuccessStream();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(lastCallTools()).toEqual(["Read", "Glob", "Grep", "Write", "Edit"]);
    });

    it("exposes Bash only when shell tools are explicitly enabled", async () => {
      const provider = new ClaudeAgentSdkProvider({
        maxRetries: 1,
        timeoutMs: 5000,
        enableWriteTools: true,
        enableShellTools: true,
      });
      mockSuccessStream();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(lastCallTools()).toEqual(["Read", "Glob", "Grep", "Write", "Edit", "Bash"]);
    });

    it("scopes pre-approved Read access to the workspace by default", async () => {
      const provider = new ClaudeAgentSdkProvider({ maxRetries: 1, timeoutMs: 5000 });
      mockSuccessStream();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(lastCallOptions().allowedTools).toEqual(["Read(./**)", "Glob", "Grep"]);
    });

    it("scopes Write/Edit to the workspace when write tools are enabled", async () => {
      const provider = new ClaudeAgentSdkProvider({
        maxRetries: 1,
        timeoutMs: 5000,
        enableWriteTools: true,
      });
      mockSuccessStream();

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(lastCallOptions().allowedTools).toEqual([
        "Read(./**)",
        "Glob",
        "Grep",
        "Write(./**)",
        "Edit(./**)",
      ]);
    });

    it("denies Read access to absolute paths outside the workspace", async () => {
      const provider = new ClaudeAgentSdkProvider({ maxRetries: 1, timeoutMs: 5000 });
      mockSuccessStream();

      const resultPromise = provider.executePrompt("Review the following file test.ts", {
        workingDirectory: "/repo",
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      const result = await lastCallOptions().canUseTool("Read", { file_path: "/etc/passwd" });
      expect(result.behavior).toBe("deny");
    });

    it("denies Read access to relative paths escaping the workspace", async () => {
      const provider = new ClaudeAgentSdkProvider({ maxRetries: 1, timeoutMs: 5000 });
      mockSuccessStream();

      const resultPromise = provider.executePrompt("Review the following file test.ts", {
        workingDirectory: "/repo",
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      const result = await lastCallOptions().canUseTool("Read", {
        file_path: "../../etc/passwd",
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies Write access outside the workspace when write tools are enabled", async () => {
      const provider = new ClaudeAgentSdkProvider({
        maxRetries: 1,
        timeoutMs: 5000,
        enableWriteTools: true,
      });
      mockSuccessStream();

      const resultPromise = provider.executePrompt("Fix the issue", {
        workingDirectory: "/repo",
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      const result = await lastCallOptions().canUseTool("Write", {
        file_path: "/home/user/.bashrc",
      });
      expect(result.behavior).toBe("deny");
    });

    it.each([
      ["relative path inside workspace", { file_path: "src/index.ts" }],
      ["absolute path inside workspace", { file_path: "/repo/src/index.ts" }],
      ["workspace root itself", { file_path: "/repo" }],
    ])("allows Read access to %s", async (_label, input) => {
      const provider = new ClaudeAgentSdkProvider({ maxRetries: 1, timeoutMs: 5000 });
      mockSuccessStream();

      const resultPromise = provider.executePrompt("Review the following file test.ts", {
        workingDirectory: "/repo",
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      const result = await lastCallOptions().canUseTool("Read", input);
      expect(result.behavior).toBe("allow");
    });

    it("allows tool calls without a path input", async () => {
      const provider = new ClaudeAgentSdkProvider({ maxRetries: 1, timeoutMs: 5000 });
      mockSuccessStream();

      const resultPromise = provider.executePrompt("Review the following file test.ts", {
        workingDirectory: "/repo",
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      const result = await lastCallOptions().canUseTool("Glob", { pattern: "**/*.ts" });
      expect(result.behavior).toBe("allow");
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
        findings: [
          {
            line: 10,
            severity: "high",
            category: "bug",
            message: "Issue",
            reasoning: "Code context.",
          },
        ],
      };

      mockQueryStream.mockReturnValue(
        createMockStream([
          { session_id: "session-123", type: "system" },
          {
            type: "result",
            subtype: "success",
            session_id: "session-123",
            result: JSON.stringify(structuredOutput),
            structured_output: structuredOutput,
          },
        ])
      );

      const resultPromise = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.parsed).toEqual(structuredOutput);
    });

    it("should capture and reuse session ID on subsequent calls", async () => {
      const provider = createProvider();
      const structuredOutput = { findings: [] };

      mockQueryStream.mockReturnValue(
        createMockStream([
          { session_id: "session-123", type: "system" },
          {
            type: "result",
            subtype: "success",
            session_id: "session-123",
            result: JSON.stringify(structuredOutput),
            structured_output: structuredOutput,
          },
        ])
      );

      const promise1 = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await promise1;

      expect(mockQueryStream).toHaveBeenLastCalledWith(
        expect.objectContaining({
          options: expect.not.objectContaining({
            resume: "session-123",
          }),
        })
      );

      // Call it again to verify resume is passed
      mockQueryStream.mockReturnValue(
        createMockStream([
          { session_id: "session-123", type: "system" },
          {
            type: "result",
            subtype: "success",
            session_id: "session-123",
            result: JSON.stringify(structuredOutput),
            structured_output: structuredOutput,
          },
        ])
      );

      const promise2 = provider.executePrompt("Review cross-file review");
      await vi.runAllTimersAsync();
      await promise2;

      expect(mockQueryStream).toHaveBeenLastCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            resume: "session-123",
          }),
        })
      );
    });

    it("should support destroy to clear session ID", async () => {
      const provider = createProvider();
      const structuredOutput = { findings: [] };

      mockQueryStream.mockReturnValue(
        createMockStream([
          { session_id: "session-123", type: "system" },
          {
            type: "result",
            subtype: "success",
            session_id: "session-123",
            result: JSON.stringify(structuredOutput),
            structured_output: structuredOutput,
          },
        ])
      );

      const promise1 = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await promise1;

      provider.destroy();

      mockQueryStream.mockReturnValue(
        createMockStream([
          { session_id: "session-456", type: "system" },
          {
            type: "result",
            subtype: "success",
            session_id: "session-456",
            result: JSON.stringify(structuredOutput),
            structured_output: structuredOutput,
          },
        ])
      );

      const promise2 = provider.executePrompt("Review the following file test.ts");
      await vi.runAllTimersAsync();
      await promise2;

      expect(mockQueryStream).toHaveBeenLastCalledWith(
        expect.objectContaining({
          options: expect.not.objectContaining({
            resume: "session-123",
          }),
        })
      );
    });

    it("should handle streaming chunks via onStreamData callback", async () => {
      const provider = createProvider();
      const streamChunks: string[] = [];
      const onStreamData = (chunk: string) => {
        streamChunks.push(chunk);
      };

      mockQueryStream.mockReturnValue(
        createMockStream([
          { session_id: "session-123", type: "system" },
          {
            type: "stream_event",
            session_id: "session-123",
            event: {
              type: "content_block_delta",
              delta: {
                type: "text_delta",
                text: "Hello ",
              },
            },
          },
          {
            type: "stream_event",
            session_id: "session-123",
            event: {
              type: "content_block_delta",
              delta: {
                type: "text_delta",
                text: "World!",
              },
            },
          },
          {
            type: "result",
            subtype: "success",
            session_id: "session-123",
            result: '{"findings":[]}',
            structured_output: { findings: [] },
          },
        ])
      );

      const promise = provider.executePrompt("Review test.ts", { onStreamData });
      await vi.runAllTimersAsync();
      await promise;

      expect(streamChunks).toEqual(["Hello ", "World!"]);
    });

    it("should abort and reject when execution times out", async () => {
      const provider = createProvider(1, 1000); // 1s timeout

      // Create stream that takes a long time
      const slowStream = async function* () {
        yield { session_id: "session-123", type: "system" };
        await new Promise((resolve) => setTimeout(resolve, 2000));
        yield {
          type: "result",
          subtype: "success",
          session_id: "session-123",
          result: '{"findings":[]}',
          structured_output: { findings: [] },
        };
      };
      mockQueryStream.mockImplementation(() => slowStream());

      const promise = provider.executePrompt("Review test.ts");
      const rejectPromise = expect(promise).rejects.toThrow(AIProviderError);

      await vi.advanceTimersByTimeAsync(1500);

      await rejectPromise;
      await expect(promise).rejects.toThrow("Prompt timed out after 1000ms");
    });

    it("should parse text and fallback to JSON extract if structured_output is missing", async () => {
      const provider = createProvider();
      const structuredOutput = {
        findings: [
          {
            line: 10,
            severity: "high",
            category: "bug",
            message: "Issue",
            reasoning: "Code context.",
          },
        ],
      };

      mockQueryStream.mockReturnValue(
        createMockStream([
          { session_id: "session-123", type: "system" },
          {
            type: "result",
            subtype: "success",
            session_id: "session-123",
            result: `Here is the JSON:
\`\`\`json
${JSON.stringify(structuredOutput)}
\`\`\`
`,
          },
        ])
      );

      const promise = provider.executePrompt("Review the file");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.parsed).toEqual(structuredOutput);
    });

    it("should throw AIProviderError when query results in a failure subtype", async () => {
      const provider = createProvider();

      mockQueryStream.mockReturnValue(
        createMockStream([
          { session_id: "session-123", type: "system" },
          {
            type: "result",
            subtype: "error_max_turns",
            session_id: "session-123",
            errors: ["Max turns reached"],
          },
        ])
      );

      const promise = provider.executePrompt("Review the file");
      const rejectPromise = expect(promise).rejects.toThrow(AIProviderError);

      await vi.runAllTimersAsync();

      await rejectPromise;
      await expect(promise).rejects.toThrow("Max turns reached");
    });
  });

  describe("parsing methods", () => {
    const provider = new ClaudeAgentSdkProvider();

    describe("parseFileReview", () => {
      it("should parse file review successfully", () => {
        const inputResponse: AIResponse = {
          raw: "",
          parsed: {
            findings: [
              {
                line: 5,
                severity: "high",
                confidence: "high",
                category: "bug",
                message: "Null pointer error",
                suggestion: "Check for null",
                reasoning: "The value can be null, causing a crash.",
                isPreExisting: false,
              },
            ],
          },
        };

        const result = provider.parseFileReview("index.ts", inputResponse);
        expect(result.filename).toBe("index.ts");
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0].line).toBe(5);
        expect(result.findings[0].severity).toBe("high");
      });
    });

    describe("parseCrossFileReview", () => {
      it("should parse cross-file review successfully", () => {
        const inputResponse: AIResponse = {
          raw: "",
          parsed: {
            overall_assessment: "Looks good overall",
            findings: [
              {
                severity: "medium",
                confidence: "medium",
                category: "architecture",
                message: "Circular dependency detected",
                reasoning: "Component A imports Component B which imports Component A.",
                affected_files: ["a.ts", "b.ts"],
              },
            ],
            recommendations: ["Refactor dependencies"],
          },
        };

        const result = provider.parseCrossFileReview(inputResponse);
        expect(result.overallAssessment).toBe("Looks good overall");
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0].severity).toBe("medium");
        expect(result.findings[0].affectedFiles).toEqual(["a.ts", "b.ts"]);
        expect(result.recommendations).toEqual(["Refactor dependencies"]);
      });
    });

    describe("parseBatchedFileReview", () => {
      it("should parse batched file reviews successfully", () => {
        const inputResponse: AIResponse = {
          raw: "",
          parsed: {
            file_results: {
              "a.ts": {
                findings: [
                  {
                    line: 2,
                    severity: "low",
                    confidence: "low",
                    category: "quality",
                    message: "Unused variable",
                    suggestion: "Remove it",
                    reasoning: "Variable is defined but never referenced.",
                    isPreExisting: true,
                  },
                ],
              },
            },
          },
        };

        const result = provider.parseBatchedFileReview(inputResponse);
        expect(result).toHaveLength(1);
        expect(result[0].filename).toBe("a.ts");
        expect(result[0].findings[0].line).toBe(2);
      });
    });

    describe("parseFastReview", () => {
      it("should split flat findings into file and cross-file findings", () => {
        const inputResponse: AIResponse = {
          raw: "",
          parsed: {
            summary: "Combined summary",
            findings: [
              {
                file: "foo.ts",
                line: 12,
                severity: "high",
                confidence: "high",
                category: "bug",
                message: "Index out of bounds",
                suggestion: "Check length",
                reasoning: "The index is accessed without verification.",
                isPreExisting: false,
              },
              {
                severity: "medium",
                confidence: "high",
                category: "security",
                message: "Insecure credentials storage",
                reasoning: "Storing API keys in plain text config files.",
                isPreExisting: false,
              },
            ],
          },
        };

        const result = provider.parseFastReview(inputResponse);
        expect(result.crossFileResult.overallAssessment).toBe("Combined summary");
        expect(result.crossFileResult.findings).toHaveLength(1);
        expect(result.crossFileResult.findings[0].category).toBe("security");

        expect(result.fileResults).toHaveLength(1);
        expect(result.fileResults[0].filename).toBe("foo.ts");
        expect(result.fileResults[0].findings[0].line).toBe(12);
      });
    });
  });
});
