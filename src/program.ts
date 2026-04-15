import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import type { AIProviderType } from "./ai/types.js";
import { type CIContext, detectCIEnvironment } from "./ci/index.js";
import { loadConfig, type Platform, validateConfig } from "./config.js";
import { CATEGORY_EMOJI, SEVERITY_EMOJI } from "./constants.js";
import { initLogger, logger } from "./logger.js";
import { AzureDevOpsAdapter } from "./platforms/azure.js";
import { GitHubAdapter } from "./platforms/github.js";
import type { PlatformAdapter } from "./platforms/types.js";
import {
  consoleOutputWriter,
  type Environment,
  type OutputWriter,
  processEnvironment,
} from "./ports/index.js";
import { ReviewEngine, type ReviewResult } from "./review/engine.js";
import { generatePRIdentifier, sanitizeProjectName } from "./utils/prIdentifier.js";

export interface ReviewOptions {
  pr?: number;
  ci: boolean;
  platform?: string;
  provider?: string;
  write?: boolean;
  verbose: boolean;
  runs?: number;
  reviewType?: string;
  stream?: boolean;
  streamLines?: number;
  tempPath?: string;
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
  copilotToken?: string;
  copilotModel?: string;
  copilotTimeout?: number;
  copilotSdkModel?: string;
  copilotSdkTimeout?: number;
  opencodeModel?: string;
  opencodeTimeout?: number;
  opencodeSdkModel?: string;
  opencodeSdkTimeout?: number;
  cursorModel?: string;
  cursorTimeout?: number;
  // Comment filtering
  skipExistingIssues?: string;
}

interface ReviewExecutionResult {
  result: ReviewResult;
  adapter: PlatformAdapter;
  platform: Platform;
}

interface ProgramDeps {
  output?: OutputWriter;
  env?: Environment;
}

/**
 * Merges a resolved CI context into review options.
 * Explicit CLI flags always take priority over CI-detected values.
 * In CI mode, `write` defaults to `true` (post comments) unless explicitly overridden.
 */
function mergeCIContext(options: ReviewOptions, ci: CIContext): ReviewOptions {
  return {
    ...options,
    pr: options.pr ?? ci.prNumber,
    platform: options.platform ?? ci.platform,
    write: options.write ?? true,
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
    resolvedOptions = mergeCIContext(options, ciContext);
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
    commentIdentifier: resolvedOptions.commentIdentifier,
    tempPath: resolvedOptions.tempPath,
    aiProvider: resolvedOptions.provider,
    copilotModel: resolvedOptions.copilotModel,
    copilotTimeout: resolvedOptions.copilotTimeout,
    copilotSdkModel: resolvedOptions.copilotSdkModel,
    copilotSdkTimeout: resolvedOptions.copilotSdkTimeout,
    opencodeModel: resolvedOptions.opencodeModel,
    opencodeTimeout: resolvedOptions.opencodeTimeout,
    opencodeSdkModel: resolvedOptions.opencodeSdkModel,
    opencodeSdkTimeout: resolvedOptions.opencodeSdkTimeout,
    cursorModel: resolvedOptions.cursorModel,
    cursorTimeout: resolvedOptions.cursorTimeout,
    skipExistingIssues: resolvedOptions.skipExistingIssues,
    reviewRuns: resolvedOptions.runs,
    reviewType: resolvedOptions.reviewType,
    streamingEnabled: resolvedOptions.stream !== false ? undefined : false,
    streamingLines: resolvedOptions.streamLines,
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
  if (!["copilot", "copilot-sdk", "opencode", "opencode-sdk", "cursor"].includes(aiProvider)) {
    logger.error({ provider: aiProvider }, "Invalid AI provider specified");
    throw new Error(
      `Invalid AI provider "${aiProvider}". Must be "copilot", "copilot-sdk", "opencode", "opencode-sdk", or "cursor".`
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
  const reviewRuns = resolvedOptions.runs ?? config.reviewRuns;

  // Select provider-specific model and timeout
  let aiModel: string | undefined;
  let aiTimeoutMs: number | undefined;

  switch (aiProvider) {
    case "copilot-sdk":
      aiModel = config.copilotSdkModel;
      aiTimeoutMs = config.copilotSdkTimeoutMs;
      break;
    case "opencode":
      aiModel = config.opencodeModel;
      aiTimeoutMs = config.opencodeTimeoutMs;
      break;
    case "opencode-sdk":
      aiModel = config.opencodeSdkModel;
      aiTimeoutMs = config.opencodeSdkTimeoutMs;
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
    verbose: resolvedOptions.verbose,
    aiModel,
    aiTimeoutMs,
    copilotToken: config.copilotToken,
    skipPreExisting: config.skipPreExisting,
    reviewRuns,
    reviewType: resolvedOptions.reviewType ?? config.reviewType,
    streamingEnabled: resolvedOptions.stream !== false && config.streamingEnabled,
    streamingLines: resolvedOptions.streamLines ?? config.streamingLines,
    tempPath: config.tempPath,
  });

  const modeLabel = dryRun ? "(dry-run)" : "";
  const providerLabel = `[${aiProvider}]`;
  output.log(
    `\n🔍 Starting code review for PR #${pr} on ${platform} ${providerLabel} ${modeLabel}...\n`
  );

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
  reviewType = "general"
): string {
  const date = new Date().toISOString();
  const totalIssues = result.fileResults.reduce((sum, r) => sum + r.findings.length, 0);
  const crossFileIssues = result.crossFileResult.findings.length;

  let report = `# Code Review Report - PR #${result.prDetails.number}\n\n`;

  // Header with PR details
  report += `**Generated:** ${date}  \n`;
  report += `**AI Provider:** ${aiProvider}  \n`;
  report += `**Review Type:** ${reviewType}  \n`;
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
  tempPath?: string,
  deps: ProgramDeps = {}
): void {
  const output = deps.output ?? consoleOutputWriter;
  output.log("=".repeat(60));
  output.log("📊 Review Complete");
  output.log("=".repeat(60));
  output.log(`PR: #${result.prDetails.number} - ${result.prDetails.title}`);
  output.log(`Author: ${result.prDetails.author}`);
  output.log(`Branch: ${result.prDetails.headBranch} → ${result.prDetails.baseBranch}`);
  output.log(`Review Type: ${reviewType}`);
  output.log("");
  output.log(`Files Reviewed: ${result.filesReviewed}`);
  output.log(
    `Total Issues Found: ${result.fileResults.reduce((sum, r) => sum + r.findings.length, 0)}`
  );
  output.log("");

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
      const markdownReport = generateMarkdownReport(result, aiProvider, dryRun, reviewType);
      const reportDir = join(tempPath ?? "./.mergementor", "reports");

      // Generate unique report filename using platform and project
      const projectId = sanitizeProjectName(adapter.getProjectIdentifier());
      const prIdentifier = generatePRIdentifier(platform, projectId, result.prDetails.number);
      const reportFile = join(reportDir, `${prIdentifier}-${reviewType}-review-report.md`);

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

const program = new Command();

program
  .name("merge-mentor")
  .description(
    "Automated code review bot using AI providers (Copilot CLI, OpenCode CLI, Cursor CLI)"
  )
  .version("1.12.0");

program
  .command("review")
  .description("Review a pull request")
  .option("--pr <number>", "Pull request number (auto-detected in CI mode)", parseInt)
  .option(
    "--ci",
    "CI mode: auto-detect platform and PR from the CI environment (GitHub Actions or Azure Pipelines)",
    false
  )
  .option("--platform <platform>", "Platform (github or azure). Env: MM_PLATFORM", "github")
  .option(
    "--provider <provider>",
    "AI provider (copilot, copilot-sdk, opencode, opencode-sdk, or cursor). Env: MM_AI_PROVIDER"
  )
  .option("--write", "Post comments to PR (default is dry-run mode; CI mode defaults to write)")
  .option("--verbose", "Enable verbose output", true)
  .option("--runs <number>", "Number of review runs (1-5). Env: MM_REVIEW_RUNS", (value) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 5) {
      throw new Error("--runs must be a number between 1 and 5");
    }
    return parsed;
  })
  .option(
    "--review-type <type>",
    "Type of review (general, testing, security, performance, fast). Env: MM_REVIEW_TYPE",
    "general"
  )
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
  .option(
    "--temp-path <path>",
    "Base path for temporary files (cache, diffs, logs, repos, etc.). Env: MM_TEMP_PATH"
  )
  // AI provider config
  .option("--copilot-token <token>", "Copilot GitHub token. Env: MM_COPILOT_TOKEN")
  .option("--copilot-model <model>", "Copilot model name. Env: MM_COPILOT_MODEL")
  .option("--copilot-timeout <ms>", "Copilot timeout in ms. Env: MM_COPILOT_TIMEOUT", parseInt)
  .option("--copilot-sdk-model <model>", "Copilot SDK model name. Env: MM_COPILOT_SDK_MODEL")
  .option(
    "--copilot-sdk-timeout <ms>",
    "Copilot SDK timeout in ms. Env: MM_COPILOT_SDK_TIMEOUT",
    parseInt
  )
  .option("--opencode-model <model>", "OpenCode model name. Env: MM_OPENCODE_MODEL")
  .option("--opencode-timeout <ms>", "OpenCode timeout in ms. Env: MM_OPENCODE_TIMEOUT", parseInt)
  .option("--opencode-sdk-model <model>", "OpenCode SDK model name. Env: MM_OPENCODE_SDK_MODEL")
  .option(
    "--opencode-sdk-timeout <ms>",
    "OpenCode SDK timeout in ms. Env: MM_OPENCODE_SDK_TIMEOUT",
    parseInt
  )
  .option("--cursor-model <model>", "Cursor model name. Env: MM_CURSOR_MODEL")
  .option("--cursor-timeout <ms>", "Cursor timeout in ms. Env: MM_CURSOR_TIMEOUT", parseInt)
  // Comment filtering
  .option(
    "--skip-existing-issues <bool>",
    "Skip pre-existing issues (true/false). Env: MM_SKIP_EXISTING_ISSUES"
  )
  // Streaming options
  .option("--no-stream", "Disable streaming output display")
  .option(
    "--stream-lines <number>",
    "Number of lines in streaming display (1-20). Env: MM_STREAMING_LINES",
    (value) => {
      const parsed = parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed < 1 || parsed > 20) {
        throw new Error("--stream-lines must be a number between 1 and 20");
      }
      return parsed;
    }
  )
  .action(async (options: ReviewOptions) => {
    try {
      if (!options.ci && options.pr === undefined) {
        consoleOutputWriter.error(
          "\n❌ Error: --pr <number> is required, or use --ci to auto-detect in a CI environment.\n"
        );
        process.exit(1);
      }

      const { result, adapter, platform } = await executeReview(options);

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
        copilotToken: options.copilotToken,
        copilotModel: options.copilotModel,
        copilotTimeout: options.copilotTimeout,
        copilotSdkModel: options.copilotSdkModel,
        copilotSdkTimeout: options.copilotSdkTimeout,
        opencodeModel: options.opencodeModel,
        opencodeTimeout: options.opencodeTimeout,
        opencodeSdkModel: options.opencodeSdkModel,
        opencodeSdkTimeout: options.opencodeSdkTimeout,
        cursorModel: options.cursorModel,
        cursorTimeout: options.cursorTimeout,
        skipExistingIssues: options.skipExistingIssues,
        reviewRuns: options.runs,
        reviewType: options.reviewType,
      });
      const aiProvider = (options.provider || config.aiProvider) as AIProviderType;
      const reviewType = options.reviewType ?? config.reviewType ?? "general";
      displayResults(
        result,
        !options.write,
        adapter,
        platform,
        aiProvider,
        reviewType,
        config.tempPath
      );

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
      consoleOutputWriter.error(`\n❌ Error: ${err.message}\n`);
      process.exit(1);
    }
  });

// Repository management command
program
  .command("repos")
  .description("Manage cloned repositories for context loading")
  .option("--list", "List all cloned repositories", false)
  .option("--clean", "Remove all cloned repositories", false)
  .option("--clean-repo <name>", "Remove a specific cloned repository")
  .option("--temp-path <path>", "Base path for temporary files. Env: MM_TEMP_PATH")
  .action((options: { list?: boolean; clean?: boolean; cleanRepo?: string; tempPath?: string }) => {
    const config = loadConfig({ tempPath: options.tempPath });
    const reposDir = join(config.tempPath, "repos");
    const output = consoleOutputWriter;

    try {
      // Ensure repos directory exists
      mkdirSync(reposDir, { recursive: true });

      if (options.list) {
        // List all repos
        const repos = readdirSync(reposDir).filter((name) => {
          const fullPath = join(reposDir, name);
          return statSync(fullPath).isDirectory();
        });

        if (repos.length === 0) {
          output.log("No cloned repositories found.");
        } else {
          output.log(`\n📁 Cloned repositories (${repos.length}):\n`);
          for (const repo of repos) {
            const repoPath = join(reposDir, repo);
            const stats = statSync(repoPath);
            output.log(`  • ${repo}`);
            output.log(`    Path: ${repoPath}`);
            output.log(`    Last modified: ${stats.mtime.toISOString()}`);
            output.log("");
          }
        }
      } else if (options.clean) {
        // Clean all repos
        const repos = readdirSync(reposDir).filter((name) => {
          const fullPath = join(reposDir, name);
          return statSync(fullPath).isDirectory();
        });

        if (repos.length === 0) {
          output.log("No cloned repositories to clean.");
        } else {
          output.log(`\n🧹 Cleaning ${repos.length} repositories...\n`);
          for (const repo of repos) {
            const repoPath = join(reposDir, repo);
            rmSync(repoPath, { recursive: true, force: true });
            output.log(`  ✓ Removed: ${repo}`);
          }
          output.log(`\n✅ Cleaned ${repos.length} repositories.`);
        }
      } else if (options.cleanRepo) {
        // Clean specific repo
        const repoPath = join(reposDir, options.cleanRepo);
        try {
          const stats = statSync(repoPath);
          if (stats.isDirectory()) {
            rmSync(repoPath, { recursive: true, force: true });
            output.log(`✅ Removed repository: ${options.cleanRepo}`);
          } else {
            output.error(`❌ Error: "${options.cleanRepo}" is not a directory.`);
            process.exit(1);
          }
        } catch {
          output.error(`❌ Error: Repository "${options.cleanRepo}" not found.`);
          process.exit(1);
        }
      } else {
        // No option specified, show help
        output.log("\nUsage: merge-mentor repos [options]\n");
        output.log("Options:");
        output.log("  --list           List all cloned repositories");
        output.log("  --clean          Remove all cloned repositories");
        output.log("  --clean-repo <n> Remove a specific cloned repository");
        output.log("");
      }

      process.exit(0);
    } catch (error) {
      const err = error as Error;
      logger.error({ error: err.message }, "Repository management failed");
      output.error(`\n❌ Error: ${err.message}\n`);
      process.exit(1);
    }
  });

// Diagnostic command to check AI provider CLI installations
program
  .command("doctor")
  .description("Check AI provider CLI installations and configuration")
  .option("--provider <provider>", "Check specific provider (copilot, opencode, cursor)")
  .action((options: { provider?: string }) => {
    const output = consoleOutputWriter;
    const env = processEnvironment;
    output.log("\n🔍 merge-mentor diagnostics\n");
    output.log(`Platform: ${process.platform}`);
    output.log(`Node.js: ${process.version}`);
    output.log(`CWD: ${process.cwd()}`);
    output.log(`PATH length: ${(env.get("PATH") || env.get("Path") || "").length} chars\n`);

    const providersToCheck = options.provider
      ? [options.provider]
      : ["copilot", "opencode", "cursor"];

    for (const provider of providersToCheck) {
      output.log(`\n📦 Checking ${provider} CLI:`);

      try {
        // Try to get version
        const versionOutput = execSync(`${provider} --version`, {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 5000,
        }).trim();
        output.log(`  ✅ Installed: ${versionOutput}`);

        // Try to get path
        const whichCommand = process.platform === "win32" ? "where" : "which";
        try {
          const pathOutput = execSync(`${whichCommand} ${provider}`, {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 5000,
          }).trim();
          output.log(`  📍 Location: ${pathOutput}`);
        } catch {
          output.log(`  ⚠️  Could not determine installation location`);
        }
      } catch (error) {
        const err = error as Error & { status?: number };
        output.log(`  ❌ Not found or not working`);
        if (err.message) {
          output.log(`     Error: ${err.message.split("\n")[0]}`);
        }
      }
    }

    output.log("\n");

    // Check configuration
    try {
      const config = loadConfig({});
      output.log("⚙️  Configuration:");
      output.log(`  Default platform: ${config.defaultPlatform}`);
      output.log(`  AI provider: ${config.aiProvider}`);
      output.log(`  GitHub token: ${config.github.token ? "✅ Set" : "❌ Not set"}`);
      output.log(`  Azure token: ${config.azure.token ? "✅ Set" : "❌ Not set"}`);
      output.log("");
    } catch (error) {
      output.log("⚙️  Configuration: ⚠️  Could not load configuration");
      output.log(`   ${(error as Error).message}\n`);
    }

    process.exit(0);
  });

export { program };
