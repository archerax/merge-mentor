import { execSync } from "node:child_process";

import type { Config } from "@merge-mentor/config/config.js";
import { loadConfig } from "@merge-mentor/config/config.js";
import { resolveReviewProfile } from "@merge-mentor/config/reviewSelection.js";
import { AzureDevOpsAdapter } from "@merge-mentor/platforms/azure.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { program } from "../program.js";
import { executeProjectReview } from "./project.js";

// Mock dependencies
const mockAdapter = {
  getPRDetails: vi.fn(),
  getPRFiles: vi.fn(),
  getExistingBotComments: vi.fn(),
  postInlineComment: vi.fn(),
  postGeneralComment: vi.fn(),
  getPlatformName: () => "github" as const,
};

vi.mock("@merge-mentor/config/config.js", () => ({
  loadConfig: vi.fn(),
  validateConfig: vi.fn(),
}));

vi.mock("@merge-mentor/platforms/github.js", () => {
  return {
    GitHubAdapter: vi.fn(function GitHubAdapter() {
      return mockAdapter;
    }),
  };
});

vi.mock("@merge-mentor/platforms/azure.js", () => {
  return {
    AzureDevOpsAdapter: vi.fn(function AzureDevOpsAdapterMock() {
      return mockAdapter;
    }),
  };
});

vi.mock("@merge-mentor/core/review/projectEngine.js", () => {
  return {
    ProjectReviewEngine: vi.fn(function ProjectReviewEngine() {
      return { reviewProject: vi.fn().mockResolvedValue({ title: "Mock Project" }) };
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
    multiAgentMaxParallel = 4,
    ...restOverrides
  } = overrides;
  const reviewProfile =
    overrides.reviewProfile ??
    resolveReviewProfile({
      reviewPasses: overrides.reviewPasses,
      reviewStrategy: overrides.reviewStrategy,
    });

  return {
    defaultPlatform: "github" as const,
    github: { token: "gh-token", owner: "test-owner", repo: "test-repo" },
    azure: {
      token: "az-token",
      org: "test-org",
      project: "test-project",
      repo: "test-repo",
    },
    botCommentIdentifier: "[merge-mentor]",
    aiProvider: "copilot-sdk",
    aiModel: "claude-sonnet-4.6",
    gitBackend: "cli",
    skipPreExisting: true,
    reviewPasses: reviewProfile.passes,
    reviewStrategy: reviewProfile.strategy,
    reviewProfile,
    streamingEnabled: true,
    streamingLines: 5,
    tempPath: "./.mergementor",
    longContext,
    experimentalTools,
    verifyPbi,
    multiAgentMaxParallel,
    ...restOverrides,
  };
}

describe("project command", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.mocked(loadConfig).mockReturnValue(createMockConfig());
  });

  it("successfully reviews project in dry-run mode", async () => {
    vi.mocked(execSync).mockReturnValue("https://github.com/owner/repo.git\n");

    await program.parseAsync(["node", "test", "project", "12345"]);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("resolves an Azure work-item URL", async () => {
    await program.parseAsync([
      "node",
      "test",
      "project",
      "--url",
      "https://dev.azure.com/url-org/url-project/_workitems/edit/42",
      "--azure-repo",
      "url-repo",
    ]);

    expect(loadConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "azure",
        azureOrg: "url-org",
        azureProject: "url-project",
        azureRepo: "url-repo",
      })
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("auto-detects Azure context from the git remote", async () => {
    vi.mocked(execSync).mockReturnValue(
      "https://dev.azure.com/det-org/det-project/_git/det-repo\n"
    );
    vi.mocked(loadConfig).mockReturnValueOnce(createMockConfig({ defaultPlatform: "azure" }));

    await executeProjectReview("42", {});

    expect(loadConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        azureOrg: "det-org",
        azureProject: "det-project",
        azureRepo: "det-repo",
      })
    );
    expect(AzureDevOpsAdapter).toHaveBeenCalled();
  });

  it("rejects an invalid resolved platform", async () => {
    vi.mocked(loadConfig).mockReturnValueOnce({
      ...createMockConfig(),
      defaultPlatform: "gitlab",
    } as unknown as Config);

    await expect(executeProjectReview("42", {})).rejects.toThrow('Invalid platform "gitlab"');
  });
});
