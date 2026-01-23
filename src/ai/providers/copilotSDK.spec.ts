import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotSDKError, ValidationError } from "../../errors/index.js";
import { CopilotSDKProvider } from "./copilotSDK.js";

// Create mock instances
const mockSession = {
  sendAndWait: vi.fn(),
  on: vi.fn(),
};

const mockClientInstance = {
  createSession: vi.fn().mockResolvedValue(mockSession),
  stop: vi.fn().mockResolvedValue(undefined),
};

// Mock the SDK using function constructor pattern
vi.mock("@github/copilot-sdk", () => ({
  CopilotClient: function CopilotClient() {
    return mockClientInstance;
  },
}));

describe("CopilotSDKProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.sendAndWait.mockReset();
    mockSession.on.mockReset();
    mockClientInstance.createSession.mockResolvedValue(mockSession);
    mockClientInstance.stop.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("executePrompt", () => {
    it("throws ValidationError for empty prompt", async () => {
      const provider = new CopilotSDKProvider();
      await expect(provider.executePrompt("")).rejects.toThrow(ValidationError);
      await expect(provider.executePrompt("   ")).rejects.toThrow(ValidationError);
    });

    it("executes prompt and returns parsed response", async () => {
      const provider = new CopilotSDKProvider({ model: "gpt-4.1" });

      mockSession.sendAndWait.mockResolvedValue({
        data: {
          content: '```json\n{"findings": []}\n```',
        },
        usage: {
          promptTokens: 100,
          completionTokens: 50,
        },
      });

      const result = await provider.executePrompt("Review this code");

      expect(result.parsed).toEqual({ findings: [] });
      expect(result.raw).toBe('```json\n{"findings": []}\n```');
    });

    it("retries on failure and eventually succeeds", async () => {
      const provider = new CopilotSDKProvider({ maxRetries: 3 });

      mockSession.sendAndWait
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Timeout"))
        .mockResolvedValueOnce({
          data: { content: '{"findings": []}' },
        });

      const result = await provider.executePrompt("Review code");

      expect(result.parsed).toEqual({ findings: [] });
      expect(mockSession.sendAndWait).toHaveBeenCalledTimes(3);
    });

    it("throws CopilotSDKError after all retries exhausted", async () => {
      const provider = new CopilotSDKProvider({ maxRetries: 2 });

      mockSession.sendAndWait.mockRejectedValue(new Error("Persistent error"));

      await expect(provider.executePrompt("Review code")).rejects.toThrow(CopilotSDKError);
    });

    it("parses JSON from raw content when not in markdown block", async () => {
      const provider = new CopilotSDKProvider();

      mockSession.sendAndWait.mockResolvedValue({
        data: { content: 'Here is the review:\n{"findings": [{"line": 10}]}' },
      });

      const result = await provider.executePrompt("Review code");

      expect(result.parsed).toEqual({ findings: [{ line: 10 }] });
    });

    it("uses configured model", async () => {
      const provider = new CopilotSDKProvider({ model: "gpt-5" });

      mockSession.sendAndWait.mockResolvedValue({
        data: { content: '{"findings": []}' },
      });

      await provider.executePrompt("Review code");

      expect(mockClientInstance.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ model: "gpt-5" })
      );
    });
  });

  describe("parseFileReview", () => {
    it("parses file review response correctly", () => {
      const provider = new CopilotSDKProvider();
      const response = {
        raw: "",
        parsed: {
          findings: [
            {
              line: 10,
              severity: "high",
              confidence: "high",
              category: "bug",
              message: "Null pointer dereference",
              suggestion: "Add null check",
              reasoning: "Variable may be null",
              isPreExisting: false,
            },
          ],
        },
      };

      const result = provider.parseFileReview("test.ts", response);

      expect(result.filename).toBe("test.ts");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toEqual({
        line: 10,
        severity: "high",
        confidence: "high",
        category: "bug",
        message: "Null pointer dereference",
        suggestion: "Add null check",
        reasoning: "Variable may be null",
        isPreExisting: false,
      });
    });

    it("handles empty findings array", () => {
      const provider = new CopilotSDKProvider();
      const response = {
        raw: "",
        parsed: { findings: [] },
      };

      const result = provider.parseFileReview("test.ts", response);

      expect(result.filename).toBe("test.ts");
      expect(result.findings).toHaveLength(0);
    });

    it("validates and defaults invalid severity", () => {
      const provider = new CopilotSDKProvider();
      const response = {
        raw: "",
        parsed: {
          findings: [
            {
              line: 1,
              severity: "invalid",
              confidence: "high",
              category: "bug",
              message: "Test",
              suggestion: "Fix",
            },
          ],
        },
      };

      const result = provider.parseFileReview("test.ts", response);

      expect(result.findings[0].severity).toBe("medium"); // Default
    });
  });

  describe("parseCrossFileReview", () => {
    it("parses cross-file review response correctly", () => {
      const provider = new CopilotSDKProvider();
      const response = {
        raw: "",
        parsed: {
          overall_assessment: "Good architecture",
          findings: [
            {
              severity: "high",
              confidence: "high",
              category: "architecture",
              message: "Circular dependency detected",
              reasoning: "Module A depends on B depends on A",
              affected_files: ["a.ts", "b.ts"],
            },
          ],
          recommendations: ["Refactor to break cycle"],
        },
      };

      const result = provider.parseCrossFileReview(response);

      expect(result.overallAssessment).toBe("Good architecture");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].affectedFiles).toEqual(["a.ts", "b.ts"]);
      expect(result.recommendations).toEqual(["Refactor to break cycle"]);
    });
  });

  describe("parseBatchedFileReview", () => {
    it("parses batched file review response correctly", () => {
      const provider = new CopilotSDKProvider();
      const response = {
        raw: "",
        parsed: {
          file_results: {
            "src/a.ts": {
              findings: [
                {
                  line: 5,
                  severity: "medium",
                  confidence: "high",
                  category: "quality",
                  message: "Consider using const",
                  suggestion: "Use const instead of let",
                },
              ],
            },
            "src/b.ts": {
              findings: [],
            },
          },
        },
      };

      const results = provider.parseBatchedFileReview(response);

      expect(results).toHaveLength(2);
      expect(results[0].filename).toBe("src/a.ts");
      expect(results[0].findings).toHaveLength(1);
      expect(results[1].filename).toBe("src/b.ts");
      expect(results[1].findings).toHaveLength(0);
    });

    it("returns empty array when file_results is missing", () => {
      const provider = new CopilotSDKProvider();
      const response = {
        raw: "",
        parsed: {},
      };

      const results = provider.parseBatchedFileReview(response);

      expect(results).toHaveLength(0);
    });
  });

  describe("stop", () => {
    it("stops the client", async () => {
      const provider = new CopilotSDKProvider();

      // Trigger client creation by executing a prompt
      mockSession.sendAndWait.mockResolvedValue({
        data: { content: '{"findings": []}' },
      });
      await provider.executePrompt("Test");

      // Now stop
      await provider.stop();

      expect(mockClientInstance.stop).toHaveBeenCalled();
    });

    it("handles stop when client not initialized", async () => {
      const provider = new CopilotSDKProvider();

      // Should not throw - client never created
      await expect(provider.stop()).resolves.toBeUndefined();
    });
  });
});
