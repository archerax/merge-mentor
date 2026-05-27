import { describe, expect, it } from "vitest";
import {
  loadConfig,
  type Platform,
  validateAIProvider,
  validateConfig,
  validateGitBackend,
  validateReviewStrategy,
  validateReviewType,
} from "./config.js";
import { ConfigurationError } from "./errors/index.js";
import type { Environment } from "./ports/environment.js";
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
      expect(config.reviewPasses).toEqual([]);
      expect(config.reviewStrategy).toBe("fast");
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

    it("should load MM_AI_TIMEOUT from environment", () => {
      const env = createStubEnvironment({
        MM_AI_TIMEOUT: "60000",
      });

      const config = loadConfig(undefined, env);

      expect(config.aiTimeoutMs).toBe(60000);
    });

    it("should ignore MM_AI_TIMEOUT when zero or negative", () => {
      const env = createStubEnvironment({
        MM_AI_TIMEOUT: "0",
      });

      const config = loadConfig(undefined, env);

      expect(config.aiTimeoutMs).toBeUndefined();
    });

    it("should default MM_AI_TIMEOUT to undefined when not set", () => {
      const env = createStubEnvironment();
      const config = loadConfig(undefined, env);

      expect(config.aiTimeoutMs).toBeUndefined();
    });

    it("should load MM_AI_MODEL from environment", () => {
      const env = createStubEnvironment({
        MM_AI_MODEL: "gpt-5.2-codex",
      });

      const config = loadConfig(undefined, env);

      expect(config.aiModel).toBe("gpt-5.2-codex");
    });

    it("should load MM_AI_PROVIDER from environment", () => {
      const env = createStubEnvironment({
        MM_AI_PROVIDER: "opencode-sdk",
      });

      const config = loadConfig(undefined, env);

      expect(config.aiProvider).toBe("opencode-sdk");
    });

    it("should load generic AI BYOK settings from environment", () => {
      const env = createStubEnvironment({
        MM_AI_BASE_URL: "https://bedrock.example.com/openai/v1",
        MM_AI_API_KEY: "bedrock-key",
      });

      const config = loadConfig(undefined, env);

      expect(config.aiBaseUrl).toBe("https://bedrock.example.com/openai/v1");
      expect(config.aiApiKey).toBe("bedrock-key");
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
        loadConfig(undefined, createStubEnvironment({ MM_AI_PROVIDER: "copilot-sdk" })).aiProvider
      ).toBe("copilot-sdk");

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
        MM_AI_PROVIDER: "opencode-sdk",
        MM_AI_TIMEOUT: "180000",
        MM_AI_MODEL: "gpt-5.2-codex",
        MM_AI_BASE_URL: "https://bedrock.example.com/openai/v1",
        MM_AI_API_KEY: "bedrock-key",
        MM_MIN_COMMENT_CONFIDENCE: "low",
        MM_SKIP_EXISTING_ISSUES: "false",
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
      expect(config.aiProvider).toBe("opencode-sdk");
      expect(config.aiTimeoutMs).toBe(180000);
      expect(config.aiModel).toBe("gpt-5.2-codex");
      expect(config.aiBaseUrl).toBe("https://bedrock.example.com/openai/v1");
      expect(config.aiApiKey).toBe("bedrock-key");
      expect(config.skipPreExisting).toBe(false);
    });

    it("should accept CLI overrides that take precedence over environment variables", () => {
      const env = createStubEnvironment({
        MM_GITHUB_TOKEN: "env-token",
        MM_PLATFORM: "github",
      });

      const config = loadConfig(
        {
          githubToken: "cli-token",
          platform: "azure",
        },
        env
      );

      expect(config.github.token).toBe("cli-token");
      expect(config.defaultPlatform).toBe("azure");
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
          aiTimeout: 180000,
          aiModel: "gpt-5.2-codex",
          aiBaseUrl: "https://bedrock.example.com/openai/v1",
          aiApiKey: "bedrock-key",
          skipExistingIssues: "false",
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
      expect(config.aiTimeoutMs).toBe(180000);
      expect(config.aiModel).toBe("gpt-5.2-codex");
      expect(config.aiBaseUrl).toBe("https://bedrock.example.com/openai/v1");
      expect(config.aiApiKey).toBe("bedrock-key");
      expect(config.skipPreExisting).toBe(false);
    });

    it("should load MM_REVIEW_TYPE from environment", () => {
      const env = createStubEnvironment({
        MM_REVIEW_TYPE: "fast",
      });

      const config = loadConfig(undefined, env);

      expect(config.reviewType).toBe("fast");
      expect(config.reviewStrategy).toBe("fast");
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

    it("loads additive review passes without using legacy review types", () => {
      const config = loadConfig({
        passes: "security,database",
      });

      expect(config.reviewType).toBe("general");
      expect(config.reviewPasses).toEqual(["security", "database"]);
    });

    it("merges legacy review type aliases with explicit passes", () => {
      const config = loadConfig({
        reviewType: "security",
        passes: "database",
      });

      expect(config.reviewPasses).toEqual(["database", "security"]);
    });

    it("should default MM_STREAMING_LINES to 9 when not set", () => {
      const env = createStubEnvironment();
      const config = loadConfig(undefined, env);

      expect(config.streamingLines).toBe(9);
    });

    it("should load MM_STREAMING_LINES from environment", () => {
      const env = createStubEnvironment({
        MM_STREAMING_LINES: "15",
      });

      const config = loadConfig(undefined, env);

      expect(config.streamingLines).toBe(15);
    });

    it("should accept CLI streamingLines override", () => {
      const env = createStubEnvironment();
      const config = loadConfig(
        {
          streamingLines: 20,
        },
        env
      );

      expect(config.streamingLines).toBe(20);
    });

    it("should handle zero streamingLines from CLI", () => {
      const env = createStubEnvironment({
        MM_STREAMING_LINES: "10",
      });
      const config = loadConfig(
        {
          streamingLines: 0,
        },
        env
      );

      // Zero from CLI should still override (nullish coalescing doesn't consider 0 as falsy for this purpose)
      expect(config.streamingLines).toBe(0);
    });

    it("should handle edge case where env.get returns undefined in parseInt fallback", () => {
      // Create a mock environment that returns truthy for the first call but undefined for the second
      let callCount = 0;
      const mockEnv: Environment = {
        get: (key) => {
          if (key === "MM_STREAMING_LINES") {
            callCount++;
            // First call (in condition) returns "123", second call (in parseInt) returns undefined
            // This tests the ?? "" fallback path
            return callCount === 1 ? "123" : undefined;
          }
          return undefined;
        },
      };

      const config = loadConfig(undefined, mockEnv);

      // When second call returns undefined, the ?? "" fallback kicks in, resulting in NaN
      // which is still a number (albeit invalid), so it gets used
      expect(Number.isNaN(config.streamingLines)).toBe(true);
    });

    it("should prefer CLI streamingLines over environment variable", () => {
      const env = createStubEnvironment({
        MM_STREAMING_LINES: "10",
      });

      const config = loadConfig(
        {
          streamingLines: 25,
        },
        env
      );

      expect(config.streamingLines).toBe(25);
    });

    it("should load MM_STREAMING_ENABLED from environment", () => {
      const env = createStubEnvironment({
        MM_STREAMING_ENABLED: "false",
      });

      const config = loadConfig(undefined, env);

      expect(config.streamingEnabled).toBe(false);
    });

    it("should default MM_STREAMING_ENABLED to true when not set", () => {
      const env = createStubEnvironment();

      const config = loadConfig(undefined, env);

      expect(config.streamingEnabled).toBe(true);
    });

    it("should accept CLI streamingEnabled override", () => {
      const env = createStubEnvironment();
      const config = loadConfig(
        {
          streamingEnabled: false,
        },
        env
      );

      expect(config.streamingEnabled).toBe(false);
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
  describe("validateAIProvider", () => {
    it("should accept valid provider types", () => {
      expect(validateAIProvider("copilot-sdk")).toBe("copilot-sdk");
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
      expect(validateReviewType("custom")).toBe("custom");
    });

    it("should default to general for invalid types", () => {
      expect(validateReviewType("invalid")).toBe("general");
      expect(validateReviewType("")).toBe("general");
      expect(validateReviewType(undefined)).toBe("general");
    });
  });

  describe("validateReviewStrategy", () => {
    it("should accept valid review strategies", () => {
      expect(validateReviewStrategy("deep")).toBe("deep");
      expect(validateReviewStrategy("fast")).toBe("fast");
    });

    it("should default to fast for invalid strategies", () => {
      expect(validateReviewStrategy("invalid")).toBe("fast");
      expect(validateReviewStrategy("")).toBe("fast");
      expect(validateReviewStrategy(undefined)).toBe("fast");
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
