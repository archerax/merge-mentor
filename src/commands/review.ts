import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AIProviderType } from "../ai/types.js";
import { type CIContext, detectCIEnvironment } from "../ci/index.js";
import {
  loadConfig,
  type Platform,
  type ReviewPass,
  type ReviewStrategy,
  validateConfig,
} from "../config.js";
import { CATEGORY_EMOJI, SEVERITY_EMOJI } from "../constants.js";
import { initLogger, logger } from "../logger.js";
import { AzureDevOpsAdapter } from "../platforms/azure.js";
import { GitHubAdapter } from "../platforms/github.js";
import type { PlatformAdapter } from "../platforms/types.js";
import { consoleOutputWriter, processEnvironment } from "../ports/index.js";
import { ReviewEngine, type ReviewResult } from "../review/engine.js";
import { formatReviewPasses, formatReviewTypeLabel } from "../review/reviewSelection.js";
import { generatePRIdentifier, sanitizeProjectName } from "../utils/prIdentifier.js";
import { formatTokenUsage } from "../utils/tokenUsage.js";
import type { ProgramDeps, ReviewExecutionResult, ReviewOptions } from "./types.js";

/**
 * Merges a resolved CI context into review options.
 * Explicit CLI flags always take priority over CI-detected values.
 * In CI mode, `write` defaults to `true` (post comments) unless explicitly overridden.
 */
export function mergeCIContext(options: ReviewOptions, ci: CIContext): ReviewOptions {
  return {
    ...options,
    pr: options.pr ?? ci.prNumber,
    platform: options.platform ?? ci.platform,
    write: options.write ?? true,
    localWorkspacePath: options.localWorkspacePath ?? ci.workspacePath,
    githubToken: options.githubToken ?? ci.githubToken,
    githubRepoOwner: options.githubRepoOwner ?? ci.githubOwner,
    githubRepoName: options.githubRepoName ?? ci.githubRepo,
    azureToken: options.azureToken ?? ci.azureToken,
    azureOrg: options.azureOrg ?? ci.azureOrg,
    azureProject: options.azureProject ?? ci.azureProject,
    azureRepo: options.azureRepo ?? ci.azureRepo,
  };
}

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
    const optionsWithEnvTokens: ReviewOptions = {
      ...options,
      azureToken: options.azureToken ?? (env.get("MM_AZURE_TOKEN") || undefined),
      githubToken: options.githubToken ?? (env.get("MM_GITHUB_TOKEN") || undefined),
    };
    resolvedOptions = mergeCIContext(optionsWithEnvTokens, ciContext);
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
 * Generate a markdown report for the review.
 */
export function generateMarkdownReport(
  result: ReviewResult,
  aiProvider: AIProviderType,
  dryRun: boolean,
  reviewType = "general",
  reviewPasses?: readonly ReviewPass[],
  reviewStrategy: ReviewStrategy = "fast"
): string {
  const date = new Date().toISOString();
  const totalIssues = result.fileResults.reduce((sum, r) => sum + r.findings.length, 0);
  const crossFileIssues = result.crossFileResult.findings.length;
  const reviewTypeLabel = formatReviewTypeLabel(reviewType, reviewPasses, reviewStrategy);
  const formattedPasses = formatReviewPasses(reviewPasses);

  let report = `# Code Review Report - PR #${result.prDetails.number}\n\n`;

  // Header with PR details
  report += `**Generated:** ${date}  \n`;
  report += `**AI Provider:** ${aiProvider}  \n`;
  report += `**Review Profile:** ${reviewTypeLabel}  \n`;
  if (formattedPasses) {
    report += `**Review Passes:** ${formattedPasses}  \n`;
  }
  if (reviewStrategy !== "fast") {
    report += `**Review Strategy:** ${reviewStrategy}  \n`;
  }
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

  if (result.tokenUsage) {
    const lines = formatTokenUsage(result.tokenUsage);
    report += `### 💰 Token Usage\n\n`;
    for (const line of lines) {
      report += `- ${line}\n`;
    }
    report += `\n`;
  }

  // Review actions summary
  const actionHeader = dryRun ? "### 📝 Planned Actions (Dry-Run)" : "### 📝 Review Actions";
  report += `${actionHeader}\n\n`;
  report += `- Comments to Create: ${result.commentsCreated}\n\n`;

  // Issues by severity
  const severityCounts = countIssuesBySeverity(result);
  if (Object.values(severityCounts).some((count) => count > 0)) {
    report += `### Issues by Severity\n\n`;
    Object.entries(severityCounts).forEach(([severity, count]) => {
      if (count > 0) {
        const emoji = SEVERITY_EMOJI[severity as keyof typeof SEVERITY_EMOJI];
        report += `- ${emoji} **${
          severity.charAt(0).toUpperCase() + severity.slice(1)
        }:** ${count}\n`;
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
        report += `- ${emoji} **${
          category.charAt(0).toUpperCase() + category.slice(1)
        }:** ${count}\n`;
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

          report += `#### ${index + 1}. Line ${finding.line} ${severityEmoji} ${categoryEmoji}\n\n`;
          report += `**Severity:** ${finding.severity.toUpperCase()}  \n`;
          report += `**Category:** ${finding.category}  \n`;
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

      report += `### ${
        index + 1
      }. ${severityEmoji} ${categoryEmoji} ${finding.category.toUpperCase()}\n\n`;
      report += `**Severity:** ${finding.severity.toUpperCase()}  \n`;
      report += `**Affected Files:** ${finding.affectedFiles
        .map((f) => `\`${f}\``)
        .join(", ")}  \n\n`;
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
      const markdownReport = generateMarkdownReport(
        result,
        aiProvider,
        dryRun,
        reviewType,
        reviewPasses,
        reviewStrategy
      );
      const reportDir = join(tempPath ?? "./.mergementor", "reports");

      // Generate unique report filename using platform and project
      const projectId = sanitizeProjectName(adapter.getProjectIdentifier());
      const prIdentifier = generatePRIdentifier(platform, projectId, result.prDetails.number);
      const reportFile = join(reportDir, `${prIdentifier}-review-profile-report.md`);

      // Ensure directory exists
      mkdirSync(reportDir, { recursive: true });

      // Write the report
      writeFileSync(reportFile, markdownReport, "utf-8");

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
