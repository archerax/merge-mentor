import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProviderClient, AIResponse } from "../ai/types.js";
import type { PBIDetails, PlatformAdapter } from "../platforms/types.js";
import { createStubGitClient } from "./gitClients/gitClient.test-helper.js";
import { PLAN_MARKDOWN_SIGNATURE, PlanEngine } from "./planEngine.js";

describe("PlanEngine", () => {
  let tempPath: string;

  beforeEach(() => {
    tempPath = mkdtempSync(join(tmpdir(), "plan-engine-spec-"));
  });

  afterEach(() => {
    rmSync(tempPath, { recursive: true, force: true });
  });

  const mockPbiDetails: PBIDetails = {
    id: "12345",
    platform: "azure",
    title: "Add plan mode",
    description: "Generate a phased implementation plan.",
    acceptanceCriteria: "Plan is saved and attachable.",
    storyPoints: 8,
    comments: [{ id: "1", body: "Please ground the plan in the repo." }],
  };

  const readyOutput = {
    status: "ready",
    title: "Add plan mode",
    phases: [
      {
        name: "Foundation",
        goal: "Add the config plumbing",
        tasks: [
          {
            description: "Add MM_AI_PLAN_MODEL to config",
            acceptance_criteria: "Config exposes aiPlanModel",
          },
        ],
      },
      {
        name: "Engine",
        goal: "Generate the plan",
        tasks: [],
      },
    ],
    assumptions: ["Azure DevOps only"],
    unresolved_questions: ["Should the base branch default?"],
    missing_information: [],
  };

  function createMockAdapter(overrides: Partial<PBIDetails> = {}): PlatformAdapter {
    return {
      getProjectIdentifier: vi.fn().mockReturnValue("test-project"),
      getPlatformName: vi.fn().mockReturnValue("azure"),
      getRepoInfo: vi.fn().mockReturnValue({ owner: "org", repo: "repo", platform: "azure" }),
      getToken: vi.fn().mockReturnValue("token"),
      getPRDetails: vi.fn(),
      getPRFiles: vi.fn(),
      getExistingBotComments: vi.fn(),
      getUnresolvedCommentThreads: vi.fn(),
      postInlineComment: vi.fn(),
      postGeneralComment: vi.fn(),
      getLinkedPBIIds: vi.fn(),
      getPBIDetails: vi.fn().mockResolvedValue({ ...mockPbiDetails, ...overrides }),
      getProjectDetails: vi.fn(),
      postPBIComment: vi.fn(),
      attachWorkItemFile: vi.fn(),
      updatePRDetails: vi.fn(),
      getCommentThread: vi.fn(),
      postCommentReply: vi.fn(),
      resolveCommentThread: vi.fn(),
    };
  }

  function createMockAi(response: AIResponse): AIProviderClient {
    return {
      executePrompt: vi.fn().mockResolvedValue(response),
      parseFileReview: vi.fn(),
      parseCrossFileReview: vi.fn(),
      parseBatchedFileReview: vi.fn(),
      parseFastReview: vi.fn(),
    } as unknown as AIProviderClient;
  }

  it("guards the dirty tree, switches, pulls, and generates a ready plan", async () => {
    const adapter = createMockAdapter();
    const gitClient = createStubGitClient();
    const ai = createMockAi({ raw: JSON.stringify(readyOutput), parsed: readyOutput });

    const engine = new PlanEngine(adapter, ai, gitClient, { tempPath, aiModel: "gpt-5.6-sol" });
    const result = await engine.generatePlan("12345", "main", "/repo");

    expect(gitClient.hasUncommittedChanges).toHaveBeenCalledWith("/repo");
    expect(gitClient.switchBranch).toHaveBeenCalledWith("/repo", "main");
    expect(gitClient.pull).toHaveBeenCalledWith("/repo", "main");
    expect(ai.executePrompt).toHaveBeenCalledWith(
      expect.stringContaining("Add plan mode"),
      expect.objectContaining({ workingDirectory: "/repo" })
    );

    expect(result.status).toBe("ready");
    expect(result.fileName).toBe("plan-12345-add-plan-mode.md");
    expect(result.markdown).toContain("# Implementation Plan — #12345 Add plan mode");
    expect(result.markdown).toContain("## Phase 1: Foundation");
    expect(result.markdown).toContain("- [ ] Add MM_AI_PLAN_MODEL to config");
    expect(result.markdown).toContain("  - Acceptance criteria: Config exposes aiPlanModel");
    expect(result.markdown).toContain("## Assumptions");
    expect(result.markdown).toContain(PLAN_MARKDOWN_SIGNATURE);

    const reportPath = join(tempPath, "reports", result.fileName);
    expect(existsSync(reportPath)).toBe(true);
    expect(readFileSync(reportPath, "utf-8")).toBe(result.markdown);
  });

  it("aborts when the working tree is dirty and --allow-dirty is not set", async () => {
    const adapter = createMockAdapter();
    const gitClient = createStubGitClient({
      hasUncommittedChanges: vi.fn().mockResolvedValue(true),
    });
    const ai = createMockAi({ raw: JSON.stringify(readyOutput), parsed: readyOutput });

    const engine = new PlanEngine(adapter, ai, gitClient, { tempPath });

    await expect(engine.generatePlan("12345", "main", "/repo")).rejects.toThrow(
      "uncommitted changes"
    );
    expect(gitClient.switchBranch).not.toHaveBeenCalled();
    expect(ai.executePrompt).not.toHaveBeenCalled();
  });

  it("proceeds on a dirty tree when --allow-dirty is set", async () => {
    const adapter = createMockAdapter();
    const gitClient = createStubGitClient({
      hasUncommittedChanges: vi.fn().mockResolvedValue(true),
    });
    const ai = createMockAi({ raw: JSON.stringify(readyOutput), parsed: readyOutput });

    const engine = new PlanEngine(adapter, ai, gitClient, { tempPath, allowDirty: true });
    await engine.generatePlan("12345", "main", "/repo");

    expect(gitClient.switchBranch).toHaveBeenCalledWith("/repo", "main");
  });

  it("renders an insufficient-information document without task checkboxes", async () => {
    const adapter = createMockAdapter();
    const gitClient = createStubGitClient();
    const insufficient = {
      status: "insufficient_information",
      title: "Add plan mode",
      phases: [],
      assumptions: [],
      unresolved_questions: [],
      missing_information: ["No acceptance criteria provided"],
    };
    const ai = createMockAi({ raw: JSON.stringify(insufficient), parsed: insufficient });

    const engine = new PlanEngine(adapter, ai, gitClient, { tempPath });
    const result = await engine.generatePlan("12345", "main", "/repo");

    expect(result.status).toBe("insufficient_information");
    expect(result.markdown).toContain("## Missing Information");
    expect(result.markdown).toContain("- No acceptance criteria provided");
    expect(result.markdown).not.toContain("- [ ]");
  });

  it("falls back to regex parsing when the provider does not return parsed JSON", async () => {
    const adapter = createMockAdapter();
    const gitClient = createStubGitClient();
    const raw = `Here is the plan:\n\`\`\`json\n${JSON.stringify(readyOutput)}\n\`\`\``;
    const ai = createMockAi({ raw, parsed: null });

    const engine = new PlanEngine(adapter, ai, gitClient, { tempPath });
    const result = await engine.generatePlan("12345", "main", "/repo");

    expect(result.status).toBe("ready");
    expect(result.planData.phases).toHaveLength(2);
  });
});
