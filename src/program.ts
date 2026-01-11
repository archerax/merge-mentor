import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import type { AIProviderType } from "./ai/types.js";
import { loadConfig, type Platform, validateConfig } from "./config.js";
import { CATEGORY_EMOJI, CONFIDENCE_EMOJI, SEVERITY_EMOJI } from "./constants.js";
import { logger } from "./logger.js";
import { AzureDevOpsAdapter } from "./platforms/azure.js";
import { GitHubAdapter } from "./platforms/github.js";
import type { PlatformAdapter } from "./platforms/types.js";
import { ReviewEngine, type ReviewResult } from "./review/engine.js";
import { generatePRIdentifier, sanitizeProjectName } from "./utils/prIdentifier.js";

export interface ReviewOptions {
  pr: number;
  platform?: string;
  provider?: string;
  write: boolean;
  verbose: boolean;
  runs?: number;
  // GitHub config
  githubToken?: string;
  githubRepoOwner?: string;
  githubRepoName?: string;
  // Azure config
  azureToken?: string;
  azureOrg?: string;
  azureProject?: string;
  azureRepo?: string;
  // Bot config
  commentIdentifier?: string;
  // AI provider config
  copilotModel?: string;
  copilotTimeout?: number;
  opencodeModel?: string;
  opencodeTimeout?: number;
  cursorModel?: string;
  cursorTimeout?: number;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiTimeout?: number;
  openaiBaseUrl?: string;
  openaiMaxRetries?: number;
  // Comment filtering
  minCommentConfidence?: string;
  skipExistingIssues?: string;
  postResolutionComments?: string;
}

export interface ReviewExecutionResult {
  result: ReviewResult;
  adapter: PlatformAdapter;
  platform: Platform;
}

/**
 * Execute the review command logic.
 * Extracted for testability.
 */
export async function executeReview(options: ReviewOptions): Promise<ReviewExecutionResult> {
  logger.info(
    {
      pr: options.pr,
      platform: options.platform,
      provider: options.provider,
      write: options.write,
    },
    "Review command initiated"
  );

  const config = loadConfig({
    platform: options.platform,
    githubToken: options.githubToken,
    githubRepoOwner: options.githubRepoOwner,
    githubRepoName: options.githubRepoName,
    azureToken: options.azureToken,
    azureOrg: options.azureOrg,
    azureProject: options.azureProject,
    azureRepo: options.azureRepo,
    commentIdentifier: options.commentIdentifier,
    aiProvider: options.provider,
    copilotModel: options.copilotModel,
    copilotTimeout: options.copilotTimeout,
    opencodeModel: options.opencodeModel,
    opencodeTimeout: options.opencodeTimeout,
    cursorModel: options.cursorModel,
    cursorTimeout: options.cursorTimeout,
    openaiApiKey: options.openaiApiKey,
    openaiModel: options.openaiModel,
    openaiTimeout: options.openaiTimeout,
    openaiBaseUrl: options.openaiBaseUrl,
    openaiMaxRetries: options.openaiMaxRetries,
    minCommentConfidence: options.minCommentConfidence,
    skipExistingIssues: options.skipExistingIssues,
    postResolutionComments: options.postResolutionComments,
    reviewRuns: options.runs,
  });
  const platform = (options.platform || config.defaultPlatform) as Platform;

  if (!["github", "azure"].includes(platform)) {
    logger.error({ platform }, "Invalid platform specified");
    throw new Error(`Invalid platform "${platform}". Must be "github" or "azure".`);
  }

  // Validate and resolve AI provider
  const aiProvider = (options.provider || config.aiProvider) as AIProviderType;
  if (!["copilot", "opencode", "cursor", "openai"].includes(aiProvider)) {
    logger.error({ provider: aiProvider }, "Invalid AI provider specified");
    throw new Error(
      `Invalid AI provider "${aiProvider}". Must be "copilot", "opencode", "cursor", or "openai".`
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
  let openaiOptions:
    | {
        apiKey: string;
        baseUrl?: string;
        maxRetries?: number;
      }
    | undefined;

  switch (aiProvider) {
    case "opencode":
      aiModel = config.opencodeModel;
      aiTimeoutMs = config.opencodeTimeoutMs;
      break;
    case "cursor":
      aiModel = config.cursorModel;
      aiTimeoutMs = config.cursorTimeoutMs;
      break;
    case "openai":
      aiModel = config.openaiModel;
      aiTimeoutMs = config.openaiTimeoutMs;
      openaiOptions = {
        apiKey: config.openaiApiKey ?? "",
        baseUrl: config.openaiBaseUrl,
        maxRetries: config.openaiMaxRetries,
      };
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
    openaiApiKey: openaiOptions?.apiKey,
    openaiBaseUrl: openaiOptions?.baseUrl,
    openaiMaxRetries: openaiOptions?.maxRetries,
  });

  const modeLabel = dryRun ? "(dry-run)" : "";
  const providerLabel = `[${aiProvider}]`;
  console.log(
    `\n🔍 Starting code review for PR #${options.pr} on ${platform} ${providerLabel} ${modeLabel}...\n`
  );

  const result = await engine.reviewPR(options.pr);
  return { result, adapter, platform };
}

/**
 * Generate a markdown report for dry-run mode.
 */
export function generateMarkdownReport(result: ReviewResult, aiProvider: AIProviderType): string {
  const date = new Date().toISOString();
  const totalIssues = result.fileResults.reduce((sum, r) => sum + r.findings.length, 0);
  const crossFileIssues = result.crossFileResult.findings.length;

  let report = `# Code Review Report - PR #${result.prDetails.number}\n\n`;

  // Header with PR details
  report += `**Generated:** ${date}  \n`;
  report += `**AI Provider:** ${aiProvider}  \n`;
  report += `**PR Title:** ${result.prDetails.title}  \n`;
  report += `**Author:** ${result.prDetails.author}  \n`;
  report += `**Branch:** \`${result.prDetails.headBranch}\` → \`${result.prDetails.baseBranch}\`  \n\n`;

  // Summary
  report += `## 📊 Review Summary\n\n`;
  report += `- **Files Reviewed:** ${result.filesReviewed}\n`;
  report += `- **Files Skipped:** ${result.filesSkipped}\n`;
  report += `- **Total Issues Found:** ${totalIssues + crossFileIssues}\n`;
  report += `  - File-specific issues: ${totalIssues}\n`;
  report += `  - Cross-file issues: ${crossFileIssues}\n\n`;

  // Dry-run actions summary
  report += `### 📝 Planned Actions (Dry-Run)\n\n`;
  report += `- Comments to Create: ${result.commentsCreated}\n`;
  report += `- Comments to Update: ${result.commentsUpdated}\n`;
  report += `- Comments to Resolve: ${result.commentsResolved}\n\n`;

  // Issues by severity
  const severityCounts = countIssuesBySeverity(result);
  if (Object.values(severityCounts).some((count) => count > 0)) {
    report += `### Issues by Severity\n\n`;
    Object.entries(severityCounts).forEach(([severity, count]) => {
      if (count > 0) {
        const emoji = SEVERITY_EMOJI[severity as keyof typeof SEVERITY_EMOJI];
        report += `- ${emoji} **${severity.charAt(0).toUpperCase() + severity.slice(1)}:** ${count}\n`;
      }
    });
    report += `\n`;
  }

  // Issues by category
  const categoryCounts = countIssuesByCategory(result);
  if (Object.values(categoryCounts).some((count) => count > 0)) {
    report += `### Issues by Category\n\n`;
    Object.entries(categoryCounts).forEach(([category, count]) => {
      if (count > 0) {
        const emoji = CATEGORY_EMOJI[category as keyof typeof CATEGORY_EMOJI];
        report += `- ${emoji} **${category.charAt(0).toUpperCase() + category.slice(1)}:** ${count}\n`;
      }
    });
    report += `\n`;
  }

  // File-specific issues
  if (totalIssues > 0) {
    report += `## 📁 File-Specific Issues\n\n`;

    result.fileResults.forEach((fileResult) => {
      if (fileResult.findings.length > 0) {
        report += `### \`${fileResult.filename}\`\n\n`;

        fileResult.findings.forEach((finding, index) => {
          const severityEmoji = SEVERITY_EMOJI[finding.severity];
          const categoryEmoji = CATEGORY_EMOJI[finding.category];
          const confidenceEmoji = finding.confidence ? CONFIDENCE_EMOJI[finding.confidence] : "";

          report += `#### ${index + 1}. Line ${finding.line} ${severityEmoji} ${categoryEmoji}\n\n`;
          report += `**Severity:** ${finding.severity.toUpperCase()}  \n`;
          report += `**Category:** ${finding.category}  \n`;
          if (finding.confidence) {
            report += `**Confidence:** ${finding.confidence} ${confidenceEmoji}  \n`;
          }
          if (finding.isPreExisting) {
            report += `**Pre-existing:** Yes ⚠️  \n`;
          }
          report += `\n**Issue:** ${finding.message}\n\n`;
          report += `**Suggestion:** ${finding.suggestion}\n\n`;
          report += `---\n\n`;
        });
      }
    });
  }

  // Cross-file issues
  if (crossFileIssues > 0) {
    report += `## 🔗 Cross-File Issues\n\n`;

    result.crossFileResult.findings.forEach((finding, index) => {
      const severityEmoji = SEVERITY_EMOJI[finding.severity];
      const categoryEmoji = CATEGORY_EMOJI[finding.category];

      report += `### ${index + 1}. ${severityEmoji} ${categoryEmoji} ${finding.category.toUpperCase()}\n\n`;
      report += `**Severity:** ${finding.severity.toUpperCase()}  \n`;
      report += `**Affected Files:** ${finding.affectedFiles.map((f) => `\`${f}\``).join(", ")}  \n\n`;
      report += `**Issue:** ${finding.message}\n\n`;
      report += `---\n\n`;
    });
  }

  // Overall assessment
  if (result.crossFileResult.overallAssessment) {
    report += `## 🎯 Overall Assessment\n\n`;
    report += `${result.crossFileResult.overallAssessment}\n\n`;
  }

  // Recommendations
  if (result.crossFileResult.recommendations.length > 0) {
    report += `## 💡 Recommendations\n\n`;
    result.crossFileResult.recommendations.forEach((rec, index) => {
      report += `${index + 1}. ${rec}\n`;
    });
    report += `\n`;
  }

  // Resolved comments (if any)
  const resolvedComments = result.fileResults.flatMap((fr) => fr.resolvedComments || []);
  if (resolvedComments.length > 0) {
    report += `## ✅ Resolved Issues\n\n`;
    resolvedComments.forEach((resolved, index) => {
      report += `${index + 1}. **Line ${resolved.line}:** ${resolved.reason}\n`;
    });
    report += `\n`;
  }

  return report;
}

/**
 * Count issues by severity across all files and cross-file results.
 */
function countIssuesBySeverity(result: ReviewResult): Record<string, number> {
  const counts: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  // Count file-specific issues
  result.fileResults.forEach((fileResult) => {
    fileResult.findings.forEach((finding) => {
      counts[finding.severity] = (counts[finding.severity] || 0) + 1;
    });
  });

  // Count cross-file issues
  result.crossFileResult.findings.forEach((finding) => {
    counts[finding.severity] = (counts[finding.severity] || 0) + 1;
  });

  return counts;
}

/**
 * Count issues by category across all files and cross-file results.
 */
function countIssuesByCategory(result: ReviewResult): Record<string, number> {
  const counts: Record<string, number> = {};

  // Count file-specific issues
  result.fileResults.forEach((fileResult) => {
    fileResult.findings.forEach((finding) => {
      counts[finding.category] = (counts[finding.category] || 0) + 1;
    });
  });

  // Count cross-file issues
  result.crossFileResult.findings.forEach((finding) => {
    counts[finding.category] = (counts[finding.category] || 0) + 1;
  });

  return counts;
}

/**
 * Display review results to console.
 */
export function displayResults(
  result: ReviewResult,
  dryRun: boolean,
  adapter?: PlatformAdapter,
  platform?: Platform,
  aiProvider?: AIProviderType
): void {
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

    // Generate and save markdown report
    if (aiProvider && adapter && platform) {
      try {
        const markdownReport = generateMarkdownReport(result, aiProvider);
        const reportDir = join(process.cwd(), ".merge-mentor", "reports");

        // Generate unique report filename using platform and project
        const projectId = sanitizeProjectName(adapter.getProjectIdentifier());
        const prIdentifier = generatePRIdentifier(platform, projectId, result.prDetails.number);
        const reportFile = join(reportDir, `${prIdentifier}-review-report.md`);

        // Ensure directory exists
        mkdirSync(reportDir, { recursive: true });

        // Write the report
        writeFileSync(reportFile, markdownReport, "utf-8");

        console.log("");
        console.log("📄 Detailed markdown report generated:");
        console.log(`  ${reportFile}`);
      } catch (error) {
        logger.warn({ error: (error as Error).message }, "Failed to generate markdown report");
        console.log("");
        console.log("⚠️  Failed to generate markdown report - see logs for details");
      }
    }
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
  .option("--platform <platform>", "Platform (github or azure). Env: MM_PLATFORM", "github")
  .option(
    "--provider <provider>",
    "AI provider (copilot, opencode, cursor, or openai). Env: MM_AI_PROVIDER"
  )
  .option("--write", "Post comments to PR (default is dry-run mode)", false)
  .option("--verbose", "Enable verbose output", true)
  .option("--runs <number>", "Number of review runs (1-5). Env: MM_REVIEW_RUNS", (value) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 5) {
      throw new Error("--runs must be a number between 1 and 5");
    }
    return parsed;
  })
  // GitHub options
  .option("--github-token <token>", "GitHub personal access token. Env: MM_GITHUB_TOKEN")
  .option("--github-repo-owner <owner>", "GitHub repository owner. Env: MM_GITHUB_REPO_OWNER")
  .option("--github-repo-name <name>", "GitHub repository name. Env: MM_GITHUB_REPO_NAME")
  // Azure options
  .option("--azure-token <token>", "Azure DevOps personal access token. Env: MM_AZURE_TOKEN")
  .option("--azure-org <org>", "Azure DevOps organization. Env: MM_AZURE_ORG")
  .option("--azure-project <project>", "Azure DevOps project. Env: MM_AZURE_PROJECT")
  .option("--azure-repo <repo>", "Azure DevOps repository. Env: MM_AZURE_REPO")
  // Bot config
  .option("--comment-identifier <id>", "Bot comment identifier. Env: MM_COMMENT_IDENTIFIER")
  // AI provider config
  .option("--copilot-model <model>", "Copilot model name. Env: MM_COPILOT_MODEL")
  .option("--copilot-timeout <ms>", "Copilot timeout in ms. Env: MM_COPILOT_TIMEOUT", parseInt)
  .option("--opencode-model <model>", "OpenCode model name. Env: MM_OPENCODE_MODEL")
  .option("--opencode-timeout <ms>", "OpenCode timeout in ms. Env: MM_OPENCODE_TIMEOUT", parseInt)
  .option("--cursor-model <model>", "Cursor model name. Env: MM_CURSOR_MODEL")
  .option("--cursor-timeout <ms>", "Cursor timeout in ms. Env: MM_CURSOR_TIMEOUT", parseInt)
  .option("--openai-api-key <key>", "OpenAI API key. Env: MM_OPENAI_API_KEY")
  .option("--openai-model <model>", "OpenAI model name (default: gpt-4o). Env: MM_OPENAI_MODEL")
  .option("--openai-timeout <ms>", "OpenAI timeout in ms. Env: MM_OPENAI_TIMEOUT", parseInt)
  .option(
    "--openai-base-url <url>",
    "OpenAI API base URL (for Azure Foundry). Env: MM_OPENAI_BASE_URL"
  )
  .option(
    "--openai-max-retries <n>",
    "OpenAI max retry attempts. Env: MM_OPENAI_MAX_RETRIES",
    parseInt
  )
  // Comment filtering
  .option(
    "--min-comment-confidence <level>",
    "Minimum confidence (high, medium, low). Env: MM_MIN_COMMENT_CONFIDENCE"
  )
  .option(
    "--skip-existing-issues <bool>",
    "Skip pre-existing issues (true/false). Env: MM_SKIP_EXISTING_ISSUES"
  )
  .option(
    "--post-resolution-comments <bool>",
    "Post resolution comments (true/false). Env: MM_POST_RESOLUTION_COMMENTS"
  )
  .action(async (options: ReviewOptions) => {
    try {
      const config = loadConfig({
        platform: options.platform,
        githubToken: options.githubToken,
        githubRepoOwner: options.githubRepoOwner,
        githubRepoName: options.githubRepoName,
        azureToken: options.azureToken,
        azureOrg: options.azureOrg,
        azureProject: options.azureProject,
        azureRepo: options.azureRepo,
        commentIdentifier: options.commentIdentifier,
        aiProvider: options.provider,
        copilotModel: options.copilotModel,
        copilotTimeout: options.copilotTimeout,
        opencodeModel: options.opencodeModel,
        opencodeTimeout: options.opencodeTimeout,
        cursorModel: options.cursorModel,
        cursorTimeout: options.cursorTimeout,
        openaiApiKey: options.openaiApiKey,
        openaiModel: options.openaiModel,
        openaiTimeout: options.openaiTimeout,
        openaiBaseUrl: options.openaiBaseUrl,
        openaiMaxRetries: options.openaiMaxRetries,
        minCommentConfidence: options.minCommentConfidence,
        skipExistingIssues: options.skipExistingIssues,
        postResolutionComments: options.postResolutionComments,
        reviewRuns: options.runs,
      });
      const aiProvider = (options.provider || config.aiProvider) as AIProviderType;

      const { result, adapter, platform } = await executeReview(options);
      displayResults(result, !options.write, adapter, platform, aiProvider);

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
