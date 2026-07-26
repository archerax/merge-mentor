import { describe, expect, it, vi } from "vitest";
import type { AIProviderClient, TokenUsage } from "../ai/index.js";
import type {
  CrossFileReviewResult,
  PBIDetails,
  PlatformAdapter,
  PRFile,
} from "../platforms/types.js";
import { createCapturingOutputWriter } from "../ports/outputWriter.test-helper.js";
import { PbiVerifier } from "./pbiVerifier.js";

describe("PbiVerifier", () => {
  const mockPRFiles: PRFile[] = [
    {
      filename: "src/auth.ts",
      status: "modified",
      additions: 10,
      deletions: 2,
      patch: "@@ -1,2 +1,10 @@\n+const login = () => true;\n",
    },
  ];

  const mockBaseCrossFileResult: CrossFileReviewResult = {
    overallAssessment: "Base code review complete.",
    findings: [],
    recommendations: [],
  };

  function createMockPlatform(overrides?: Partial<PlatformAdapter>): PlatformAdapter {
    return {
      getProjectIdentifier: vi.fn().mockReturnValue("Hello-World"),
      getPlatformName: vi.fn().mockReturnValue("github"),
      getRepoInfo: vi
        .fn()
        .mockReturnValue({ owner: "octocat", repo: "Hello-World", platform: "github" }),
      getToken: vi.fn().mockReturnValue("token"),
      getPRDetails: vi.fn(),
      getPRFiles: vi.fn(),
      getExistingBotComments: vi.fn(),
      getCommentThread: vi.fn(),
      getUnresolvedCommentThreads: vi.fn(),
      postCommentReply: vi.fn(),
      resolveCommentThread: vi.fn(),
      postInlineComment: vi.fn(),
      postGeneralComment: vi.fn(),
      getLinkedPBIIds: vi.fn().mockResolvedValue([]),
      getPBIDetails: vi.fn(),
      getProjectDetails: vi.fn(),
      postPBIComment: vi.fn(),
      updatePRDetails: vi.fn(),
      ...overrides,
    };
  }

  function createMockAIProvider(overrides?: Partial<AIProviderClient>): AIProviderClient {
    return {
      executePrompt: vi.fn(),
      parseFileReview: vi.fn(),
      parseCrossFileReview: vi.fn(),
      parseBatchedFileReview: vi.fn(),
      parseFastReview: vi.fn(),
      ...overrides,
    };
  }

  it("adds warning when no linked PBIs are found", async () => {
    const platform = createMockPlatform({
      getLinkedPBIIds: vi.fn().mockResolvedValue([]),
    });
    const provider = createMockAIProvider();
    const output = createCapturingOutputWriter();
    const verifier = new PbiVerifier(platform, provider, output);

    const onTokenUsage = vi.fn();
    const result = await verifier.verifyPRAlignment(
      101,
      mockPRFiles,
      mockBaseCrossFileResult,
      onTokenUsage
    );

    expect(platform.getLinkedPBIIds).toHaveBeenCalledWith(101);
    expect(result.overallAssessment).toContain("No linked work items or issues found for this PR.");
    expect(output.output.some((entry) => entry.data.includes("No linked work items"))).toBe(true);
    expect(onTokenUsage).not.toHaveBeenCalled();
  });

  it("handles platform.getLinkedPBIIds error gracefully and appends warning", async () => {
    const platform = createMockPlatform({
      getLinkedPBIIds: vi.fn().mockRejectedValue(new Error("API rate limit")),
    });
    const provider = createMockAIProvider();
    const output = createCapturingOutputWriter();
    const verifier = new PbiVerifier(platform, provider, output);

    const onTokenUsage = vi.fn();
    const result = await verifier.verifyPRAlignment(
      102,
      mockPRFiles,
      mockBaseCrossFileResult,
      onTokenUsage
    );

    expect(result.overallAssessment).toContain("No linked work items or issues found for this PR.");
  });

  it("fetches PBI details, runs AI prompt, and appends verification report for linked items", async () => {
    const mockPbi: PBIDetails = {
      id: "PBI-55",
      platform: "github",
      title: "Implement Login Flow",
      description: "User should be able to log in securely.",
      acceptanceCriteria: "- Login function works",
      comments: [],
    };

    const tokenUsage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
    };

    const aiRawResponse = `\`\`\`json
{
  "pbiId": "PBI-55",
  "title": "Implement Login Flow",
  "metCriteria": ["Login function works"],
  "partialCriteria": [],
  "missingCriteria": [],
  "scopeCreep": [],
  "overallAssessment": "Criteria satisfied."
}
\`\`\``;

    const platform = createMockPlatform({
      getLinkedPBIIds: vi.fn().mockResolvedValue(["PBI-55"]),
      getPBIDetails: vi.fn().mockResolvedValue(mockPbi),
    });

    const provider = createMockAIProvider({
      executePrompt: vi.fn().mockResolvedValue({
        raw: aiRawResponse,
        parsed: {},
        tokenUsage,
      }),
    });

    const output = createCapturingOutputWriter();
    const verifier = new PbiVerifier(platform, provider, output);

    const onTokenUsage = vi.fn();
    const result = await verifier.verifyPRAlignment(
      103,
      mockPRFiles,
      mockBaseCrossFileResult,
      onTokenUsage
    );

    expect(platform.getPBIDetails).toHaveBeenCalledWith("PBI-55");
    expect(provider.executePrompt).toHaveBeenCalled();
    expect(onTokenUsage).toHaveBeenCalledWith(tokenUsage);
    expect(result.overallAssessment).toContain("Work Item Alignment Verification");
    expect(result.overallAssessment).toContain(
      "Work Item #PBI-55 Alignment Report: Implement Login Flow"
    );
    expect(result.overallAssessment).toContain("Criteria satisfied.");
  });

  it("handles error during PBI details fetch or verification for individual item gracefully", async () => {
    const platform = createMockPlatform({
      getLinkedPBIIds: vi.fn().mockResolvedValue(["PBI-999"]),
      getPBIDetails: vi.fn().mockRejectedValue(new Error("PBI Not Found")),
    });

    const provider = createMockAIProvider();
    const output = createCapturingOutputWriter();
    const verifier = new PbiVerifier(platform, provider, output, { verbose: true });

    const onTokenUsage = vi.fn();
    const result = await verifier.verifyPRAlignment(
      104,
      mockPRFiles,
      mockBaseCrossFileResult,
      onTokenUsage
    );

    expect(result.overallAssessment).toContain(
      "Failed to fetch or analyze alignment details for this work item."
    );
    expect(
      output.output.some((entry) =>
        entry.data.includes("Failed to fetch or verify work item #PBI-999")
      )
    ).toBe(true);
  });
});
