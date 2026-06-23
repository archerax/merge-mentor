import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "./config.js";
import type { PlatformAdapter } from "./platforms/types.js";
import type { OutputWriter } from "./ports/outputWriter.js";
import { generateMarkdownReport } from "./program.js";
import type { ReviewResult } from "./review/engine.js";

const mockReviewPR = vi.fn();
const mockAdapter = {
  getPRDetails: vi.fn(),
  getPRFiles: vi.fn(),
  getExistingBotComments: vi.fn(),
  postInlineComment: vi.fn(),
  postGeneralComment: vi.fn(),
  getPlatformName: () => "github" as const,
};

// Mock dependencies with factory functions
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
      return { reviewPR: mockReviewPR };
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

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(),
    rmSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
// Import after mocks are set up
import { loadConfig, validateConfig } from "./config.js";
import { AzureDevOpsAdapter } from "./platforms/azure.js";
import { GitHubAdapter } from "./platforms/github.js";
import {
  displayResults,
  executeReview,
  hasCriticalIssues,
  program,
  type ReviewOptions,
} from "./program.js";
import { ReviewEngine } from "./review/engine.js";
import { resolveReviewProfile } from "./review/reviewSelection.js";

function createMockConfig(overrides: Partial<Config> = {}): Config {
  const { longContext = false, experimentalTools = false, ...restOverrides } = overrides;
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
    ...restOverrides,
  };
}

function createMockReviewResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    prDetails: {
      number: 42,
      title: "Test PR",
      description: "Test description",
      author: "testuser",
      baseBranch: "main",
      headBranch: "feature/test",
    },
    filesReviewed: 3,
    filesSkipped: 0,
    filesIgnored: 0,
    ignoredFiles: [],
    fileResults: [
      {
        filename: "file1.ts",
        findings: [
          {
            severity: "medium",
            confidence: "high",
            category: "quality",
            message: "Issue 1",
            line: 10,
            suggestion: "Fix it",
            reasoning: "This issue affects code quality.",
          },
        ],
      },
      {
        filename: "file2.ts",
        findings: [
          {
            severity: "low",
            confidence: "high",
            category: "quality",
            message: "Issue 2",
            line: 20,
            suggestion: "Improve",
            reasoning: "This could be improved for better readability.",
          },
        ],
      },
    ],
    crossFileResult: {
      overallAssessment: "Good",
      findings: [],
      recommendations: [],
    },
    commentsCreated: 2,
    commentErrors: [],
    linesAdded: 10,
    linesDeleted: 5,
    ...overrides,
  };
}

function createReviewOptions(overrides: Partial<ReviewOptions> = {}): ReviewOptions {
  return {
    pr: 42,
    ci: false,
    write: false,
    verbose: true,
    ...overrides,
  };
}

describe("CLI", () => {
  let _consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    _consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    vi.mocked(loadConfig).mockReturnValue(createMockConfig());
    vi.mocked(validateConfig).mockImplementation(() => {});
    mockReviewPR.mockResolvedValue(createMockReviewResult());
  });

  describe("executeReview", () => {
    it("executes review with default GitHub platform in dry-run mode", async () => {
      const options = createReviewOptions({
        write: false,
        verbose: true,
      });

      const result = await executeReview(options);

      expect(loadConfig).toHaveBeenCalled();
      expect(validateConfig).toHaveBeenCalledWith(expect.any(Object), "github");
      expect(GitHubAdapter).toHaveBeenCalled();
      expect(ReviewEngine).toHaveBeenCalledWith(
        expect.any(Object),
        "[merge-mentor]",
        "copilot-sdk",
        expect.objectContaining({
          dryRun: true,
          verbose: true,
          aiModel: "claude-sonnet-4.6",
        })
      );
      expect(mockReviewPR).toHaveBeenCalledWith(42);
      expect(result).toEqual({
        result: createMockReviewResult(),
        adapter: expect.any(Object),
        platform: "github",
      });
    });

    it("passes longContext to ReviewEngine when longContext option is specified", async () => {
      const options = createReviewOptions({
        longContext: true,
      });
      vi.mocked(loadConfig).mockReturnValue(createMockConfig({ longContext: true }));

      await executeReview(options);

      expect(ReviewEngine).toHaveBeenCalledWith(
        expect.any(Object),
        "[merge-mentor]",
        "copilot-sdk",
        expect.objectContaining({
          longContext: true,
        })
      );
    });

    it("passes reasoningEffort to ReviewEngine when reasoning option is specified", async () => {
      const options = createReviewOptions({
        reasoning: "high",
      });
      vi.mocked(loadConfig).mockReturnValue(createMockConfig({ reasoningEffort: "high" }));

      await executeReview(options);

      expect(ReviewEngine).toHaveBeenCalledWith(
        expect.any(Object),
        "[merge-mentor]",
        "copilot-sdk",
        expect.objectContaining({
          reasoningEffort: "high",
        })
      );
    });

    it("executes review with Azure platform", async () => {
      const options = createReviewOptions({
        platform: "azure",
        write: false,
        verbose: true,
      });

      await executeReview(options);

      expect(validateConfig).toHaveBeenCalledWith(expect.any(Object), "azure");
      expect(AzureDevOpsAdapter).toHaveBeenCalled();
      expect(GitHubAdapter).not.toHaveBeenCalled();
    });

    it("executes review in write mode", async () => {
      const options = createReviewOptions({
        write: true,
      });

      await executeReview(options);

      expect(ReviewEngine).toHaveBeenCalledWith(
        expect.any(Object),
        "[merge-mentor]",
        "copilot-sdk",
        expect.objectContaining({
          dryRun: false,
          verbose: true,
          aiModel: "claude-sonnet-4.6",
        })
      );
    });

    it("uses config default platform when not specified", async () => {
      vi.mocked(loadConfig).mockReturnValue(
        createMockConfig({ defaultPlatform: "azure" as const })
      );

      const options = createReviewOptions({
        write: false,
        verbose: true,
      });

      await executeReview(options);

      expect(validateConfig).toHaveBeenCalledWith(expect.any(Object), "azure");
      expect(AzureDevOpsAdapter).toHaveBeenCalled();
      expect(GitHubAdapter).not.toHaveBeenCalled();
    });

    it("throws error for invalid platform", async () => {
      const options = createReviewOptions({
        platform: "invalid",
        write: false,
        verbose: true,
      });

      await expect(executeReview(options)).rejects.toThrow(
        'Invalid platform "invalid". Must be "github" or "azure".'
      );
    });

    it("validates configuration for selected platform", async () => {
      const options = createReviewOptions({
        platform: "github",
        write: false,
        verbose: true,
      });

      await executeReview(options);

      expect(validateConfig).toHaveBeenCalledWith(expect.any(Object), "github");
    });

    it("creates GitHub adapter when platform is github", async () => {
      const options = createReviewOptions({
        platform: "github",
        write: false,
        verbose: true,
      });

      await executeReview(options);

      expect(GitHubAdapter).toHaveBeenCalledWith(createMockConfig());
    });

    it("creates Azure adapter when platform is azure", async () => {
      const options = createReviewOptions({
        platform: "azure",
        write: false,
        verbose: true,
      });

      await executeReview(options);

      expect(AzureDevOpsAdapter).toHaveBeenCalledWith(createMockConfig());
    });

    it("passes Azure-specific fields to loadConfig when using --pr-url parsed options", async () => {
      const options = createReviewOptions({
        platform: "azure",
        azureOrg: "parsed-org",
        azureProject: "parsed-project",
        azureRepo: "parsed-repo",
        azureToken: "parsed-token",
        write: false,
        verbose: true,
      });

      await executeReview(options);

      expect(loadConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: "azure",
          azureOrg: "parsed-org",
          azureProject: "parsed-project",
          azureRepo: "parsed-repo",
          azureToken: "parsed-token",
        })
      );
    });

    it("passes GitHub-specific fields to loadConfig when using --pr-url parsed options", async () => {
      const options = createReviewOptions({
        platform: "github",
        githubRepoOwner: "parsed-owner",
        githubRepoName: "parsed-repo",
        githubToken: "parsed-token",
        write: false,
        verbose: true,
      });

      await executeReview(options);

      expect(loadConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: "github",
          githubRepoOwner: "parsed-owner",
          githubRepoName: "parsed-repo",
          githubToken: "parsed-token",
        })
      );
    });

    it("logs starting message with dry-run label", async () => {
      const options = createReviewOptions({
        write: false,
        verbose: true,
      });

      await executeReview(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Starting code review for PR #42")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("(dry-run)"));
    });

    it("logs starting message without dry-run label in write mode", async () => {
      const options = createReviewOptions({
        write: true,
        verbose: true,
      });

      await executeReview(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Starting code review for PR #42")
      );
      const dryRunCalls = consoleLogSpy.mock.calls.filter((call: unknown[]) =>
        call[0]?.toString().includes("(dry-run)")
      );
      expect(dryRunCalls.length).toBe(0);
    });

    it("passes custom review passes through config and engine options", async () => {
      vi.mocked(loadConfig).mockReturnValue(
        createMockConfig({
          reviewType: "custom",
          reviewPasses: ["scan", "logic"],
        })
      );

      const options = createReviewOptions({
        write: false,
        verbose: true,
        reviewType: "custom",
        passes: "scan,logic",
      });

      await executeReview(options);

      expect(loadConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          reviewType: "custom",
          passes: "scan,logic",
        })
      );
      expect(ReviewEngine).toHaveBeenCalledWith(
        expect.any(Object),
        "[merge-mentor]",
        "copilot-sdk",
        expect.objectContaining({
          reviewType: "custom",
          reviewPasses: ["scan", "logic"],
          reviewStrategy: "fast",
        })
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Review:   Standard review + scan → logic")
      );
    });

    it("shows model in start banner when aiModel is set in config", async () => {
      vi.mocked(loadConfig).mockReturnValue(createMockConfig({ aiModel: "gpt-4o" }));

      await executeReview(createReviewOptions({ write: false, verbose: true }));

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Model:    gpt-4o"));
    });

    it("omits model from start banner when aiModel is not set", async () => {
      vi.mocked(loadConfig).mockReturnValue(createMockConfig({ aiModel: undefined }));

      await executeReview(createReviewOptions({ write: false, verbose: true }));

      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining("Model:"));
    });

    it("shows BYOK URL in start banner when aiBaseUrl is set", async () => {
      vi.mocked(loadConfig).mockReturnValue(
        createMockConfig({ aiBaseUrl: "https://my-byok.example.com/v1" })
      );

      await executeReview(createReviewOptions({ write: false, verbose: true }));

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("BYOK URL: https://my-byok.example.com/v1")
      );
    });

    it("omits BYOK URL from start banner when aiBaseUrl is not set", async () => {
      vi.mocked(loadConfig).mockReturnValue(createMockConfig({ aiBaseUrl: undefined }));

      await executeReview(createReviewOptions({ write: false, verbose: true }));

      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining("BYOK URL:"));
    });

    it("passes skipPreExisting config to ReviewEngine", async () => {
      const customConfig = createMockConfig({
        skipPreExisting: false,
      });
      vi.mocked(loadConfig).mockReturnValue(customConfig);

      const options = createReviewOptions({
        write: false,
        verbose: true,
      });

      await executeReview(options);

      expect(ReviewEngine).toHaveBeenCalledWith(
        expect.any(Object),
        "[merge-mentor]",
        "copilot-sdk",
        expect.objectContaining({
          skipPreExisting: false,
        })
      );
    });

    it("uses opencode-sdk provider when specified via --provider", async () => {
      vi.mocked(loadConfig).mockReturnValue(
        createMockConfig({
          aiModel: "claude-4.5-sonnet",
          aiTimeoutMs: 120000,
        })
      );

      const options = createReviewOptions({
        provider: "opencode-sdk",
        write: false,
        verbose: true,
      });

      await executeReview(options);

      expect(ReviewEngine).toHaveBeenCalledWith(
        expect.any(Object),
        "[merge-mentor]",
        "opencode-sdk",
        expect.objectContaining({
          aiModel: "claude-4.5-sonnet",
          aiTimeoutMs: 120000,
        })
      );
    });

    it("passes Copilot SDK BYOK settings to ReviewEngine", async () => {
      vi.mocked(loadConfig).mockReturnValue(
        createMockConfig({
          aiProvider: "copilot-sdk",
          aiModel: "gpt-5.2-codex",
          aiBaseUrl: "https://bedrock.example.com/openai/v1",
          aiApiKey: "bedrock-key",
        })
      );

      const options = createReviewOptions({
        write: false,
        verbose: true,
      });

      await executeReview(options);

      expect(ReviewEngine).toHaveBeenCalledWith(
        expect.any(Object),
        "[merge-mentor]",
        "copilot-sdk",
        expect.objectContaining({
          aiModel: "gpt-5.2-codex",
          aiBaseUrl: "https://bedrock.example.com/openai/v1",
          aiApiKey: "bedrock-key",
        })
      );
    });

    it("throws error for invalid provider", async () => {
      const options = createReviewOptions({
        provider: "invalid",
        write: false,
        verbose: true,
      });

      await expect(executeReview(options)).rejects.toThrow(
        'Invalid AI provider "invalid". Must be "copilot-sdk", "opencode-sdk", or "claude-agent-sdk".'
      );
    });

    describe("CI mode", () => {
      function createStubEnv(vars: Record<string, string>) {
        return { get: (key: string) => vars[key] };
      }

      const githubEnv = {
        GITHUB_ACTIONS: "true",
        GITHUB_TOKEN: "gha-token",
        GITHUB_REPOSITORY: "myorg/myrepo",
        GITHUB_REF: "refs/pull/7/merge",
        GITHUB_WORKSPACE: "/home/runner/work/myrepo/myrepo",
      };

      const azureEnv = {
        TF_BUILD: "True",
        SYSTEM_ACCESSTOKEN: "build-service-token",
        SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: "https://dev.azure.com/myorg/",
        SYSTEM_TEAMPROJECT: "myproject",
        BUILD_REPOSITORY_NAME: "myrepo",
        SYSTEM_PULLREQUEST_PULLREQUESTID: "7",
        BUILD_SOURCESDIRECTORY: "/home/vsts/work/1/s",
      };

      it("detects GitHub Actions and resolves PR from GITHUB_REF", async () => {
        const options = createReviewOptions({ ci: true, pr: undefined });

        await executeReview(options, { env: createStubEnv(githubEnv) });

        expect(loadConfig).toHaveBeenCalledWith(
          expect.objectContaining({ githubToken: "gha-token" })
        );
      });

      it("defaults write to true in CI mode", async () => {
        const options = createReviewOptions({
          ci: true,
          pr: undefined,
          write: undefined,
        });

        await executeReview(options, { env: createStubEnv(githubEnv) });

        expect(ReviewEngine).toHaveBeenCalledWith(
          expect.any(Object),
          expect.any(String),
          expect.any(String),
          expect.objectContaining({ dryRun: false })
        );
      });

      it("respects explicit --no-write in CI mode", async () => {
        const options = createReviewOptions({
          ci: true,
          pr: undefined,
          write: false,
        });

        await executeReview(options, { env: createStubEnv(githubEnv) });

        expect(ReviewEngine).toHaveBeenCalledWith(
          expect.any(Object),
          expect.any(String),
          expect.any(String),
          expect.objectContaining({ dryRun: true })
        );
      });

      it("auto-detects Azure platform from CI environment without --platform flag", async () => {
        const options = createReviewOptions({ ci: true, pr: undefined });

        await executeReview(options, { env: createStubEnv(azureEnv) });

        expect(loadConfig).toHaveBeenCalledWith(expect.objectContaining({ platform: "azure" }));
      });

      it("MM_AZURE_TOKEN takes priority over SYSTEM_ACCESSTOKEN", async () => {
        const options = createReviewOptions({
          ci: true,
          pr: undefined,
          platform: "azure",
        });
        const env = createStubEnv({ ...azureEnv, MM_AZURE_TOKEN: "my-pat" });

        await executeReview(options, { env });

        expect(loadConfig).toHaveBeenCalledWith(expect.objectContaining({ azureToken: "my-pat" }));
      });

      it("falls back to SYSTEM_ACCESSTOKEN when MM_AZURE_TOKEN is not set", async () => {
        const options = createReviewOptions({
          ci: true,
          pr: undefined,
          platform: "azure",
        });

        await executeReview(options, { env: createStubEnv(azureEnv) });

        expect(loadConfig).toHaveBeenCalledWith(
          expect.objectContaining({ azureToken: "build-service-token" })
        );
      });

      it("throws when --ci is set but no CI environment is detected", async () => {
        const options = createReviewOptions({ ci: true, pr: undefined });

        await expect(executeReview(options, { env: createStubEnv({}) })).rejects.toThrow(
          "--ci flag was set but no supported CI environment was detected"
        );
      });

      it("passes CI workspace path through to engine options", async () => {
        const options = createReviewOptions({ ci: true, pr: undefined });

        await executeReview(options, { env: createStubEnv(githubEnv) });

        expect(ReviewEngine).toHaveBeenCalledWith(
          expect.any(Object),
          expect.any(String),
          expect.any(String),
          expect.objectContaining({
            localWorkspacePath: "/home/runner/work/myrepo/myrepo",
          })
        );
      });

      it("throws when CI is detected but PR number cannot be resolved", async () => {
        const options = createReviewOptions({ ci: true, pr: undefined });
        const env = createStubEnv({
          GITHUB_ACTIONS: "true",
          GITHUB_TOKEN: "t",
          GITHUB_REPOSITORY: "o/r",
        });

        await expect(executeReview(options, { env })).rejects.toThrow(
          "could not determine PR number"
        );
      });
    });
  });

  describe("displayResults", () => {
    it("displays comprehensive review summary", () => {
      const result = createMockReviewResult();

      displayResults(result, true);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Review Complete"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("PR: #42 - Test PR"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Author: testuser"));
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Branch: feature/test → main")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Files Reviewed: 3"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Total Issues Found: 2"));
    });

    it("displays dry-run specific output", () => {
      const result = createMockReviewResult();

      displayResults(result, true);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Dry-run mode - showing what would be posted")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Comments to Create: 2"));
    });

    it("generates markdown report in dry-run mode with AI provider", () => {
      const result = createMockReviewResult();
      const mockAdapterWithId = {
        ...mockAdapter,
        getProjectIdentifier: () => "test-owner-test-repo",
      };

      displayResults(
        result,
        true,
        mockAdapterWithId as unknown as PlatformAdapter,
        "github",
        "copilot-sdk"
      );

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Detailed markdown report generated:")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Github-test-owner-test-repo-PR42-review-profile-report.md")
      );
    });

    it("displays write mode specific output", () => {
      const result = createMockReviewResult();

      displayResults(result, false);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Comments Created: 2"));
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Dry-run mode - showing what would be posted")
      );
    });

    it("generates markdown report in write mode with AI provider", () => {
      const result = createMockReviewResult();
      const mockAdapterWithId = {
        ...mockAdapter,
        getProjectIdentifier: () => "test-owner-test-repo",
      };

      displayResults(
        result,
        false,
        mockAdapterWithId as unknown as PlatformAdapter,
        "github",
        "copilot-sdk"
      );

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Detailed markdown report generated:")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Github-test-owner-test-repo-PR42-review-profile-report.md")
      );
    });

    it("handles errors when generating markdown report", () => {
      const result = createMockReviewResult();
      const mockAdapterWithId = {
        ...mockAdapter,
        getProjectIdentifier: () => "test-owner-test-repo",
      };

      // Mock the output writer
      const mockOutput = {
        log: vi.fn(),
        error: vi.fn(),
        write: vi.fn(),
      };

      const mockDeps = {
        output: mockOutput,
      };

      // Make mkdirSync throw an error to trigger the catch block
      vi.mocked(mkdirSync).mockImplementationOnce(() => {
        throw new Error("Permission denied");
      });

      displayResults(
        result,
        true,
        mockAdapterWithId as unknown as PlatformAdapter,
        "github",
        "copilot-sdk",
        "general",
        undefined,
        "deep",
        undefined,
        mockDeps as { output?: OutputWriter }
      );

      expect(mockOutput.log).toHaveBeenCalledWith(
        expect.stringContaining("Failed to generate markdown report")
      );
    });

    it("displays comment errors in write mode", () => {
      const result = createMockReviewResult({
        commentErrors: ["Failed to post comment on line 10", "Network error"],
      });

      displayResults(result, false);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Comment Errors: 2"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to post comment"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Network error"));
    });

    it("does not display comment errors when empty", () => {
      const result = createMockReviewResult();

      displayResults(result, false);

      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining("Comment Errors"));
    });

    it("calculates total issues correctly", () => {
      const result = createMockReviewResult({
        fileResults: [
          {
            filename: "file1.ts",
            findings: [
              {
                severity: "critical",
                confidence: "high",
                category: "security",
                message: "Issue 1",
                line: 1,
                suggestion: "Fix",
                reasoning: "Critical security issue that needs immediate attention.",
              },
              {
                severity: "high",
                confidence: "high",
                category: "quality",
                message: "Issue 2",
                line: 2,
                suggestion: "Fix",
                reasoning: "High priority quality issue.",
              },
            ],
          },
          {
            filename: "file2.ts",
            findings: [
              {
                severity: "medium",
                confidence: "high",
                category: "quality",
                message: "Issue 3",
                line: 3,
                suggestion: "Fix",
                reasoning: "Medium priority quality issue.",
              },
            ],
          },
        ],
      });

      displayResults(result, true);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Total Issues Found: 3"));
    });

    it("includes cross-file issues in total issues count", () => {
      const result = createMockReviewResult({
        fileResults: [
          {
            filename: "file1.ts",
            findings: [
              {
                severity: "medium",
                confidence: "high",
                category: "quality",
                message: "File issue",
                line: 1,
                suggestion: "Fix",
                reasoning: "A file-level issue.",
              },
            ],
          },
        ],
        crossFileResult: {
          overallAssessment: "Issues found",
          findings: [
            {
              severity: "high",
              confidence: "high",
              category: "security",
              message: "Cross-file issue",
              reasoning: "A cross-file issue.",
              affectedFiles: ["file1.ts", "file2.ts"],
            },
          ],
          recommendations: [],
        },
      });

      displayResults(result, true);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Total Issues Found: 2"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("File-specific: 1"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Cross-file: 1"));
    });

    it("does not display cross-file breakdown when there are no cross-file issues", () => {
      const result = createMockReviewResult();

      displayResults(result, true);

      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining("File-specific:"));
      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining("Cross-file:"));
    });

    it("displays lines changed in summary", () => {
      const result = createMockReviewResult({
        linesAdded: 42,
        linesDeleted: 7,
      });

      displayResults(result, true);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Lines Changed: +42 / -7")
      );
    });

    it("shows custom review passes when provided", () => {
      const result = createMockReviewResult();

      displayResults(result, true, undefined, undefined, undefined, "custom", ["scan", "logic"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Review Profile: Standard review + scan → logic")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Review Passes: scan → logic")
      );
    });

    it("displays files skipped when present", () => {
      const result = createMockReviewResult({
        filesSkipped: 2,
      });

      displayResults(result, true);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Files Skipped: 2"));
    });

    it("displays ignored files with list when present", () => {
      const result = createMockReviewResult({
        filesIgnored: 2,
        ignoredFiles: ["node_modules/package.json", ".git/config"],
      });

      displayResults(result, true);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Files Ignored: 2"));
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("node_modules/package.json")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(".git/config"));
    });

    it("displays review strategy when not fast", () => {
      const result = createMockReviewResult();

      displayResults(result, true, undefined, undefined, undefined, "general", undefined, "deep");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Review Strategy: deep"));
    });

    it("does not display review strategy when fast", () => {
      const result = createMockReviewResult();

      displayResults(result, true, undefined, undefined, undefined, "general", undefined, "fast");

      // Check that we don't log the strategy
      const calls = consoleLogSpy.mock.calls.map((call: unknown[]) => String(call[0]));
      const strategyCall = calls.find((c: string) => c.includes("Review Strategy:"));
      expect(strategyCall).toBeUndefined();
    });
  });

  describe("hasCriticalIssues", () => {
    it("returns true when critical issues exist", () => {
      const result = createMockReviewResult({
        fileResults: [
          {
            filename: "file1.ts",
            findings: [
              {
                severity: "critical",
                confidence: "high",
                category: "security",
                message: "Critical issue",
                line: 10,
                suggestion: "Fix now",
                reasoning: "This is a critical security vulnerability.",
              },
            ],
          },
        ],
      });

      expect(hasCriticalIssues(result)).toBe(true);
    });

    it("returns false when no critical issues exist", () => {
      const result = createMockReviewResult({
        fileResults: [
          {
            filename: "file1.ts",
            findings: [
              {
                severity: "high",
                confidence: "high",
                category: "quality",
                message: "High issue",
                line: 10,
                suggestion: "Fix",
                reasoning: "High priority issue.",
              },
              {
                severity: "medium",
                confidence: "high",
                category: "quality",
                message: "Medium issue",
                line: 20,
                suggestion: "Fix",
                reasoning: "Medium priority issue.",
              },
            ],
          },
        ],
      });

      expect(hasCriticalIssues(result)).toBe(false);
    });

    it("returns false when no findings exist", () => {
      const result = createMockReviewResult({
        fileResults: [
          {
            filename: "file1.ts",
            findings: [],
          },
        ],
      });

      expect(hasCriticalIssues(result)).toBe(false);
    });

    it("returns false when fileResults is empty", () => {
      const result = createMockReviewResult({
        fileResults: [],
      });

      expect(hasCriticalIssues(result)).toBe(false);
    });

    it("returns false when only cross-file findings have critical issues", () => {
      // Note: Current implementation only checks fileResults, not crossFileResult
      const result = createMockReviewResult({
        fileResults: [],
        crossFileResult: {
          overallAssessment: "Has critical issues",
          findings: [
            {
              severity: "critical",
              confidence: "high",
              category: "architecture",
              message: "Critical cross-file issue",
              reasoning: "Multiple modules are tightly coupled in a problematic way.",
              affectedFiles: ["file1.ts", "file2.ts"],
            },
          ],
          recommendations: [],
        },
      });

      expect(hasCriticalIssues(result)).toBe(false);
    });

    it("returns true when critical issues exist among multiple files", () => {
      const result = createMockReviewResult({
        fileResults: [
          {
            filename: "file1.ts",
            findings: [
              {
                severity: "medium",
                confidence: "high",
                category: "quality",
                message: "Medium",
                line: 1,
                suggestion: "Fix",
                reasoning: "Medium priority issue.",
              },
            ],
          },
          {
            filename: "file2.ts",
            findings: [
              {
                severity: "critical",
                confidence: "high",
                category: "security",
                message: "Critical",
                line: 2,
                suggestion: "Fix",
                reasoning: "Critical security vulnerability.",
              },
            ],
          },
          {
            filename: "file3.ts",
            findings: [
              {
                severity: "low",
                confidence: "high",
                category: "quality",
                message: "Low",
                line: 3,
                suggestion: "Fix",
                reasoning: "Low priority issue.",
              },
            ],
          },
        ],
      });

      expect(hasCriticalIssues(result)).toBe(true);
    });
  });

  describe("generateMarkdownReport", () => {
    it("generates a complete markdown report", () => {
      const result = createMockReviewResult({
        prDetails: {
          number: 123, // Override to use 123 for this specific test
          title: "Test PR",
          author: "test-author",
          headBranch: "feature/test",
          baseBranch: "main",
          description: "Test description",
        },
        filesReviewed: 2,
        filesSkipped: 1,
        fileResults: [
          {
            filename: "test.ts",
            findings: [
              {
                line: 10,
                severity: "high",
                confidence: "high",
                category: "bug",
                message: "Potential null pointer exception",
                suggestion: "Add null check",
                reasoning: "The variable may be null at this point and is not checked.",
              },
            ],
          },
        ],
        crossFileResult: {
          overallAssessment: "Code quality looks good overall",
          findings: [
            {
              severity: "medium",
              confidence: "high",
              category: "architecture",
              message: "Consider extracting common logic",
              reasoning: "Similar logic appears in multiple files.",
              affectedFiles: ["file1.ts", "file2.ts"],
            },
          ],
          recommendations: ["Use consistent naming", "Add more tests"],
        },
      });

      const report = generateMarkdownReport(result, "copilot-sdk", true);

      expect(report).toContain("# Code Review Report - PR #123");
      expect(report).toContain("**PR Title:** Test PR");
      expect(report).toContain("**Author:** test-author");
      expect(report).toContain("**AI Provider:** copilot-sdk");
      expect(report).toContain("- **Files Reviewed:** 2");
      expect(report).toContain("- **Files Skipped:** 1");
      expect(report).toContain("- **Total Issues Found:** 2");
      expect(report).toContain("## 📊 Review Summary");
      expect(report).toContain("### 📝 Planned Actions (Dry-Run)");
      expect(report).toContain("### Issues by Severity");
      expect(report).toContain("🟠 **High:** 1");
      expect(report).toContain("🟡 **Medium:** 1");
      expect(report).toContain("### Issues by Category");
      expect(report).toContain("🐛 **Bug:** 1");
      expect(report).toContain("🏗️ **Architecture:** 1");
      expect(report).toContain("## 📁 File-Specific Issues");
      expect(report).toContain("### `test.ts`");
      expect(report).toContain("#### 1. Line 10 🟠 🐛");
      expect(report).toContain("**Severity:** HIGH");
      expect(report).toContain("**Category:** bug");
      expect(report).toContain("**Issue:** Potential null pointer exception");
      expect(report).toContain("**Suggestion:** Add null check");
      expect(report).toContain("## 🔗 Cross-File Issues");
      expect(report).toContain("### 1. 🟡 🏗️ ARCHITECTURE");
      expect(report).toContain("**Affected Files:** `file1.ts`, `file2.ts`");
      expect(report).toContain("## 🎯 Overall Assessment");
      expect(report).toContain("Code quality looks good overall");
      expect(report).toContain("## 💡 Recommendations");
      expect(report).toContain("1. Use consistent naming");
      expect(report).toContain("2. Add more tests");
    });

    it("handles empty results gracefully", () => {
      const result = createMockReviewResult({
        fileResults: [],
        crossFileResult: {
          overallAssessment: "",
          findings: [],
          recommendations: [],
        },
      });

      const report = generateMarkdownReport(result, "opencode-sdk", true);

      expect(report).toContain("# Code Review Report - PR #42"); // Use the actual PR number from mock
      expect(report).toContain("**AI Provider:** opencode-sdk");
      expect(report).toContain("- **Total Issues Found:** 0");
      expect(report).not.toContain("## 📁 File-Specific Issues");
      expect(report).not.toContain("## 🔗 Cross-File Issues");
      expect(report).not.toContain("## 🎯 Overall Assessment");
      expect(report).not.toContain("## 💡 Recommendations");
    });

    it("generates a report with correct header for non-dry-run mode", () => {
      const result = createMockReviewResult({});
      const report = generateMarkdownReport(result, "copilot-sdk", false);

      expect(report).toContain("### 📝 Review Actions");
      expect(report).not.toContain("### 📝 Planned Actions (Dry-Run)");
    });

    it("includes custom review passes in the report header", () => {
      const result = createMockReviewResult({});
      const report = generateMarkdownReport(result, "copilot-sdk", true, "custom", [
        "scan",
        "performance",
      ]);

      expect(report).toContain("**Review Profile:** Standard review + scan → performance");
      expect(report).toContain("**Review Passes:** scan → performance");
    });
  });

  describe("repos command", () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      vi.mocked(mkdirSync).mockReturnValue(undefined);
      vi.mocked(readdirSync).mockReturnValue([]);
      vi.mocked(loadConfig).mockReturnValue(createMockConfig());
    });

    it("shows usage help when no options are specified", async () => {
      await program.parseAsync(["node", "test", "repos"]);

      expect(mkdirSync).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Usage: merge-mentor repos [options]")
      );
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("lists empty repos when no repositories exist", async () => {
      vi.mocked(readdirSync).mockReturnValue([]);

      await program.parseAsync(["node", "test", "repos", "--list"]);

      expect(consoleLogSpy).toHaveBeenCalledWith("No cloned repositories found.");
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("lists existing repositories with details", async () => {
      const mockDate = new Date("2024-01-15T10:30:00Z");
      vi.mocked(readdirSync).mockReturnValue(["repo-a", "repo-b"] as unknown as ReturnType<
        typeof readdirSync
      >);
      vi.mocked(statSync).mockReturnValue({
        isDirectory: () => true,
        mtime: mockDate,
      } as unknown as ReturnType<typeof statSync>);

      await program.parseAsync(["node", "test", "repos", "--list"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cloned repositories (2)")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("repo-a"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("repo-b"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(mockDate.toISOString()));
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("reports no repos to clean when directory is empty", async () => {
      vi.mocked(readdirSync).mockReturnValue([]);

      await program.parseAsync(["node", "test", "repos", "--clean"]);

      expect(consoleLogSpy).toHaveBeenCalledWith("No cloned repositories to clean.");
      expect(rmSync).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("cleans all repositories", async () => {
      vi.mocked(readdirSync).mockReturnValue(["repo-x", "repo-y"] as unknown as ReturnType<
        typeof readdirSync
      >);
      vi.mocked(statSync).mockReturnValue({
        isDirectory: () => true,
      } as unknown as ReturnType<typeof statSync>);

      await program.parseAsync(["node", "test", "repos", "--clean"]);

      expect(rmSync).toHaveBeenCalledTimes(2);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Removed: repo-x"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Removed: repo-y"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Cleaned 2 repositories"));
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("removes a specific repository with --clean-repo", async () => {
      vi.mocked(statSync).mockReturnValue({
        isDirectory: () => true,
      } as unknown as ReturnType<typeof statSync>);

      await program.parseAsync(["node", "test", "repos", "--clean-repo", "my-repo"]);

      expect(rmSync).toHaveBeenCalledWith(expect.stringContaining("my-repo"), {
        recursive: true,
        force: true,
      });
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Removed repository: my-repo")
      );
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("errors when --clean-repo target is not a directory", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(statSync).mockReturnValue({
        isDirectory: () => false,
      } as unknown as ReturnType<typeof statSync>);

      await program.parseAsync(["node", "test", "repos", "--clean-repo", "not-a-dir"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("is not a directory"));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("errors when --clean-repo target is not found", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(statSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      await program.parseAsync(["node", "test", "repos", "--clean-repo", "missing"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Repository "missing" not found')
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("handles unexpected errors during repos management", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(mkdirSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      await program.parseAsync(["node", "test", "repos", "--list"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Permission denied"));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("passes --temp-path option to loadConfig", async () => {
      await program.parseAsync(["node", "test", "repos", "--temp-path", "/custom/path", "--list"]);

      expect(loadConfig).toHaveBeenCalledWith(
        expect.objectContaining({ tempPath: "/custom/path" })
      );
    });

    it("filters non-directory entries when listing repos", async () => {
      vi.mocked(readdirSync).mockReturnValue(["real-repo", "some-file"] as unknown as ReturnType<
        typeof readdirSync
      >);
      let callCount = 0;
      vi.mocked(statSync).mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return {
            isDirectory: () => true,
            mtime: new Date(),
          } as unknown as ReturnType<typeof statSync>;
        }
        return { isDirectory: () => false } as unknown as ReturnType<typeof statSync>;
      });

      await program.parseAsync(["node", "test", "repos", "--list"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cloned repositories (1)")
      );
    });
  });

  describe("doctor command", () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      vi.mocked(loadConfig).mockReturnValue(createMockConfig());
    });

    it("displays system diagnostics header", async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });

      await program.parseAsync(["node", "test", "doctor"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("merge-mentor diagnostics")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Platform:"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Node.js:"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("CWD:"));
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("checks no providers by default (CLI providers removed)", async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });

      await program.parseAsync(["node", "test", "doctor"]);

      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining("Checking"));
    });

    it("checks only specified provider with --provider", async () => {
      vi.mocked(execSync).mockReturnValue("copilot 1.0.0");

      await program.parseAsync(["node", "test", "doctor", "--provider", "copilot"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Checking copilot CLI"));
    });

    it("shows installed version when provider is found", async () => {
      vi.mocked(execSync).mockReturnValue("copilot 2.5.0");

      await program.parseAsync(["node", "test", "doctor", "--provider", "copilot"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Installed: copilot 2.5.0")
      );
    });

    it("shows location when which/where succeeds", async () => {
      vi.mocked(execSync)
        .mockReturnValueOnce("copilot 2.5.0")
        .mockReturnValueOnce("/usr/local/bin/copilot");

      await program.parseAsync(["node", "test", "doctor", "--provider", "copilot"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Location: /usr/local/bin/copilot")
      );
    });

    it("shows warning when which/where fails", async () => {
      vi.mocked(execSync)
        .mockReturnValueOnce("copilot 2.5.0")
        .mockImplementationOnce(() => {
          throw new Error("which failed");
        });

      await program.parseAsync(["node", "test", "doctor", "--provider", "copilot"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Could not determine installation location")
      );
    });

    it("shows not found when provider version check fails", async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("command not found: opencode");
      });

      await program.parseAsync(["node", "test", "doctor", "--provider", "opencode"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Not found or not working")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("command not found: opencode")
      );
    });

    it("displays configuration details", async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });
      vi.mocked(loadConfig).mockReturnValue(
        createMockConfig({
          defaultPlatform: "github",
          aiProvider: "copilot-sdk",
        })
      );

      await program.parseAsync(["node", "test", "doctor"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Configuration:"));
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Default platform: github")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("AI provider: copilot-sdk")
      );
    });

    it("shows installed version when provider is found", async () => {
      vi.mocked(execSync).mockReturnValue("copilot 2.5.0");

      await program.parseAsync(["node", "test", "doctor", "--provider", "copilot"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Installed: copilot 2.5.0")
      );
    });

    it("shows location when which/where succeeds", async () => {
      vi.mocked(execSync)
        .mockReturnValueOnce("copilot 2.5.0")
        .mockReturnValueOnce("/usr/local/bin/copilot");

      await program.parseAsync(["node", "test", "doctor", "--provider", "copilot"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Location: /usr/local/bin/copilot")
      );
    });

    it("shows warning when which/where fails", async () => {
      vi.mocked(execSync)
        .mockReturnValueOnce("copilot 2.5.0")
        .mockImplementationOnce(() => {
          throw new Error("which failed");
        });

      await program.parseAsync(["node", "test", "doctor", "--provider", "copilot"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Could not determine installation location")
      );
    });

    it("shows not found when provider version check fails", async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("command not found: opencode");
      });

      await program.parseAsync(["node", "test", "doctor", "--provider", "opencode"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Not found or not working")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("command not found: opencode")
      );
    });

    it("displays configuration details", async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });
      vi.mocked(loadConfig).mockReturnValue(
        createMockConfig({
          defaultPlatform: "github",
          aiProvider: "copilot-sdk",
        })
      );

      await program.parseAsync(["node", "test", "doctor"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Configuration:"));
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Default platform: github")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("AI provider: copilot"));
    });

    it("shows token status for GitHub and Azure", async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });

      await program.parseAsync(["node", "test", "doctor"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("GitHub token: ✅ Set"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Azure token: ✅ Set"));
    });

    it("shows generic AI BYOK status without revealing secrets", async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });
      vi.mocked(loadConfig).mockReturnValue(
        createMockConfig({
          aiBaseUrl: "https://bedrock.example.com/openai/v1",
          aiApiKey: "bedrock-key",
        })
      );

      await program.parseAsync(["node", "test", "doctor"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("AI base URL: ✅ Set"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("AI API key: ✅ Set"));
      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining("bedrock-key"));
    });

    it("shows token not set when tokens are empty", async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });
      vi.mocked(loadConfig).mockReturnValue(
        createMockConfig({
          github: { token: "", owner: "o", repo: "r" },
          azure: { token: "", org: "o", project: "p", repo: "r" },
        })
      );

      await program.parseAsync(["node", "test", "doctor"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("GitHub token: ❌ Not set")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Azure token: ❌ Not set")
      );
    });

    it("handles config loading failure gracefully", async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });
      vi.mocked(loadConfig).mockImplementation(() => {
        throw new Error("Config file not found");
      });

      await program.parseAsync(["node", "test", "doctor"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Could not load configuration")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Config file not found"));
    });
  });

  describe("review command option parsing", () => {
    it("parses --long-context option and forwards it to loadConfig", async () => {
      vi.mocked(loadConfig).mockReturnValue(createMockConfig());
      await program.parseAsync(["node", "test", "review", "--pr", "42", "--long-context"]);

      expect(loadConfig).toHaveBeenCalledWith(expect.objectContaining({ longContext: true }));
    });
  });

  describe("--pr-url", () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

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

  describe("pbi command", () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("successfully reviews PBI in dry-run mode", async () => {
      vi.mocked(execSync).mockReturnValue("https://github.com/owner/repo.git\n");

      await program.parseAsync(["node", "test", "pbi", "12345"]);

      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("errors and exits when executePBIReview throws", async () => {
      const mockPbiEngine = await import("./review/pbiEngine.js");
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
});
