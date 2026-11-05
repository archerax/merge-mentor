/**
 * Server side of the PRD / FRD work breakdown.
 *
 * A breakdown always starts from a PRD run that is already stored on disk (the
 * review the user just ran), so there is no upload: the request names the run.
 * The run id comes from the browser, so it is checked as a safe path segment
 * before anything touches the filesystem, and the engine only reads that run's
 * own `document.json`.
 */

import path from "node:path";

import { type Config, loadConfig } from "@merge-mentor/config/config.js";
import { runPrdBreakdown } from "@merge-mentor/core/review/prd/breakdownEngine.js";
import { ConfigurationError, ValidationError } from "@merge-mentor/shared/errors/index.js";
import { initLogger } from "@merge-mentor/shared/logger.js";
import { isSafePrdRunId } from "@merge-mentor/shared/reports/index.js";

import { refreshEnv, resolveTempPath } from "./env.server.js";
import type { PrdBreakdownRunInput, PrdBreakdownSummary } from "./prd.types.js";
import { isPrdReviewActive, startOrAttach } from "./reviewRuns.server.js";
import type { SseEmitter } from "./sse.server.js";
import {
  createAiClient,
  createProgressHandler,
  createStreamOutput,
} from "./workItemReview.server.js";

/**
 * Reads and validates the body of a breakdown request.
 *
 * @throws {ValidationError} when the body is not `{ prdRunId, force? }` with a safe run id
 */
export function parseBreakdownRequest(body: unknown): PrdBreakdownRunInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("body", "the request body must be a JSON object");
  }
  const { prdRunId, force } = body as { prdRunId?: unknown; force?: unknown };
  if (typeof prdRunId !== "string" || !isSafePrdRunId(prdRunId)) {
    throw new ValidationError("prdRunId", "the run id is not valid");
  }
  if (force !== undefined && typeof force !== "boolean") {
    throw new ValidationError("force", "force must be true or false");
  }
  return { mode: "breakdown", prdRunId, force: force === true };
}

/** Strips the `Validation failed for x:` prefix for plain-language messages. */
function plainMessage(error: unknown): string {
  if (error instanceof ValidationError) {
    const detail = error.message.replace(/^Validation failed for [^:]+:\s*/, "");
    return /[.!?]$/.test(detail) ? detail : `${detail}.`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Resolves the web server's configuration for an AI-only breakdown. */
function resolveBreakdownConfig(): Config {
  refreshEnv();
  const config = loadConfig({ tempPath: resolveTempPath() });
  if (config.copilotToken && !config.copilotToken.startsWith("github_pat_")) {
    throw new ConfigurationError(
      "MM_COPILOT_TOKEN",
      "GitHub Copilot requires a fine-grained personal access token starting with 'github_pat_'."
    );
  }
  return config;
}

/**
 * Starts (or attaches to) the breakdown of a stored PRD run. A second request
 * for the same run while the first is running attaches to it.
 *
 * @throws {ValidationError} when the review of that run is still running
 */
function startPrdBreakdown(input: PrdBreakdownRunInput): { runId: string; attached: boolean } {
  if (isPrdReviewActive(input.prdRunId)) {
    throw new ValidationError(
      "prdRunId",
      "the review of this document is still running. Wait for it to finish, then break it down"
    );
  }
  const config = resolveBreakdownConfig();
  return startOrAttach({
    kind: "prd",
    targetKey: `prd-breakdown:${input.prdRunId}`,
    label: `Work breakdown · ${input.prdRunId}`,
    input,
    execute: (emitter) => executePrdBreakdown(input, config, emitter),
  });
}

/** Runs the breakdown, streaming progress frames and the final summary. */
async function executePrdBreakdown(
  input: PrdBreakdownRunInput,
  config: Config,
  emit: SseEmitter
): Promise<void> {
  initLogger(config.tempPath);
  emit.send({ type: "status", message: "Starting the work breakdown..." });

  const { aiProvider, client } = createAiClient(config);
  let result: Awaited<ReturnType<typeof runPrdBreakdown>>;
  try {
    result = await runPrdBreakdown(
      {
        source: { fromRun: input.prdRunId },
        force: input.force,
        tempPath: config.tempPath,
        aiProvider,
        aiModel: config.aiModel,
        output: createStreamOutput(emit),
        onStreamChunk: emit.pushChunk,
        onProgress: createProgressHandler(emit),
      },
      { aiClient: client }
    );
  } catch (error) {
    // Show the person a plain sentence instead of "Validation failed for ...".
    throw error instanceof ValidationError
      ? new Error(plainMessage(error), { cause: error })
      : error;
  }

  const summary: PrdBreakdownSummary = {
    prdRunId: result.runId,
    reportName: path.basename(result.paths.breakdownMarkdown),
    report: result.report,
    reportMarkdown: result.reportMarkdown,
  };
  emit.send({ type: "result", summary });
}

/**
 * Handles `POST /api/prd/breakdown`: validates the request, starts a run and
 * returns `{ runId }`. Invalid requests are 400 with a plain-language `{ error }`.
 */
export async function handlePrdBreakdownStart(request: Request): Promise<Response> {
  let input: PrdBreakdownRunInput;
  try {
    input = parseBreakdownRequest(await request.json());
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: "The request body is not valid JSON." }, { status: 400 });
    }
    return Response.json({ error: plainMessage(error) }, { status: 400 });
  }

  try {
    return Response.json(startPrdBreakdown(input));
  } catch (error) {
    return Response.json({ error: plainMessage(error) }, { status: 400 });
  }
}
