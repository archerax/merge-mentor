import path from "node:path";
import type { AIProviderType } from "./ai/types.js";
import { ConfigurationError } from "./errors/index.js";
import { type Environment, processEnvironment } from "./ports/environment.js";
import type { GitBackendType } from "./review/gitClient.js";
import {
  type GeneralReviewPhase,
  parseCustomReviewPhases,
  parseReviewPasses,
  type ResolvedReviewProfile,
  type ReviewPass,
  type ReviewStrategy,
  type ReviewType,
  resolveReviewProfile,
  validateReviewStrategy as validateReviewStrategyValue,
  validateReviewType as validateReviewTypeValue,
} from "./review/reviewSelection.js";

/** Supported platform types for PR reviews. */
export type Platform = "github" | "azure";

export type {
  ReviewPass,
  ReviewStrategy,
} from "./review/reviewSelection.js";

/**
 * Deprecated environment variable aliases retained for v1 compatibility.
 *
 * @deprecated Remove these aliases in v2 after deleting fallback support.
 */
const DEPRECATED_ENV_VAR_ALIASES = {
  agentTimeout: "MM_AGENT_TIMEOUT",
  copilotModel: "MM_COPILOT_MODEL",
  copilotSdkModel: "MM_COPILOT_SDK_MODEL",
  opencodeModel: "MM_OPENCODE_MODEL",
  opencodeSdkModel: "MM_OPENCODE_SDK_MODEL",
  copilotSdkBaseUrl: "MM_COPILOT_SDK_BASE_URL",
  copilotSdkApiKey: "MM_COPILOT_SDK_API_KEY",
} as const;

/** GitHub-specific configuration. */
interface GitHubConfig {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
}

/** Azure DevOps-specific configuration. */
interface AzureConfig {
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
  /** Git backend to use for cloning and fetching repositories. Default: cli */
  readonly gitBackend: GitBackendType;
  readonly copilotToken?: string;
  /** Shared timeout for all AI providers. Preferred over provider-specific timeout aliases. */
  readonly aiTimeoutMs?: number;
  /** @deprecated Use aiTimeoutMs instead. */
  readonly agentTimeoutMs?: number;
  /** Generic model identifier for the active AI provider. */
  readonly aiModel?: string;
  /** @deprecated Use aiModel instead. */
  readonly copilotModel?: string;
  /** @deprecated Use aiTimeoutMs instead. */
  readonly copilotTimeoutMs?: number;
  /** @deprecated Use aiModel instead. */
  readonly copilotSdkModel?: string;
  /** Generic OpenAI-compatible BYOK base URL for AI providers that support it. */
  readonly aiBaseUrl?: string;
  /** Generic BYOK API key for AI providers that support it. */
  readonly aiApiKey?: string;
  /** @deprecated Use aiTimeoutMs instead. */
  readonly copilotSdkTimeoutMs?: number;
  /** @deprecated Use aiModel instead. */
  readonly opencodeModel?: string;
  /** @deprecated Use aiTimeoutMs instead. */
  readonly opencodeTimeoutMs?: number;
  /** @deprecated Use aiModel instead. */
  readonly opencodeSdkModel?: string;
  /** @deprecated Use aiTimeoutMs instead. */
  readonly opencodeSdkTimeoutMs?: number;
  /** Skip pre-existing issues (issues not introduced in this PR). */
  readonly skipPreExisting: boolean;
  /** Number of review runs to perform (1-5). Higher values increase thoroughness but also time/cost. */
  readonly reviewRuns: number;
  /** Legacy review type alias used to resolve the review profile. Default: general */
  readonly reviewType: ReviewType;
  /** Ordered additive review passes resolved for this run. */
  readonly reviewPasses: readonly ReviewPass[];
  /** Execution strategy for the resolved review profile. */
  readonly reviewStrategy: ReviewStrategy;
  /** Fully resolved baseline + passes + strategy profile for this run. */
  readonly reviewProfile: ResolvedReviewProfile;
  /** Selected review passes retained for legacy custom-review compatibility. */
  readonly customReviewPhases?: readonly GeneralReviewPhase[];
  /** Whether to show streaming output from AI providers. Default: true (if TTY) */
  readonly streamingEnabled: boolean;
  /** Number of lines to show in the streaming display. Default: 5 */
  readonly streamingLines: number;
  /** Base path for temporary files (cache, diffs, logs, repos, etc.). Default: ./.mergementor */
  readonly tempPath: string;
  /** Suppress verbose multi-pass analysis instructions to save output tokens. Default: false */
  readonly tokenSaver: boolean;
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
  const aiTimeoutMs = parseOptionalTimeout(
    cliOverrides?.aiTimeout ??
      cliOverrides?.agentTimeout ??
      env.get("MM_AI_TIMEOUT") ??
      env.get(DEPRECATED_ENV_VAR_ALIASES.agentTimeout)
  );
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
  const reviewStrategy = validateReviewStrategy(
    cliOverrides?.reviewStrategy ?? env.get("MM_REVIEW_STRATEGY")
  );
  const explicitReviewPasses = parseReviewPasses(
    cliOverrides?.passes ?? env.get("MM_REVIEW_PASSES")
  );

  if (cliOverrides?.passes && cliOverrides?.phases) {
    throw new ConfigurationError("passes", "Use either --passes or --phases, not both.");
  }

  const legacyCustomReviewPhases = parseCustomReviewPhases(reviewType, cliOverrides?.phases);
  const resolvedReviewProfile = resolveReviewProfile({
    reviewType,
    reviewPasses: explicitReviewPasses ?? legacyCustomReviewPhases,
    reviewStrategy,
  });
  const gitBackend = validateGitBackend(cliOverrides?.gitBackend ?? env.get("MM_GIT_BACKEND"));

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
    gitBackend,
    copilotToken: cliOverrides?.copilotToken ?? env.get("MM_COPILOT_TOKEN"),
    aiTimeoutMs,
    agentTimeoutMs: aiTimeoutMs,
    aiModel: cliOverrides?.aiModel ?? env.get("MM_AI_MODEL"),
    copilotModel: cliOverrides?.copilotModel ?? env.get(DEPRECATED_ENV_VAR_ALIASES.copilotModel),
    copilotTimeoutMs,
    copilotSdkModel:
      cliOverrides?.copilotSdkModel ?? env.get(DEPRECATED_ENV_VAR_ALIASES.copilotSdkModel),
    aiBaseUrl:
      cliOverrides?.aiBaseUrl ??
      cliOverrides?.copilotSdkBaseUrl ??
      env.get("MM_AI_BASE_URL") ??
      env.get(DEPRECATED_ENV_VAR_ALIASES.copilotSdkBaseUrl),
    aiApiKey:
      cliOverrides?.aiApiKey ??
      cliOverrides?.copilotSdkApiKey ??
      env.get("MM_AI_API_KEY") ??
      env.get(DEPRECATED_ENV_VAR_ALIASES.copilotSdkApiKey),
    copilotSdkTimeoutMs,
    opencodeModel: cliOverrides?.opencodeModel ?? env.get(DEPRECATED_ENV_VAR_ALIASES.opencodeModel),
    opencodeTimeoutMs,
    opencodeSdkModel:
      cliOverrides?.opencodeSdkModel ?? env.get(DEPRECATED_ENV_VAR_ALIASES.opencodeSdkModel),
    opencodeSdkTimeoutMs,
    skipPreExisting:
      (cliOverrides?.skipExistingIssues ?? env.get("MM_SKIP_EXISTING_ISSUES")) !== "false",
    reviewRuns,
    reviewType,
    reviewPasses: resolvedReviewProfile.passes,
    reviewStrategy: resolvedReviewProfile.strategy,
    reviewProfile: resolvedReviewProfile,
    customReviewPhases: reviewType === "custom" ? resolvedReviewProfile.passes : undefined,
    streamingEnabled: cliOverrides?.streamingEnabled ?? env.get("MM_STREAMING_ENABLED") !== "false",
    streamingLines:
      cliOverrides?.streamingLines ??
      (env.get("MM_STREAMING_LINES")
        ? Number.parseInt(env.get("MM_STREAMING_LINES") ?? "", 10)
        : 9),
    tempPath: path.resolve(cliOverrides?.tempPath ?? env.get("MM_TEMP_PATH") ?? "./.mergementor"),
    tokenSaver: cliOverrides?.tokenSaver === true || env.get("MM_TOKEN_SAVER") === "true",
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
  readonly aiTimeout?: number;
  /** @deprecated Use aiTimeout instead. */
  readonly agentTimeout?: number;
  readonly aiModel?: string;
  /** @deprecated Use aiModel instead. */
  readonly copilotModel?: string;
  readonly copilotTimeout?: number;
  /** @deprecated Use aiModel instead. */
  readonly copilotSdkModel?: string;
  readonly aiBaseUrl?: string;
  readonly aiApiKey?: string;
  /** @deprecated Use aiBaseUrl instead. */
  readonly copilotSdkBaseUrl?: string;
  /** @deprecated Use aiApiKey instead. */
  readonly copilotSdkApiKey?: string;
  readonly copilotSdkTimeout?: number;
  /** @deprecated Use aiModel instead. */
  readonly opencodeModel?: string;
  readonly opencodeTimeout?: number;
  /** @deprecated Use aiModel instead. */
  readonly opencodeSdkModel?: string;
  readonly opencodeSdkTimeout?: number;
  readonly skipExistingIssues?: string;
  readonly reviewRuns?: number;
  readonly reviewType?: string;
  readonly passes?: string;
  readonly phases?: string;
  readonly reviewStrategy?: string;
  readonly streamingEnabled?: boolean;
  readonly streamingLines?: number;
  readonly tempPath?: string;
  readonly gitBackend?: string;
  readonly tokenSaver?: boolean;
}

/**
 * Validates the number of review runs.
 * Accepted values are 1-5. Values outside this range default to 1.
 *
 * @param value - Review run count as string or undefined
 * @returns Validated run count (1-5), or 1 if invalid
 *
 * @example
 * ```typescript
 * validateReviewRuns("3"); // 3
 * validateReviewRuns("10"); // 1 (default, out of range)
 * validateReviewRuns(undefined); // 1 (default)
 * ```
 */
export function validateReviewRuns(value: string | undefined): number {
  if (!value) {
    return 1; // Default to 1 run
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 5) {
    return 1; // Default to 1 for invalid values
  }
  return parsed;
}

/**
 * Validates the AI provider type.
 * Supported providers are: copilot, copilot-sdk, opencode, opencode-sdk.
 * Unknown values default to copilot-sdk.
 *
 * @param value - AI provider name as string or undefined
 * @returns Validated provider type, or 'copilot-sdk' if invalid
 *
 * @example
 * ```typescript
 * validateAIProvider("copilot"); // "copilot"
 * validateAIProvider("opencode-sdk"); // "opencode-sdk"
 * validateAIProvider("unknown"); // "copilot-sdk" (default)
 * validateAIProvider(undefined); // "copilot-sdk" (default)
 * ```
 */
export function validateAIProvider(value: string | undefined): AIProviderType {
  const validProviders: AIProviderType[] = ["copilot", "copilot-sdk", "opencode", "opencode-sdk"];
  if (value && validProviders.includes(value as AIProviderType)) {
    return value as AIProviderType;
  }
  return "copilot-sdk"; // Default to copilot-sdk
}

/**
 * Validates the review type.
 * Supported types are: general, testing, security, performance, fast, custom.
 * Unknown values default to general.
 *
 * @param value - Review type name as string or undefined
 * @returns Validated review type, or 'general' if invalid
 *
 * @example
 * ```typescript
 * validateReviewType("security"); // "security"
 * validateReviewType("performance"); // "performance"
 * validateReviewType("custom"); // "custom"
 * validateReviewType("unknown"); // "general" (default)
 * validateReviewType(undefined); // "general" (default)
 * ```
 */
export function validateReviewType(value: string | undefined): ReviewType {
  return validateReviewTypeValue(value);
}

/**
 * Validates the review strategy.
 * Supported strategies are: standard, fast.
 * Unknown values default to standard.
 */
export function validateReviewStrategy(value: string | undefined): ReviewStrategy {
  return validateReviewStrategyValue(value);
}

/**
 * Validates the git backend type.
 * Supported backends are: cli, isomorphic.
 * Unknown values default to cli.
 *
 * @param value - Git backend name as string or undefined
 * @returns Validated backend type, or 'cli' if invalid
 *
 * @example
 * ```typescript
 * validateGitBackend("isomorphic"); // "isomorphic"
 * validateGitBackend("cli"); // "cli"
 * validateGitBackend("unknown"); // "cli" (default)
 * validateGitBackend(undefined); // "cli" (default)
 * ```
 */
export function validateGitBackend(value: string | undefined): GitBackendType {
  const validBackends: GitBackendType[] = ["cli", "isomorphic"];
  if (value && validBackends.includes(value as GitBackendType)) {
    return value as GitBackendType;
  }
  return "cli"; // Default to cli
}

/**
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
