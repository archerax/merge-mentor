import { afterEach, beforeEach, describe, expect, it, type Mocked, vi } from "vitest";
import type { Clock } from "../../ports/clock.js";
import { createFixedClock } from "../../ports/clock.test-helper.js";
import type { FileSystem } from "../../ports/fileSystem.js";
import { createStubFileSystem } from "../../ports/fileSystem.test-helper.js";

// vi.hoisted ensures these are available when vi.mock() factory runs (which is hoisted)
const { mockSession, mockClient } = vi.hoisted(() => {
  const mockSession = {
    on: vi.fn(),
    sendAndWait: vi.fn(),
    destroy: vi.fn(),
  };
  const mockClient = {
    createSession: vi.fn().mockResolvedValue(mockSession),
    stop: vi.fn().mockResolvedValue([]),
  };
  return { mockSession, mockClient };
});

vi.mock("@github/copilot-sdk", () => ({
  // biome-ignore lint/complexity/useArrowFunction: regular function required so Reflect.construct works when called with `new`
  CopilotClient: vi.fn().mockImplementation(function () {
    return mockClient;
  }),
}));

import { CopilotSdkError, ValidationError } from "../../errors/index.js";
import type { AIResponse } from "../types.js";
import { CopilotSdkProvider } from "./copilot-sdk.js";

function createAIResponse(parsed: unknown): AIResponse {
  return { raw: JSON.stringify(parsed), parsed };
}

describe("CopilotSdkProvider", () => {
  let fileSystem: Mocked<FileSystem>;
  let clock: Clock;

  function createProvider(maxRetries = 1, timeoutMs = 5000, model?: string): CopilotSdkProvider {
    return new CopilotSdkProvider({ maxRetries, timeoutMs, model, fileSystem, clock });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    fileSystem = createStubFileSystem() as Mocked<FileSystem>;
    clock = createFixedClock();
    mockSession.on.mockReturnValue(() => {});
    mockSession.destroy.mockResolvedValue(undefined);
    mockClient.createSession.mockResolvedValue(mockSession);
    mockClient.stop.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("executePrompt", () => {
    it("throws ValidationError when prompt is empty", async () => {
      const provider = createProvider();

      await expect(provider.executePrompt("")).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError when prompt is whitespace only", async () => {
      const provider = createProvider();

      await expect(provider.executePrompt("   ")).rejects.toThrow(ValidationError);
    });

    it("returns parsed JSON from output file on success", async () => {
      const provider = createProvider();
      const expectedParsed = { findings: [] };
      const jsonContent = JSON.stringify(expectedParsed);

      mockSession.sendAndWait.mockResolvedValue({
        type: "assistant.message",
        data: { content: "Done" },
      });
      fileSystem.readFile.mockResolvedValue(jsonContent);

      const result = await provider.executePrompt("Review the following file: test.ts");

      expect(result.parsed).toEqual(expectedParsed);
    });

    it("throws CopilotSdkError when output file is empty", async () => {
      const provider = createProvider();

      mockSession.sendAndWait.mockResolvedValue({
        type: "assistant.message",
        data: { content: "Done" },
      });
      fileSystem.readFile.mockResolvedValue("");

      await expect(provider.executePrompt("Review the following file: test.ts")).rejects.toThrow(
        CopilotSdkError
      );
    });

    it("throws CopilotSdkError after exhausting retries", async () => {
      const provider = createProvider(2);

      mockSession.sendAndWait.mockRejectedValue(new Error("Network error"));

      const promise = provider.executePrompt("Review the following file: test.ts");
      // Attach rejection handler before advancing timers to avoid unhandled rejection
      const assertion = expect(promise).rejects.toThrow(CopilotSdkError);
      await vi.runAllTimersAsync();
      await assertion;
    });

    it("creates session with specified model", async () => {
      const provider = createProvider(1, 5000, "gpt-4.1");
      const jsonContent = JSON.stringify({ findings: [] });

      mockSession.sendAndWait.mockResolvedValue({
        type: "assistant.message",
        data: { content: "Done" },
      });
      fileSystem.readFile.mockResolvedValue(jsonContent);

      await provider.executePrompt("Review the following file: test.ts");

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ model: "gpt-4.1" })
      );
    });

    it("calls onStreamData with delta content from events", async () => {
      const provider = createProvider();
      const onStreamData = vi.fn();
      const jsonContent = JSON.stringify({ findings: [] });

      mockSession.on.mockImplementation((eventType: string, handler: (e: any) => void) => {
        if (eventType === "assistant.message_delta") {
          handler({ type: "assistant.message_delta", data: { deltaContent: "hello " } });
        }
        return () => {};
      });
      mockSession.sendAndWait.mockResolvedValue({
        type: "assistant.message",
        data: { content: "Done" },
      });
      fileSystem.readFile.mockResolvedValue(jsonContent);

      await provider.executePrompt("Review the following file: test.ts", { onStreamData });

      expect(onStreamData).toHaveBeenCalledWith("hello ");
    });

    it("cleans up temp files after successful execution", async () => {
      const provider = createProvider();
      const jsonContent = JSON.stringify({ findings: [] });

      mockSession.sendAndWait.mockResolvedValue({
        type: "assistant.message",
        data: { content: "Done" },
      });
      fileSystem.readFile.mockResolvedValue(jsonContent);

      await provider.executePrompt("Review the following file: test.ts");

      expect(fileSystem.unlink).toHaveBeenCalledTimes(2); // prompt + output files
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
  });
});
