import {
  type Config,
  loadConfig,
  type Platform,
  validateConfig,
} from "@merge-mentor/config/config.js";
import { createAIProvider } from "@merge-mentor/core/ai/providerFactory.js";
import type { AIProviderType } from "@merge-mentor/core/ai/types.js";
import { PBIReviewEngine, type PBIReviewResponse } from "@merge-mentor/core/review/pbiEngine.js";
import {
  ProjectReviewEngine,
  type ProjectReviewResponse,
} from "@merge-mentor/core/review/projectEngine.js";
import type { PlatformAdapter } from "@merge-mentor/domain/platform.js";
import { AzureDevOpsAdapter } from "@merge-mentor/platforms/azure.js";
import { GitHubAdapter } from "@merge-mentor/platforms/github.js";
import { initLogger } from "@merge-mentor/shared/logger.js";
import type { OutputWriter } from "@merge-mentor/shared/ports/index.js";
import { parseWorkItemUrl } from "@merge-mentor/shared/utils/workItemUrl.js";

import { refreshEnv, resolveTempPath } from "./env.server.js";
import type {
  PBIReviewStreamInput,
  PBIReviewSummary,
  ProjectReviewStreamInput,
  ProjectReviewSummary,
} from "./review.types.js";
import { createSseResponse, type SseEmitter } from "./sse.server.js";

/** A fully resolved work item review target: platform, item ID, and configuration. */
interface WorkItemTarget {
  readonly platform: Platform;
  readonly id: string;
  readonly write: boolean;
  readonly config: Config;
}

/** Human-readable noun used in validation and status messages for each kind. */
type WorkItemKind = "PBI" | "project";

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

/** Sends the shared configuration/start status frames and initializes logging. */
function announceStart(emit: SseEmitter, target: WorkItemTarget, kind: WorkItemKind): void {
  initLogger(target.config.tempPath);

  const modeLabel = target.write ? "" : " (dry-run)";
  emit.send({
    type: "status",
    message: `Starting ${kind} review for #${target.id} on ${target.platform}${modeLabel}...`,
  });
}

/** Flattens the PBI engine result into the client-safe summary view. */
function toPBISummary(result: PBIReviewResponse, target: WorkItemTarget): PBIReviewSummary {
  return {
    id: target.id,
    title: result.title,
    overallAssessment: result.overall_assessment,
    suggestions: result.suggestions,
    dryRun: !target.write,
  };
}

/** Flattens the project engine result into the client-safe summary view. */
function toProjectSummary(
  result: ProjectReviewResponse,
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
  };
}

/**
 * Streams a PBI review as Server-Sent Events.
 *
 * Emits `status`, `log`, and `chunk` frames while the review runs, followed by a
 * single `result` frame (or `error`) and a terminating `done` frame.
 */
export function createPBIReviewStream(input: PBIReviewStreamInput): ReadableStream<Uint8Array> {
  return createSseResponse(async (emit) => {
    emit.send({ type: "status", message: "Resolving review configuration..." });
    const target = resolveTarget(input, "PBI");
    announceStart(emit, target, "PBI");

    const { aiProvider, client } = createAiClient(target);
    const engine = new PBIReviewEngine(createAdapter(target), client, {
      dryRun: !target.write,
      tempPath: target.config.tempPath,
      aiProvider,
      aiModel: target.config.aiModel,
      output: createStreamOutput(emit),
      onStreamChunk: emit.pushChunk,
    });

    const result = await engine.reviewPBI(target.id);
    emit.send({ type: "result", summary: toPBISummary(result, target) });
  });
}

/**
 * Streams a project plan review as Server-Sent Events.
 *
 * Emits `status`, `log`, and `chunk` frames while the review runs, followed by a
 * single `result` frame (or `error`) and a terminating `done` frame.
 */
export function createProjectReviewStream(
  input: ProjectReviewStreamInput
): ReadableStream<Uint8Array> {
  return createSseResponse(async (emit) => {
    emit.send({ type: "status", message: "Resolving review configuration..." });
    const target = resolveTarget(input, "project");
    announceStart(emit, target, "project");

    const { aiProvider, client } = createAiClient(target);
    const engine = new ProjectReviewEngine(createAdapter(target), client, {
      dryRun: !target.write,
      tempPath: target.config.tempPath,
      aiProvider,
      aiModel: target.config.aiModel,
      output: createStreamOutput(emit),
      onStreamChunk: emit.pushChunk,
    });

    const result = await engine.reviewProject(target.id);
    emit.send({ type: "result", summary: toProjectSummary(result, target) });
  });
}
