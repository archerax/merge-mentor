import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIProviderClient, AIResponse } from "../ai/types.js";
import type { PBIDetails, PlatformAdapter } from "../platforms/types.js";
import { PBIReviewEngine } from "./pbiEngine.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: vi
      .fn()
      .mockImplementation((...args: Parameters<typeof actual.writeFileSync>) => {
        if ((globalThis as { __throwWriteFileError?: boolean }).__throwWriteFileError) {
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
      independent: "Ind feedback",
      negotiable: "Neg feedback",
      valuable: "Val feedback",
      estimable: "Est feedback",
      testable: "Test feedback",
    },
    overall_assessment: "Good overall, but estimability and testability need work.",
    suggestions: ["Add more details to acceptance criteria"],
  };

  const mockAiResponse: AIResponse = {
    raw: JSON.stringify(mockAiOutput),
    parsed: mockAiOutput,
  };

  const createMockAdapter = (
    comments: PBIDetails["comments"] = [],
    pbiDetailsOverride?: Partial<PBIDetails>
  ): PlatformAdapter => ({
    getProjectIdentifier: vi.fn().mockReturnValue("test-project"),
    getPlatformName: vi.fn().mockReturnValue("github"),
    getRepoInfo: vi.fn().mockReturnValue({ owner: "owner", repo: "repo", platform: "github" }),
    getToken: vi.fn().mockReturnValue("token"),
    getPRDetails: vi.fn(),
    getPRFiles: vi.fn(),
    getExistingBotComments: vi.fn(),
    getUnresolvedCommentThreads: vi.fn(),
    postInlineComment: vi.fn(),
    postGeneralComment: vi.fn(),
    getLinkedPBIIds: vi.fn(),
    getPBIDetails: vi
      .fn()
      .mockResolvedValue({ ...mockPbiDetails, comments, ...pbiDetailsOverride }),
    getProjectDetails: vi.fn(),
    postPBIComment: vi.fn(),
    updatePRDetails: vi.fn(),
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
    expect(result.invest_evaluation.estimable).toBe("Est feedback");
    expect(result.invest_evaluation.testable).toBe("Test feedback");

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

  it("includes Merge Mentor version and AI model in the PBI review footer", async () => {
    const adapter = createMockAdapter();
    const aiClient = createMockAiClient();
    const engine = new PBIReviewEngine(adapter, aiClient, {
      dryRun: false,
      aiModel: "custom-test-model",
    });

    await engine.reviewPBI("12345");

    expect(adapter.postPBIComment).toHaveBeenCalledWith(
      "12345",
      expect.stringContaining("Merge Mentor v")
    );
    expect(adapter.postPBIComment).toHaveBeenCalledWith(
      "12345",
      expect.stringContaining("PBI review, custom-test-model")
    );
  });

  it("defaults to 'AI model' in the footer if no aiModel option is specified", async () => {
    const adapter = createMockAdapter();
    const aiClient = createMockAiClient();
    const engine = new PBIReviewEngine(adapter, aiClient, { dryRun: false });

    await engine.reviewPBI("12345");

    expect(adapter.postPBIComment).toHaveBeenCalledWith(
      "12345",
      expect.stringContaining("PBI review, AI model")
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
    (globalThis as { __throwWriteFileError?: boolean }).__throwWriteFileError = false;
  });

  it("should handle writeFileSync failure when saving report", async () => {
    const adapter = createMockAdapter();
    const aiClient = createMockAiClient();
    const engine = new PBIReviewEngine(adapter, aiClient, { dryRun: true });

    (globalThis as { __throwWriteFileError?: boolean }).__throwWriteFileError = true;

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
    expect(result.invest_evaluation.independent).toBe("");
    expect(result.overall_assessment).toBe("Invalid structure");
  });

  it("should parse fallback JSON wrapped in markdown code blocks (old object structure)", async () => {
    const adapter = createMockAdapter();
    const markdownRaw =
      'Some explanation\n```json\n{\n  "title": "Wrapped Story",\n  "invest_evaluation": {\n    "independent": { "status": "pass", "feedback": "Good" }\n  }\n}\n```\nSome other explanation';
    const invalidParsedResponse: AIResponse = {
      raw: markdownRaw,
      parsed: { invalid: true }, // Will fail zod validation
    };
    const aiClient = createMockAiClient(invalidParsedResponse);
    const engine = new PBIReviewEngine(adapter, aiClient, { dryRun: true });

    const result = await engine.reviewPBI("12345");

    expect(result.title).toBe("Wrapped Story");
    expect(result.invest_evaluation.independent).toBe("Good");
    expect(result.invest_evaluation.negotiable).toBe("");
  });

  it("should parse fallback JSON wrapped in markdown code blocks (new string structure)", async () => {
    const adapter = createMockAdapter();
    const markdownRaw =
      'Some explanation\n```json\n{\n  "title": "Wrapped Story",\n  "invest_evaluation": {\n    "independent": "Good"\n  }\n}\n```\nSome other explanation';
    const invalidParsedResponse: AIResponse = {
      raw: markdownRaw,
      parsed: { invalid: true }, // Will fail zod validation
    };
    const aiClient = createMockAiClient(invalidParsedResponse);
    const engine = new PBIReviewEngine(adapter, aiClient, { dryRun: true });

    const result = await engine.reviewPBI("12345");

    expect(result.title).toBe("Wrapped Story");
    expect(result.invest_evaluation.independent).toBe("Good");
    expect(result.invest_evaluation.negotiable).toBe("");
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
    expect(result.invest_evaluation.independent).toBe("Failed to parse AI evaluation.");
  });

  it("should parse fallback JSON not wrapped in markdown code blocks", async () => {
    const adapter = createMockAdapter();
    const rawJson =
      '{\n  "title": "Direct JSON Story",\n  "invest_evaluation": {\n    "independent": "Good"\n  }\n}';
    const invalidParsedResponse: AIResponse = {
      raw: rawJson,
      parsed: { invalid: true },
    };
    const aiClient = createMockAiClient(invalidParsedResponse);
    const engine = new PBIReviewEngine(adapter, aiClient, { dryRun: true });

    const result = await engine.reviewPBI("12345");

    expect(result.title).toBe("Direct JSON Story");
    expect(result.invest_evaluation.independent).toBe("Good");
  });

  it("should include moscowTag and backlogPriority in the prompt if defined", async () => {
    const adapter = createMockAdapter([], {
      moscowTag: "Must",
      backlogPriority: 10,
    });
    const aiClient = createMockAiClient();
    const engine = new PBIReviewEngine(adapter, aiClient, { dryRun: false });

    await engine.reviewPBI("12345");

    expect(aiClient.executePrompt).toHaveBeenCalledWith(
      expect.stringContaining("MoSCoW Tag:** Must")
    );
    expect(aiClient.executePrompt).toHaveBeenCalledWith(
      expect.stringContaining("Backlog Priority:** 10")
    );
  });
});
