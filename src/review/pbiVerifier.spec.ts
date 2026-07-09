import { describe, expect, it, vi } from "vitest";
import type { AIProviderClient } from "../ai/types.js";
import type { CrossFileReviewResult, PlatformAdapter, PRFile } from "../platforms/types.js";
import type { OutputWriter } from "../ports/index.js";
import { PbiVerifier } from "./pbiVerifier.js";

describe("PbiVerifier", () => {
  const createMockPlatform = (): PlatformAdapter => ({
    getProjectIdentifier: vi.fn(),
    getPlatformName: vi.fn(),
    getRepoInfo: vi.fn(),
    getToken: vi.fn(),
    getPRDetails: vi.fn(),
    getPRFiles: vi.fn(),
    getExistingBotComments: vi.fn(),
    getUnresolvedCommentThreads: vi.fn(),
    postInlineComment: vi.fn(),
    postGeneralComment: vi.fn(),
    getLinkedPBIIds: vi.fn().mockResolvedValue(["123"]),
    getPBIDetails: vi.fn().mockResolvedValue({
      id: "123",
      title: "Test PBI",
      description: "Test description",
      acceptanceCriteria: "Test AC",
    }),
    getProjectDetails: vi.fn(),
    postPBIComment: vi.fn(),
    updatePRDetails: vi.fn(),
    getCommentThread: vi.fn(),
    postCommentReply: vi.fn(),
    resolveCommentThread: vi.fn(),
  });

  const createMockProvider = (): AIProviderClient => ({
    executePrompt: vi.fn().mockResolvedValue({
      raw: JSON.stringify({
        pbiId: "123",
        title: "Test PBI",
        metCriteria: ["AC1"],
        partialCriteria: [{ criterion: "AC2", explanation: "Almost" }],
        missingCriteria: ["AC3"],
        scopeCreep: ["Creep"],
        overallAssessment: "Looks good overall",
      }),
      tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    }),
    parseFileReview: vi.fn(),
    parseCrossFileReview: vi.fn(),
    parseBatchedFileReview: vi.fn(),
    parseFastReview: vi.fn(),
  });

  const createMockOutput = (): OutputWriter => ({
    log: vi.fn(),
    error: vi.fn(),
    write: vi.fn(),
  });

  const files: PRFile[] = [
    {
      filename: "test.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: "@@ -1,1 +1,2 @@\n line 1\n+added line 2",
    },
  ];

  const crossFileResult: CrossFileReviewResult = {
    overallAssessment: "Initial assessment",
    findings: [],
    recommendations: [],
  };

  it("should prepend warning when no linked work items/issues are found", async () => {
    const platform = createMockPlatform();
    vi.mocked(platform.getLinkedPBIIds).mockResolvedValueOnce([]);

    const provider = createMockProvider();
    const output = createMockOutput();
    const verifier = new PbiVerifier(platform, provider, output);

    const onTokenUsage = vi.fn();
    const result = await verifier.verifyPRAlignment(1, files, crossFileResult, onTokenUsage);

    expect(result.overallAssessment).toContain("No linked work items or issues found for this PR");
    expect(provider.executePrompt).not.toHaveBeenCalled();
  });

  it("should run alignment verification and append reports successfully", async () => {
    const platform = createMockPlatform();
    const provider = createMockProvider();
    const output = createMockOutput();
    const verifier = new PbiVerifier(platform, provider, output);

    const onTokenUsage = vi.fn();
    const result = await verifier.verifyPRAlignment(1, files, crossFileResult, onTokenUsage);

    expect(platform.getLinkedPBIIds).toHaveBeenCalledWith(1);
    expect(platform.getPBIDetails).toHaveBeenCalledWith("123");
    expect(provider.executePrompt).toHaveBeenCalled();
    expect(onTokenUsage).toHaveBeenCalledWith({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
    expect(result.overallAssessment).toContain("Work Item Alignment Verification");
    expect(result.overallAssessment).toContain("Work Item #123 Alignment Report: Test PBI");
    expect(output.log).toHaveBeenCalledWith(
      "\n🔍 Verifying PR alignment with linked work items..."
    );
  });

  it("should handle error in getLinkedPBIIds gracefully", async () => {
    const platform = createMockPlatform();
    vi.mocked(platform.getLinkedPBIIds).mockRejectedValueOnce(new Error("Network Error"));

    const provider = createMockProvider();
    const output = createMockOutput();
    const verifier = new PbiVerifier(platform, provider, output);

    const onTokenUsage = vi.fn();
    const result = await verifier.verifyPRAlignment(1, files, crossFileResult, onTokenUsage);

    expect(result.overallAssessment).toContain("No linked work items or issues found for this PR");
  });

  it("should handle error in getPBIDetails/verification and log warnings gracefully", async () => {
    const platform = createMockPlatform();
    vi.mocked(platform.getPBIDetails).mockRejectedValueOnce(new Error("Failed to fetch PBI"));

    const provider = createMockProvider();
    const output = createMockOutput();
    const verifier = new PbiVerifier(platform, provider, output);

    const onTokenUsage = vi.fn();
    const result = await verifier.verifyPRAlignment(1, files, crossFileResult, onTokenUsage);

    expect(result.overallAssessment).toContain("Work Item Alignment Verification");
    expect(result.overallAssessment).toContain("Failed to fetch or analyze alignment details");
  });

  it("should not output logs when verbose option is false", async () => {
    const platform = createMockPlatform();
    vi.mocked(platform.getLinkedPBIIds).mockResolvedValueOnce([]);

    const provider = createMockProvider();
    const output = createMockOutput();
    const verifier = new PbiVerifier(platform, provider, output, { verbose: false });

    const onTokenUsage = vi.fn();
    await verifier.verifyPRAlignment(1, files, crossFileResult, onTokenUsage);

    expect(output.log).not.toHaveBeenCalled();
  });
});
