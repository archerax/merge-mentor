#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig, type Platform, validateConfig } from "./config.js";
import { logger } from "./logger.js";
import { AzureDevOpsAdapter } from "./platforms/azure.js";
import { GitHubAdapter } from "./platforms/github.js";
import type { PlatformAdapter } from "./platforms/types.js";
import { ReviewEngine, type ReviewResult } from "./review/engine.js";

export interface ReviewOptions {
  pr: number;
  platform?: string;
  write: boolean;
  verbose: boolean;
}

/**
 * Execute the review command logic.
 * Extracted for testability.
 */
export async function executeReview(options: ReviewOptions): Promise<ReviewResult> {
  logger.info(
    { pr: options.pr, platform: options.platform, write: options.write },
    "Review command initiated"
  );

  const config = loadConfig();
  const platform = (options.platform || config.defaultPlatform) as Platform;

  if (!["github", "azure"].includes(platform)) {
    logger.error({ platform }, "Invalid platform specified");
    throw new Error(`Invalid platform "${platform}". Must be "github" or "azure".`);
  }

  validateConfig(config, platform);

  let adapter: PlatformAdapter;
  if (platform === "github") {
    adapter = new GitHubAdapter(config);
  } else {
    adapter = new AzureDevOpsAdapter(config);
  }

  const dryRun = !options.write;
  const engine = new ReviewEngine(adapter, config.botCommentIdentifier, {
    dryRun,
    verbose: options.verbose,
    copilotModel: config.copilotModel,
  });

  const modeLabel = dryRun ? "(dry-run)" : "";
  console.log(`\n🔍 Starting code review for PR #${options.pr} on ${platform} ${modeLabel}...\n`);

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
  .description("Automated code review bot using GitHub Copilot CLI")
  .version("1.0.0");

program
  .command("review")
  .description("Review a pull request")
  .requiredOption("--pr <number>", "Pull request number", parseInt)
  .option("--platform <platform>", "Platform (github or azure)", "github")
  .option("--write", "Post comments to PR (default is dry-run mode)", false)
  .option("--verbose", "Enable verbose output", true)
  .action(async (options: ReviewOptions) => {
    try {
      const result = await executeReview(options);
      displayResults(result, !options.write);

      const exitCode = hasCriticalIssues(result) ? 1 : 0;
      logger.info(
        {
          pr: options.pr,
          exitCode,
          hasCriticalIssues: exitCode === 1,
          filesReviewed: result.filesReviewed,
          totalFindings: result.fileResults.reduce((sum, r) => sum + r.findings.length, 0),
        },
        "Review completed"
      );
      process.exit(exitCode);
    } catch (error) {
      const err = error as Error;

      // Check if this is a repository checkout issue (common with Azure DevOps)
      const isCheckoutIssue =
        err.message.includes("Path does not exist") ||
        err.message.includes("no such file or directory");

      if (isCheckoutIssue) {
        logger.warn(
          {
            error: err.message,
            pr: options.pr,
            platform: options.platform,
          },
          "Review failed due to missing repository files"
        );
        console.error(`\n⚠️  Repository files not accessible\n`);
        console.error(`The GitHub Copilot CLI requires access to repository files.`);
        console.error(
          `\nFor Azure DevOps or CI/CD environments, ensure the repository is checked out first:\n`
        );
        console.error(`  - Azure Pipelines: Add a 'checkout: self' step before running the review`);
        console.error(`  - GitHub Actions: Add 'actions/checkout@v4' step`);
        console.error(`  - Local development: Run from within the repository directory\n`);

        // Exit with code 0 to avoid failing the pipeline for configuration issues
        process.exit(0);
      }

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

// Only parse if running as main module
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse();
}

export { program };
