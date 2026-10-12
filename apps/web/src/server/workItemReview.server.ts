import {
  type Config,
  loadConfig,
  type Platform,
  validateConfig,
} from "@merge-mentor/config/config.js";
import { createAIProvider } from "@merge-mentor/core/ai/providerFactory.js";
import type { AIProviderType } from "@merge-mentor/core/ai/types.js";
import {
  commentFingerprint,
  type PendingComment,
  postPlannedComments,
} from "@merge-mentor/core/review/commentPosting.js";
import { PBIReviewEngine, type PBIReviewResult } from "@merge-mentor/core/review/pbiEngine.js";
import type { ReviewProgressEvent } from "@merge-mentor/core/review/progress.js";
import {
  ProjectReviewEngine,
  type ProjectReviewResult,
} from "@merge-mentor/core/review/projectEngine.js";
import type { PlatformAdapter } from "@merge-mentor/domain/platform.js";
import { AzureDevOpsAdapter } from "@merge-mentor/platforms/azure.js";
import { GitHubAdapter } from "@merge-mentor/platforms/github.js";
import { initLogger } from "@merge-mentor/shared/logger.js";
import type { OutputWriter } from "@merge-mentor/shared/ports/index.js";
import { parseWorkItemUrl } from "@merge-mentor/shared/utils/workItemUrl.js";

import { refreshEnv, resolveTempPath } from "./env.server.js";
import {
  loadPostedFingerprints,
  postedTargetKey,
  recordPostedFingerprints,
  reviewScope,
} from "./postedComments.server.js";
import type {
  PBIReviewStreamInput,
  PBIReviewSummary,
  PendingCommentView,
  PostCommentsInput,
  PostCommentsResult,
  ProjectReviewStreamInput,
  ProjectReviewSummary,
} from "./review.types.js";
import { startOrAttach } from "./reviewRuns.server.js";
import type { SseEmitter } from "./sse.server.js";

/** A fully resolved work item review target: platform, item ID, and configuration. */
interface WorkItemTarget {
  readonly platform: Platform;
  readonly id: string;
  readonly write: boolean;
  readonly config: Config;
}

/** Human-readable noun used in validation and status messages for each kind. */
export type WorkItemKind = "PBI" | "project";

/**
 * Resolves the work item to review and the adapter configuration for it.
 *
 * A pasted work item URL takes precedence and supplies the platform and
 * repository, mirroring the CLI's `--url` behavior. A bare work item ID falls
 * back to the repository configured in the web server's environment.
 */
function resolveTarget(
  input: PBIReviewStreamInput | ProjectReviewStreamInput,
  kind: WorkItemKind
): WorkItemTarget {
  refreshEnv();

  const overrides: {
    platform?: string;
    githubRepoOwner?: string;
    githubRepoName?: string;
    azureOrg?: string;
    azureProject?: string;
    tempPath?: string;
  } = { tempPath: resolveTempPath() };
  let id: string;

  if (input.url) {
    const parsed = parseWorkItemUrl(input.url);
    overrides.platform = parsed.platform;
    if (parsed.platform === "github") {
      overrides.githubRepoOwner = parsed.owner;
      overrides.githubRepoName = parsed.repo;
    } else {
      overrides.azureOrg = parsed.org;
      overrides.azureProject = parsed.project;
    }
    id = parsed.id;
  } else if (input.id?.trim()) {
    id = input.id.trim();
  } else {
    throw new Error(`Provide a ${kind} URL or ID to run a review.`);
  }

  const config = loadConfig(overrides);
  const platform = (overrides.platform ?? config.defaultPlatform) as Platform;
  if (platform !== "github" && platform !== "azure") {
    throw new Error(`Invalid platform "${platform}". Must be "github" or "azure".`);
  }

  validateConfig(config, platform);

  return { platform, id, write: input.write === true, config };
}

/** Creates the platform adapter for the resolved target. */
function createAdapter(target: WorkItemTarget): PlatformAdapter {
  return target.platform === "github"
    ? new GitHubAdapter(target.config)
    : new AzureDevOpsAdapter(target.config);
}

/** Creates the AI provider client for the resolved target's configuration. */
function createAiClient(target: WorkItemTarget): {
  readonly aiProvider: AIProviderType;
  readonly client: ReturnType<typeof createAIProvider>;
} {
  const aiProvider = target.config.aiProvider as AIProviderType;
  const client = createAIProvider(aiProvider, {
    model: target.config.aiModel,
    token: target.config.copilotToken,
    aiBaseUrl: target.config.aiBaseUrl,
    aiApiKey: target.config.aiApiKey,
    tempPath: target.config.tempPath,
  });

  return { aiProvider, client };
}

/** Builds an OutputWriter that forwards engine progress to the SSE emitter. */
function createStreamOutput(emit: SseEmitter): OutputWriter {
  return {
    log: (message) => emit.send({ type: "log", message }),
    error: (message) => emit.send({ type: "log", message: `⚠️ ${message}` }),
    write: (data) => {
      emit.pushChunk(data);
      return true;
    },
  };
}

/**
 * Routes structured engine progress: AI stream deltas go to the batched
 * formatted `stream` channel, everything else becomes a `progress` frame.
 */
function createProgressHandler(emit: SseEmitter): (event: ReviewProgressEvent) => void {
  return (event) => {
    if (event.kind === "stream") {
      emit.pushStream(event.phase, event.delta);
      return;
    }
    emit.send({ type: "progress", event });
  };
}

/** Sends the shared configuration/start status frames and initializes logging. */
function announceStart(emit: SseEmitter, target: WorkItemTarget, kind: WorkItemKind): void {
  initLogger(target.config.tempPath);

  const modeLabel = target.write ? "" : " (dry-run)";
  emit.send({
    type: "status",
    message: `Starting ${kind} review for #${target.id} on ${target.platform}${modeLabel}...`,
  });
}

/**
 * Wraps a dry-run work item comment with its fingerprint and posted state.
 *
 * Write-mode runs have already posted, so they expose no pending comments.
 */
function toWorkItemPendingComments(
  target: WorkItemTarget,
  kind: "pbi" | "project",
  planned: { readonly reportMarkdown: string; readonly existingCommentId?: number | string }
): PendingCommentView[] {
  if (target.write) return [];

  const key = postedTargetKey(
    kind,
    target.platform,
    reviewScope(target.platform, target.config),
    target.id
  );
  const posted = loadPostedFingerprints(target.config.tempPath, key);
  const comment: PendingComment = {
    body: planned.reportMarkdown,
    existingCommentId: planned.existingCommentId,
  };
  const fingerprint = commentFingerprint(comment);
  return [{ ...comment, fingerprint, posted: posted.has(fingerprint) }];
}

/** Flattens the PBI engine result into the client-safe summary view. */
function toPBISummary(result: PBIReviewResult, target: WorkItemTarget): PBIReviewSummary {
  return {
    id: target.id,
    title: result.title,
    overallAssessment: result.overall_assessment,
    suggestions: result.suggestions,
    dryRun: !target.write,
    pendingComments: toWorkItemPendingComments(target, "pbi", result),
  };
}

/** Flattens the project engine result into the client-safe summary view. */
function toProjectSummary(
  result: ProjectReviewResult,
  target: WorkItemTarget
): ProjectReviewSummary {
  return {
    id: target.id,
    title: result.title,
    completenessAssessment: result.completeness_assessment,
    dependencyRisks: result.dependency_risks,
    acceptanceCriteriaAlignment: result.acceptance_criteria_alignment,
    estimationConsistency: result.estimation_consistency,
    overallAssessment: result.overall_assessment,
    confidence: result.confidence,
    findings: result.findings.map((finding) => ({
      workItemId: finding.work_item_id,
      dimension: finding.dimension,
      severity: finding.severity,
      issue: finding.issue,
      recommendation: finding.recommendation,
    })),
    suggestions: result.suggestions,
    dryRun: !target.write,
    pendingComments: toWorkItemPendingComments(target, "project", result),
  };
}

/**
 * Builds the run-dedupe key for a work item target.
 *
 * This is distinct from the posted-comments key: it includes the write mode so
 * a submit that toggles it starts a new run instead of silently attaching to an
 * unrelated in-flight run.
 */
function runTargetKey(kind: "pbi" | "project", target: WorkItemTarget): string {
  const base = postedTargetKey(
    kind,
    target.platform,
    reviewScope(target.platform, target.config),
    target.id
  );
  return `${base}:write=${target.write}`;
}

/**
 * Starts (or attaches to) a PBI review run and returns its id.
 *
 * Target resolution and validation happen synchronously; execution is owned by
 * the run registry. Clients stream frames from the GET endpoint.
 */
export function startPBIReview(input: PBIReviewStreamInput): { runId: string; attached: boolean } {
  const target = resolveTarget(input, "PBI");
  const scope = reviewScope(target.platform, target.config);

  return startOrAttach({
    kind: "pbi",
    targetKey: runTargetKey("pbi", target),
    label: `PBI #${target.id} · ${scope}`,
    input,
    execute: (emitter) => executePBIReview(target, emitter),
  });
}

/** Runs a PBI review, emitting frames for the timeline and formatted AI output. */
async function executePBIReview(target: WorkItemTarget, emit: SseEmitter): Promise<void> {
  emit.send({ type: "status", message: "Resolving review configuration..." });
  announceStart(emit, target, "PBI");

  const { aiProvider, client } = createAiClient(target);
  const engine = new PBIReviewEngine(createAdapter(target), client, {
    dryRun: !target.write,
    tempPath: target.config.tempPath,
    aiProvider,
    aiModel: target.config.aiModel,
    output: createStreamOutput(emit),
    onStreamChunk: emit.pushChunk,
    onProgress: createProgressHandler(emit),
  });

  const result = await engine.reviewPBI(target.id);
  emit.send({ type: "result", summary: toPBISummary(result, target) });
}

/**
 * Starts (or attaches to) a project plan review run and returns its id.
 *
 * Target resolution and validation happen synchronously; execution is owned by
 * the run registry. Clients stream frames from the GET endpoint.
 */
export function startProjectReview(input: ProjectReviewStreamInput): {
  runId: string;
  attached: boolean;
} {
  const target = resolveTarget(input, "project");
  const scope = reviewScope(target.platform, target.config);

  return startOrAttach({
    kind: "project",
    targetKey: runTargetKey("project", target),
    label: `Project #${target.id} · ${scope}`,
    input,
    execute: (emitter) => executeProjectReview(target, emitter),
  });
}

/** Runs a project plan review, emitting frames for the timeline and formatted AI output. */
async function executeProjectReview(target: WorkItemTarget, emit: SseEmitter): Promise<void> {
  emit.send({ type: "status", message: "Resolving review configuration..." });
  announceStart(emit, target, "project");

  const { aiProvider, client } = createAiClient(target);
  const engine = new ProjectReviewEngine(createAdapter(target), client, {
    dryRun: !target.write,
    tempPath: target.config.tempPath,
    aiProvider,
    aiModel: target.config.aiModel,
    output: createStreamOutput(emit),
    onStreamChunk: emit.pushChunk,
    onProgress: createProgressHandler(emit),
  });

  const result = await engine.reviewProject(target.id);
  emit.send({ type: "result", summary: toProjectSummary(result, target) });
}

/**
 * Posts the comment a dry-run work item review planned, without re-running any
 * AI work. The planned body is round-tripped from the client.
 */
export async function postWorkItemComments(
  input: PostCommentsInput,
  kind: WorkItemKind
): Promise<PostCommentsResult> {
  const target = resolveTarget(input, kind);
  const adapter = createAdapter(target);
  const storeKind = kind === "PBI" ? "pbi" : "project";
  const key = postedTargetKey(
    storeKind,
    target.platform,
    reviewScope(target.platform, target.config),
    target.id
  );
  const posted = loadPostedFingerprints(target.config.tempPath, key);
  const result = await postPlannedComments(
    adapter,
    { kind: storeKind, id: target.id },
    input.comments,
    { postedFingerprints: posted }
  );
  recordPostedFingerprints(target.config.tempPath, key, result.postedFingerprints);
  return result;
}
