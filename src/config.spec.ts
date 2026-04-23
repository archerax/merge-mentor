import { describe, expect, it } from "vitest";
import {
  loadConfig,
  type Platform,
  validateAIProvider,
  validateConfig,
  validateGitBackend,
  validateReviewRuns,
  validateReviewType,
} from "./config.js";
import { ConfigurationError } from "./errors/index.js";
import { createStubEnvironment } from "./ports/environment.test-helper.js";

describe("Config", () => {
  describe("loadConfig", () => {
    it("should load default values when env vars are not set", () => {
      const env = createStubEnvironment();
      const config = loadConfig(undefined, env);

      expect(config.defaultPlatform).toBe("github");
      expect(config.github.token).toBe("");
      expect(config.github.owner).toBe("");
      expect(config.github.repo).toBe("");
      expect(config.azure.token).toBe("");
      expect(config.azure.org).toBe("");
      expect(config.azure.project).toBe("");
      expect(config.azure.repo).toBe("");
      expect(config.botCommentIdentifier).toBe("[merge-mentor]");
      expect(config.aiProvider).toBe("copilot-sdk");
      expect(config.gitBackend).toBe("cli");
      expect(config.skipPreExisting).toBe(true);
      expect(config.reviewRuns).toBe(1);
    });

    it("should load values from environment variables", () => {
      const env = createStubEnvironment({
        MM_PLATFORM: "azure",
        MM_GITHUB_TOKEN: "gh-token",
        MM_GITHUB_REPO_OWNER: "owner",
        MM_GITHUB_REPO_NAME: "repo",
        MM_AZURE_TOKEN: "az-token",
        MM_AZURE_ORG: "org",
        MM_AZURE_PROJECT: "project",
        MM_AZURE_REPO: "az-repo",
        MM_COMMENT_IDENTIFIER: "[Custom Bot]",
      });

      const config = loadConfig(undefined, env);

      expect(config.defaultPlatform).toBe("azure");
      expect(config.github.token).toBe("gh-token");
      expect(config.github.owner).toBe("owner");
      expect(config.github.repo).toBe("repo");
      expect(config.azure.token).toBe("az-token");
      expect(config.azure.org).toBe("org");
      expect(config.azure.project).toBe("project");
      expect(config.azure.repo).toBe("az-repo");
      expect(config.botCommentIdentifier).toBe("[Custom Bot]");
    });

    it("should load skipPreExisting setting from environment variable", () => {
      const env = createStubEnvironment({
        MM_SKIP_EXISTING_ISSUES: "false",
      });

      const config = loadConfig(undefined, env);

      expect(config.skipPreExisting).toBe(false);
    });

    it("should default skipPreExisting to true when not set", () => {
      const env = createStubEnvironment();

      const config = loadConfig(undefined, env);

      expect(config.skipPreExisting).toBe(true);
    });

    it("should load MM_REVIEW_RUNS from environment", () => {
      const env = createStubEnvironment({
        MM_REVIEW_RUNS: "3",
      });

      const config = loadConfig(undefined, env);

      expect(config.reviewRuns).toBe(3);
    });

    it("should default MM_REVIEW_RUNS to 1 for invalid values", () => {
      const env = createStubEnvironment({
        MM_REVIEW_RUNS: "invalid",
      });

      const config = loadConfig(undefined, env);

      expect(config.reviewRuns).toBe(1);
    });

    it("should default MM_REVIEW_RUNS to 1 for values below range", () => {
      const env = createStubEnvironment({
        MM_REVIEW_RUNS: "0",
      });

      const config = loadConfig(undefined, env);

      expect(config.reviewRuns).toBe(1);
    });

    it("should default MM_REVIEW_RUNS to 1 for values above range", () => {
      const env = createStubEnvironment({
        MM_REVIEW_RUNS: "10",
      });

      const config = loadConfig(undefined, env);

      expect(config.reviewRuns).toBe(1);
    });

    it("should accept MM_REVIEW_RUNS at boundary values", () => {
      expect(loadConfig(undefined, createStubEnvironment({ MM_REVIEW_RUNS: "1" })).reviewRuns).toBe(
        1
      );

      expect(loadConfig(undefined, createStubEnvironment({ MM_REVIEW_RUNS: "5" })).reviewRuns).toBe(
        5
      );
    });

    it("should load MM_COPILOT_TIMEOUT from environment", () => {
      const env = createStubEnvironment({
        MM_COPILOT_TIMEOUT: "60000",
      });

      const config = loadConfig(undefined, env);

      expect(config.copilotTimeoutMs).toBe(60000);
    });

    it("should load MM_AGENT_TIMEOUT from environment", () => {
      const env = createStubEnvironment({
        MM_AGENT_TIMEOUT: "60000",
      });

      const config = loadConfig(undefined, env);

      expect(config.agentTimeoutMs).toBe(60000);
    });

    it("should ignore MM_AGENT_TIMEOUT when zero or negative", () => {
      const env = createStubEnvironment({
        MM_AGENT_TIMEOUT: "0",
      });

      const config = loadConfig(undefined, env);

      expect(config.agentTimeoutMs).toBeUndefined();
    });

    it("should default MM_AGENT_TIMEOUT to undefined when not set", () => {
      const env = createStubEnvironment();
      const config = loadConfig(undefined, env);

      expect(config.agentTimeoutMs).toBeUndefined();
    });

    it("should prefer MM_AGENT_TIMEOUT over deprecated provider-specific timeouts", () => {
      const env = createStubEnvironment({
        MM_AGENT_TIMEOUT: "60000",
        MM_COPILOT_TIMEOUT: "120000",
        MM_OPENCODE_TIMEOUT: "180000",
      });

      const config = loadConfig(undefined, env);

      expect(config.agentTimeoutMs).toBe(60000);
      expect(config.copilotTimeoutMs).toBe(120000);
      expect(config.opencodeTimeoutMs).toBe(180000);
    });

    it("should ignore MM_COPILOT_TIMEOUT when zero or negative", () => {
      const env = createStubEnvironment({
        MM_COPILOT_TIMEOUT: "0",
      });

      const config = loadConfig(undefined, env);

      expect(config.copilotTimeoutMs).toBeUndefined();
    });

    it("should ignore MM_COPILOT_TIMEOUT when negative", () => {
      const env = createStubEnvironment({
        MM_COPILOT_TIMEOUT: "-1000",
      });

      const config = loadConfig(undefined, env);

      expect(config.copilotTimeoutMs).toBeUndefined();
    });

    it("should default MM_COPILOT_TIMEOUT to undefined when not set", () => {
      const env = createStubEnvironment();
      const config = loadConfig(undefined, env);

      expect(config.copilotTimeoutMs).toBeUndefined();
    });

    it("should load MM_COPILOT_MODEL from environment", () => {
      const env = createStubEnvironment({
        MM_COPILOT_MODEL: "claude-haiku-4.5",
      });

      const config = loadConfig(undefined, env);

      expect(config.copilotModel).toBe("claude-haiku-4.5");
    });

    it("should load MM_AI_PROVIDER from environment", () => {
      const env = createStubEnvironment({
        MM_AI_PROVIDER: "opencode",
      });

      const config = loadConfig(undefined, env);

      expect(config.aiProvider).toBe("opencode");
    });

    it("should default MM_AI_PROVIDER to copilot-sdk for invalid values", () => {
      const env = createStubEnvironment({
        MM_AI_PROVIDER: "invalid",
      });

      const config = loadConfig(undefined, env);

      expect(config.aiProvider).toBe("copilot-sdk");
    });

    it("should accept all valid MM_AI_PROVIDER values", () => {
      expect(
        loadConfig(undefined, createStubEnvironment({ MM_AI_PROVIDER: "copilot" })).aiProvider
      ).toBe("copilot");

      expect(
        loadConfig(undefined, createStubEnvironment({ MM_AI_PROVIDER: "copilot-sdk" })).aiProvider
      ).toBe("copilot-sdk");

      expect(
        loadConfig(undefined, createStubEnvironment({ MM_AI_PROVIDER: "opencode" })).aiProvider
      ).toBe("opencode");

      expect(
        loadConfig(undefined, createStubEnvironment({ MM_AI_PROVIDER: "opencode-sdk" })).aiProvider
      ).toBe("opencode-sdk");
    });

    it("should load MM_GIT_BACKEND from environment", () => {
      const env = createStubEnvironment({ MM_GIT_BACKEND: "isomorphic" });

      const config = loadConfig(undefined, env);

      expect(config.gitBackend).toBe("isomorphic");
    });

    it("should default MM_GIT_BACKEND to cli for invalid values", () => {
      const env = createStubEnvironment({ MM_GIT_BACKEND: "invalid" });

      const config = loadConfig(undefined, env);

      expect(config.gitBackend).toBe("cli");
    });

    it("should load MM_OPENCODE_MODEL from environment", () => {
      const env = createStubEnvironment({
        MM_OPENCODE_MODEL: "claude-4.5-sonnet",
      });

      const config = loadConfig(undefined, env);

      expect(config.opencodeModel).toBe("claude-4.5-sonnet");
    });

    it("should load MM_OPENCODE_TIMEOUT from environment", () => {
      const env = createStubEnvironment({
        MM_OPENCODE_TIMEOUT: "120000",
      });

      const config = loadConfig(undefined, env);

      expect(config.opencodeTimeoutMs).toBe(120000);
    });

    it("should ignore MM_OPENCODE_TIMEOUT when zero or negative", () => {
      const env = createStubEnvironment({
        MM_OPENCODE_TIMEOUT: "0",
      });

      const config = loadConfig(undefined, env);

      expect(config.opencodeTimeoutMs).toBeUndefined();
    });

    it("should load MM_OPENCODE_SDK_MODEL from environment", () => {
      const env = createStubEnvironment({
        MM_OPENCODE_SDK_MODEL: "claude-4.5-sonnet",
      });

      const config = loadConfig(undefined, env);

      expect(config.opencodeSdkModel).toBe("claude-4.5-sonnet");
    });

    it("should load MM_OPENCODE_SDK_TIMEOUT from environment", () => {
      const env = createStubEnvironment({
        MM_OPENCODE_SDK_TIMEOUT: "90000",
      });

      const config = loadConfig(undefined, env);

      expect(config.opencodeSdkTimeoutMs).toBe(90000);
    });

    it("should ignore MM_OPENCODE_SDK_TIMEOUT when zero or negative", () => {
      const env = createStubEnvironment({
        MM_OPENCODE_SDK_TIMEOUT: "0",
      });

      const config = loadConfig(undefined, env);

      expect(config.opencodeSdkTimeoutMs).toBeUndefined();
    });

    it("should support all MM_ prefixed environment variables", () => {
      const env = createStubEnvironment({
        MM_PLATFORM: "azure",
        MM_GITHUB_TOKEN: "gh-token",
        MM_GITHUB_REPO_OWNER: "owner",
        MM_GITHUB_REPO_NAME: "repo",
        MM_AZURE_TOKEN: "az-token",
        MM_AZURE_ORG: "org",
        MM_AZURE_PROJECT: "project",
        MM_AZURE_REPO: "az-repo",
        MM_COMMENT_IDENTIFIER: "[MM Bot]",
        MM_AI_PROVIDER: "opencode",
        MM_AGENT_TIMEOUT: "180000",
        MM_COPILOT_MODEL: "claude-haiku-4.5",
        MM_COPILOT_TIMEOUT: "60000",
        MM_MIN_COMMENT_CONFIDENCE: "low",
        MM_SKIP_EXISTING_ISSUES: "false",
        MM_REVIEW_RUNS: "3",
      });

      const config = loadConfig(undefined, env);

      expect(config.defaultPlatform).toBe("azure");
      expect(config.github.token).toBe("gh-token");
      expect(config.github.owner).toBe("owner");
      expect(config.github.repo).toBe("repo");
      expect(config.azure.token).toBe("az-token");
      expect(config.azure.org).toBe("org");
      expect(config.azure.project).toBe("project");
      expect(config.azure.repo).toBe("az-repo");
      expect(config.botCommentIdentifier).toBe("[MM Bot]");
      expect(config.aiProvider).toBe("opencode");
      expect(config.agentTimeoutMs).toBe(180000);
      expect(config.copilotModel).toBe("claude-haiku-4.5");
      expect(config.copilotTimeoutMs).toBe(60000);
      expect(config.skipPreExisting).toBe(false);
      expect(config.reviewRuns).toBe(3);
    });

    it("should accept CLI overrides that take precedence over environment variables", () => {
      const env = createStubEnvironment({
        MM_GITHUB_TOKEN: "env-token",
        MM_PLATFORM: "github",
        MM_REVIEW_RUNS: "1",
      });

      const config = loadConfig(
        {
          githubToken: "cli-token",
          platform: "azure",
          reviewRuns: 3,
        },
        env
      );

      expect(config.github.token).toBe("cli-token");
      expect(config.defaultPlatform).toBe("azure");
      expect(config.reviewRuns).toBe(3);
    });

    it("should accept all CLI overrides", () => {
      const env = createStubEnvironment();
      const config = loadConfig(
        {
          platform: "azure",
          githubToken: "gh-token",
          githubRepoOwner: "owner",
          githubRepoName: "repo",
          azureToken: "az-token",
          azureOrg: "org",
          azureProject: "project",
          azureRepo: "az-repo",
          commentIdentifier: "[CLI Bot]",
          aiProvider: "copilot-sdk",
          agentTimeout: 180000,
          copilotModel: "claude-haiku-4.5",
          copilotTimeout: 90000,
          skipExistingIssues: "false",
          reviewRuns: 5,
        },
        env
      );

      expect(config.defaultPlatform).toBe("azure");
      expect(config.github.token).toBe("gh-token");
      expect(config.github.owner).toBe("owner");
      expect(config.github.repo).toBe("repo");
      expect(config.azure.token).toBe("az-token");
      expect(config.azure.org).toBe("org");
      expect(config.azure.project).toBe("project");
      expect(config.azure.repo).toBe("az-repo");
      expect(config.botCommentIdentifier).toBe("[CLI Bot]");
      expect(config.aiProvider).toBe("copilot-sdk");
      expect(config.agentTimeoutMs).toBe(180000);
      expect(config.copilotModel).toBe("claude-haiku-4.5");
      expect(config.copilotTimeoutMs).toBe(90000);
      expect(config.skipPreExisting).toBe(false);
      expect(config.reviewRuns).toBe(5);
    });

    it("should load MM_REVIEW_TYPE from environment", () => {
      const env = createStubEnvironment({
        MM_REVIEW_TYPE: "fast",
      });

      const config = loadConfig(undefined, env);

      expect(config.reviewType).toBe("fast");
    });

    it("should default MM_REVIEW_TYPE to general for invalid values", () => {
      const env = createStubEnvironment({
        MM_REVIEW_TYPE: "invalid",
      });

      const config = loadConfig(undefined, env);

      expect(config.reviewType).toBe("general");
    });

    it("should accept all valid MM_REVIEW_TYPE values", () => {
      expect(
        loadConfig(undefined, createStubEnvironment({ MM_REVIEW_TYPE: "general" })).reviewType
      ).toBe("general");

      expect(
        loadConfig(undefined, createStubEnvironment({ MM_REVIEW_TYPE: "testing" })).reviewType
      ).toBe("testing");

      expect(
        loadConfig(undefined, createStubEnvironment({ MM_REVIEW_TYPE: "security" })).reviewType
      ).toBe("security");

      expect(
        loadConfig(undefined, createStubEnvironment({ MM_REVIEW_TYPE: "performance" })).reviewType
      ).toBe("performance");

      expect(
        loadConfig(undefined, createStubEnvironment({ MM_REVIEW_TYPE: "fast" })).reviewType
      ).toBe("fast");
    });
  });

  describe("validateConfig", () => {
    it("should throw ConfigurationError when GitHub token is missing", () => {
      const env = createStubEnvironment();
      const config = loadConfig(undefined, env);

      expect(() => validateConfig(config, "github" as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, "github" as Platform)).toThrow("MM_GITHUB_TOKEN");
    });

    it("should throw ConfigurationError when GitHub owner is missing", () => {
      const env = createStubEnvironment({ MM_GITHUB_TOKEN: "token" });
      const config = loadConfig(undefined, env);

      expect(() => validateConfig(config, "github" as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, "github" as Platform)).toThrow("MM_GITHUB_REPO_OWNER");
    });

    it("should throw ConfigurationError when GitHub repo is missing", () => {
      const env = createStubEnvironment({
        MM_GITHUB_TOKEN: "token",
        MM_GITHUB_REPO_OWNER: "owner",
      });
      const config = loadConfig(undefined, env);

      expect(() => validateConfig(config, "github" as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, "github" as Platform)).toThrow("MM_GITHUB_REPO_NAME");
    });

    it("should not throw when all GitHub config is provided", () => {
      const env = createStubEnvironment({
        MM_GITHUB_TOKEN: "token",
        MM_GITHUB_REPO_OWNER: "owner",
        MM_GITHUB_REPO_NAME: "repo",
      });
      const config = loadConfig(undefined, env);

      expect(() => validateConfig(config, "github" as Platform)).not.toThrow();
    });

    it("should throw ConfigurationError when Azure DevOps token is missing", () => {
      const env = createStubEnvironment();
      const config = loadConfig(undefined, env);

      expect(() => validateConfig(config, "azure" as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, "azure" as Platform)).toThrow("MM_AZURE_TOKEN");
    });

    it("should throw ConfigurationError when Azure DevOps org is missing", () => {
      const env = createStubEnvironment({ MM_AZURE_TOKEN: "token" });
      const config = loadConfig(undefined, env);

      expect(() => validateConfig(config, "azure" as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, "azure" as Platform)).toThrow("MM_AZURE_ORG");
    });

    it("should throw ConfigurationError when Azure DevOps project is missing", () => {
      const env = createStubEnvironment({
        MM_AZURE_TOKEN: "token",
        MM_AZURE_ORG: "org",
      });
      const config = loadConfig(undefined, env);

      expect(() => validateConfig(config, "azure" as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, "azure" as Platform)).toThrow("MM_AZURE_PROJECT");
    });

    it("should throw ConfigurationError when Azure DevOps repo is missing", () => {
      const env = createStubEnvironment({
        MM_AZURE_TOKEN: "token",
        MM_AZURE_ORG: "org",
        MM_AZURE_PROJECT: "project",
      });
      const config = loadConfig(undefined, env);

      expect(() => validateConfig(config, "azure" as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, "azure" as Platform)).toThrow("MM_AZURE_REPO");
    });

    it("should not throw when all Azure DevOps config is provided", () => {
      const env = createStubEnvironment({
        MM_AZURE_TOKEN: "token",
        MM_AZURE_ORG: "org",
        MM_AZURE_PROJECT: "project",
        MM_AZURE_REPO: "repo",
      });
      const config = loadConfig(undefined, env);

      expect(() => validateConfig(config, "azure" as Platform)).not.toThrow();
    });

    it("should not throw for unknown platform (no validation)", () => {
      const env = createStubEnvironment();
      const config = loadConfig(undefined, env);
      const unknownPlatform = "unknown" as unknown as Platform;

      expect(() => validateConfig(config, unknownPlatform)).not.toThrow();
    });
  });
});

describe("Validator functions", () => {
  describe("validateReviewRuns", () => {
    it("should accept valid run counts 1-5", () => {
      expect(validateReviewRuns("1")).toBe(1);
      expect(validateReviewRuns("3")).toBe(3);
      expect(validateReviewRuns("5")).toBe(5);
    });

    it("should default to 1 for out-of-range values", () => {
      expect(validateReviewRuns("0")).toBe(1);
      expect(validateReviewRuns("6")).toBe(1);
      expect(validateReviewRuns("100")).toBe(1);
    });

    it("should default to 1 for invalid values", () => {
      expect(validateReviewRuns("invalid")).toBe(1);
      expect(validateReviewRuns("")).toBe(1);
      expect(validateReviewRuns(undefined)).toBe(1);
    });
  });

  describe("validateAIProvider", () => {
    it("should accept valid provider types", () => {
      expect(validateAIProvider("copilot")).toBe("copilot");
      expect(validateAIProvider("copilot-sdk")).toBe("copilot-sdk");
      expect(validateAIProvider("opencode")).toBe("opencode");
      expect(validateAIProvider("opencode-sdk")).toBe("opencode-sdk");
    });

    it("should default to copilot-sdk for invalid providers", () => {
      expect(validateAIProvider("invalid")).toBe("copilot-sdk");
      expect(validateAIProvider("cursor")).toBe("copilot-sdk");
      expect(validateAIProvider("")).toBe("copilot-sdk");
      expect(validateAIProvider(undefined)).toBe("copilot-sdk");
    });
  });

  describe("validateReviewType", () => {
    it("should accept valid review types", () => {
      expect(validateReviewType("general")).toBe("general");
      expect(validateReviewType("testing")).toBe("testing");
      expect(validateReviewType("security")).toBe("security");
      expect(validateReviewType("performance")).toBe("performance");
      expect(validateReviewType("fast")).toBe("fast");
    });

    it("should default to general for invalid types", () => {
      expect(validateReviewType("invalid")).toBe("general");
      expect(validateReviewType("custom")).toBe("general");
      expect(validateReviewType("")).toBe("general");
      expect(validateReviewType(undefined)).toBe("general");
    });
  });

  describe("validateGitBackend", () => {
    it("should return valid backend types", () => {
      expect(validateGitBackend("cli")).toBe("cli");
      expect(validateGitBackend("isomorphic")).toBe("isomorphic");
    });

    it("should default to cli for invalid values", () => {
      expect(validateGitBackend("invalid")).toBe("cli");
      expect(validateGitBackend("native")).toBe("cli");
      expect(validateGitBackend("")).toBe("cli");
      expect(validateGitBackend(undefined)).toBe("cli");
    });
  });
});
