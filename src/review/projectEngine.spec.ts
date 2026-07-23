import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProviderClient, AIResponse } from "../ai/types.js";
import type { PlatformAdapter, ProjectDetails } from "../platforms/types.js";
import { ProjectReviewEngine } from "./projectEngine.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: vi
      .fn()
      .mockImplementation((...args: Parameters<typeof actual.writeFileSync>) => {
        return actual.writeFileSync(...args);
      }),
  };
});

describe("ProjectReviewEngine", () => {
  let tempPath: string;

  beforeEach(() => {
    tempPath = mkdtempSync(join(tmpdir(), "project-engine-spec-"));
  });

  afterEach(() => {
    rmSync(tempPath, { recursive: true, force: true });
  });

  const mockProjectDetails: ProjectDetails = {
    rootId: "100",
    rootTitle: "Test Feature",
    rootType: "Feature",
    rootDescription: "High level epic feature description.",
    platform: "azure",
    workItems: [
      {
        id: "100",
        title: "Test Feature",
        type: "Feature",
        description: "High level epic feature description.",
        state: "New",
        normalizedState: "todo",
        comments: [],
      },
      {
        id: "101",
        title: "Child Story 1",
        type: "User Story",
        description: "Child description",
        state: "In Progress",
        normalizedState: "inprogress",
        comments: [],
      },
    ],
    dependencies: [
      {
        sourceId: "101",
        targetId: "100",
        type: "successor",
      },
    ],
  };

  const mockAiOutput = {
    title: "Test Feature",
    completeness_assessment: "Completeness feedback",
    dependency_risks: "Dependency feedback",
    acceptance_criteria_alignment: "AC feedback",
    estimation_consistency: "Estimation feedback",
    overall_assessment: "Good overall project review.",
    suggestions: ["Add more story details"],
  };

  const mockAiResponse: AIResponse = {
    raw: JSON.stringify(mockAiOutput),
    parsed: mockAiOutput,
  };

  const createMockAdapter = (
    rootComments: { id: number; body: string }[] = [],
    projectDetailsOverride?: Partial<ProjectDetails>
  ): PlatformAdapter => {
    const details = { ...mockProjectDetails, ...projectDetailsOverride };
    // inject comments on the root work item
    details.workItems = details.workItems.map((wi) => {
      if (wi.id === details.rootId) {
        return { ...wi, comments: rootComments };
      }
      return wi;
    });

    return {
      getProjectIdentifier: vi.fn().mockReturnValue("test-project"),
      getPlatformName: vi.fn().mockReturnValue("azure"),
      getRepoInfo: vi.fn().mockReturnValue({
        owner: "org",
        repo: "repo",
        platform: "azure",
        org: "org",
        project: "project",
      }),
      getToken: vi.fn().mockReturnValue("token"),
      getPRDetails: vi.fn(),
      getPRFiles: vi.fn(),
      getExistingBotComments: vi.fn(),
      getUnresolvedCommentThreads: vi.fn(),
      postInlineComment: vi.fn(),
      postGeneralComment: vi.fn(),
      getLinkedPBIIds: vi.fn(),
      getPBIDetails: vi.fn(),
      getProjectDetails: vi.fn().mockResolvedValue(details),
      postPBIComment: vi.fn(),
      updatePRDetails: vi.fn(),
    };
  };

  const createMockAiClient = (response: AIResponse = mockAiResponse): AIProviderClient => ({
    executePrompt: vi.fn().mockResolvedValue(response),
    parseFileReview: vi.fn(),
    parseCrossFileReview: vi.fn(),
    parseBatchedFileReview: vi.fn(),
    parseFastReview: vi.fn(),
  });

  it("should retrieve project, run AI review, and write comment (new comment)", async () => {
    const adapter = createMockAdapter();
    const aiClient = createMockAiClient();
    const engine = new ProjectReviewEngine(adapter, aiClient, { dryRun: false, tempPath });

    const result = await engine.reviewProject("100");

    expect(adapter.getProjectDetails).toHaveBeenCalledWith("100");
    expect(aiClient.executePrompt).toHaveBeenCalled();
    expect(result.title).toBe("Test Feature");
    expect(result.completeness_assessment).toBe("Completeness feedback");
    expect(result.dependency_risks).toBe("Dependency feedback");

    // Should post a new comment because no comment with signature was found on the root
    expect(adapter.postPBIComment).toHaveBeenCalledWith(
      "100",
      expect.stringContaining("<!-- merge-mentor-project-review -->")
    );
  });

  it("should retrieve project, run AI review, and overwrite existing comment if signature exists", async () => {
    const existingComments = [
      { id: 999, body: "Some user comment" },
      { id: 1000, body: "Old bot review <!-- merge-mentor-project-review -->" },
    ];
    const adapter = createMockAdapter(existingComments);
    const aiClient = createMockAiClient();
    const engine = new ProjectReviewEngine(adapter, aiClient, { dryRun: false, tempPath });

    await engine.reviewProject("100");

    // Should update existing comment 1000 instead of posting a new one
    expect(adapter.postPBIComment).toHaveBeenCalledWith(
      "100",
      expect.stringContaining("<!-- merge-mentor-project-review -->"),
      1000
    );
  });

  it("should skip writing comment when dryRun option is set", async () => {
    const adapter = createMockAdapter();
    const aiClient = createMockAiClient();
    const engine = new ProjectReviewEngine(adapter, aiClient, { dryRun: true, tempPath });

    await engine.reviewProject("100");

    expect(adapter.postPBIComment).not.toHaveBeenCalled();
  });

  it("should handle writeFileSync failure when saving report", async () => {
    const adapter = createMockAdapter();
    const aiClient = createMockAiClient();
    const engine = new ProjectReviewEngine(adapter, aiClient, { dryRun: true, tempPath });

    vi.mocked(writeFileSync).mockImplementationOnce(() => {
      throw new Error("Write failed");
    });

    // Should not throw, should handle error gracefully in catch block
    await expect(engine.reviewProject("100")).resolves.toBeDefined();
  });

  it("should handle schema drift and fallback to fallbackParse on invalid zod schema output", async () => {
    const adapter = createMockAdapter();
    const malformedOutput = {
      title: "Malformed Project",
      overall_assessment: "Invalid structure",
      suggestions: [],
    };
    const malformedResponse: AIResponse = {
      raw: JSON.stringify(malformedOutput),
      parsed: malformedOutput,
    };
    const aiClient = createMockAiClient(malformedResponse);
    const engine = new ProjectReviewEngine(adapter, aiClient, { dryRun: true, tempPath });

    const result = await engine.reviewProject("100");

    expect(result.title).toBe("Malformed Project");
    expect(result.completeness_assessment).toBe("");
    expect(result.overall_assessment).toBe("Invalid structure");
  });

  it("should return fully failing fallback structure when parsing completely fails", async () => {
    const adapter = createMockAdapter();
    const invalidParsedResponse: AIResponse = {
      raw: "This is completely invalid JSON text",
      parsed: { invalid: true },
    };
    const aiClient = createMockAiClient(invalidParsedResponse);
    const engine = new ProjectReviewEngine(adapter, aiClient, { dryRun: true, tempPath });

    const result = await engine.reviewProject("100");

    expect(result.title).toBe("Test Feature"); // Fallbacks to project title
    expect(result.overall_assessment).toBe("AI review failed to generate a parseable response.");
    expect(result.completeness_assessment).toBe("Failed to parse AI evaluation.");
  });

  it("should include moscowTag and backlogPriority in the prompt for work items if defined", async () => {
    const detailsOverride: Partial<ProjectDetails> = {
      workItems: [
        {
          id: "100",
          title: "Test Feature",
          type: "Feature",
          description: "High level epic feature description.",
          state: "New",
          normalizedState: "todo",
          comments: [],
          moscowTag: "Must",
          backlogPriority: 1.25,
        },
      ],
    };

    const adapter = createMockAdapter([], detailsOverride);
    const aiClient = createMockAiClient();
    const engine = new ProjectReviewEngine(adapter, aiClient, { dryRun: true, tempPath });

    await engine.reviewProject("100");

    expect(aiClient.executePrompt).toHaveBeenCalledWith(
      expect.stringContaining("MoSCoW Tag:** Must")
    );
    expect(aiClient.executePrompt).toHaveBeenCalledWith(
      expect.stringContaining("Backlog Priority:** 1.25")
    );
  });
});
