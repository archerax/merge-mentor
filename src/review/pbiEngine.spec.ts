import { describe, expect, it, vi } from "vitest";
import type { AIProviderClient, AIResponse } from "../ai/types.js";
import type { PBIDetails, PlatformAdapter } from "../platforms/types.js";
import { PBIReviewEngine } from "./pbiEngine.js";

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
});
