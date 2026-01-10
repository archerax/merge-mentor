import path from "node:path";
import dotenv from "dotenv";
import type { AIProviderType } from "./ai/types.js";
import { ConfigurationError } from "./errors/index.js";
import type { FindingConfidence } from "./platforms/types.js";

// Load .env from current working directory (supports both local and global usage)
// Set quiet to true to suppress "injecting env" message
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
  readonly openaiApiKey?: string;
  readonly openaiModel?: string;
  readonly openaiTimeoutMs?: number;
  readonly openaiBaseUrl?: string;
  readonly openaiMaxRetries?: number;
  readonly commentFilter: CommentFilterConfig;
  /** Number of review runs to perform (1-5). Higher values increase thoroughness but also time/cost. */
  readonly reviewRuns: number;
}

/**
 * Gets environment variable value with MM_ prefix fallback.
 * Tries MM_ prefixed version first, then falls back to old unprefixed names for backward compatibility.
 */
function getEnvWithPrefix(key: string): string | undefined {
  // Mapping from new keys to old keys for backward compatibility
  const oldKeyMapping: Record<string, string> = {
    PLATFORM: "DEFAULT_PLATFORM",
    AZURE_TOKEN: "AZURE_DEVOPS_TOKEN",
    AZURE_ORG: "AZURE_DEVOPS_ORG",
    AZURE_PROJECT: "AZURE_DEVOPS_PROJECT",
    AZURE_REPO: "AZURE_DEVOPS_REPO",
    COMMENT_IDENTIFIER: "BOT_COMMENT_IDENTIFIER",
    SKIP_EXISTING_ISSUES: "SKIP_PREEXISTING_ISSUES",
    COPILOT_TIMEOUT: "COPILOT_TIMEOUT_MS",
    OPENCODE_TIMEOUT: "OPENCODE_TIMEOUT_MS",
    CURSOR_TIMEOUT: "CURSOR_TIMEOUT_MS",
    OPENAI_TIMEOUT: "OPENAI_TIMEOUT_MS",
  };

  const newKey = `MM_${key}`;
  const oldKey = oldKeyMapping[key] ?? key;

  return process.env[newKey] ?? process.env[oldKey];
}

/**
 * Loads configuration from environment variables or CLI overrides.
 *
 * @param cliOverrides - Optional CLI parameter overrides
 * @returns Complete configuration object with defaults applied
 *
 * @example
 * ```typescript
 * const config = loadConfig();
 * console.log(config.defaultPlatform); // 'github'
 * ```
 */
export function loadConfig(cliOverrides?: Partial<CliOverrides>): Config {
  const copilotTimeoutMs =
    (cliOverrides?.copilotTimeout ?? getEnvWithPrefix("COPILOT_TIMEOUT"))
      ? Number.parseInt(
          cliOverrides?.copilotTimeout?.toString() ?? getEnvWithPrefix("COPILOT_TIMEOUT")!,
          10
        )
      : undefined;
  const opencodeTimeoutMs =
    (cliOverrides?.opencodeTimeout ?? getEnvWithPrefix("OPENCODE_TIMEOUT"))
      ? Number.parseInt(
          cliOverrides?.opencodeTimeout?.toString() ?? getEnvWithPrefix("OPENCODE_TIMEOUT")!,
          10
        )
      : undefined;
  const cursorTimeoutMs =
    (cliOverrides?.cursorTimeout ?? getEnvWithPrefix("CURSOR_TIMEOUT"))
      ? Number.parseInt(
          cliOverrides?.cursorTimeout?.toString() ?? getEnvWithPrefix("CURSOR_TIMEOUT")!,
          10
        )
      : undefined;
  const openaiTimeoutMs =
    (cliOverrides?.openaiTimeout ?? getEnvWithPrefix("OPENAI_TIMEOUT"))
      ? Number.parseInt(
          cliOverrides?.openaiTimeout?.toString() ?? getEnvWithPrefix("OPENAI_TIMEOUT")!,
          10
        )
      : undefined;
  const openaiMaxRetries =
    (cliOverrides?.openaiMaxRetries ?? getEnvWithPrefix("OPENAI_MAX_RETRIES"))
      ? Number.parseInt(
          cliOverrides?.openaiMaxRetries?.toString() ?? getEnvWithPrefix("OPENAI_MAX_RETRIES")!,
          10
        )
      : undefined;

  const minConfidence = validateMinConfidence(
    cliOverrides?.minCommentConfidence ?? getEnvWithPrefix("MIN_COMMENT_CONFIDENCE")
  );
  const reviewRuns = validateReviewRuns(
    cliOverrides?.reviewRuns?.toString() ?? getEnvWithPrefix("REVIEW_RUNS")
  );
  const aiProvider = validateAIProvider(
    cliOverrides?.aiProvider ?? getEnvWithPrefix("AI_PROVIDER")
  );

  return {
    defaultPlatform:
      ((cliOverrides?.platform ?? getEnvWithPrefix("PLATFORM")) as Platform) || "github",
    github: {
      token: cliOverrides?.githubToken ?? getEnvWithPrefix("GITHUB_TOKEN") ?? "",
      owner: cliOverrides?.githubRepoOwner ?? getEnvWithPrefix("GITHUB_REPO_OWNER") ?? "",
      repo: cliOverrides?.githubRepoName ?? getEnvWithPrefix("GITHUB_REPO_NAME") ?? "",
    },
    azure: {
      token: cliOverrides?.azureToken ?? getEnvWithPrefix("AZURE_TOKEN") ?? "",
      org: cliOverrides?.azureOrg ?? getEnvWithPrefix("AZURE_ORG") ?? "",
      project: cliOverrides?.azureProject ?? getEnvWithPrefix("AZURE_PROJECT") ?? "",
      repo: cliOverrides?.azureRepo ?? getEnvWithPrefix("AZURE_REPO") ?? "",
    },
    botCommentIdentifier:
      cliOverrides?.commentIdentifier ?? getEnvWithPrefix("COMMENT_IDENTIFIER") ?? "[merge-mentor]",
    aiProvider,
    copilotModel: cliOverrides?.copilotModel ?? getEnvWithPrefix("COPILOT_MODEL"),
    copilotTimeoutMs: copilotTimeoutMs && copilotTimeoutMs > 0 ? copilotTimeoutMs : undefined,
    opencodeModel: cliOverrides?.opencodeModel ?? getEnvWithPrefix("OPENCODE_MODEL"),
    opencodeTimeoutMs: opencodeTimeoutMs && opencodeTimeoutMs > 0 ? opencodeTimeoutMs : undefined,
    cursorModel: cliOverrides?.cursorModel ?? getEnvWithPrefix("CURSOR_MODEL"),
    cursorTimeoutMs: cursorTimeoutMs && cursorTimeoutMs > 0 ? cursorTimeoutMs : undefined,
    openaiApiKey: cliOverrides?.openaiApiKey ?? getEnvWithPrefix("OPENAI_API_KEY"),
    openaiModel: cliOverrides?.openaiModel ?? getEnvWithPrefix("OPENAI_MODEL"),
    openaiTimeoutMs: openaiTimeoutMs && openaiTimeoutMs > 0 ? openaiTimeoutMs : undefined,
    openaiBaseUrl: cliOverrides?.openaiBaseUrl ?? getEnvWithPrefix("OPENAI_BASE_URL"),
    openaiMaxRetries: openaiMaxRetries && openaiMaxRetries > 0 ? openaiMaxRetries : undefined,
    commentFilter: {
      minConfidence,
      skipPreExisting:
        (cliOverrides?.skipExistingIssues ?? getEnvWithPrefix("SKIP_EXISTING_ISSUES")) !== "false",
      postResolutionComments:
        (cliOverrides?.postResolutionComments ?? getEnvWithPrefix("POST_RESOLUTION_COMMENTS")) !==
        "false",
    },
    reviewRuns,
  };
}

/** CLI parameter overrides for configuration. */
export interface CliOverrides {
  readonly platform?: string;
  readonly githubToken?: string;
  readonly githubRepoOwner?: string;
  readonly githubRepoName?: string;
  readonly azureToken?: string;
  readonly azureOrg?: string;
  readonly azureProject?: string;
  readonly azureRepo?: string;
  readonly commentIdentifier?: string;
  readonly aiProvider?: string;
  readonly copilotModel?: string;
  readonly copilotTimeout?: number;
  readonly opencodeModel?: string;
  readonly opencodeTimeout?: number;
  readonly cursorModel?: string;
  readonly cursorTimeout?: number;
  readonly openaiApiKey?: string;
  readonly openaiModel?: string;
  readonly openaiTimeout?: number;
  readonly openaiBaseUrl?: string;
  readonly openaiMaxRetries?: number;
  readonly minCommentConfidence?: string;
  readonly skipExistingIssues?: string;
  readonly postResolutionComments?: string;
  readonly reviewRuns?: number;
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
  const validProviders: AIProviderType[] = ["copilot", "opencode", "cursor", "openai"];
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
      throw new ConfigurationError(
        "MM_GITHUB_TOKEN",
        "Required for GitHub platform. Set via MM_GITHUB_TOKEN env var or --github-token CLI flag."
      );
    }
    if (!config.github.owner) {
      throw new ConfigurationError(
        "MM_GITHUB_REPO_OWNER",
        "Required for GitHub platform. Set via MM_GITHUB_REPO_OWNER env var or --github-repo-owner CLI flag."
      );
    }
    if (!config.github.repo) {
      throw new ConfigurationError(
        "MM_GITHUB_REPO_NAME",
        "Required for GitHub platform. Set via MM_GITHUB_REPO_NAME env var or --github-repo-name CLI flag."
      );
    }
  } else if (platform === "azure") {
    if (!config.azure.token) {
      throw new ConfigurationError(
        "MM_AZURE_TOKEN",
        "Required for Azure DevOps platform. Set via MM_AZURE_TOKEN env var or --azure-token CLI flag."
      );
    }
    if (!config.azure.org) {
      throw new ConfigurationError(
        "MM_AZURE_ORG",
        "Required for Azure DevOps platform. Set via MM_AZURE_ORG env var or --azure-org CLI flag."
      );
    }
    if (!config.azure.project) {
      throw new ConfigurationError(
        "MM_AZURE_PROJECT",
        "Required for Azure DevOps platform. Set via MM_AZURE_PROJECT env var or --azure-project CLI flag."
      );
    }
    if (!config.azure.repo) {
      throw new ConfigurationError(
        "MM_AZURE_REPO",
        "Required for Azure DevOps platform. Set via MM_AZURE_REPO env var or --azure-repo CLI flag."
      );
    }
  }
}
