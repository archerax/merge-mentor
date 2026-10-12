import { execSync } from "node:child_process";

import type { Config } from "@merge-mentor/config/config.js";
import { loadConfig } from "@merge-mentor/config/config.js";
import { resolveReviewProfile } from "@merge-mentor/config/reviewSelection.js";
import { AzureDevOpsAdapter } from "@merge-mentor/platforms/azure.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { program } from "../program.js";
import { executePBIReview } from "./pbi.js";

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

vi.mock("@merge-mentor/core/review/pbiEngine.js", () => {
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

describe("pbi command", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MM_PLATFORM;
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(loadConfig).mockReturnValue(createMockConfig());
  });

  afterEach(() => {
    delete process.env.MM_PLATFORM;
  });

  it("successfully reviews PBI in dry-run mode", async () => {
    vi.mocked(execSync).mockReturnValue("https://github.com/owner/repo.git\n");

    await program.parseAsync(["node", "test", "pbi", "12345"]);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("respects MM_PLATFORM environment variable when CLI option is not provided", async () => {
    vi.mocked(execSync).mockReturnValue("https://github.com/owner/repo.git\n");
    process.env.MM_PLATFORM = "azure";

    try {
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
    } finally {
      delete process.env.MM_PLATFORM;
    }
  });

  it("resolves a GitHub issue URL", async () => {
    await program.parseAsync([
      "node",
      "test",
      "pbi",
      "--url",
      "https://github.com/url-owner/url-repo/issues/42",
    ]);

    expect(loadConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "github",
        githubRepoOwner: "url-owner",
        githubRepoName: "url-repo",
      })
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("supports an explicit --id", async () => {
    await program.parseAsync(["node", "test", "pbi", "--id", "42"]);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("rejects a URL combined with an explicit ID", async () => {
    await program.parseAsync([
      "node",
      "test",
      "pbi",
      "--id",
      "42",
      "--url",
      "https://github.com/owner/repo/issues/1",
    ]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("--url cannot be combined with --id")
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("errors and exits when executePBIReview throws", async () => {
    const mockPbiEngine = await import("@merge-mentor/core/review/pbiEngine.js");
    vi.mocked(mockPbiEngine.PBIReviewEngine).mockImplementationOnce(function () {
      throw new Error("PBI Review Failed");
    });

    await program.parseAsync(["node", "test", "pbi", "12345"]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error: PBI Review Failed")
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("auto-detects Azure context from the git remote", async () => {
    vi.mocked(execSync).mockReturnValue(
      "https://dev.azure.com/det-org/det-project/_git/det-repo\n"
    );
    vi.mocked(loadConfig).mockReturnValueOnce(createMockConfig({ defaultPlatform: "azure" }));

    await executePBIReview("42", {});

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

    await expect(executePBIReview("42", {})).rejects.toThrow('Invalid platform "gitlab"');
  });
});
