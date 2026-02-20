import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type Platform, validateConfig } from "./config.js";
import { ConfigurationError } from "./errors/index.js";

function cleanEnv(): void {
  // Old names (for backward compatibility testing)
  delete process.env.MM_PLATFORM;
  delete process.env.MM_GITHUB_TOKEN;
  delete process.env.MM_GITHUB_REPO_OWNER;
  delete process.env.MM_GITHUB_REPO_NAME;
  delete process.env.MM_AZURE_TOKEN;
  delete process.env.MM_AZURE_ORG;
  delete process.env.MM_AZURE_PROJECT;
  delete process.env.MM_AZURE_REPO;
  delete process.env.MM_COMMENT_IDENTIFIER;
  delete process.env.MIN_COMMENT_CONFIDENCE;
  delete process.env.MM_SKIP_EXISTING_ISSUES;
  delete process.env.POST_RESOLUTION_COMMENTS;
  delete process.env.MM_REVIEW_RUNS;
  delete process.env.MM_AI_PROVIDER;
  delete process.env.MM_COPILOT_MODEL;
  delete process.env.MM_COPILOT_TIMEOUT;
  delete process.env.MM_OPENCODE_MODEL;
  delete process.env.MM_OPENCODE_TIMEOUT;
  delete process.env.MM_CURSOR_MODEL;
  delete process.env.MM_CURSOR_TIMEOUT;

  // New MM_ prefixed names
  delete process.env.MM_PLATFORM;
  delete process.env.MM_GITHUB_TOKEN;
  delete process.env.MM_GITHUB_REPO_OWNER;
  delete process.env.MM_GITHUB_REPO_NAME;
  delete process.env.MM_AZURE_TOKEN;
  delete process.env.MM_AZURE_ORG;
  delete process.env.MM_AZURE_PROJECT;
  delete process.env.MM_AZURE_REPO;
  delete process.env.MM_COMMENT_IDENTIFIER;
  delete process.env.MM_MIN_COMMENT_CONFIDENCE;
  delete process.env.MM_SKIP_EXISTING_ISSUES;
  delete process.env.MM_POST_RESOLUTION_COMMENTS;
  delete process.env.MM_REVIEW_RUNS;
  delete process.env.MM_AI_PROVIDER;
  delete process.env.MM_COPILOT_MODEL;
  delete process.env.MM_COPILOT_TIMEOUT;
  delete process.env.MM_OPENCODE_MODEL;
  delete process.env.MM_OPENCODE_TIMEOUT;
  delete process.env.MM_CURSOR_MODEL;
  delete process.env.MM_CURSOR_TIMEOUT;
  delete process.env.MM_REVIEW_TYPE;
}

function setEnv(overrides: Record<string, string>): void {
  Object.entries(overrides).forEach(([key, value]) => {
    process.env[key] = value;
  });
}

describe("Config", () => {
  beforeEach(() => {
    vi.resetModules();
    cleanEnv();
  });

  describe("loadConfig", () => {
    it("should load default values when env vars are not set", () => {
      const config = loadConfig();

      expect(config.defaultPlatform).toBe("github");
      expect(config.github.token).toBe("");
      expect(config.github.owner).toBe("");
      expect(config.github.repo).toBe("");
      expect(config.azure.token).toBe("");
      expect(config.azure.org).toBe("");
      expect(config.azure.project).toBe("");
      expect(config.azure.repo).toBe("");
      expect(config.botCommentIdentifier).toBe("[merge-mentor]");
      expect(config.aiProvider).toBe("copilot");
      expect(config.skipPreExisting).toBe(true);
      expect(config.reviewRuns).toBe(1);
    });

    it("should load values from environment variables", () => {
      setEnv({
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

      const config = loadConfig();

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
      setEnv({
        MM_SKIP_EXISTING_ISSUES: "false",
      });

      const config = loadConfig();

      expect(config.skipPreExisting).toBe(false);
    });

    it("should default skipPreExisting to true when not set", () => {
      setEnv({});

      const config = loadConfig();

      expect(config.skipPreExisting).toBe(true);
    });

    it("should load MM_REVIEW_RUNS from environment", () => {
      setEnv({
        MM_REVIEW_RUNS: "3",
      });

      const config = loadConfig();

      expect(config.reviewRuns).toBe(3);
    });

    it("should default MM_REVIEW_RUNS to 1 for invalid values", () => {
      setEnv({
        MM_REVIEW_RUNS: "invalid",
      });

      const config = loadConfig();

      expect(config.reviewRuns).toBe(1);
    });

    it("should default MM_REVIEW_RUNS to 1 for values below range", () => {
      setEnv({
        MM_REVIEW_RUNS: "0",
      });

      const config = loadConfig();

      expect(config.reviewRuns).toBe(1);
    });

    it("should default MM_REVIEW_RUNS to 1 for values above range", () => {
      setEnv({
        MM_REVIEW_RUNS: "10",
      });

      const config = loadConfig();

      expect(config.reviewRuns).toBe(1);
    });

    it("should accept MM_REVIEW_RUNS at boundary values", () => {
      setEnv({ MM_REVIEW_RUNS: "1" });
      expect(loadConfig().reviewRuns).toBe(1);

      setEnv({ MM_REVIEW_RUNS: "5" });
      expect(loadConfig().reviewRuns).toBe(5);
    });

    it("should load MM_COPILOT_TIMEOUT from environment", () => {
      setEnv({
        MM_COPILOT_TIMEOUT: "60000",
      });

      const config = loadConfig();

      expect(config.copilotTimeoutMs).toBe(60000);
    });

    it("should ignore MM_COPILOT_TIMEOUT when zero or negative", () => {
      setEnv({
        MM_COPILOT_TIMEOUT: "0",
      });

      const config = loadConfig();

      expect(config.copilotTimeoutMs).toBeUndefined();
    });

    it("should ignore MM_COPILOT_TIMEOUT when negative", () => {
      setEnv({
        MM_COPILOT_TIMEOUT: "-1000",
      });

      const config = loadConfig();

      expect(config.copilotTimeoutMs).toBeUndefined();
    });

    it("should default MM_COPILOT_TIMEOUT to undefined when not set", () => {
      const config = loadConfig();

      expect(config.copilotTimeoutMs).toBeUndefined();
    });

    it("should load MM_COPILOT_MODEL from environment", () => {
      setEnv({
        MM_COPILOT_MODEL: "claude-haiku-4.5",
      });

      const config = loadConfig();

      expect(config.copilotModel).toBe("claude-haiku-4.5");
    });

    it("should load MM_AI_PROVIDER from environment", () => {
      setEnv({
        MM_AI_PROVIDER: "opencode",
      });

      const config = loadConfig();

      expect(config.aiProvider).toBe("opencode");
    });

    it("should default MM_AI_PROVIDER to copilot for invalid values", () => {
      setEnv({
        MM_AI_PROVIDER: "invalid",
      });

      const config = loadConfig();

      expect(config.aiProvider).toBe("copilot");
    });

    it("should accept all valid MM_AI_PROVIDER values", () => {
      setEnv({ MM_AI_PROVIDER: "copilot" });
      expect(loadConfig().aiProvider).toBe("copilot");

      setEnv({ MM_AI_PROVIDER: "opencode" });
      expect(loadConfig().aiProvider).toBe("opencode");

      setEnv({ MM_AI_PROVIDER: "cursor" });
      expect(loadConfig().aiProvider).toBe("cursor");
    });

    it("should load MM_OPENCODE_MODEL from environment", () => {
      setEnv({
        MM_OPENCODE_MODEL: "claude-4.5-sonnet",
      });

      const config = loadConfig();

      expect(config.opencodeModel).toBe("claude-4.5-sonnet");
    });

    it("should load MM_OPENCODE_TIMEOUT from environment", () => {
      setEnv({
        MM_OPENCODE_TIMEOUT: "120000",
      });

      const config = loadConfig();

      expect(config.opencodeTimeoutMs).toBe(120000);
    });

    it("should ignore MM_OPENCODE_TIMEOUT when zero or negative", () => {
      setEnv({
        MM_OPENCODE_TIMEOUT: "0",
      });

      const config = loadConfig();

      expect(config.opencodeTimeoutMs).toBeUndefined();
    });

    it("should load MM_CURSOR_MODEL from environment", () => {
      setEnv({
        MM_CURSOR_MODEL: "claude-haiku-4.5",
      });

      const config = loadConfig();

      expect(config.cursorModel).toBe("claude-haiku-4.5");
    });

    it("should load MM_CURSOR_TIMEOUT from environment", () => {
      setEnv({
        MM_CURSOR_TIMEOUT: "180000",
      });

      const config = loadConfig();

      expect(config.cursorTimeoutMs).toBe(180000);
    });

    it("should ignore MM_CURSOR_TIMEOUT when zero or negative", () => {
      setEnv({
        MM_CURSOR_TIMEOUT: "0",
      });

      const config = loadConfig();

      expect(config.cursorTimeoutMs).toBeUndefined();
    });

    it("should support all MM_ prefixed environment variables", () => {
      setEnv({
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
        MM_COPILOT_MODEL: "claude-haiku-4.5",
        MM_COPILOT_TIMEOUT: "60000",
        MM_MIN_COMMENT_CONFIDENCE: "low",
        MM_SKIP_EXISTING_ISSUES: "false",
        MM_POST_RESOLUTION_COMMENTS: "false",
        MM_REVIEW_RUNS: "3",
      });

      const config = loadConfig();

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
      expect(config.copilotModel).toBe("claude-haiku-4.5");
      expect(config.copilotTimeoutMs).toBe(60000);
      expect(config.skipPreExisting).toBe(false);
      expect(config.reviewRuns).toBe(3);
    });

    it("should accept CLI overrides that take precedence over environment variables", () => {
      setEnv({
        MM_GITHUB_TOKEN: "env-token",
        MM_PLATFORM: "github",
        MM_REVIEW_RUNS: "1",
      });

      const config = loadConfig({
        githubToken: "cli-token",
        platform: "azure",
        reviewRuns: 3,
      });

      expect(config.github.token).toBe("cli-token");
      expect(config.defaultPlatform).toBe("azure");
      expect(config.reviewRuns).toBe(3);
    });

    it("should accept all CLI overrides", () => {
      const config = loadConfig({
        platform: "azure",
        githubToken: "gh-token",
        githubRepoOwner: "owner",
        githubRepoName: "repo",
        azureToken: "az-token",
        azureOrg: "org",
        azureProject: "project",
        azureRepo: "az-repo",
        commentIdentifier: "[CLI Bot]",
        aiProvider: "cursor",
        copilotModel: "claude-haiku-4.5",
        copilotTimeout: 90000,
        skipExistingIssues: "false",
        reviewRuns: 5,
      });

      expect(config.defaultPlatform).toBe("azure");
      expect(config.github.token).toBe("gh-token");
      expect(config.github.owner).toBe("owner");
      expect(config.github.repo).toBe("repo");
      expect(config.azure.token).toBe("az-token");
      expect(config.azure.org).toBe("org");
      expect(config.azure.project).toBe("project");
      expect(config.azure.repo).toBe("az-repo");
      expect(config.botCommentIdentifier).toBe("[CLI Bot]");
      expect(config.aiProvider).toBe("cursor");
      expect(config.copilotModel).toBe("claude-haiku-4.5");
      expect(config.copilotTimeoutMs).toBe(90000);
      expect(config.skipPreExisting).toBe(false);
      expect(config.reviewRuns).toBe(5);
    });

    it("should load MM_REVIEW_TYPE from environment", () => {
      setEnv({
        MM_REVIEW_TYPE: "fast",
      });

      const config = loadConfig();

      expect(config.reviewType).toBe("fast");
    });

    it("should default MM_REVIEW_TYPE to general for invalid values", () => {
      setEnv({
        MM_REVIEW_TYPE: "invalid",
      });

      const config = loadConfig();

      expect(config.reviewType).toBe("general");
    });

    it("should accept all valid MM_REVIEW_TYPE values", () => {
      setEnv({ MM_REVIEW_TYPE: "general" });
      expect(loadConfig().reviewType).toBe("general");

      setEnv({ MM_REVIEW_TYPE: "testing" });
      expect(loadConfig().reviewType).toBe("testing");

      setEnv({ MM_REVIEW_TYPE: "security" });
      expect(loadConfig().reviewType).toBe("security");

      setEnv({ MM_REVIEW_TYPE: "performance" });
      expect(loadConfig().reviewType).toBe("performance");

      setEnv({ MM_REVIEW_TYPE: "fast" });
      expect(loadConfig().reviewType).toBe("fast");
    });
  });

  describe("validateConfig", () => {
    it("should throw ConfigurationError when GitHub token is missing", () => {
      const config = loadConfig();

      expect(() => validateConfig(config, "github" as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, "github" as Platform)).toThrow("MM_GITHUB_TOKEN");
    });

    it("should throw ConfigurationError when GitHub owner is missing", () => {
      process.env.MM_GITHUB_TOKEN = "token";
      const config = loadConfig();

      expect(() => validateConfig(config, "github" as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, "github" as Platform)).toThrow("MM_GITHUB_REPO_OWNER");
    });

    it("should throw ConfigurationError when GitHub repo is missing", () => {
      process.env.MM_GITHUB_TOKEN = "token";
      process.env.MM_GITHUB_REPO_OWNER = "owner";
      const config = loadConfig();

      expect(() => validateConfig(config, "github" as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, "github" as Platform)).toThrow("MM_GITHUB_REPO_NAME");
    });

    it("should not throw when all GitHub config is provided", () => {
      process.env.MM_GITHUB_TOKEN = "token";
      process.env.MM_GITHUB_REPO_OWNER = "owner";
      process.env.MM_GITHUB_REPO_NAME = "repo";
      const config = loadConfig();

      expect(() => validateConfig(config, "github" as Platform)).not.toThrow();
    });

    it("should throw ConfigurationError when Azure DevOps token is missing", () => {
      const config = loadConfig();

      expect(() => validateConfig(config, "azure" as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, "azure" as Platform)).toThrow("MM_AZURE_TOKEN");
    });

    it("should throw ConfigurationError when Azure DevOps org is missing", () => {
      process.env.MM_AZURE_TOKEN = "token";
      const config = loadConfig();

      expect(() => validateConfig(config, "azure" as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, "azure" as Platform)).toThrow("MM_AZURE_ORG");
    });

    it("should throw ConfigurationError when Azure DevOps project is missing", () => {
      process.env.MM_AZURE_TOKEN = "token";
      process.env.MM_AZURE_ORG = "org";
      const config = loadConfig();

      expect(() => validateConfig(config, "azure" as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, "azure" as Platform)).toThrow("MM_AZURE_PROJECT");
    });

    it("should throw ConfigurationError when Azure DevOps repo is missing", () => {
      process.env.MM_AZURE_TOKEN = "token";
      process.env.MM_AZURE_ORG = "org";
      process.env.MM_AZURE_PROJECT = "project";
      const config = loadConfig();

      expect(() => validateConfig(config, "azure" as Platform)).toThrow(ConfigurationError);
      expect(() => validateConfig(config, "azure" as Platform)).toThrow("MM_AZURE_REPO");
    });

    it("should not throw when all Azure DevOps config is provided", () => {
      process.env.MM_AZURE_TOKEN = "token";
      process.env.MM_AZURE_ORG = "org";
      process.env.MM_AZURE_PROJECT = "project";
      process.env.MM_AZURE_REPO = "repo";
      const config = loadConfig();

      expect(() => validateConfig(config, "azure" as Platform)).not.toThrow();
    });

    it("should not throw for unknown platform (no validation)", () => {
      const config = loadConfig();
      const unknownPlatform = "unknown" as unknown as Platform;

      expect(() => validateConfig(config, unknownPlatform)).not.toThrow();
    });
  });
});
