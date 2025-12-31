import { Command } from "commander";
import type { AIProviderType } from "./ai/types.js";
import { loadConfig, type Platform, validateConfig } from "./config.js";
import { logger } from "./logger.js";
import { AzureDevOpsAdapter } from "./platforms/azure.js";
import { GitHubAdapter } from "./platforms/github.js";
import type { PlatformAdapter } from "./platforms/types.js";
import { ReviewEngine, type ReviewResult } from "./review/engine.js";

export interface ReviewOptions {
  pr: number;
  platform?: string;
  provider?: string;
  write: boolean;
  verbose: boolean;
  runs?: number;
}

/**
 * Execute the review command logic.
 * Extracted for testability.
 */
export async function executeReview(options: ReviewOptions): Promise<ReviewResult> {
  logger.info(
    {
      pr: options.pr,
      platform: options.platform,
      provider: options.provider,
      write: options.write,
    },
    "Review command initiated"
  );

  const config = loadConfig();
  const platform = (options.platform || config.defaultPlatform) as Platform;

  if (!["github", "azure"].includes(platform)) {
    logger.error({ platform }, "Invalid platform specified");
    throw new Error(`Invalid platform "${platform}". Must be "github" or "azure".`);
  }

  // Validate and resolve AI provider
  const aiProvider = (options.provider || config.aiProvider) as AIProviderType;
  if (!["copilot", "opencode", "cursor"].includes(aiProvider)) {
    logger.error({ provider: aiProvider }, "Invalid AI provider specified");
    throw new Error(
      `Invalid AI provider "${aiProvider}". Must be "copilot", "opencode", or "cursor".`
    );
  }

  validateConfig(config, platform);

  let adapter: PlatformAdapter;
  if (platform === "github") {
    adapter = new GitHubAdapter(config);
  } else {
    adapter = new AzureDevOpsAdapter(config);
  }

  const dryRun = !options.write;
  const reviewRuns = options.runs ?? config.reviewRuns;

  // Select provider-specific model and timeout
  let aiModel: string | undefined;
  let aiTimeoutMs: number | undefined;

  switch (aiProvider) {
    case "opencode":
      aiModel = config.opencodeModel;
      aiTimeoutMs = config.opencodeTimeoutMs;
      break;
    case "cursor":
      aiModel = config.cursorModel;
      aiTimeoutMs = config.cursorTimeoutMs;
      break;
    default:
      aiModel = config.copilotModel;
      aiTimeoutMs = config.copilotTimeoutMs;
  }

  const engine = new ReviewEngine(adapter, config.botCommentIdentifier, aiProvider, {
    dryRun,
    verbose: options.verbose,
    aiModel,
    aiTimeoutMs,
    commentFilter: config.commentFilter,
    reviewRuns,
  });

  const modeLabel = dryRun ? "(dry-run)" : "";
  const providerLabel = `[${aiProvider}]`;
  console.log(
    `\n🔍 Starting code review for PR #${options.pr} on ${platform} ${providerLabel} ${modeLabel}...\n`
  );

  return await engine.reviewPR(options.pr);
}

/**
 * Display review results to console.
 */
export function displayResults(result: ReviewResult, dryRun: boolean): void {
  console.log("=".repeat(60));
  console.log("📊 Review Complete");
  console.log("=".repeat(60));
  console.log(`PR: #${result.prDetails.number} - ${result.prDetails.title}`);
  console.log(`Author: ${result.prDetails.author}`);
  console.log(`Branch: ${result.prDetails.headBranch} → ${result.prDetails.baseBranch}`);
  console.log("");
  console.log(`Files Reviewed: ${result.filesReviewed}`);
  console.log(
    `Total Issues Found: ${result.fileResults.reduce((sum, r) => sum + r.findings.length, 0)}`
  );
  console.log("");

  if (dryRun) {
    console.log("📝 Dry-run mode - showing what would be posted:");
    console.log(`  Comments to Create: ${result.commentsCreated}`);
    console.log(`  Comments to Update: ${result.commentsUpdated}`);
    console.log(`  Comments to Resolve: ${result.commentsResolved}`);
  } else {
    console.log(`Comments Created: ${result.commentsCreated}`);
    console.log(`Comments Updated: ${result.commentsUpdated}`);
    console.log(`Comments Resolved: ${result.commentsResolved}`);
    if (result.commentErrors.length > 0) {
      console.log(`\n⚠️  Comment Errors: ${result.commentErrors.length}`);
      result.commentErrors.forEach((err, i) => {
        console.log(`  ${i + 1}. ${err}`);
      });
    }
  }
  console.log(`${"=".repeat(60)}\n`);
}

/**
 * Check if review has critical issues.
 */
export function hasCriticalIssues(result: ReviewResult): boolean {
  return result.fileResults.some((r) => r.findings.some((f) => f.severity === "critical"));
}

const program = new Command();

program
  .name("merge-mentor")
  .description(
    "Automated code review bot using AI providers (Copilot CLI, OpenCode CLI, Cursor CLI)"
  )
  .version("1.4.0");

program
  .command("review")
  .description("Review a pull request")
  .requiredOption("--pr <number>", "Pull request number", parseInt)
  .option("--platform <platform>", "Platform (github or azure)", "github")
  .option("--provider <provider>", "AI provider (copilot, opencode, or cursor)")
  .option("--write", "Post comments to PR (default is dry-run mode)", false)
  .option("--verbose", "Enable verbose output", true)
  .option(
    "--runs <number>",
    "Number of review runs (1-5). Multiple runs aggregate findings for thoroughness.",
    (value) => {
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed < 1 || parsed > 5) {
        throw new Error("--runs must be a number between 1 and 5");
      }
      return parsed;
    }
  )
  .action(async (options: ReviewOptions) => {
    try {
      const result = await executeReview(options);
      displayResults(result, !options.write);

      logger.info(
        {
          pr: options.pr,
          hasCriticalIssues: hasCriticalIssues(result),
          filesReviewed: result.filesReviewed,
          totalFindings: result.fileResults.reduce((sum, r) => sum + r.findings.length, 0),
        },
        "Review completed"
      );
      process.exit(0);
    } catch (error) {
      const err = error as Error;

      logger.error(
        {
          error: err.message,
          stack: err.stack,
          pr: options.pr,
        },
        "Review failed"
      );
      console.error(`\n❌ Error: ${err.message}\n`);
      process.exit(1);
    }
  });

export { program };
