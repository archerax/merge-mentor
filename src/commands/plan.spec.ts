import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { loadConfig } from "../config.js";
import { program } from "../program.js";
import { resolveReviewProfile } from "../review/reviewSelection.js";

const mockAdapter = {
  getProjectIdentifier: vi.fn(),
  getPlatformName: () => "azure" as const,
  getRepoInfo: vi.fn(),
  getToken: vi.fn(),
  getPRDetails: vi.fn(),
  getPRFiles: vi.fn(),
  getExistingBotComments: vi.fn(),
  getCommentThread: vi.fn(),
  getUnresolvedCommentThreads: vi.fn(),
  postCommentReply: vi.fn(),
  resolveCommentThread: vi.fn(),
  postInlineComment: vi.fn(),
  postGeneralComment: vi.fn(),
  getLinkedPBIIds: vi.fn(),
  getPBIDetails: vi.fn(),
  getProjectDetails: vi.fn(),
  postPBIComment: vi.fn(),
  attachWorkItemFile: vi.fn().mockResolvedValue(undefined),
  updatePRDetails: vi.fn(),
};

const mockGeneratePlan = vi.fn().mockResolvedValue({
  markdown: "# Plan",
  status: "ready",
  planData: { status: "ready", title: "t", phases: [] },
  fileName: "merge-mentor-plan-42.md",
});

vi.mock("../config.js", () => ({
  loadConfig: vi.fn(),
  validateConfig: vi.fn(),
}));

vi.mock("../platforms/azure.js", () => {
  return {
    AzureDevOpsAdapter: vi.fn(function AzureDevOpsAdapter() {
      return mockAdapter;
    }),
  };
});

vi.mock("../platforms/github.js", () => {
  return {
    GitHubAdapter: vi.fn(function GitHubAdapter() {
      return mockAdapter;
    }),
  };
});

vi.mock("../review/planEngine.js", () => {
  return {
    PlanEngine: vi.fn(function PlanEngine() {
      return { generatePlan: mockGeneratePlan };
    }),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

function createMockConfig(overrides: Partial<Config> = {}): Config {
  const {
    longContext = false,
    experimentalTools = false,
    verifyPbi = false,
    multiAgentMinConfidence = 0.7,
    multiAgentMaxParallel = 4,
    ...restOverrides
  } = overrides;
  const reviewType = overrides.reviewType ?? "general";
  const reviewProfile =
    overrides.reviewProfile ?? resolveReviewProfile({ reviewType, reviewStrategy: "fast" });

  return {
    defaultPlatform: "azure" as const,
    github: { token: "", owner: "", repo: "" },
    azure: { token: "az-token", org: "test-org", project: "test-project", repo: "test-repo" },
    botCommentIdentifier: "[merge-mentor]",
    aiProvider: "copilot-sdk",
    aiModel: "gpt-5.2-codex",
    aiPlanModel: "gpt-5.6-sol",
    gitBackend: "cli",
    skipPreExisting: true,
    reviewType,
    reviewPasses: reviewProfile.passes,
    reviewStrategy: reviewProfile.strategy,
    reviewProfile,
    streamingEnabled: true,
    streamingLines: 5,
    tempPath: "./.mergementor",
    longContext,
    experimentalTools,
    verifyPbi,
    multiAgentMinConfidence,
    multiAgentMaxParallel,
    ...restOverrides,
  };
}

describe("plan command", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MM_PLATFORM;
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(execSync).mockReturnValue("https://dev.azure.com/org/project/_git/repo\n");
    vi.mocked(loadConfig).mockReturnValue(createMockConfig());
    mockGeneratePlan.mockResolvedValue({
      markdown: "# Plan",
      status: "ready",
      planData: { status: "ready", title: "t", phases: [] },
      fileName: "merge-mentor-plan-42.md",
    });
    mockAdapter.attachWorkItemFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.MM_PLATFORM;
  });

  it("generates a plan and saves it locally in dry-run mode", async () => {
    await program.parseAsync(["node", "test", "plan", "42", "--base", "main"]);

    expect(loadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "azure", azureOrg: "org", azureProject: "project" })
    );
    expect(mockGeneratePlan).toHaveBeenCalledWith("42", "main", expect.any(String));
    expect(mockAdapter.attachWorkItemFile).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("attaches the plan to the work item with --write", async () => {
    await program.parseAsync(["node", "test", "plan", "42", "--base", "main", "--write"]);

    expect(mockAdapter.attachWorkItemFile).toHaveBeenCalledWith(
      "42",
      "merge-mentor-plan-42.md",
      "# Plan"
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("rejects a GitHub issue URL", async () => {
    await program.parseAsync([
      "node",
      "test",
      "plan",
      "--base",
      "main",
      "--url",
      "https://github.com/owner/repo/issues/1",
    ]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("only supports Azure DevOps")
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("errors and exits when the plan engine throws", async () => {
    mockGeneratePlan.mockRejectedValueOnce(new Error("Plan generation failed"));

    await program.parseAsync(["node", "test", "plan", "42", "--base", "main"]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error: Plan generation failed")
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
