import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import type { AIProviderType } from "./ai/types.js";
import { type CIContext, detectCIEnvironment } from "./ci/index.js";
import {
  loadConfig,
  type Platform,
  type ReviewPass,
  type ReviewStrategy,
  validateConfig,
} from "./config.js";
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
import {
  formatReviewPhases,
  formatReviewTypeLabel,
  REVIEW_PASSES,
} from "./review/reviewSelection.js";
import { generatePRIdentifier, sanitizeProjectName } from "./utils/prIdentifier.js";
import { parsePRUrl } from "./utils/prUrl.js";
import { formatTokenUsage } from "./utils/tokenUsage.js";

export interface ReviewOptions {
  pr?: number;
  prUrl?: string;
  ci: boolean;
  platform?: string;
  provider?: string;
  write?: boolean;
  verbose: boolean;
  reviewType?: string;
  passes?: string;
  strategy?: string;
  streamingEnabled?: boolean;
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
  aiTimeout?: number;
  aiModel?: string;
  aiBaseUrl?: string;
  aiApiKey?: string;
  // Comment filtering
  skipExistingIssues?: string;
  // File filtering
  ignore?: string[];
  /**
   * Path to a pre-existing local repository workspace.
   * Automatically set in CI mode from GITHUB_WORKSPACE / BUILD_SOURCESDIRECTORY.
   * When set, the engine skips cloning and uses this directory directly.
   */
  localWorkspacePath?: string;
  /** Git backend for repository cloning and fetching ('cli' or 'isomorphic'). Default: 'cli' */
  gitBackend?: string;
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
    commentIdentifier: resolvedOptions.commentIdentifier,
    tempPath: resolvedOptions.tempPath,
    aiProvider: resolvedOptions.provider,
    aiModel: resolvedOptions.aiModel,
    aiTimeout: resolvedOptions.aiTimeout,
    aiBaseUrl: resolvedOptions.aiBaseUrl,
    aiApiKey: resolvedOptions.aiApiKey,
    skipExistingIssues: resolvedOptions.skipExistingIssues,
    reviewType: resolvedOptions.reviewType,
    passes: resolvedOptions.passes,
    reviewStrategy: resolvedOptions.strategy,
    streamingEnabled: resolvedOptions.streamingEnabled,
    streamingLines: resolvedOptions.streamLines,
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
    verbose: resolvedOptions.verbose,
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
  const formattedPasses = formatReviewPhases(reviewPasses);

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
  const formattedPasses = formatReviewPhases(reviewPasses);
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

const program = new Command();

program
  .name("merge-mentor")
  .description("Automated code review bot using AI providers (Copilot SDK, OpenCode SDK)")
  .version(packageJson.version);

program
  .command("review")
  .description("Review a pull request")
  .option("--pr <number>", "Pull request number (auto-detected in CI mode)", parseInt)
  .option(
    "--pr-url <url>",
    "PR URL (e.g. https://github.com/owner/repo/pull/123 or https://dev.azure.com/org/project/_git/repo/pullrequest/456). Sets platform, org/project, repo, and PR number automatically."
  )
  .option(
    "--ci",
    "CI mode: auto-detect platform and PR from the CI environment (GitHub Actions or Azure Pipelines)",
    false
  )
  .option("--platform <platform>", "Platform (github or azure). Env: MM_PLATFORM")
  .option("--provider <provider>", "AI provider (copilot-sdk, opencode-sdk). Env: MM_AI_PROVIDER")
  .option("--write", "Post comments to PR (default is dry-run mode; CI mode defaults to write)")
  .option("--verbose", "Enable verbose output", true)
  .option(
    "--review-type <type>",
    "Type of review (general, testing, security, performance, fast, custom). Env: MM_REVIEW_TYPE",
    "general"
  )
  .option(
    "--passes <passNames>",
    `Comma-separated additive review passes. Use quoted exact names: "${REVIEW_PASSES.join(", ")}"`
  )
  .option("--strategy <strategy>", "Execution strategy (deep or fast). Env: MM_REVIEW_STRATEGY")
  .option(
    "--git-backend <backend>",
    "Git backend for cloning/fetching (cli, isomorphic). Default: cli. Env: MM_GIT_BACKEND"
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
  .option("--ai-timeout <ms>", "Timeout in ms for all AI providers. Env: MM_AI_TIMEOUT", parseInt)
  .option("--ai-model <model>", "Model name for the active AI provider. Env: MM_AI_MODEL")
  .option(
    "--ai-base-url <url>",
    "OpenAI-compatible API base URL for AI providers that support BYOK. Env: MM_AI_BASE_URL"
  )
  .option("--ai-api-key <key>", "API key for AI providers that support BYOK. Env: MM_AI_API_KEY")
  // Comment filtering
  .option(
    "--skip-existing-issues <bool>",
    "Skip pre-existing issues (true/false). Env: MM_SKIP_EXISTING_ISSUES"
  )
  // File filtering
  .option(
    "--ignore <pattern>",
    "Glob pattern for files to ignore (repeatable). Default ignores **/generated/**",
    (pattern: string, previous: string[] = []) => [...previous, pattern]
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
  .option(
    "--local-workspace-path <path>",
    "Path to a pre-existing local repository checkout (overrides CI-detected workspace)"
  )
  .action(async (options: ReviewOptions) => {
    try {
      if (options.prUrl) {
        const conflicting: string[] = [];
        if (options.pr !== undefined) conflicting.push("--pr");
        if (options.ci) conflicting.push("--ci");
        if (options.platform !== undefined) conflicting.push("--platform");
        if (options.githubRepoOwner !== undefined) conflicting.push("--github-repo-owner");
        if (options.githubRepoName !== undefined) conflicting.push("--github-repo-name");
        if (options.azureOrg !== undefined) conflicting.push("--azure-org");
        if (options.azureProject !== undefined) conflicting.push("--azure-project");
        if (options.azureRepo !== undefined) conflicting.push("--azure-repo");

        if (conflicting.length > 0) {
          consoleOutputWriter.error(
            `\n❌ Error: --pr-url cannot be combined with ${conflicting.join(", ")}.\n`
          );
          process.exit(1);
        }

        const parsed = parsePRUrl(options.prUrl);
        options.pr = parsed.prNumber;
        options.platform = parsed.platform;
        if (parsed.platform === "github") {
          options.githubRepoOwner = parsed.owner;
          options.githubRepoName = parsed.repo;
        } else {
          options.azureOrg = parsed.org;
          options.azureProject = parsed.project;
          options.azureRepo = parsed.azureRepo;
        }
      }

      if (!options.ci && options.pr === undefined) {
        consoleOutputWriter.error(
          "\n❌ Error: --pr <number> or --pr-url <url> is required, or use --ci to auto-detect in a CI environment.\n"
        );
        process.exit(1);
      }

      const { result, adapter, platform } = await executeReview({
        ...options,
        streamingEnabled: (options as unknown as Record<string, unknown>).stream as boolean,
      });

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
        aiTimeout: options.aiTimeout,
        aiModel: options.aiModel,
        aiBaseUrl: options.aiBaseUrl,
        aiApiKey: options.aiApiKey,
        skipExistingIssues: options.skipExistingIssues,
        reviewType: options.reviewType,
        passes: options.passes,
        reviewStrategy: options.strategy,
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
        config.reviewPasses,
        config.reviewStrategy,
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
  .option("--provider <provider>", "Check specific provider (copilot, opencode)")
  .action((options: { provider?: string }) => {
    const output = consoleOutputWriter;
    const env = processEnvironment;
    output.log("\n🔍 merge-mentor diagnostics\n");
    output.log(`Platform: ${process.platform}`);
    output.log(`Node.js: ${process.version}`);
    output.log(`CWD: ${process.cwd()}`);
    output.log(`PATH length: ${(env.get("PATH") || env.get("Path") || "").length} chars\n`);

    const providersToCheck = options.provider ? [options.provider] : [];

    if (providersToCheck.length > 0) {
      for (const provider of providersToCheck) {
        output.log(`\n📦 Checking ${provider} CLI:`);

        try {
          const versionOutput = execSync(`${provider} --version`, {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 5000,
          }).trim();
          output.log(`  ✅ Installed: ${versionOutput}`);

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
      output.log(`  AI base URL: ${config.aiBaseUrl ? "✅ Set" : "❌ Not set"}`);
      output.log(`  AI API key: ${config.aiApiKey ? "✅ Set" : "❌ Not set"}`);
      output.log("");
    } catch (error) {
      output.log("⚙️  Configuration: ⚠️  Could not load configuration");
      output.log(`   ${(error as Error).message}\n`);
    }

    process.exit(0);
  });

export { program };
