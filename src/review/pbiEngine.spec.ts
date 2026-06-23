import { describe, expect, it, vi, afterEach } from "vitest";
import type { AIProviderClient, AIResponse } from "../ai/types.js";
import type { PBIDetails, PlatformAdapter } from "../platforms/types.js";
import { PBIReviewEngine } from "./pbiEngine.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: vi.fn().mockImplementation((...args) => {
      if ((globalThis as any).__throwWriteFileError) {
        throw new Error("Write failed");
      }
      return actual.writeFileSync(...args);
    }),
  };
});

describe("PBIReviewEngine", () => {
  const mockPbiDetails: PBIDetails = {
    id: "12345",
    platform: "github",
    title: "Test User Story",
    description: "As a user, I want to review stories, so that they meet INVEST criteria.",
    acceptanceCriteria: "Must evaluate all dimensions.",
    storyPoints: 5,
    comments: [],
  };

  const mockAiOutput = {
    title: "Test User Story",
    invest_evaluation: {
      independent: { status: "pass", feedback: "Ind feedback" },
      negotiable: { status: "pass", feedback: "Neg feedback" },
      valuable: { status: "pass", feedback: "Val feedback" },
      estimable: { status: "needs-improvement", feedback: "Est feedback" },
      testable: { status: "fail", feedback: "Test feedback" },
    },
    overall_assessment: "Good overall, but estimability and testability need work.",
    suggestions: ["Add more details to acceptance criteria"],
  };

  const mockAiResponse: AIResponse = {
    raw: JSON.stringify(mockAiOutput),
    parsed: mockAiOutput,
  };

  const createMockAdapter = (comments: PBIDetails["comments"] = []): PlatformAdapter => ({
    getProjectIdentifier: vi.fn().mockReturnValue("test-project"),
    getPlatformName: vi.fn().mockReturnValue("github"),
    getRepoInfo: vi.fn().mockReturnValue({ owner: "owner", repo: "repo", platform: "github" }),
    getToken: vi.fn().mockReturnValue("token"),
    getPRDetails: vi.fn(),
    getPRFiles: vi.fn(),
    getExistingBotComments: vi.fn(),
    postInlineComment: vi.fn(),
    postGeneralComment: vi.fn(),
    getPBIDetails: vi.fn().mockResolvedValue({ ...mockPbiDetails, comments }),
    postPBIComment: vi.fn(),
  });

  const createMockAiClient = (response: AIResponse = mockAiResponse): AIProviderClient => ({
    executePrompt: vi.fn().mockResolvedValue(response),
    parseFileReview: vi.fn(),
    parseCrossFileReview: vi.fn(),
    parseBatchedFileReview: vi.fn(),
    parseFastReview: vi.fn(),
  });

  it("should retrieve PBI, run AI review, and write comment (new comment)", async () => {
    const adapter = createMockAdapter();
    const aiClient = createMockAiClient();
    const engine = new PBIReviewEngine(adapter, aiClient, { dryRun: false });

    const result = await engine.reviewPBI("12345");

    expect(adapter.getPBIDetails).toHaveBeenCalledWith("12345");
    expect(aiClient.executePrompt).toHaveBeenCalled();
    expect(result.title).toBe("Test User Story");
    expect(result.invest_evaluation.estimable.status).toBe("needs-improvement");
    expect(result.invest_evaluation.testable.status).toBe("fail");

    // Should post a new comment because no comment with signature was found
    expect(adapter.postPBIComment).toHaveBeenCalledWith(
      "12345",
      expect.stringContaining("<!-- merge-mentor-pbi-review -->")
    );
  });

  it("should retrieve PBI, run AI review, and overwrite existing comment if signature exists", async () => {
    const existingComments = [
      { id: 999, body: "Some user comment" },
      { id: 1000, body: "Old bot review <!-- merge-mentor-pbi-review -->" },
    ];
    const adapter = createMockAdapter(existingComments);
    const aiClient = createMockAiClient();
    const engine = new PBIReviewEngine(adapter, aiClient, { dryRun: false });

    await engine.reviewPBI("12345");

    // Should update existing comment 1000 instead of posting a new one
    expect(adapter.postPBIComment).toHaveBeenCalledWith(
      "12345",
      expect.stringContaining("<!-- merge-mentor-pbi-review -->"),
      1000
    );
  });

  it("should skip writing comment when dryRun option is set", async () => {
    const adapter = createMockAdapter();
    const aiClient = createMockAiClient();
    const engine = new PBIReviewEngine(adapter, aiClient, { dryRun: true });

    await engine.reviewPBI("12345");

    expect(adapter.postPBIComment).not.toHaveBeenCalled();
  });

  afterEach(() => {
    (globalThis as any).__throwWriteFileError = false;
  });

  it("should handle writeFileSync failure when saving report", async () => {
    const adapter = createMockAdapter();
    const aiClient = createMockAiClient();
    const engine = new PBIReviewEngine(adapter, aiClient, { dryRun: true });

    (globalThis as any).__throwWriteFileError = true;

    // Should not throw, should handle error gracefully in catch block
    await expect(engine.reviewPBI("12345")).resolves.toBeDefined();
  });

  it("should handle schema drift and fallback to fallbackParse on invalid zod schema output", async () => {
    const adapter = createMockAdapter();
    // Raw output is valid JSON, but doesn't conform to the schema (missing invest_evaluation)
    const malformedOutput = {
      title: "Malformed Story",
      overall_assessment: "Invalid structure",
      suggestions: [],
    };
    const malformedResponse: AIResponse = {
      raw: JSON.stringify(malformedOutput),
      parsed: malformedOutput,
    };
    const aiClient = createMockAiClient(malformedResponse);
    const engine = new PBIReviewEngine(adapter, aiClient, { dryRun: true });

    const result = await engine.reviewPBI("12345");

    expect(result.title).toBe("Malformed Story");
    expect(result.invest_evaluation.independent.status).toBe("needs-improvement");
    expect(result.overall_assessment).toBe("Invalid structure");
  });

  it("should parse fallback JSON wrapped in markdown code blocks", async () => {
    const adapter = createMockAdapter();
    const markdownRaw = "Some explanation\n```json\n{\n  \"title\": \"Wrapped Story\",\n  \"invest_evaluation\": {\n    \"independent\": { \"status\": \"pass\", \"feedback\": \"Good\" }\n  }\n}\n```\nSome other explanation";
    const invalidParsedResponse: AIResponse = {
      raw: markdownRaw,
      parsed: { invalid: true }, // Will fail zod validation
    };
    const aiClient = createMockAiClient(invalidParsedResponse);
    const engine = new PBIReviewEngine(adapter, aiClient, { dryRun: true });

    const result = await engine.reviewPBI("12345");

    expect(result.title).toBe("Wrapped Story");
    expect(result.invest_evaluation.independent.status).toBe("pass");
    expect(result.invest_evaluation.independent.feedback).toBe("Good");
    expect(result.invest_evaluation.negotiable.status).toBe("needs-improvement");
  });

  it("should return fully failing fallback structure when parsing completely fails", async () => {
    const adapter = createMockAdapter();
    const invalidParsedResponse: AIResponse = {
      raw: "This is completely invalid JSON text",
      parsed: { invalid: true },
    };
    const aiClient = createMockAiClient(invalidParsedResponse);
    const engine = new PBIReviewEngine(adapter, aiClient, { dryRun: true });

    const result = await engine.reviewPBI("12345");

    expect(result.title).toBe("Test User Story"); // Fallbacks to story title
    expect(result.overall_assessment).toBe("AI review failed to generate a parseable response.");
    expect(result.invest_evaluation.independent.status).toBe("needs-improvement");
  });

  it("should handle unknown status in getStatusEmoji", () => {
    const adapter = createMockAdapter();
    const aiClient = createMockAiClient();
    const engine = new PBIReviewEngine(adapter, aiClient, { dryRun: true });

    // Call private method directly using type casting
    const emoji = (engine as any).getStatusEmoji("some-unknown-status");
    expect(emoji).toBe("⚪ **UNKNOWN**");
  });

  it("should parse fallback JSON not wrapped in markdown code blocks", async () => {
    const adapter = createMockAdapter();
    const rawJson = "{\n  \"title\": \"Direct JSON Story\",\n  \"invest_evaluation\": {\n    \"independent\": { \"status\": \"pass\", \"feedback\": \"Good\" }\n  }\n}";
    const invalidParsedResponse: AIResponse = {
      raw: rawJson,
      parsed: { invalid: true },
    };
    const aiClient = createMockAiClient(invalidParsedResponse);
    const engine = new PBIReviewEngine(adapter, aiClient, { dryRun: true });

    const result = await engine.reviewPBI("12345");

    expect(result.title).toBe("Direct JSON Story");
    expect(result.invest_evaluation.independent.status).toBe("pass");
  });
});
