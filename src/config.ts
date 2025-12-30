import path from "node:path";
import dotenv from "dotenv";
import type { AIProviderType } from "./ai/types.js";
import { ConfigurationError } from "./errors/index.js";
import type { FindingConfidence } from "./platforms/types.js";

// Load .env from current working directory (supports both local and global usage)
dotenv.config({ path: path.join(process.cwd(), ".env"), quiet: true });

/** Supported platform types for PR reviews. */
export type Platform = "github" | "azure";

/** GitHub-specific configuration. */
export interface GitHubConfig {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
}

/** Azure DevOps-specific configuration. */
export interface AzureConfig {
  readonly token: string;
  readonly org: string;
  readonly project: string;
  readonly repo: string;
}

/** Comment filtering configuration. */
export interface CommentFilterConfig {
  /** Minimum confidence level for posting comments. */
  readonly minConfidence: FindingConfidence;
  /** Skip pre-existing issues (issues not introduced in this PR). */
  readonly skipPreExisting: boolean;
  /** Post a resolution comment before resolving threads. */
  readonly postResolutionComments: boolean;
}

/** Application configuration loaded from environment variables. */
export interface Config {
  readonly defaultPlatform: Platform;
  readonly github: GitHubConfig;
  readonly azure: AzureConfig;
  readonly botCommentIdentifier: string;
  /** AI provider to use for code reviews. Default: copilot */
  readonly aiProvider: AIProviderType;
  readonly copilotModel?: string;
  readonly copilotTimeoutMs?: number;
  readonly opencodeModel?: string;
  readonly opencodeTimeoutMs?: number;
  readonly cursorModel?: string;
  readonly cursorTimeoutMs?: number;
  readonly commentFilter: CommentFilterConfig;
  /** Number of review runs to perform (1-5). Higher values increase thoroughness but also time/cost. */
  readonly reviewRuns: number;
}

/**
 * Loads configuration from environment variables.
 *
 * @returns Complete configuration object with defaults applied
 *
 * @example
 * ```typescript
 * const config = loadConfig();
 * console.log(config.defaultPlatform); // 'github'
 * ```
 */
export function loadConfig(): Config {
  const copilotTimeoutMs = process.env.COPILOT_TIMEOUT_MS
    ? Number.parseInt(process.env.COPILOT_TIMEOUT_MS, 10)
    : undefined;
  const opencodeTimeoutMs = process.env.OPENCODE_TIMEOUT_MS
    ? Number.parseInt(process.env.OPENCODE_TIMEOUT_MS, 10)
    : undefined;
  const cursorTimeoutMs = process.env.CURSOR_TIMEOUT_MS
    ? Number.parseInt(process.env.CURSOR_TIMEOUT_MS, 10)
    : undefined;

  const minConfidence = validateMinConfidence(process.env.MIN_COMMENT_CONFIDENCE);
  const reviewRuns = validateReviewRuns(process.env.REVIEW_RUNS);
  const aiProvider = validateAIProvider(process.env.AI_PROVIDER);

  return {
    defaultPlatform: (process.env.DEFAULT_PLATFORM as Platform) || "github",
    github: {
      token: process.env.GITHUB_TOKEN || "",
      owner: process.env.GITHUB_REPO_OWNER || "",
      repo: process.env.GITHUB_REPO_NAME || "",
    },
    azure: {
      token: process.env.AZURE_DEVOPS_TOKEN || "",
      org: process.env.AZURE_DEVOPS_ORG || "",
      project: process.env.AZURE_DEVOPS_PROJECT || "",
      repo: process.env.AZURE_DEVOPS_REPO || "",
    },
    botCommentIdentifier: process.env.BOT_COMMENT_IDENTIFIER || "[merge-mentor]",
    aiProvider,
    copilotModel: process.env.COPILOT_MODEL,
    copilotTimeoutMs: copilotTimeoutMs && copilotTimeoutMs > 0 ? copilotTimeoutMs : undefined,
    opencodeModel: process.env.OPENCODE_MODEL,
    opencodeTimeoutMs: opencodeTimeoutMs && opencodeTimeoutMs > 0 ? opencodeTimeoutMs : undefined,
    cursorModel: process.env.CURSOR_MODEL,
    cursorTimeoutMs: cursorTimeoutMs && cursorTimeoutMs > 0 ? cursorTimeoutMs : undefined,
    commentFilter: {
      minConfidence,
      skipPreExisting: process.env.SKIP_PREEXISTING_ISSUES !== "false",
      postResolutionComments: process.env.POST_RESOLUTION_COMMENTS !== "false",
    },
    reviewRuns,
  };
}

function validateMinConfidence(value: string | undefined): FindingConfidence {
  const validConfidences: FindingConfidence[] = ["high", "medium", "low"];
  if (value && validConfidences.includes(value as FindingConfidence)) {
    return value as FindingConfidence;
  }
  return "high"; // Default to high confidence
}

function validateReviewRuns(value: string | undefined): number {
  if (!value) {
    return 1; // Default to 1 run
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 5) {
    return 1; // Default to 1 for invalid values
  }
  return parsed;
}

function validateAIProvider(value: string | undefined): AIProviderType {
  const validProviders: AIProviderType[] = ["copilot", "opencode", "cursor"];
  if (value && validProviders.includes(value as AIProviderType)) {
    return value as AIProviderType;
  }
  return "copilot"; // Default to copilot for backward compatibility
}

/**
 * Validates configuration for the specified platform.
 *
 * @param config - Configuration object to validate
 * @param platform - Target platform requiring validation
 * @throws {ConfigurationError} When required configuration is missing
 *
 * @example
 * ```typescript
 * const config = loadConfig();
 * validateConfig(config, 'github'); // throws if GitHub config is incomplete
 * ```
 */
export function validateConfig(config: Config, platform: Platform): void {
  if (platform === "github") {
    if (!config.github.token) {
      throw new ConfigurationError("GITHUB_TOKEN", "Required for GitHub platform");
    }
    if (!config.github.owner) {
      throw new ConfigurationError("GITHUB_REPO_OWNER", "Required for GitHub platform");
    }
    if (!config.github.repo) {
      throw new ConfigurationError("GITHUB_REPO_NAME", "Required for GitHub platform");
    }
  } else if (platform === "azure") {
    if (!config.azure.token) {
      throw new ConfigurationError("AZURE_DEVOPS_TOKEN", "Required for Azure DevOps platform");
    }
    if (!config.azure.org) {
      throw new ConfigurationError("AZURE_DEVOPS_ORG", "Required for Azure DevOps platform");
    }
    if (!config.azure.project) {
      throw new ConfigurationError("AZURE_DEVOPS_PROJECT", "Required for Azure DevOps platform");
    }
    if (!config.azure.repo) {
      throw new ConfigurationError("AZURE_DEVOPS_REPO", "Required for Azure DevOps platform");
    }
  }
}
