import { execSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { loadConfig } from "../config.js";
import { AzureDevOpsAdapter } from "../platforms/azure.js";
import { program } from "../program.js";
import { resolveReviewProfile } from "../review/reviewSelection.js";

// Mock dependencies
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

vi.mock("../review/pbiEngine.js", () => {
  return {
    PBIReviewEngine: vi.fn(function PBIReviewEngine() {
      return { reviewPBI: vi.fn().mockResolvedValue({ title: "Mock PBI" }) };
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

describe("pbi command", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(loadConfig).mockReturnValue(createMockConfig());
  });

  it("successfully reviews PBI in dry-run mode", async () => {
    vi.mocked(execSync).mockReturnValue("https://github.com/owner/repo.git\n");

    await program.parseAsync(["node", "test", "pbi", "12345"]);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("respects MM_PLATFORM environment variable when CLI option is not provided", async () => {
    vi.mocked(execSync).mockReturnValue("https://github.com/owner/repo.git\n");
    process.env.MM_PLATFORM = "azure";

    vi.mocked(loadConfig).mockImplementationOnce((cliOverrides) => {
      const overrides = cliOverrides as { platform?: string } | undefined;
      return createMockConfig({
        defaultPlatform: (overrides?.platform ?? "github") as "github" | "azure",
      });
    });

    await program.parseAsync(["node", "test", "pbi", "12345"]);

    expect(loadConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "azure",
      })
    );
    expect(AzureDevOpsAdapter).toHaveBeenCalled();

    delete process.env.MM_PLATFORM;
  });

  it("errors and exits when executePBIReview throws", async () => {
    const mockPbiEngine = await import("../review/pbiEngine.js");
    // biome-ignore lint/complexity/useArrowFunction: regular function required so it can be constructible when called with new
    vi.mocked(mockPbiEngine.PBIReviewEngine).mockImplementationOnce(function () {
      throw new Error("PBI Review Failed");
    });

    await program.parseAsync(["node", "test", "pbi", "12345"]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error: PBI Review Failed")
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
