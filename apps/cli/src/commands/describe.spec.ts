import type { Config } from "@merge-mentor/config/config.js";
import { loadConfig, validateConfig } from "@merge-mentor/config/config.js";
import { resolveReviewProfile } from "@merge-mentor/config/reviewSelection.js";
import { ReviewEngine } from "@merge-mentor/core/review/engine.js";
import { GitHubAdapter } from "@merge-mentor/platforms/github.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { displayDescribeResults, executeDescribe } from "./describe.js";
import type { DescribeOptions } from "./types.js";

// Mock dependencies
const mockReviewPR = vi.fn();
const mockDescribePR = vi.fn();
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
    GitHubAdapter: vi.fn(function GitHubAdapterMock() {
      return mockAdapter;
    }),
  };
});

vi.mock("@merge-mentor/platforms/azure.js", () => {
  return {
    AzureDevOpsAdapter: vi.fn(function AzureDevOpsAdapter() {
      return mockAdapter;
    }),
  };
});

vi.mock("@merge-mentor/core/review/engine.js", () => {
  return {
    ReviewEngine: vi.fn(function ReviewEngineMock() {
      return { reviewPR: mockReviewPR, describePR: mockDescribePR };
    }),
  };
});

function createMockConfig(overrides: Partial<Config> = {}): Config {
  const {
    longContext = false,
    experimentalTools = false,
    verifyPbi = false,
    multiAgentMaxParallel = 4,
    reviewRuns = 1,
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
    reviewRuns,
    ...restOverrides,
  };
}

describe("executeDescribe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockReturnValue(createMockConfig());
    vi.mocked(validateConfig).mockImplementation(() => {});
    mockDescribePR.mockResolvedValue({ title: "feat: add feature", body: "Description body" });
  });

  it("executes describe with default platform in dry-run mode", async () => {
    const options: DescribeOptions = {
      pr: 42,
      ci: false,
      write: false,
      suggestTitle: true,
    };

    const result = await executeDescribe(options);

    expect(loadConfig).toHaveBeenCalled();
    expect(validateConfig).toHaveBeenCalledWith(expect.any(Object), "github");
    expect(GitHubAdapter).toHaveBeenCalled();
    expect(ReviewEngine).toHaveBeenCalledWith(
      expect.any(Object),
      "[merge-mentor]",
      "copilot-sdk",
      expect.objectContaining({
        verbose: true,
      })
    );
    expect(mockDescribePR).toHaveBeenCalledWith({
      prNumber: 42,
      suggestTitle: true,
      write: false,
      streamingEnabled: true,
    });
    expect(result).toEqual({
      title: "feat: add feature",
      body: "Description body",
      adapter: expect.any(Object),
      platform: "github",
    });
  });

  it("throws when PR number is missing", async () => {
    const options: DescribeOptions = {
      ci: false,
    };
    await expect(executeDescribe(options)).rejects.toThrow("PR number is required");
  });

  it("rejects an unsupported platform", async () => {
    await expect(executeDescribe({ pr: 1, ci: false, platform: "gitlab" })).rejects.toThrow(
      'Invalid platform "gitlab"'
    );
  });

  it("rejects an unsupported AI provider", async () => {
    await expect(executeDescribe({ pr: 1, ci: false, provider: "nope" })).rejects.toThrow(
      'Invalid AI provider "nope"'
    );
  });

  it("uses the Azure adapter for the azure platform", async () => {
    const result = await executeDescribe({ pr: 7, ci: false, platform: "azure" });

    expect(result.platform).toBe("azure");
    expect(validateConfig).toHaveBeenCalledWith(expect.any(Object), "azure");
  });

  it("logs the BYOK URL when configured", async () => {
    vi.mocked(loadConfig).mockReturnValue(
      createMockConfig({ aiBaseUrl: "https://byok.example.com/v1" })
    );
    const log = vi.fn();

    await executeDescribe(
      { pr: 9, ci: false },
      { output: { log, error: vi.fn(), write: vi.fn() } }
    );

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("BYOK URL: https://byok.example.com/v1")
    );
  });
});

describe("displayDescribeResults", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("displays generated PR description details", () => {
    displayDescribeResults("feat: add feature", "Description body", false);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("PR Description Generation Complete")
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Suggested Title: feat: add feature")
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Description body"));
  });

  it("indicates when the description was written to the platform", () => {
    displayDescribeResults("feat: add feature", "Description body", true);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("PR details have been updated on the remote platform")
    );
  });
});
