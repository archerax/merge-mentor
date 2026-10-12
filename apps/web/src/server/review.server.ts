import {
  type Config,
  loadConfig,
  type Platform,
  validateConfig,
} from "@merge-mentor/config/config.js";
import type { AIProviderType } from "@merge-mentor/core/ai/types.js";
import {
  commentFingerprint,
  type PendingComment,
  postPlannedComments,
} from "@merge-mentor/core/review/commentPosting.js";
import { ReviewEngine, type ReviewResult } from "@merge-mentor/core/review/engine.js";
import type { ReviewProgressEvent } from "@merge-mentor/core/review/progress.js";
import { saveReviewReport } from "@merge-mentor/core/review/reviewReport.js";
import type { PlatformAdapter } from "@merge-mentor/domain/platform.js";
import { AzureDevOpsAdapter } from "@merge-mentor/platforms/azure.js";
import { GitHubAdapter } from "@merge-mentor/platforms/github.js";
import { initLogger } from "@merge-mentor/shared/logger.js";
import type { OutputWriter } from "@merge-mentor/shared/ports/index.js";
import { parsePRUrl } from "@merge-mentor/shared/utils/prUrl.js";

import { refreshEnv, resolveTempPath } from "./env.server.js";
import {
  loadPostedFingerprints,
  postedTargetKey,
  recordPostedFingerprints,
  reviewScope,
} from "./postedComments.server.js";
import type {
  PendingCommentView,
  PostCommentsInput,
  PostCommentsResult,
  ReviewFindingView,
  ReviewStreamInput,
  ReviewSummary,
} from "./review.types.js";
import { startOrAttach } from "./reviewRuns.server.js";
import type { SseEmitter } from "./sse.server.js";

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
    reviewStrategy?: string;
    passes?: string;
  } = { tempPath: resolveTempPath() };
  let pr: number;
  let originalUrl: string | undefined;

  if (input.strategy) {
    overrides.reviewStrategy = input.strategy;
    if (input.strategy !== "multi-agent") overrides.passes = "";
  }

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
    pendingComments: toPendingCommentViews(target, result.plannedComments),
  };
}

/** Marks planned PR comments with a stable fingerprint and posted state. */
function toPendingCommentViews(
  target: ReviewTarget,
  plannedComments: ReviewResult["plannedComments"]
): PendingCommentView[] {
  if (target.write || !plannedComments) return [];

  const key = postedTargetKey(
    "pr",
    target.platform,
    reviewScope(target.platform, target.config),
    target.pr
  );
  const posted = loadPostedFingerprints(target.config.tempPath, key);

  return plannedComments.map((action) => {
    const comment: PendingComment = {
      path: action.path,
      line: action.line,
      startLine: action.startLine,
      body: action.body ?? "",
      existingCommentId: action.existingCommentId,
    };
    const fingerprint = commentFingerprint(comment);
    return { ...comment, fingerprint, posted: posted.has(fingerprint) };
  });
}

/** Builds the review engine for the resolved target, streaming raw output to `emit`. */
function createEngine(
  target: ReviewTarget,
  adapter: PlatformAdapter,
  output: OutputWriter,
  onStreamChunk: (chunk: string) => void,
  onProgress: (event: ReviewProgressEvent) => void
): ReviewEngine {
  const { config } = target;
  const aiProvider = config.aiProvider as AIProviderType;

  return new ReviewEngine(adapter, config.botCommentIdentifier, aiProvider, {
    dryRun: !target.write,
    verbose: true,
    aiModel: config.aiModel,
    aiTimeoutMs: config.aiTimeoutMs,
    copilotToken: config.copilotToken,
    aiBaseUrl: config.aiBaseUrl,
    aiApiKey: config.aiApiKey,
    skipPreExisting: config.skipPreExisting,
    reviewPasses: config.reviewPasses,
    reviewStrategy: config.reviewStrategy,
    streamingEnabled: false,
    onStreamChunk,
    onProgress,
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
 * Builds the run-dedupe key for a PR target.
 *
 * This is distinct from the posted-comments key: it includes the execution mode
 * (`write` and `strategy`) so a submit that changes either setting starts a new
 * run instead of silently attaching to an unrelated in-flight run.
 */
function runTargetKey(target: ReviewTarget): string {
  const base = postedTargetKey(
    "pr",
    target.platform,
    reviewScope(target.platform, target.config),
    target.pr
  );
  return `${base}:write=${target.write}:strategy=${target.config.reviewStrategy}`;
}

/**
 * Starts (or attaches to) a PR review run and returns its id.
 *
 * Target resolution and validation happen synchronously so invalid input fails
 * the request; execution itself is owned by the run registry and is not tied to
 * the HTTP connection. Clients stream frames from the GET endpoint.
 */
export function startPRReview(input: ReviewStreamInput): { runId: string; attached: boolean } {
  const target = resolveTarget(input);
  const scope = reviewScope(target.platform, target.config);

  return startOrAttach({
    kind: "pr",
    targetKey: runTargetKey(target),
    label: `PR #${target.pr} · ${scope}`,
    input,
    execute: (emitter) => executePRReview(target, emitter),
  });
}

/**
 * Runs a PR review, emitting `status`, `log`, and `chunk` frames for the raw
 * technical log, structured `progress` frames for the phase timeline, batched
 * `stream` frames for formatted per-phase AI output, then a single `result`
 * frame (or `error`). The registry appends a terminating `done` frame.
 */
async function executePRReview(target: ReviewTarget, emit: SseEmitter): Promise<void> {
  const output: OutputWriter = {
    log: (message) => emit.send({ type: "log", message }),
    error: (message) => emit.send({ type: "log", message: `⚠️ ${message}` }),
    write: (data) => {
      emit.pushChunk(data);
      return true;
    },
  };

  emit.send({ type: "status", message: "Resolving review configuration..." });

  initLogger(target.config.tempPath);

  const modeLabel = target.write ? "" : " (dry-run)";
  emit.send({
    type: "status",
    message: `Starting code review for PR #${target.pr} on ${target.platform}${modeLabel}...`,
  });

  const adapter = createAdapter(target);
  const engine = createEngine(target, adapter, output, emit.pushChunk, (event) => {
    if (event.kind === "stream") {
      emit.pushStream(event.phase, event.delta);
      return;
    }
    emit.send({ type: "progress", event });
  });
  const result = await engine.reviewPR(target.pr);

  emit.send({
    type: "progress",
    event: { kind: "phase", id: "report", label: "Saving report", status: "start" },
  });
  try {
    const reportFile = saveReviewReport({
      result,
      aiProvider: target.config.aiProvider as AIProviderType,
      dryRun: !target.write,
      reviewPasses: target.config.reviewPasses,
      reviewStrategy: target.config.reviewStrategy,
      platform: target.platform,
      projectId: adapter.getProjectIdentifier(),
      tempPath: target.config.tempPath,
    });
    emit.send({ type: "log", message: `📄 Detailed markdown report saved to: ${reportFile}` });
    emit.send({
      type: "progress",
      event: { kind: "phase", id: "report", label: "Saving report", status: "done" },
    });
  } catch (error) {
    emit.send({
      type: "log",
      message: `⚠️ Failed to save markdown report: ${(error as Error).message}`,
    });
    emit.send({
      type: "progress",
      event: { kind: "phase", id: "report", label: "Saving report", status: "error" },
    });
  }

  emit.send({ type: "result", summary: toSummary(result, target) });
}

/**
 * Posts the comments a dry-run PR review planned, without re-running any AI
 * work. The planned payload is round-tripped from the client.
 */
export async function postPRComments(input: PostCommentsInput): Promise<PostCommentsResult> {
  const target = resolveTarget(input);
  const adapter = createAdapter(target);
  const key = postedTargetKey(
    "pr",
    target.platform,
    reviewScope(target.platform, target.config),
    target.pr
  );
  const posted = loadPostedFingerprints(target.config.tempPath, key);
  const result = await postPlannedComments(
    adapter,
    { kind: "pr", prNumber: target.pr },
    input.comments,
    { postedFingerprints: posted }
  );
  recordPostedFingerprints(target.config.tempPath, key, result.postedFingerprints);
  return result;
}
