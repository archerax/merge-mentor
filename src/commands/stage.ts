import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AIProviderType } from "../ai/types.js";
import { loadConfig, type Platform, type ReviewPass, type ReviewStrategy } from "../config.js";
import { CATEGORY_EMOJI, SEVERITY_EMOJI } from "../constants.js";
import { initLogger } from "../logger.js";
import { LocalPlatformAdapter, parseRemoteUrl } from "../platforms/local.js";
import type { PlatformAdapter } from "../platforms/types.js";
import { consoleOutputWriter } from "../ports/index.js";
import { ReviewEngine, type ReviewResult } from "../review/engine.js";
import type { GitBackendType } from "../review/gitClient.js";
import { createGitClient } from "../review/gitClients/factory.js";
import { formatReviewPasses, formatReviewTypeLabel } from "../review/reviewSelection.js";
import { formatTokenUsage } from "../utils/tokenUsage.js";
import type { ProgramDeps, StageOptions } from "./types.js";

/** Exit code used when `--exit-code` finds blocking findings. */
export const STAGE_BLOCKING_EXIT_CODE = 1;

/** Verdict levels that gate the `--exit-code` hook. */
const BLOCKING_SEVERITIES = new Set(["critical", "high"]);

/**
 * Execute the `stage` command logic: review the local working tree (staged,
 * unstaged, or a ref pair) against a base ref using the existing review engine.
 */
export async function executeStage(
  options: StageOptions,
  deps: ProgramDeps = {}
): Promise<{ result: ReviewResult; adapter: PlatformAdapter }> {
  const output = deps.output ?? consoleOutputWriter;

  const repoPath = path.resolve(options.dir ?? process.cwd());
  const config = loadConfig({
    platform: "github",
    githubToken: options.githubToken,
    githubRepoOwner: options.githubRepoOwner,
    githubRepoName: options.githubRepoName,
    azureToken: options.azureToken,
    azureOrg: options.azureOrg,
    azureProject: options.azureProject,
    azureRepo: options.azureRepo,
    tempPath: options.tempPath,
    aiProvider: options.provider,
    aiModel: options.aiModel,
    aiTimeout: options.aiTimeout,
    aiBaseUrl: options.aiBaseUrl,
    aiApiKey: options.aiApiKey,
    reviewType: options.reviewType,
    passes: options.passes,
    reviewStrategy: options.strategy,
    gitBackend: options.gitBackend,
  });

  initLogger(config.tempPath);

  const aiProvider = (options.provider || config.aiProvider) as AIProviderType;
  const gitBackend = (options.gitBackend ?? config.gitBackend) as GitBackendType;

  const gitClient = createGitClient(gitBackend);
  const remoteUrl = await gitClient.getRemoteUrl(repoPath);
  const parsedRemote = remoteUrl ? parseRemoteUrl(remoteUrl) : undefined;
  const repoInfo = parsedRemote
    ? {
        platform: parsedRemote.platform as Platform,
        owner: parsedRemote.owner,
        repo: parsedRemote.repo,
      }
    : undefined;

  const adapter = new LocalPlatformAdapter({
    repoPath,
    gitClient,
    baseRef: options.base,
    headRef: options.head,
    stagedOnly: options.staged,
    repoInfo,
  });

  const prDetails = await adapter.getPRDetails(-1);
  const files = await adapter.getPRFiles(-1, options.ignore);

  if (files.length === 0) {
    output.log("\n🌱 No changes detected to review.");
    output.log("  Working tree is clean (or all changes are ignored).\n");
    return { result: emptyStageResult(prDetails), adapter };
  }

  const engine = new ReviewEngine(adapter, config.botCommentIdentifier, aiProvider, {
    dryRun: true,
    verbose: true,
    aiModel: config.aiModel,
    aiTimeoutMs: config.aiTimeoutMs,
    copilotToken: config.copilotToken,
    aiBaseUrl: config.aiBaseUrl,
    aiApiKey: config.aiApiKey,
    skipPreExisting: config.skipPreExisting,
    reviewType: options.reviewType ?? config.reviewType,
    reviewPasses: config.reviewPasses,
    reviewStrategy: config.reviewStrategy,
    streamingEnabled: options.streamingEnabled ?? config.streamingEnabled,
    streamingLines: options.streamLines ?? config.streamingLines,
    tempPath: config.tempPath,
    localWorkspacePath: repoPath,
    ignorePatterns: options.ignore,
    gitBackend,
    experimentalTools: config.experimentalTools,
    longContext: config.longContext,
    reasoningEffort: config.reasoningEffort,
    multiAgentMinConfidence: config.multiAgentMinConfidence,
    multiAgentMaxParallel: config.multiAgentMaxParallel,
    noCache: options.noCache,
    reReview: options.reReview,
  });

  output.log(`\n🔍 Starting staged review of local working tree...\n`);
  output.log(`  Repository: ${repoPath}`);
  output.log(`  Branch:     ${prDetails.headBranch}`);
  output.log(`  Base:       ${prDetails.baseBranch}`);
  output.log(`  Provider:   ${aiProvider}`);
  if (config.aiModel) {
    output.log(`  Model:      ${config.aiModel}`);
  }
  if (config.aiBaseUrl) {
    output.log(`  BYOK URL:   ${config.aiBaseUrl}`);
  }
  output.log(
    `  Review:     ${formatReviewTypeLabel(
      options.reviewType ?? config.reviewType,
      config.reviewPasses,
      config.reviewStrategy
    )}`
  );
  output.log("");

  const result = await engine.reviewLocal(prDetails, files);
  return { result, adapter };
}

/** A review result representing a clean working tree. */
export function emptyStageResult(prDetails: {
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly author: string;
  readonly baseBranch: string;
  readonly headBranch: string;
}): ReviewResult {
  return {
    prDetails,
    filesReviewed: 0,
    filesSkipped: 0,
    filesIgnored: 0,
    ignoredFiles: [],
    fileResults: [],
    linesAdded: 0,
    linesDeleted: 0,
    crossFileResult: {
      overallAssessment: "No changes detected",
      findings: [],
      recommendations: [],
    },
    commentsCreated: 0,
    commentErrors: [],
  };
}

/** Returns `true` when the review contains critical or high findings. */
export function hasBlockingFindings(result: ReviewResult): boolean {
  const hasFileFinding = result.fileResults.some((r) =>
    r.findings.some((f) => BLOCKING_SEVERITIES.has(f.severity))
  );
  const hasCrossFileFinding = result.crossFileResult.findings.some((f) =>
    BLOCKING_SEVERITIES.has(f.severity)
  );
  return hasFileFinding || hasCrossFileFinding;
}

/** Counts issues by severity across file and cross-file results. */
export function countStageIssuesBySeverity(result: ReviewResult): Record<string, number> {
  const counts: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const fileResult of result.fileResults) {
    for (const finding of fileResult.findings) {
      counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
    }
  }
  for (const finding of result.crossFileResult.findings) {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  }
  return counts;
}

/** Counts issues by category across file and cross-file results. */
function countStageIssuesByCategory(result: ReviewResult): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const fileResult of result.fileResults) {
    for (const finding of fileResult.findings) {
      counts[finding.category] = (counts[finding.category] ?? 0) + 1;
    }
  }
  for (const finding of result.crossFileResult.findings) {
    counts[finding.category] = (counts[finding.category] ?? 0) + 1;
  }
  return counts;
}

/** Generates a Markdown report for a local stage review. */
export function generateStageMarkdownReport(
  result: ReviewResult,
  aiProvider: AIProviderType,
  reviewType = "general",
  reviewPasses?: readonly ReviewPass[],
  reviewStrategy: ReviewStrategy = "fast"
): string {
  const date = new Date().toISOString();
  const totalIssues = result.fileResults.reduce((sum, r) => sum + r.findings.length, 0);
  const crossFileIssues = result.crossFileResult.findings.length;
  const reviewTypeLabel = formatReviewTypeLabel(reviewType, reviewPasses, reviewStrategy);
  const formattedPasses = formatReviewPasses(reviewPasses);

  let report = `# Staged Review Report\n\n`;
  report += `**Generated:** ${date}  \n`;
  report += `**AI Provider:** ${aiProvider}  \n`;
  report += `**Review Profile:** ${reviewTypeLabel}  \n`;
  if (formattedPasses) {
    report += `**Review Passes:** ${formattedPasses}  \n`;
  }
  if (reviewStrategy !== "fast") {
    report += `**Review Strategy:** ${reviewStrategy}  \n`;
  }
  report += `**Branch:** \`${result.prDetails.headBranch}\` → \`${result.prDetails.baseBranch}\`  \n\n`;

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

  const severityCounts = countStageIssuesBySeverity(result);
  if (Object.values(severityCounts).some((count) => count > 0)) {
    report += `### Issues by Severity\n\n`;
    for (const [severity, count] of Object.entries(severityCounts)) {
      if (count > 0) {
        const emoji = SEVERITY_EMOJI[severity as keyof typeof SEVERITY_EMOJI];
        report += `- ${emoji} **${severity.charAt(0).toUpperCase() + severity.slice(1)}:** ${count}\n`;
      }
    }
    report += `\n`;
  }

  const categoryCounts = countStageIssuesByCategory(result);
  if (Object.values(categoryCounts).some((count) => count > 0)) {
    report += `### Issues by Category\n\n`;
    for (const [category, count] of Object.entries(categoryCounts)) {
      if (count > 0) {
        const emoji = CATEGORY_EMOJI[category as keyof typeof CATEGORY_EMOJI];
        report += `- ${emoji} **${category.charAt(0).toUpperCase() + category.slice(1)}:** ${count}\n`;
      }
    }
    report += `\n`;
  }

  if (totalIssues > 0) {
    report += `## 📁 File-Specific Issues\n\n`;
    for (const fileResult of result.fileResults) {
      if (fileResult.findings.length === 0) continue;
      report += `### \`${fileResult.filename}\`\n\n`;
      fileResult.findings.forEach((finding, index) => {
        const severityEmoji = SEVERITY_EMOJI[finding.severity];
        const categoryEmoji = CATEGORY_EMOJI[finding.category];
        report += `#### ${index + 1}. Line ${finding.line} ${severityEmoji} ${categoryEmoji}\n\n`;
        report += `**Severity:** ${finding.severity.toUpperCase()}  \n`;
        report += `**Category:** ${finding.category}  \n`;
        report += `**Confidence:** ${finding.confidence}  \n`;
        report += `\n**Issue:** ${finding.message}\n\n`;
        report += `**Suggestion:** ${finding.suggestion}\n\n`;
        report += `---\n\n`;
      });
    }
  }

  if (crossFileIssues > 0) {
    report += `## 🔗 Cross-File Issues\n\n`;
    result.crossFileResult.findings.forEach((finding, index) => {
      const severityEmoji = SEVERITY_EMOJI[finding.severity];
      const categoryEmoji = CATEGORY_EMOJI[finding.category];
      report += `### ${index + 1}. ${severityEmoji} ${categoryEmoji} ${finding.category.toUpperCase()}\n\n`;
      report += `**Severity:** ${finding.severity.toUpperCase()}  \n`;
      report += `**Affected Files:** ${finding.affectedFiles
        .map((f) => `\`${f}\``)
        .join(", ")}  \n\n`;
      report += `**Issue:** ${finding.message}\n\n`;
      report += `---\n\n`;
    });
  }

  if (result.crossFileResult.overallAssessment) {
    report += `## 🎯 Overall Assessment\n\n`;
    report += `${result.crossFileResult.overallAssessment}\n\n`;
  }

  if (result.crossFileResult.recommendations.length > 0) {
    report += `## 💡 Recommendations\n\n`;
    result.crossFileResult.recommendations.forEach((rec, index) => {
      report += `${index + 1}. ${rec}\n`;
    });
    report += `\n`;
  }

  return report;
}

/** Serializes a stage review into a stable machine-readable JSON schema. */
export function stageReviewToJson(result: ReviewResult, provider: AIProviderType): string {
  return JSON.stringify(
    {
      tool: "merge-mentor",
      command: "stage",
      generatedAt: new Date().toISOString(),
      provider,
      branch: {
        head: result.prDetails.headBranch,
        base: result.prDetails.baseBranch,
      },
      filesReviewed: result.filesReviewed,
      filesSkipped: result.filesSkipped,
      filesIgnored: result.filesIgnored,
      ignoredFiles: result.ignoredFiles,
      linesAdded: result.linesAdded,
      linesDeleted: result.linesDeleted,
      tokenUsage: result.tokenUsage ?? null,
      fileResults: result.fileResults.map((fileResult) => ({
        filename: fileResult.filename,
        findings: fileResult.findings.map((finding) => ({
          line: finding.line,
          startLine: finding.startLine ?? null,
          endLine: finding.endLine ?? null,
          severity: finding.severity,
          confidence: finding.confidence,
          category: finding.category,
          message: finding.message,
          suggestion: finding.suggestion,
          reasoning: finding.reasoning,
          replacement: finding.replacement ?? null,
        })),
      })),
      crossFileResult: {
        overallAssessment: result.crossFileResult.overallAssessment,
        findings: result.crossFileResult.findings.map((finding) => ({
          severity: finding.severity,
          confidence: finding.confidence,
          category: finding.category,
          message: finding.message,
          reasoning: finding.reasoning,
          affectedFiles: finding.affectedFiles,
        })),
        recommendations: result.crossFileResult.recommendations,
      },
    },
    null,
    2
  );
}

/** Writes a stage report to disk (creating parent directories as needed). */
function writeStageReport(reportPath: string, content: string): void {
  const dir = path.dirname(reportPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(reportPath, content, "utf-8");
}

/**
 * Displays a stage review to the console and writes reports per the requested
 * `--format` / `--output` options.
 */
export function displayStageResults(
  result: ReviewResult,
  aiProvider: AIProviderType,
  options: StageOptions,
  reviewType = "general",
  reviewPasses?: readonly ReviewPass[],
  reviewStrategy: ReviewStrategy = "fast",
  tempPath = "./.mergementor",
  deps: ProgramDeps = {}
): void {
  const output = deps.output ?? consoleOutputWriter;
  const format = options.format ?? "terminal";
  const reviewTypeLabel = formatReviewTypeLabel(reviewType, reviewPasses, reviewStrategy);
  const formattedPasses = formatReviewPasses(reviewPasses);

  if (format === "json") {
    const json = stageReviewToJson(result, aiProvider);
    if (options.output) {
      writeStageReport(options.output, json);
      output.log(`📄 JSON report written to: ${options.output}`);
    } else {
      output.log(json);
    }
    return;
  }

  if (format === "markdown") {
    const markdown = generateStageMarkdownReport(
      result,
      aiProvider,
      reviewType,
      reviewPasses,
      reviewStrategy
    );
    if (options.output) {
      writeStageReport(options.output, markdown);
      output.log(`📄 Markdown report written to: ${options.output}`);
    } else {
      output.log(markdown);
    }
    return;
  }

  output.log("=".repeat(60));
  output.log("📊 Stage Review Complete");
  output.log("=".repeat(60));
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
    for (const line of formatTokenUsage(result.tokenUsage)) {
      output.log(`  ${line}`);
    }
    output.log("");
  }

  if (fileIssues > 0) {
    output.log("📁 File-Specific Issues");
    for (const fileResult of result.fileResults) {
      if (fileResult.findings.length === 0) continue;
      output.log("");
      output.log(`  ${fileResult.filename}`);
      for (const finding of fileResult.findings) {
        const severityEmoji = SEVERITY_EMOJI[finding.severity];
        const categoryEmoji = CATEGORY_EMOJI[finding.category];
        output.log(
          `    L${finding.line} ${severityEmoji} ${finding.severity.toUpperCase()} ${categoryEmoji} ${finding.category}`
        );
        output.log(`      ${finding.message}`);
      }
    }
  }

  if (crossFileIssues > 0) {
    output.log("");
    output.log("🔗 Cross-File Issues");
    for (const finding of result.crossFileResult.findings) {
      const severityEmoji = SEVERITY_EMOJI[finding.severity];
      output.log(
        `  ${severityEmoji} ${finding.severity.toUpperCase()} ${finding.category}: ${finding.message}`
      );
    }
  }

  if (result.crossFileResult.overallAssessment) {
    output.log("");
    output.log("🎯 Overall Assessment");
    output.log(`  ${result.crossFileResult.overallAssessment}`);
  }

  if (result.crossFileResult.recommendations.length > 0) {
    output.log("");
    output.log("💡 Recommendations");
    result.crossFileResult.recommendations.forEach((rec, index) => {
      output.log(`  ${index + 1}. ${rec}`);
    });
  }

  // Persist a markdown report by default (terminal mode)
  const markdown = generateStageMarkdownReport(
    result,
    aiProvider,
    reviewType,
    reviewPasses,
    reviewStrategy
  );
  const reportDir = path.join(tempPath, "reports");
  const reportFile = path.join(
    reportDir,
    `stage-${sanitizeForFilename(result.prDetails.headBranch)}.md`
  );
  try {
    writeStageReport(reportFile, markdown);
    output.log("");
    output.log(`📄 Detailed markdown report generated:`);
    output.log(`  ${reportFile}`);
  } catch (error) {
    output.log("");
    output.log(`⚠️  Failed to write markdown report: ${(error as Error).message}`);
  }
  output.log(`${"=".repeat(60)}\n`);
}

/** Sanitizes a branch name for use in a report filename. */
function sanitizeForFilename(value: string): string {
  return value.replace(/[/\\:*?"<>| ]/g, "-");
}
