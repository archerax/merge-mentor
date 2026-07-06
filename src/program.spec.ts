import { execSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "./config.js";
import { loadConfig, validateConfig } from "./config.js";
import { program } from "./program.js";

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

vi.mock("./config.js", () => ({
  loadConfig: vi.fn(),
  validateConfig: vi.fn(),
}));

vi.mock("./platforms/github.js", () => {
  return {
    GitHubAdapter: vi.fn(function GitHubAdapter() {
      return mockAdapter;
    }),
  };
});

vi.mock("./platforms/azure.js", () => {
  return {
    AzureDevOpsAdapter: vi.fn(function AzureDevOpsAdapter() {
      return mockAdapter;
    }),
  };
});

vi.mock("./review/engine.js", () => {
  return {
    ReviewEngine: vi.fn(function ReviewEngine() {
      return { reviewPR: mockReviewPR, describePR: mockDescribePR };
    }),
  };
});

vi.mock("./review/pbiEngine.js", () => {
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

import { resolveReviewProfile } from "./review/reviewSelection.js";

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

describe("CLI Options & Parsing", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.mocked(loadConfig).mockReturnValue(createMockConfig());
    vi.mocked(validateConfig).mockImplementation(() => {});
    mockReviewPR.mockResolvedValue({
      prDetails: { number: 42, title: "Mock PR", author: "test" },
      fileResults: [],
      crossFileResult: { findings: [] },
    });
    mockDescribePR.mockResolvedValue({ title: "feat: add feature", body: "Description body" });
  });

  describe("review command option parsing", () => {
    it("parses --long-context option and forwards it to loadConfig", async () => {
      vi.mocked(loadConfig).mockReturnValue(createMockConfig());
      await program.parseAsync(["node", "test", "review", "--pr", "42", "--long-context"]);

      expect(loadConfig).toHaveBeenCalledWith(expect.objectContaining({ longContext: true }));
    });
  });

  describe("--pr-url", () => {
    it("resolves GitHub PR URL and populates correct options", async () => {
      await program.parseAsync([
        "node",
        "test",
        "review",
        "--pr-url",
        "https://github.com/test-owner/test-repo/pull/42",
        "--github-token",
        "gh-token",
      ]);

      expect(loadConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: "github",
          githubRepoOwner: "test-owner",
          githubRepoName: "test-repo",
        })
      );
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("resolves Azure DevOps PR URL and populates correct options", async () => {
      await program.parseAsync([
        "node",
        "test",
        "review",
        "--pr-url",
        "https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/123",
        "--azure-token",
        "az-token",
      ]);

      expect(loadConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: "azure",
          azureOrg: "myorg",
          azureProject: "myproject",
          azureRepo: "myrepo",
        })
      );
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("resolves Azure DevOps legacy visualstudio.com PR URL", async () => {
      await program.parseAsync([
        "node",
        "test",
        "review",
        "--pr-url",
        "https://oldorg.visualstudio.com/MyProject/_git/MyRepo/pullrequest/99",
        "--azure-token",
        "az-token",
      ]);

      expect(loadConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: "azure",
          azureOrg: "oldorg",
          azureProject: "MyProject",
          azureRepo: "MyRepo",
        })
      );
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("errors when --pr-url is combined with --ci", async () => {
      await program.parseAsync([
        "node",
        "test",
        "review",
        "--pr-url",
        "https://github.com/org/repo/pull/1",
        "--ci",
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("--pr-url cannot be combined with --ci")
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("errors when --pr-url is combined with --pr", async () => {
      await program.parseAsync([
        "node",
        "test",
        "review",
        "--pr-url",
        "https://github.com/org/repo/pull/1",
        "--pr",
        "99",
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("--pr-url cannot be combined with --pr")
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("errors when --pr-url is combined with --platform", async () => {
      await program.parseAsync([
        "node",
        "test",
        "review",
        "--pr-url",
        "https://github.com/org/repo/pull/1",
        "--platform",
        "azure",
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("--pr-url cannot be combined with --platform")
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("errors when --pr-url is combined with Azure-specific flags", async () => {
      await program.parseAsync([
        "node",
        "test",
        "review",
        "--pr-url",
        "https://github.com/org/repo/pull/1",
        "--azure-org",
        "someorg",
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("--pr-url cannot be combined with --azure-org")
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("errors when --pr-url is combined with GitHub-specific flags", async () => {
      await program.parseAsync([
        "node",
        "test",
        "review",
        "--pr-url",
        "https://dev.azure.com/org/proj/_git/repo/pullrequest/1",
        "--github-repo-owner",
        "someone",
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("--pr-url cannot be combined with --github-repo-owner")
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("errors when --pr-url is given an invalid URL", async () => {
      await program.parseAsync(["node", "test", "review", "--pr-url", "not-a-valid-url"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("is not a valid URL"));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("describe command", () => {
    it("successfully generates PR description in dry-run mode", async () => {
      vi.mocked(execSync).mockReturnValue("https://github.com/owner/repo.git\n");

      await program.parseAsync(["node", "test", "describe", "--pr", "42"]);

      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("errors and exits when executeDescribe throws", async () => {
      mockDescribePR.mockRejectedValueOnce(new Error("Describe Failed"));

      await program.parseAsync(["node", "test", "describe", "--pr", "42"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error: Describe Failed")
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
