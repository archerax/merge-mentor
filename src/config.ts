import path from "node:path";
import type { AIProviderType } from "./ai/types.js";
import { ConfigurationError } from "./errors/index.js";
import { type Environment, processEnvironment } from "./ports/environment.js";

/** Supported platform types for PR reviews. */
export type Platform = "github" | "azure";

/** Supported review types for specialized analysis. */
export type ReviewType = "general" | "testing" | "security" | "performance" | "fast";

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

/** Application configuration loaded from environment variables. */
export interface Config {
  readonly defaultPlatform: Platform;
  readonly github: GitHubConfig;
  readonly azure: AzureConfig;
  readonly botCommentIdentifier: string;
  /** AI provider to use for code reviews. Default: copilot-sdk */
  readonly aiProvider: AIProviderType;
  readonly copilotToken?: string;
  readonly copilotModel?: string;
  readonly copilotTimeoutMs?: number;
  readonly copilotSdkModel?: string;
  readonly copilotSdkTimeoutMs?: number;
  readonly opencodeModel?: string;
  readonly opencodeTimeoutMs?: number;
  readonly opencodeSdkModel?: string;
  readonly opencodeSdkTimeoutMs?: number;
  /** Skip pre-existing issues (issues not introduced in this PR). */
  readonly skipPreExisting: boolean;
  /** Number of review runs to perform (1-5). Higher values increase thoroughness but also time/cost. */
  readonly reviewRuns: number;
  /** Type of review to perform (general, testing, security, performance). Default: general */
  readonly reviewType: ReviewType;
  /** Whether to show streaming output from AI providers. Default: true (if TTY) */
  readonly streamingEnabled: boolean;
  /** Number of lines to show in the streaming display. Default: 5 */
  readonly streamingLines: number;
  /** Base path for temporary files (cache, diffs, logs, repos, etc.). Default: ./.mergementor */
  readonly tempPath: string;
}

/**
 * Parses an optional timeout value from string or number.
 * Returns undefined if not provided or if the value is not a positive number.
 * Invalid values (NaN, zero, negative) are silently ignored.
 *
 * @param raw - Raw timeout value (string, number, or undefined)
 * @returns Parsed timeout in milliseconds, or undefined if not provided or invalid
 *
 * @internal Used internally by loadConfig for consistent timeout parsing
 */
function parseOptionalTimeout(raw: string | number | undefined): number | undefined {
  if (raw === undefined || raw === "") {
    return undefined;
  }

  const value = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;

  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
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
export function loadConfig(
  cliOverrides?: Partial<CliOverrides>,
  env: Environment = processEnvironment
): Config {
  const copilotTimeoutMs = parseOptionalTimeout(
    cliOverrides?.copilotTimeout ?? env.get("MM_COPILOT_TIMEOUT")
  );
  const copilotSdkTimeoutMs = parseOptionalTimeout(
    cliOverrides?.copilotSdkTimeout ?? env.get("MM_COPILOT_SDK_TIMEOUT")
  );
  const opencodeTimeoutMs = parseOptionalTimeout(
    cliOverrides?.opencodeTimeout ?? env.get("MM_OPENCODE_TIMEOUT")
  );
  const opencodeSdkTimeoutMs = parseOptionalTimeout(
    cliOverrides?.opencodeSdkTimeout ?? env.get("MM_OPENCODE_SDK_TIMEOUT")
  );

  const reviewRuns = validateReviewRuns(
    cliOverrides?.reviewRuns?.toString() ?? env.get("MM_REVIEW_RUNS")
  );
  const aiProvider = validateAIProvider(cliOverrides?.aiProvider ?? env.get("MM_AI_PROVIDER"));
  const reviewType = validateReviewType(cliOverrides?.reviewType ?? env.get("MM_REVIEW_TYPE"));

  return {
    defaultPlatform: ((cliOverrides?.platform ?? env.get("MM_PLATFORM")) as Platform) || "github",
    github: {
      token: cliOverrides?.githubToken ?? env.get("MM_GITHUB_TOKEN") ?? "",
      owner: cliOverrides?.githubRepoOwner ?? env.get("MM_GITHUB_REPO_OWNER") ?? "",
      repo: cliOverrides?.githubRepoName ?? env.get("MM_GITHUB_REPO_NAME") ?? "",
    },
    azure: {
      token: cliOverrides?.azureToken ?? env.get("MM_AZURE_TOKEN") ?? "",
      org: cliOverrides?.azureOrg ?? env.get("MM_AZURE_ORG") ?? "",
      project: cliOverrides?.azureProject ?? env.get("MM_AZURE_PROJECT") ?? "",
      repo: cliOverrides?.azureRepo ?? env.get("MM_AZURE_REPO") ?? "",
    },
    botCommentIdentifier:
      cliOverrides?.commentIdentifier ?? env.get("MM_COMMENT_IDENTIFIER") ?? "[merge-mentor]",
    aiProvider,
    copilotToken: cliOverrides?.copilotToken ?? env.get("MM_COPILOT_TOKEN"),
    copilotModel: cliOverrides?.copilotModel ?? env.get("MM_COPILOT_MODEL"),
    copilotTimeoutMs,
    copilotSdkModel: cliOverrides?.copilotSdkModel ?? env.get("MM_COPILOT_SDK_MODEL"),
    copilotSdkTimeoutMs,
    opencodeModel: cliOverrides?.opencodeModel ?? env.get("MM_OPENCODE_MODEL"),
    opencodeTimeoutMs,
    opencodeSdkModel: cliOverrides?.opencodeSdkModel ?? env.get("MM_OPENCODE_SDK_MODEL"),
    opencodeSdkTimeoutMs,
    skipPreExisting:
      (cliOverrides?.skipExistingIssues ?? env.get("MM_SKIP_EXISTING_ISSUES")) !== "false",
    reviewRuns,
    reviewType,
    streamingEnabled: cliOverrides?.streamingEnabled ?? env.get("MM_STREAMING_ENABLED") !== "false",
    streamingLines:
      cliOverrides?.streamingLines ??
      (env.get("MM_STREAMING_LINES")
        ? Number.parseInt(env.get("MM_STREAMING_LINES") ?? "", 10)
        : 9),
    tempPath: path.resolve(cliOverrides?.tempPath ?? env.get("MM_TEMP_PATH") ?? "./.mergementor"),
  };
}

/** CLI parameter overrides for configuration. */
interface CliOverrides {
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
  readonly copilotToken?: string;
  readonly copilotModel?: string;
  readonly copilotTimeout?: number;
  readonly copilotSdkModel?: string;
  readonly copilotSdkTimeout?: number;
  readonly opencodeModel?: string;
  readonly opencodeTimeout?: number;
  readonly opencodeSdkModel?: string;
  readonly opencodeSdkTimeout?: number;
  readonly skipExistingIssues?: string;
  readonly reviewRuns?: number;
  readonly reviewType?: string;
  readonly streamingEnabled?: boolean;
  readonly streamingLines?: number;
  readonly tempPath?: string;
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
  const validProviders: AIProviderType[] = ["copilot", "copilot-sdk", "opencode", "opencode-sdk"];
  if (value && validProviders.includes(value as AIProviderType)) {
    return value as AIProviderType;
  }
  return "copilot-sdk"; // Default to copilot-sdk
}

function validateReviewType(value: string | undefined): ReviewType {
  const validTypes: ReviewType[] = ["general", "testing", "security", "performance", "fast"];
  if (value && validTypes.includes(value as ReviewType)) {
    return value as ReviewType;
  }
  return "general"; // Default to general
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
