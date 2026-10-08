import {
  type Config,
  loadConfig,
  type Platform,
  validateConfig,
} from "@merge-mentor/config/config.js";
import type { AIProviderType } from "@merge-mentor/core/ai/types.js";
import { ReviewEngine, type ReviewResult } from "@merge-mentor/core/review/engine.js";
import type { PlatformAdapter } from "@merge-mentor/domain/platform.js";
import { AzureDevOpsAdapter } from "@merge-mentor/platforms/azure.js";
import { GitHubAdapter } from "@merge-mentor/platforms/github.js";
import { initLogger } from "@merge-mentor/shared/logger.js";
import type { OutputWriter } from "@merge-mentor/shared/ports/index.js";
import { parsePRUrl } from "@merge-mentor/shared/utils/prUrl.js";

import { refreshEnv, resolveTempPath } from "./env.server.js";
import type { ReviewFindingView, ReviewStreamInput, ReviewSummary } from "./review.types.js";
import { createSseResponse } from "./sse.server.js";

/** A fully resolved review target: platform, PR number, link, and configuration. */
interface ReviewTarget {
  readonly platform: Platform;
  readonly pr: number;
  readonly url: string;
  readonly write: boolean;
  readonly config: Config;
}

/**
 * Resolves the PR to review and the adapter configuration for it.
 *
 * A pasted PR URL takes precedence and supplies the platform and repository,
 * mirroring the CLI's `--pr-url` behavior. A bare PR number falls back to the
 * repository configured in the web server's environment.
 */
function resolveTarget(input: ReviewStreamInput): ReviewTarget {
  refreshEnv();

  const overrides: {
    platform?: string;
    githubRepoOwner?: string;
    githubRepoName?: string;
    azureOrg?: string;
    azureProject?: string;
    azureRepo?: string;
    tempPath?: string;
  } = { tempPath: resolveTempPath() };
  let pr: number;
  let originalUrl: string | undefined;

  if (input.prUrl) {
    const parsed = parsePRUrl(input.prUrl);
    overrides.platform = parsed.platform;
    if (parsed.platform === "github") {
      overrides.githubRepoOwner = parsed.owner;
      overrides.githubRepoName = parsed.repo;
    } else {
      overrides.azureOrg = parsed.org;
      overrides.azureProject = parsed.project;
      overrides.azureRepo = parsed.azureRepo;
    }
    pr = parsed.prNumber;
    originalUrl = input.prUrl.trim();
  } else if (input.pr !== undefined) {
    if (!Number.isInteger(input.pr) || input.pr <= 0) {
      throw new Error("PR number must be a positive integer.");
    }
    pr = input.pr;
  } else {
    throw new Error("Provide a PR URL or a PR number to run a review.");
  }

  const config = loadConfig(overrides);
  const platform = (overrides.platform ?? config.defaultPlatform) as Platform;
  if (platform !== "github" && platform !== "azure") {
    throw new Error(`Invalid platform "${platform}". Must be "github" or "azure".`);
  }

  validateConfig(config, platform);

  return {
    platform,
    pr,
    url: originalUrl ?? buildPrUrl(config, platform, pr),
    write: input.write === true,
    config,
  };
}

/** Builds the canonical PR URL for a platform and repository. */
function buildPrUrl(config: Config, platform: Platform, pr: number): string {
  if (platform === "github") {
    return `https://github.com/${config.github.owner}/${config.github.repo}/pull/${pr}`;
  }
  return `https://dev.azure.com/${config.azure.org}/${config.azure.project}/_git/${config.azure.repo}/pullrequest/${pr}`;
}

/** Creates the platform adapter for the resolved target. */
function createAdapter(target: ReviewTarget): PlatformAdapter {
  return target.platform === "github"
    ? new GitHubAdapter(target.config)
    : new AzureDevOpsAdapter(target.config);
}

/** Flattens the engine's review result into the client-safe summary view. */
function toSummary(result: ReviewResult, target: ReviewTarget): ReviewSummary {
  const findings: ReviewFindingView[] = result.fileResults.flatMap((fileResult) =>
    fileResult.findings.map((finding) => ({
      file: finding.file ?? fileResult.filename,
      line: finding.line,
      severity: finding.severity,
      category: finding.category,
      message: finding.message,
      suggestion: finding.suggestion,
      isPreExisting: finding.isPreExisting,
    }))
  );

  const crossFileFindings: ReviewFindingView[] = result.crossFileResult.findings.map((finding) => ({
    file: finding.affectedFiles.join(", "),
    line: 0,
    severity: finding.severity,
    category: finding.category,
    message: finding.message,
  }));

  return {
    platform: target.platform,
    number: result.prDetails.number,
    title: result.prDetails.title,
    author: result.prDetails.author,
    baseBranch: result.prDetails.baseBranch,
    headBranch: result.prDetails.headBranch,
    url: target.url,
    filesReviewed: result.filesReviewed,
    filesSkipped: result.filesSkipped,
    filesIgnored: result.filesIgnored,
    linesAdded: result.linesAdded,
    linesDeleted: result.linesDeleted,
    findings,
    crossFileFindings,
    overallAssessment: result.crossFileResult.overallAssessment,
    recommendations: result.crossFileResult.recommendations,
    commentsCreated: result.commentsCreated,
    commentErrors: result.commentErrors,
    dryRun: !target.write,
  };
}

/** Builds the review engine for the resolved target, streaming raw output to `emit`. */
function createEngine(
  target: ReviewTarget,
  output: OutputWriter,
  onStreamChunk: (chunk: string) => void
): ReviewEngine {
  const { config } = target;
  const aiProvider = config.aiProvider as AIProviderType;

  return new ReviewEngine(createAdapter(target), config.botCommentIdentifier, aiProvider, {
    dryRun: !target.write,
    verbose: true,
    aiModel: config.aiModel,
    aiTimeoutMs: config.aiTimeoutMs,
    copilotToken: config.copilotToken,
    aiBaseUrl: config.aiBaseUrl,
    aiApiKey: config.aiApiKey,
    skipPreExisting: config.skipPreExisting,
    reviewType: config.reviewType,
    reviewPasses: config.reviewPasses,
    reviewStrategy: config.reviewStrategy,
    streamingEnabled: false,
    onStreamChunk,
    tempPath: config.tempPath,
    gitBackend: config.gitBackend,
    longContext: config.longContext,
    reasoningEffort: config.reasoningEffort,
    experimentalTools: config.experimentalTools,
    verifyPbi: config.verifyPbi,
    multiAgentMaxParallel: config.multiAgentMaxParallel,
    output,
  });
}

/**
 * Streams a review as Server-Sent Events.
 *
 * Emits `status`, `log`, and `chunk` frames while the review runs, followed by a
 * single `result` frame (or `error`) and a terminating `done` frame. The stream
 * is consumed by the web UI via `fetch` so raw output appears live.
 */
export function createReviewStream(input: ReviewStreamInput): ReadableStream<Uint8Array> {
  return createSseResponse(async (emit) => {
    const output: OutputWriter = {
      log: (message) => emit.send({ type: "log", message }),
      error: (message) => emit.send({ type: "log", message: `⚠️ ${message}` }),
      write: (data) => {
        emit.pushChunk(data);
        return true;
      },
    };

    emit.send({ type: "status", message: "Resolving review configuration..." });
    const target = resolveTarget(input);

    initLogger(target.config.tempPath);

    const modeLabel = target.write ? "" : " (dry-run)";
    emit.send({
      type: "status",
      message: `Starting code review for PR #${target.pr} on ${target.platform}${modeLabel}...`,
    });

    const engine = createEngine(target, output, emit.pushChunk);
    const result = await engine.reviewPR(target.pr);

    emit.send({ type: "result", summary: toSummary(result, target) });
  });
}
