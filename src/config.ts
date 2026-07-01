import path from "node:path";
import { z } from "zod";
import type { AIProviderType, ReasoningEffort } from "./ai/types.js";
import { ConfigurationError } from "./errors/index.js";
import { type Environment, processEnvironment } from "./ports/environment.js";
import type { GitBackendType } from "./review/gitClient.js";
import {
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

export type { ReviewPass, ReviewStrategy } from "./review/reviewSelection.js";

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
  /** Generic model identifier for the active AI provider. */
  readonly aiModel?: string;
  /** Generic OpenAI-compatible BYOK base URL for AI providers that support it. */
  readonly aiBaseUrl?: string;
  /** Generic BYOK API key for AI providers that support it. */
  readonly aiApiKey?: string;
  /** Skip pre-existing issues (issues not introduced in this PR). */
  readonly skipPreExisting: boolean;
  /** Legacy review type alias used to resolve the review profile. Default: general */
  readonly reviewType: ReviewType;
  /** Ordered additive review passes resolved for this run. */
  readonly reviewPasses: readonly ReviewPass[];
  /** Execution strategy for the resolved review profile. */
  readonly reviewStrategy: ReviewStrategy;
  /** Fully resolved baseline + passes + strategy profile for this run. */
  readonly reviewProfile: ResolvedReviewProfile;
  /** Whether to show streaming output from AI providers. Default: true (if TTY) */
  readonly streamingEnabled: boolean;
  /** Number of lines to show in the streaming display. Default: 9 */
  readonly streamingLines: number;
  /** Base path for temporary files (cache, diffs, logs, repos, etc.). Default: ./.mergementor */
  readonly tempPath: string;
  /** Pin the session to the long-context tier when the selected model supports it. */
  readonly longContext: boolean;
  /** Reasoning effort level for models that support it. */
  readonly reasoningEffort?: ReasoningEffort;
  /** Enable experimental structured output via Copilot SDK tool calls. */
  readonly experimentalTools: boolean;
  /** Verify pull request changes against linked Product Backlog Items/Issues */
  readonly verifyPbi: boolean;
}

const AIProviderSchema = z
  .enum(["copilot-sdk", "opencode-sdk", "claude-agent-sdk"])
  .catch("copilot-sdk");
const GitBackendSchema = z.enum(["cli", "isomorphic"]).catch("cli");

const ConfigParserSchema = z.object({
  platform: z.enum(["github", "azure"]).catch("github"),
  aiProvider: AIProviderSchema,
  gitBackend: GitBackendSchema,
  reviewType: z
    .enum(["general", "testing", "security", "performance", "fast", "custom"])
    .catch("general"),
  reviewStrategy: z.enum(["deep", "fast"]).catch("fast"),
  streamingEnabled: z.preprocess(
    (val) => val !== "false" && val !== false,
    z.boolean().default(true)
  ),
  streamingLines: z.preprocess(
    (val) => {
      if (val === undefined || val === null) return undefined;
      return typeof val === "string" ? Number.parseInt(val, 10) : val;
    },
    z.custom<number>((val) => typeof val === "number").catch(9)
  ),
  tempPath: z.string().default("./.mergementor"),
  aiTimeoutMs: z.preprocess((val) => {
    if (val === undefined || val === null || val === "") return undefined;
    const parsed = typeof val === "string" ? Number.parseInt(val, 10) : val;
    return Number.isFinite(parsed) && (parsed as number) > 0 ? parsed : undefined;
  }, z.number().int().positive().optional()),
  longContext: z.preprocess(
    (val) => val === "true" || val === true || val === "1",
    z.boolean().default(false)
  ),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional().catch(undefined),
  experimentalTools: z.preprocess(
    (val) => val === "true" || val === true || val === "1",
    z.boolean().default(false)
  ),
  verifyPbi: z.preprocess(
    (val) => val === "true" || val === true || val === "1",
    z.boolean().default(false)
  ),
});

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
  const parsed = ConfigParserSchema.parse({
    platform: cliOverrides?.platform ?? env.get("MM_PLATFORM"),
    aiProvider: cliOverrides?.aiProvider ?? env.get("MM_AI_PROVIDER"),
    gitBackend: cliOverrides?.gitBackend ?? env.get("MM_GIT_BACKEND"),
    reviewType: cliOverrides?.reviewType ?? env.get("MM_REVIEW_TYPE"),
    reviewStrategy: cliOverrides?.reviewStrategy ?? env.get("MM_REVIEW_STRATEGY"),
    streamingEnabled: cliOverrides?.streamingEnabled ?? env.get("MM_STREAMING_ENABLED"),
    streamingLines:
      cliOverrides?.streamingLines ??
      (env.get("MM_STREAMING_LINES") ? (env.get("MM_STREAMING_LINES") ?? "") : undefined),
    tempPath: cliOverrides?.tempPath ?? env.get("MM_TEMP_PATH"),
    aiTimeoutMs: cliOverrides?.aiTimeout ?? env.get("MM_AI_TIMEOUT"),
    longContext: cliOverrides?.longContext ?? env.get("MM_LONG_CONTEXT"),
    reasoningEffort: cliOverrides?.reasoning ?? env.get("MM_REASONING"),
    experimentalTools: cliOverrides?.experimentalTools ?? env.get("MM_EXPERIMENTAL_TOOLS"),
    verifyPbi: cliOverrides?.verifyPbi ?? env.get("MM_VERIFY_PBI"),
  });

  const explicitReviewPasses = parseReviewPasses(
    cliOverrides?.passes ?? env.get("MM_REVIEW_PASSES")
  );

  const resolvedReviewProfile = resolveReviewProfile({
    reviewType: parsed.reviewType,
    reviewPasses: explicitReviewPasses,
    reviewStrategy: parsed.reviewStrategy,
  });

  return {
    defaultPlatform: parsed.platform as Platform,
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
    botCommentIdentifier: "[merge-mentor]",
    aiProvider: parsed.aiProvider,
    gitBackend: parsed.gitBackend,
    copilotToken: cliOverrides?.copilotToken ?? env.get("MM_COPILOT_TOKEN"),
    aiTimeoutMs: parsed.aiTimeoutMs,
    aiModel: cliOverrides?.aiModel ?? env.get("MM_AI_MODEL"),
    aiBaseUrl: cliOverrides?.aiBaseUrl ?? env.get("MM_AI_BASE_URL"),
    aiApiKey: cliOverrides?.aiApiKey ?? env.get("MM_AI_API_KEY"),
    skipPreExisting: true,
    reviewType: parsed.reviewType,
    reviewPasses: resolvedReviewProfile.passes,
    reviewStrategy: resolvedReviewProfile.strategy,
    reviewProfile: resolvedReviewProfile,
    streamingEnabled: parsed.streamingEnabled,
    streamingLines: parsed.streamingLines,
    tempPath: path.resolve(parsed.tempPath),
    longContext: parsed.longContext,
    reasoningEffort: parsed.reasoningEffort,
    experimentalTools: parsed.experimentalTools,
    verifyPbi: parsed.verifyPbi,
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
  readonly aiProvider?: string;
  readonly copilotToken?: string;
  readonly aiTimeout?: number;
  readonly aiModel?: string;
  readonly aiBaseUrl?: string;
  readonly aiApiKey?: string;
  readonly reviewType?: string;
  readonly passes?: string;
  readonly reviewStrategy?: string;
  readonly streamingEnabled?: boolean;
  readonly streamingLines?: number;
  readonly tempPath?: string;
  readonly gitBackend?: string;
  readonly longContext?: boolean;
  readonly reasoning?: string;
  readonly experimentalTools?: boolean;
  readonly verifyPbi?: boolean;
}

/**
 * Validates the AI provider type.
 * Supported providers are: copilot-sdk, opencode-sdk.
 * Unknown values default to copilot-sdk.
 *
 * @param value - AI provider name as string or undefined
 * @returns Validated provider type, or 'copilot-sdk' if invalid
 *
 * @example
 * ```typescript
 * validateAIProvider("copilot-sdk"); // "copilot-sdk"
 * validateAIProvider("opencode-sdk"); // "opencode-sdk"
 * validateAIProvider("unknown"); // "copilot-sdk" (default)
 * validateAIProvider(undefined); // "copilot-sdk" (default)
 * ```
 */
export function validateAIProvider(value: string | undefined): AIProviderType {
  return AIProviderSchema.parse(value);
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
 * Supported strategies are: deep, fast.
 * Unknown values default to fast.
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
  return GitBackendSchema.parse(value);
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
