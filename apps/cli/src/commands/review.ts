import {
  loadConfig,
  type Platform,
  type ReviewPass,
  type ReviewStrategy,
  validateConfig,
} from "@merge-mentor/config/config.js";
import { formatReviewPasses, formatReviewTypeLabel } from "@merge-mentor/config/reviewSelection.js";
import type { AIProviderType } from "@merge-mentor/core/ai/types.js";
import { ReviewEngine, type ReviewResult } from "@merge-mentor/core/review/engine.js";
import { saveReviewReport } from "@merge-mentor/core/review/reviewReport.js";
import type { PlatformAdapter } from "@merge-mentor/domain/platform.js";
import { AzureDevOpsAdapter } from "@merge-mentor/platforms/azure.js";
import { GitHubAdapter } from "@merge-mentor/platforms/github.js";
import { initLogger, logger } from "@merge-mentor/shared/logger.js";
import { consoleOutputWriter, processEnvironment } from "@merge-mentor/shared/ports/index.js";
import { formatTokenUsage } from "@merge-mentor/shared/utils/tokenUsage.js";

import { ensureCIContext } from "./shared/ci.js";
import type { ProgramDeps, ReviewExecutionResult, ReviewOptions } from "./types.js";

export { generateMarkdownReport } from "@merge-mentor/core/review/reviewReport.js";

/**
 * Execute the review command logic.
 * Extracted for testability.
 */
export async function executeReview(
  options: ReviewOptions,
  deps: ProgramDeps = {}
): Promise<ReviewExecutionResult> {
  const output = deps.output ?? consoleOutputWriter;
  const env = deps.env ?? processEnvironment;

  // Resolve CI context when --ci flag is set
  const resolvedOptions = ensureCIContext(options, { output, env });

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
    "Review command initiated"
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
    reviewType: resolvedOptions.reviewType,
    passes: resolvedOptions.passes,
    reviewStrategy: resolvedOptions.strategy,
    streamingEnabled: resolvedOptions.streamingEnabled,
    streamingLines: resolvedOptions.streamLines,
    gitBackend: resolvedOptions.gitBackend,
    longContext: resolvedOptions.longContext,
    reasoning: resolvedOptions.reasoning,
    experimentalTools: resolvedOptions.experimentalTools,
    verifyPbi: resolvedOptions.verifyPbi,
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
  if (!["copilot-sdk", "opencode-sdk"].includes(aiProvider)) {
    logger.error({ provider: aiProvider }, "Invalid AI provider specified");
    throw new Error(
      `Invalid AI provider "${aiProvider}". Must be "copilot-sdk" or "opencode-sdk".`
    );
  }

  validateConfig(config, platform);

  let adapter: PlatformAdapter;
  if (platform === "github") {
    adapter = new GitHubAdapter(config);
  } else {
    adapter = new AzureDevOpsAdapter(config);
  }

  const dryRun = !resolvedOptions.write;
  const aiModel = config.aiModel;
  const aiTimeoutMs = config.aiTimeoutMs;

  const engine = new ReviewEngine(adapter, config.botCommentIdentifier, aiProvider, {
    dryRun,
    verbose: true,
    aiModel,
    aiTimeoutMs,
    copilotToken: config.copilotToken,
    aiBaseUrl: config.aiBaseUrl,
    aiApiKey: config.aiApiKey,
    skipPreExisting: config.skipPreExisting,
    reviewType: resolvedOptions.reviewType ?? config.reviewType,
    reviewPasses: config.reviewPasses,
    reviewStrategy: config.reviewStrategy,
    streamingEnabled: resolvedOptions.streamingEnabled !== false && config.streamingEnabled,
    streamingLines: resolvedOptions.streamLines ?? config.streamingLines,
    ciMode: resolvedOptions.ci,
    tempPath: config.tempPath,
    localWorkspacePath: resolvedOptions.localWorkspacePath,
    ignorePatterns: resolvedOptions.ignore,
    gitBackend: resolvedOptions.gitBackend ?? config.gitBackend,
    experimentalTools: resolvedOptions.experimentalTools ?? config.experimentalTools,
    longContext: config.longContext,
    reasoningEffort: config.reasoningEffort,
    verifyPbi: config.verifyPbi,
    reReview: resolvedOptions.reReview,
    multiAgentMaxParallel: config.multiAgentMaxParallel,
  });

  const modeLabel = dryRun ? " (dry-run)" : "";
  output.log(`\n🔍 Starting code review for PR #${pr} on ${platform}${modeLabel}...\n`);
  output.log(`  Platform: ${platform}`);
  output.log(`  Provider: ${aiProvider}`);
  if (aiModel) {
    output.log(`  Model:    ${aiModel}`);
  }
  if (config.aiBaseUrl) {
    output.log(`  BYOK URL: ${config.aiBaseUrl}`);
  }
  output.log(
    `  Review:   ${formatReviewTypeLabel(
      resolvedOptions.reviewType ?? config.reviewType,
      config.reviewPasses,
      config.reviewStrategy
    )}`
  );
  output.log("");

  const result = await engine.reviewPR(pr);
  return { result, adapter, platform };
}

/**
 * Display review results to console.
 */
export function displayResults(
  result: ReviewResult,
  dryRun: boolean,
  adapter?: PlatformAdapter,
  platform?: Platform,
  aiProvider?: AIProviderType,
  reviewType = "general",
  reviewPasses?: readonly ReviewPass[],
  reviewStrategy: ReviewStrategy = "fast",
  tempPath?: string,
  deps: ProgramDeps = {}
): void {
  const output = deps.output ?? consoleOutputWriter;
  const reviewTypeLabel = formatReviewTypeLabel(reviewType, reviewPasses, reviewStrategy);
  const formattedPasses = formatReviewPasses(reviewPasses);
  output.log("=".repeat(60));
  output.log("📊 Review Complete");
  output.log("=".repeat(60));
  output.log(`PR: #${result.prDetails.number} - ${result.prDetails.title}`);
  output.log(`Author: ${result.prDetails.author}`);
  output.log(`Branch: ${result.prDetails.headBranch} → ${result.prDetails.baseBranch}`);
  output.log(`Review Profile: ${reviewTypeLabel}`);
  if (formattedPasses) {
    output.log(`Review Passes: ${formattedPasses}`);
  }
  if (reviewStrategy !== "fast") {
    output.log(`Review Strategy: ${reviewStrategy}`);
  }
  output.log("");
  output.log(`Files Reviewed: ${result.filesReviewed}`);
  output.log(`Lines Changed: +${result.linesAdded} / -${result.linesDeleted}`);
  if (result.filesSkipped > 0) {
    output.log(`Files Skipped: ${result.filesSkipped}`);
  }
  if (result.filesIgnored > 0) {
    output.log(`Files Ignored: ${result.filesIgnored}`);
    result.ignoredFiles.forEach((file) => {
      output.log(`  - ${file}`);
    });
  }
  const fileIssues = result.fileResults.reduce((sum, r) => sum + r.findings.length, 0);
  const crossFileIssues = result.crossFileResult.findings.length;
  output.log(`Total Issues Found: ${fileIssues + crossFileIssues}`);
  if (crossFileIssues > 0) {
    output.log(`  File-specific: ${fileIssues}`);
    output.log(`  Cross-file: ${crossFileIssues}`);
  }
  output.log("");

  if (result.tokenUsage) {
    output.log("💰 Token Usage");
    const lines = formatTokenUsage(result.tokenUsage);
    for (const line of lines) {
      output.log(`  ${line}`);
    }
    output.log("");
  }

  if (dryRun) {
    output.log("📝 Dry-run mode - showing what would be posted:");
    output.log(`  Comments to Create: ${result.commentsCreated}`);
  } else {
    output.log(`Comments Created: ${result.commentsCreated}`);
    if (result.commentErrors.length > 0) {
      output.log(`\n⚠️  Comment Errors: ${result.commentErrors.length}`);
      result.commentErrors.forEach((err, i) => {
        output.log(`  ${i + 1}. ${err}`);
      });
    }
  }

  // Generate and save markdown report
  if (aiProvider && adapter && platform) {
    try {
      const reportFile = saveReviewReport({
        result,
        aiProvider,
        dryRun,
        reviewType,
        reviewPasses,
        reviewStrategy,
        platform,
        projectId: adapter.getProjectIdentifier(),
        tempPath,
      });

      output.log("");
      output.log("📄 Detailed markdown report generated:");
      output.log(`  ${reportFile}`);
    } catch (error) {
      logger.warn({ error: (error as Error).message }, "Failed to generate markdown report");
      output.log("");
      output.log("⚠️  Failed to generate markdown report - see logs for details");
    }
  }
  output.log(`${"=".repeat(60)}\n`);
}

/**
 * Check if review has critical issues.
 */
export function hasCriticalIssues(result: ReviewResult): boolean {
  return result.fileResults.some((r) => r.findings.some((f) => f.severity === "critical"));
}
