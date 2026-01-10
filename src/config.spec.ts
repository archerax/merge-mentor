import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type Platform, validateConfig } from "./config.js";
import { ConfigurationError } from "./errors/index.js";

function cleanEnv(): void {
  // Old names (for backward compatibility testing)
  delete process.env.DEFAULT_PLATFORM;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_REPO_OWNER;
  delete process.env.GITHUB_REPO_NAME;
  delete process.env.AZURE_DEVOPS_TOKEN;
  delete process.env.AZURE_DEVOPS_ORG;
  delete process.env.AZURE_DEVOPS_PROJECT;
  delete process.env.AZURE_DEVOPS_REPO;
  delete process.env.BOT_COMMENT_IDENTIFIER;
  delete process.env.MIN_COMMENT_CONFIDENCE;
  delete process.env.SKIP_PREEXISTING_ISSUES;
  delete process.env.POST_RESOLUTION_COMMENTS;
  delete process.env.REVIEW_RUNS;
  delete process.env.AI_PROVIDER;
  delete process.env.COPILOT_MODEL;
  delete process.env.COPILOT_TIMEOUT_MS;
  delete process.env.OPENCODE_MODEL;
  delete process.env.OPENCODE_TIMEOUT_MS;
  delete process.env.CURSOR_MODEL;
  delete process.env.CURSOR_TIMEOUT_MS;

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
      expect(config.commentFilter.minConfidence).toBe("high");
      expect(config.commentFilter.skipPreExisting).toBe(true);
      expect(config.commentFilter.postResolutionComments).toBe(true);
      expect(config.reviewRuns).toBe(1);
    });

    it("should load values from environment variables", () => {
      setEnv({
        DEFAULT_PLATFORM: "azure",
        GITHUB_TOKEN: "gh-token",
        GITHUB_REPO_OWNER: "owner",
        GITHUB_REPO_NAME: "repo",
        AZURE_DEVOPS_TOKEN: "az-token",
        AZURE_DEVOPS_ORG: "org",
        AZURE_DEVOPS_PROJECT: "project",
        AZURE_DEVOPS_REPO: "az-repo",
        BOT_COMMENT_IDENTIFIER: "[Custom Bot]",
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

    it("should load comment filter settings from environment variables", () => {
      setEnv({
        MIN_COMMENT_CONFIDENCE: "medium",
        SKIP_PREEXISTING_ISSUES: "false",
        POST_RESOLUTION_COMMENTS: "false",
      });

      const config = loadConfig();

      expect(config.commentFilter.minConfidence).toBe("medium");
      expect(config.commentFilter.skipPreExisting).toBe(false);
      expect(config.commentFilter.postResolutionComments).toBe(false);
    });

    it("should default to high confidence for invalid MIN_COMMENT_CONFIDENCE", () => {
      setEnv({
        MIN_COMMENT_CONFIDENCE: "invalid",
      });

      const config = loadConfig();

      expect(config.commentFilter.minConfidence).toBe("high");
    });

    it("should accept low as MIN_COMMENT_CONFIDENCE", () => {
      setEnv({
        MIN_COMMENT_CONFIDENCE: "low",
      });

      const config = loadConfig();

      expect(config.commentFilter.minConfidence).toBe("low");
    });

    it("should load REVIEW_RUNS from environment", () => {
      setEnv({
        REVIEW_RUNS: "3",
      });

      const config = loadConfig();

      expect(config.reviewRuns).toBe(3);
    });

    it("should default REVIEW_RUNS to 1 for invalid values", () => {
      setEnv({
        REVIEW_RUNS: "invalid",
      });

      const config = loadConfig();

      expect(config.reviewRuns).toBe(1);
    });

    it("should default REVIEW_RUNS to 1 for values below range", () => {
      setEnv({
        REVIEW_RUNS: "0",
      });

      const config = loadConfig();

      expect(config.reviewRuns).toBe(1);
    });

    it("should default REVIEW_RUNS to 1 for values above range", () => {
      setEnv({
        REVIEW_RUNS: "10",
      });

      const config = loadConfig();

      expect(config.reviewRuns).toBe(1);
    });

    it("should accept REVIEW_RUNS at boundary values", () => {
      setEnv({ REVIEW_RUNS: "1" });
      expect(loadConfig().reviewRuns).toBe(1);

      setEnv({ REVIEW_RUNS: "5" });
      expect(loadConfig().reviewRuns).toBe(5);
    });

    it("should load COPILOT_TIMEOUT_MS from environment", () => {
      setEnv({
        COPILOT_TIMEOUT_MS: "60000",
      });

      const config = loadConfig();

      expect(config.copilotTimeoutMs).toBe(60000);
    });

    it("should ignore COPILOT_TIMEOUT_MS when zero or negative", () => {
      setEnv({
        COPILOT_TIMEOUT_MS: "0",
      });

      const config = loadConfig();

      expect(config.copilotTimeoutMs).toBeUndefined();
    });

    it("should ignore COPILOT_TIMEOUT_MS when negative", () => {
      setEnv({
        COPILOT_TIMEOUT_MS: "-1000",
      });

      const config = loadConfig();

      expect(config.copilotTimeoutMs).toBeUndefined();
    });

    it("should default COPILOT_TIMEOUT_MS to undefined when not set", () => {
      const config = loadConfig();

      expect(config.copilotTimeoutMs).toBeUndefined();
    });

    it("should load COPILOT_MODEL from environment", () => {
      setEnv({
        COPILOT_MODEL: "gpt-4-turbo",
      });

      const config = loadConfig();

      expect(config.copilotModel).toBe("gpt-4-turbo");
    });

    it("should load AI_PROVIDER from environment", () => {
      setEnv({
        AI_PROVIDER: "opencode",
      });

      const config = loadConfig();

      expect(config.aiProvider).toBe("opencode");
    });

    it("should default AI_PROVIDER to copilot for invalid values", () => {
      setEnv({
        AI_PROVIDER: "invalid",
      });

      const config = loadConfig();

      expect(config.aiProvider).toBe("copilot");
    });

    it("should accept all valid AI_PROVIDER values", () => {
      setEnv({ AI_PROVIDER: "copilot" });
      expect(loadConfig().aiProvider).toBe("copilot");

      setEnv({ AI_PROVIDER: "opencode" });
      expect(loadConfig().aiProvider).toBe("opencode");

      setEnv({ AI_PROVIDER: "cursor" });
      expect(loadConfig().aiProvider).toBe("cursor");
    });

    it("should load OPENCODE_MODEL from environment", () => {
      setEnv({
        OPENCODE_MODEL: "claude-3.5-sonnet",
      });

      const config = loadConfig();

      expect(config.opencodeModel).toBe("claude-3.5-sonnet");
    });

    it("should load OPENCODE_TIMEOUT_MS from environment", () => {
      setEnv({
        OPENCODE_TIMEOUT_MS: "120000",
      });

      const config = loadConfig();

      expect(config.opencodeTimeoutMs).toBe(120000);
    });

    it("should ignore OPENCODE_TIMEOUT_MS when zero or negative", () => {
      setEnv({
        OPENCODE_TIMEOUT_MS: "0",
      });

      const config = loadConfig();

      expect(config.opencodeTimeoutMs).toBeUndefined();
    });

    it("should load CURSOR_MODEL from environment", () => {
      setEnv({
        CURSOR_MODEL: "gpt-5",
      });

      const config = loadConfig();

      expect(config.cursorModel).toBe("gpt-5");
    });

    it("should load CURSOR_TIMEOUT_MS from environment", () => {
      setEnv({
        CURSOR_TIMEOUT_MS: "180000",
      });

      const config = loadConfig();

      expect(config.cursorTimeoutMs).toBe(180000);
    });

    it("should ignore CURSOR_TIMEOUT_MS when zero or negative", () => {
      setEnv({
        CURSOR_TIMEOUT_MS: "0",
      });

      const config = loadConfig();

      expect(config.cursorTimeoutMs).toBeUndefined();
    });

    it("should prefer MM_ prefixed environment variables over unprefixed", () => {
      setEnv({
        MM_GITHUB_TOKEN: "mm-token",
        GITHUB_TOKEN: "old-token",
        MM_PLATFORM: "azure",
        DEFAULT_PLATFORM: "github",
      });

      const config = loadConfig();

      expect(config.github.token).toBe("mm-token");
      expect(config.defaultPlatform).toBe("azure");
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
        MM_COPILOT_MODEL: "gpt-5",
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
      expect(config.copilotModel).toBe("gpt-5");
      expect(config.copilotTimeoutMs).toBe(60000);
      expect(config.commentFilter.minConfidence).toBe("low");
      expect(config.commentFilter.skipPreExisting).toBe(false);
      expect(config.commentFilter.postResolutionComments).toBe(false);
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
        copilotModel: "gpt-5.2",
        copilotTimeout: 90000,
        minCommentConfidence: "medium",
        skipExistingIssues: "false",
        postResolutionComments: "true",
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
      expect(config.copilotModel).toBe("gpt-5.2");
      expect(config.copilotTimeoutMs).toBe(90000);
      expect(config.commentFilter.minConfidence).toBe("medium");
      expect(config.commentFilter.skipPreExisting).toBe(false);
      expect(config.commentFilter.postResolutionComments).toBe(true);
      expect(config.reviewRuns).toBe(5);
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
