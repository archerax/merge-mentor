import type { AIProviderType } from "../ai/types.js";
import { detectCIEnvironment } from "../ci/index.js";
import { loadConfig, type Platform, validateConfig } from "../config.js";
import { initLogger, logger } from "../logger.js";
import { AzureDevOpsAdapter } from "../platforms/azure.js";
import { GitHubAdapter } from "../platforms/github.js";
import type { PlatformAdapter } from "../platforms/types.js";
import { consoleOutputWriter, processEnvironment } from "../ports/index.js";
import { ReviewEngine } from "../review/engine.js";
import { mergeCIContext } from "./review.js";
import type { DescribeExecutionResult, DescribeOptions, ProgramDeps } from "./types.js";

export async function executeDescribe(
  options: DescribeOptions,
  deps: ProgramDeps = {}
): Promise<DescribeExecutionResult> {
  const output = deps.output ?? consoleOutputWriter;
  const env = deps.env ?? processEnvironment;

  // Resolve CI context when --ci flag is set
  let resolvedOptions = options;
  if (options.ci) {
    const ciContext = detectCIEnvironment(env);
    if (!ciContext) {
      throw new Error(
        "--ci flag was set but no supported CI environment was detected. " +
          "Expected GITHUB_ACTIONS=true (GitHub Actions) or TF_BUILD=True (Azure Pipelines)."
      );
    }
    output.log(`\n🤖 CI mode: detected ${ciContext.ciSystem}\n`);

    // Pre-load MM_* token overrides from env so they take priority over
    // CI-detected tokens (e.g. SYSTEM_ACCESSTOKEN may lack permission to
    // post PR comments; users can supply a PAT via MM_AZURE_TOKEN instead).
    const optionsWithEnvTokens: DescribeOptions = {
      ...options,
      azureToken: options.azureToken ?? (env.get("MM_AZURE_TOKEN") || undefined),
      githubToken: options.githubToken ?? (env.get("MM_GITHUB_TOKEN") || undefined),
    };
    resolvedOptions = mergeCIContext(optionsWithEnvTokens, ciContext) as DescribeOptions;
  }

  if (resolvedOptions.pr === undefined) {
    throw new Error(
      "PR number is required. Pass --pr <number> or use --ci in a supported CI environment."
    );
  }

  const pr = resolvedOptions.pr;

  logger.info(
    {
      pr,
      platform: resolvedOptions.platform,
      provider: resolvedOptions.provider,
      write: resolvedOptions.write,
      ci: resolvedOptions.ci,
    },
    "Describe command initiated"
  );

  const config = loadConfig({
    platform: resolvedOptions.platform,
    githubToken: resolvedOptions.githubToken,
    githubRepoOwner: resolvedOptions.githubRepoOwner,
    githubRepoName: resolvedOptions.githubRepoName,
    azureToken: resolvedOptions.azureToken,
    azureOrg: resolvedOptions.azureOrg,
    azureProject: resolvedOptions.azureProject,
    azureRepo: resolvedOptions.azureRepo,
    tempPath: resolvedOptions.tempPath,
    aiProvider: resolvedOptions.provider,
    aiModel: resolvedOptions.aiModel,
    aiTimeout: resolvedOptions.aiTimeout,
    aiBaseUrl: resolvedOptions.aiBaseUrl,
    aiApiKey: resolvedOptions.aiApiKey,
    streamingEnabled: resolvedOptions.streamingEnabled,
    gitBackend: resolvedOptions.gitBackend,
  });

  // Initialize logger with configured temp path
  initLogger(config.tempPath);

  const platform = (resolvedOptions.platform || config.defaultPlatform) as Platform;

  if (!["github", "azure"].includes(platform)) {
    logger.error({ platform }, "Invalid platform specified");
    throw new Error(`Invalid platform "${platform}". Must be "github" or "azure".`);
  }

  // Validate and resolve AI provider
  const aiProvider = (resolvedOptions.provider || config.aiProvider) as AIProviderType;
  if (!["copilot-sdk", "opencode-sdk", "claude-agent-sdk"].includes(aiProvider)) {
    logger.error({ provider: aiProvider }, "Invalid AI provider specified");
    throw new Error(
      `Invalid AI provider "${aiProvider}". Must be "copilot-sdk", "opencode-sdk", or "claude-agent-sdk".`
    );
  }

  validateConfig(config, platform);

  let adapter: PlatformAdapter;
  if (platform === "github") {
    adapter = new GitHubAdapter(config);
  } else {
    adapter = new AzureDevOpsAdapter(config);
  }

  const aiModel = config.aiModel;
  const aiTimeoutMs = config.aiTimeoutMs;

  const engine = new ReviewEngine(adapter, config.botCommentIdentifier, aiProvider, {
    verbose: true,
    aiModel,
    aiTimeoutMs,
    copilotToken: config.copilotToken,
    aiBaseUrl: config.aiBaseUrl,
    aiApiKey: config.aiApiKey,
    streamingEnabled: resolvedOptions.streamingEnabled !== false && config.streamingEnabled,
    ciMode: resolvedOptions.ci,
    tempPath: config.tempPath,
    localWorkspacePath: resolvedOptions.localWorkspacePath,
    ignorePatterns: resolvedOptions.ignore,
    gitBackend: resolvedOptions.gitBackend ?? config.gitBackend,
  });

  const modeLabel = resolvedOptions.write ? " (write)" : " (dry-run)";
  output.log(
    `\n🔍 Starting PR description generation for PR #${pr} on ${platform}${modeLabel}...\n`
  );
  output.log(`  Platform: ${platform}`);
  output.log(`  Provider: ${aiProvider}`);
  if (aiModel) {
    output.log(`  Model:    ${aiModel}`);
  }
  if (config.aiBaseUrl) {
    output.log(`  BYOK URL: ${config.aiBaseUrl}`);
  }
  output.log("");

  const { title, body } = await engine.describePR({
    prNumber: pr,
    suggestTitle: resolvedOptions.suggestTitle,
    write: resolvedOptions.write,
    streamingEnabled: resolvedOptions.streamingEnabled !== false && config.streamingEnabled,
  });

  return { title, body, adapter, platform };
}

export function displayDescribeResults(
  title: string | undefined,
  body: string,
  write: boolean,
  deps: ProgramDeps = {}
): void {
  const output = deps.output ?? consoleOutputWriter;
  output.log("=".repeat(60));
  output.log("📝 PR Description Generation Complete");
  if (write) {
    output.log("   (PR details have been updated on the remote platform)");
  } else {
    output.log("   (Dry-run mode - showing what would be updated)");
  }
  output.log("=".repeat(60));
  output.log("");

  if (title !== undefined) {
    output.log("============================================================");
    output.log(`Suggested Title: ${title}`);
    output.log("============================================================");
    output.log("");
  }

  output.log("============================================================");
  output.log("Suggested Description:");
  output.log("============================================================");
  output.log(body);
  output.log("============================================================");
  output.log("");
}
