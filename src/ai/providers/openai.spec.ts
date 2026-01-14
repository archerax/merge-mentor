import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Create mock at module level
const mockCreate = vi.fn();

// Mock OpenAI before imports
vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
        },
      };
    },
    APIError: class APIError extends Error {
      status: number;
      headers: Record<string, string>;
      constructor(message: string, status: number, headers: Record<string, string> = {}) {
        super(message);
        this.status = status;
        this.headers = headers;
      }
    },
  };
});

import {
  OpenAIAuthenticationError,
  OpenAIProviderError,
  OpenAIRateLimitError,
} from "../../errors/index.js";
import type { AIResponse } from "../types.js";
import { OpenAIProvider, type OpenAIProviderOptions } from "./openai.js";

function createOpenAIProvider(options?: Partial<OpenAIProviderOptions>): OpenAIProvider {
  return new OpenAIProvider({
    apiKey: options?.apiKey ?? "test-api-key",
    model: options?.model,
    timeoutMs: options?.timeoutMs ?? 5000,
    baseUrl: options?.baseUrl,
    maxRetries: options?.maxRetries,
  });
}

function createAIResponse(parsed: unknown): AIResponse {
  return { raw: JSON.stringify(parsed), parsed };
}

describe("OpenAIProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("throws error when API key is missing", () => {
      expect(() => new OpenAIProvider({ apiKey: "" })).toThrow(OpenAIAuthenticationError);
      expect(() => new OpenAIProvider({ apiKey: "" })).toThrow("OpenAI API key is required");
    });

    it("creates provider with valid API key", () => {
      const provider = createOpenAIProvider();
      expect(provider).toBeInstanceOf(OpenAIProvider);
    });

    it("uses default model gpt-4o when not specified", () => {
      const provider = createOpenAIProvider();
      expect(provider).toBeInstanceOf(OpenAIProvider);
      // Model is internal, we verify it in executePrompt tests
    });
  });

  describe("executePrompt", () => {
    it("throws error for empty prompt", async () => {
      const provider = createOpenAIProvider();
      await expect(provider.executePrompt("")).rejects.toThrow("Prompt cannot be empty");
    });

    it("throws error for whitespace-only prompt", async () => {
      const provider = createOpenAIProvider();
      await expect(provider.executePrompt("   ")).rejects.toThrow("Prompt cannot be empty");
    });

    it("executes prompt and returns parsed response", async () => {
      const provider = createOpenAIProvider();
      const mockResponse = { findings: [] };

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(mockResponse) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const result = await provider.executePrompt("Review this code");

      expect(result.parsed).toEqual(mockResponse);
      expect(result.tokenUsage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        model: "gpt-4o",
        durationWallSeconds: expect.any(Number),
      });
    });

    it("throws error when response content is empty", async () => {
      const provider = createOpenAIProvider();

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: null } }],
      });

      await expect(provider.executePrompt("test")).rejects.toThrow("Empty response from OpenAI");
    });

    it("throws error when response has no JSON object", async () => {
      const provider = createOpenAIProvider();

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "No JSON here" } }],
      });

      await expect(provider.executePrompt("test")).rejects.toThrow(
        "No JSON object found in response"
      );
    });

    it("handles authentication error (401)", async () => {
      const provider = createOpenAIProvider();
      // Create an error object that matches OpenAI's APIError shape
      const apiError = { status: 401, message: "Invalid API key", headers: {} };
      mockCreate.mockRejectedValueOnce(apiError);

      await expect(provider.executePrompt("test")).rejects.toThrow(OpenAIAuthenticationError);
    });

    it("handles rate limit error (429)", async () => {
      const provider = createOpenAIProvider();
      // Create an error object that matches OpenAI's APIError shape
      const apiError = {
        status: 429,
        message: "Rate limit exceeded",
        headers: { "retry-after": "60" },
      };
      mockCreate.mockRejectedValueOnce(apiError);

      await expect(provider.executePrompt("test")).rejects.toThrow(OpenAIRateLimitError);
    });

    it("handles generic API error", async () => {
      const provider = createOpenAIProvider();
      // Create an error object that matches OpenAI's APIError shape
      const apiError = { status: 500, message: "Server error", headers: {} };
      mockCreate.mockRejectedValueOnce(apiError);

      await expect(provider.executePrompt("test")).rejects.toThrow(OpenAIProviderError);
    });

    it("handles non-API errors", async () => {
      const provider = createOpenAIProvider();
      mockCreate.mockRejectedValueOnce(new Error("Network error"));

      await expect(provider.executePrompt("test")).rejects.toThrow(OpenAIProviderError);
    });

    it("extracts JSON from markdown code blocks", async () => {
      const provider = createOpenAIProvider();
      const mockResponse = { findings: [{ line: 1, message: "test" }] };

      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: `Here's the review:\n\`\`\`json\n${JSON.stringify(mockResponse)}\n\`\`\``,
            },
          },
        ],
      });

      const result = await provider.executePrompt("test");
      expect(result.parsed).toEqual(mockResponse);
    });

    it("uses custom model when specified", async () => {
      const provider = createOpenAIProvider({ model: "gpt-4-turbo" });
      const mockResponse = { findings: [] };

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(mockResponse) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const result = await provider.executePrompt("test");

      expect(result.tokenUsage?.model).toBe("gpt-4-turbo");
    });
  });

  describe("parseFileReview", () => {
    it("parses valid file review response", () => {
      const provider = createOpenAIProvider();
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
      });
    });

    it("normalizes invalid severity values", () => {
      const provider = createOpenAIProvider();
      const response = createAIResponse({
        findings: [{ line: 1, severity: "invalid", category: "bug", message: "test" }],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings[0].severity).toBe("medium");
    });

    it("normalizes invalid category values", () => {
      const provider = createOpenAIProvider();
      const response = createAIResponse({
        findings: [{ line: 1, severity: "high", category: "invalid", message: "test" }],
      });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings[0].category).toBe("quality");
    });

    it("handles empty findings array", () => {
      const provider = createOpenAIProvider();
      const response = createAIResponse({ findings: [] });

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings).toEqual([]);
    });
  });

  describe("parseCrossFileReview", () => {
    it("parses valid cross-file review response", () => {
      const provider = createOpenAIProvider();
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
      const provider = createOpenAIProvider();
      const response = createAIResponse({});

      const result = provider.parseCrossFileReview(response);

      expect(result.overallAssessment).toBe("Review completed");
      expect(result.findings).toEqual([]);
      expect(result.recommendations).toEqual([]);
    });

    it("normalizes invalid cross-file category values", () => {
      const provider = createOpenAIProvider();
      const response = createAIResponse({
        findings: [{ severity: "high", category: "invalid", message: "test" }],
      });

      const result = provider.parseCrossFileReview(response);

      expect(result.findings[0].category).toBe("design");
    });

    it("handles missing affected_files", () => {
      const provider = createOpenAIProvider();
      const response = createAIResponse({
        findings: [{ severity: "high", category: "design", message: "test" }],
      });

      const result = provider.parseCrossFileReview(response);

      expect(result.findings[0].affectedFiles).toEqual([]);
    });
  });

  describe("parseBatchedFileReview", () => {
    it("parses valid batched file review response", () => {
      const provider = createOpenAIProvider();
      const response = createAIResponse({
        file_results: {
          "src/app.ts": {
            findings: [{ line: 10, severity: "high", category: "bug", message: "Bug found" }],
          },
          "src/utils.ts": {
            findings: [],
          },
        },
      });

      const results = provider.parseBatchedFileReview(response);

      expect(results).toHaveLength(2);
      expect(results[0].filename).toBe("src/app.ts");
      expect(results[0].findings).toHaveLength(1);
      expect(results[1].filename).toBe("src/utils.ts");
      expect(results[1].findings).toHaveLength(0);
    });

    it("returns empty array when file_results is missing", () => {
      const provider = createOpenAIProvider();
      const response = createAIResponse({});

      const results = provider.parseBatchedFileReview(response);

      expect(results).toEqual([]);
    });

    it("returns empty array when file_results is not an object", () => {
      const provider = createOpenAIProvider();
      const response = createAIResponse({ file_results: "not an object" });

      const results = provider.parseBatchedFileReview(response);

      expect(results).toEqual([]);
    });

    it("handles multiple files with various findings", () => {
      const provider = createOpenAIProvider();
      const response = createAIResponse({
        file_results: {
          "file1.ts": {
            findings: [
              { line: 1, severity: "critical", category: "security", message: "SQL injection" },
              { line: 5, severity: "medium", category: "quality", message: "Magic number" },
            ],
          },
          "file2.ts": {
            findings: [
              { line: 10, severity: "low", category: "documentation", message: "Missing docs" },
            ],
          },
          "file3.ts": {
            findings: [],
          },
        },
      });

      const results = provider.parseBatchedFileReview(response);

      expect(results).toHaveLength(3);
      expect(results[0].findings).toHaveLength(2);
      expect(results[1].findings).toHaveLength(1);
      expect(results[2].findings).toHaveLength(0);
    });
  });
});
