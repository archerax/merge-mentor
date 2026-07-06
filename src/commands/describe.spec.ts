import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { loadConfig, validateConfig } from "../config.js";
import { GitHubAdapter } from "../platforms/github.js";
import { ReviewEngine } from "../review/engine.js";
import { resolveReviewProfile } from "../review/reviewSelection.js";
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

vi.mock("../config.js", () => ({
  loadConfig: vi.fn(),
  validateConfig: vi.fn(),
}));

vi.mock("../platforms/github.js", () => {
  return {
    GitHubAdapter: vi.fn(function GitHubAdapter() {
      return mockAdapter;
    }),
  };
});

vi.mock("../platforms/azure.js", () => {
  return {
    AzureDevOpsAdapter: vi.fn(function AzureDevOpsAdapter() {
      return mockAdapter;
    }),
  };
});

vi.mock("../review/engine.js", () => {
  return {
    ReviewEngine: vi.fn(function ReviewEngine() {
      return { reviewPR: mockReviewPR, describePR: mockDescribePR };
    }),
  };
});

function createMockConfig(overrides: Partial<Config> = {}): Config {
  const {
    longContext = false,
    experimentalTools = false,
    verifyPbi = false,
    ...restOverrides
  } = overrides;
  const reviewType = overrides.reviewType ?? "general";
  const reviewProfile =
    overrides.reviewProfile ??
    resolveReviewProfile({
      reviewType,
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
});
