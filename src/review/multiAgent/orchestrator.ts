import { formatExistingCommentsContext } from "../../ai/prompts/commentContext.js";
import {
  buildAgentPrompt,
  buildPreClassifierPrompt,
  buildSynthesizerPrompt,
} from "../../ai/prompts/multiAgent/prompts.js";
import {
  parseAgentReview,
  parsePreClassifier,
  parseSynthesizedReview,
} from "../../ai/shared/responseParsers.js";
import type { AIProviderClient, AIResponse, TokenUsage } from "../../ai/types.js";
import { createChildLogger } from "../../logger.js";
import type {
  CrossFileReviewResult,
  ExistingComment,
  FileFinding,
  FileReviewResult,
  PRDetails,
} from "../../platforms/types.js";
import type { OutputWriter } from "../../ports/index.js";
import { StreamingDisplay } from "../../utils/streamingDisplay.js";
import { calculateTextSimilarity } from "../../utils/textSimilarity.js";
import { mergeTokenUsage } from "../../utils/tokenUsage.js";
import type { DiffManifest } from "../diffStorage.js";
import type { ReviewPass } from "../reviewSelection.js";
import { type AgentRoleId, getAllAgentIds, resolveAgentsFromPasses } from "./agents.js";

/** Confidence level → numeric score used for minConfidence filtering. */
const CONFIDENCE_SCORES: Record<string, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.3,
};

/** Heartbeat check interval in ms. */
const HEARTBEAT_INTERVAL_MS = 1000;

/** Minimum gap between two emitted "still working" lines, in ms. */
const HEARTBEAT_LOG_GAP_MS = 10_000;

/** While streaming, emit a "still working" line only after this much silence. */
const SILENCE_THRESHOLD_MS = 15_000;

/**
 * Configuration options for the multi-agent review orchestrator.
 */
export interface MultiAgentOrchestratorOptions {
  /** ReviewPasses that resolve to the enabled subagent set. Default: all agents. */
  readonly passes?: readonly ReviewPass[];
  /** Discard findings whose confidence score is below this threshold. Default: 0.7 */
  readonly minConfidence?: number;
  /** Maximum number of subagents dispatched concurrently. Default: 2 */
  readonly maxParallel?: number;
  /** Output writer for progress/status messages. */
  readonly output?: OutputWriter;
  /** Streaming display configuration (mirrors the engine's streaming options). */
  readonly streaming?: {
    readonly enabled: boolean;
    readonly lines: number;
    readonly ciMode: boolean;
  };
}

/**
 * Inputs required to run a multi-agent review over a stored diff manifest.
 */
export interface MultiAgentReviewInput {
  /** Pull request details used to build agent and classifier prompts. */
  readonly prDetails: PRDetails;
  /** Diff manifest describing the files and stored diffs being reviewed. */
  readonly manifest: DiffManifest;
  /** Absolute paths to the numbered diff files for @file attachment. */
  readonly diffFiles?: readonly string[];
  /** Existing bot comments to give subagents context and avoid repeats. */
  readonly existingComments?: readonly ExistingComment[];
  /** Repository working directory for the AI provider's tool access. */
  readonly repoPath?: string;
}

/** A single subagent's raw output before synthesis. */
interface AgentRunResult {
  /** Agent role that produced the findings. */
  readonly agent: AgentRoleId;
  /** Raw findings reported by this subagent before synthesis. */
  readonly findings: readonly FileFinding[];
}

/**
 * The synthesized result of a multi-agent review run.
 */
export interface MultiAgentReviewOutput {
  /** Final per-file review results after synthesis and confidence filtering. */
  readonly fileResults: readonly FileReviewResult[];
  /** Cross-file architectural assessment produced by the synthesizer. */
  readonly crossFileResult: CrossFileReviewResult;
  /** Subagents that were actually dispatched (after pre-classification). */
  readonly dispatchedAgents: readonly AgentRoleId[];
  /** Findings each subagent produced before synthesis. */
  readonly agentResults: readonly AgentRunResult[];
  /** Aggregated token usage across all AI calls in the run. */
  readonly tokenUsage?: TokenUsage;
}

/** A subagent execution tracked by the concurrency pool. */
interface AgentExecution {
  /** Agent role that was executed. */
  readonly agent: AgentRoleId;
  /** Findings parsed from the agent's AI response. */
  readonly findings: readonly FileFinding[];
  /** Token usage reported by the agent's AI call. */
  readonly tokenUsage?: TokenUsage;
}

/**
 * Maps a confidence string to a numeric score used for minConfidence filtering.
 *
 * @param confidence - Confidence label (e.g. "high", "medium", "low").
 * @returns The numeric score, or 0 for unknown labels.
 */
function scoreConfidence(confidence: string): number {
  return CONFIDENCE_SCORES[confidence] ?? 0;
}

/**
 * Runs `fn` over `items` concurrently, processing at most `limit` items at a
 * time while preserving input order in the results.
 *
 * @param items - Values to process.
 * @param limit  - Maximum number of concurrent executions.
 * @param fn     - Async function applied to each item and its index.
 * @returns Results in the same order as `items`.
 */
async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex++;
      results[index] = await fn(items[index], index);
    }
  };

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

/**
 * Orchestrates the multi-agent review strategy.
 *
 * Flow:
 * 1. Resolves --passes into the enabled subagent set (pass-to-agent map).
 * 2. Runs a lightweight LLM pre-classifier to select relevant subagents.
 * 3. Dispatches the selected subagents concurrently (bounded by maxParallel).
 * 4. Runs the Lead Synthesizer to deduplicate, resolve conflicts, and filter
 *    findings below the configured minConfidence.
 */
export class MultiAgentOrchestrator {
  private readonly provider: AIProviderClient;
  private readonly passes?: readonly ReviewPass[];
  private readonly minConfidence: number;
  private readonly maxParallel: number;
  private readonly output?: OutputWriter;
  private readonly streaming?: MultiAgentOrchestratorOptions["streaming"];
  private readonly logger = createChildLogger({ component: "MultiAgentOrchestrator" });

  constructor(provider: AIProviderClient, options?: MultiAgentOrchestratorOptions) {
    this.provider = provider;
    this.passes = options?.passes;
    this.minConfidence = options?.minConfidence ?? 0.7;
    this.maxParallel = options?.maxParallel ?? 2;
    this.output = options?.output;
    this.streaming = options?.streaming;
  }

  private log(message: string): void {
    this.output?.log(message);
    this.logger.debug(message);
  }

  /**
   * Whether streaming output will actually render for the user: CI mode prints
   * plain text, interactive TTYs render the rolling window. In other contexts
   * (piped/captured output) the ANSI escape codes StreamingDisplay emits would
   * be invisible, so we fall back to plain-text progress lines instead.
   */
  private get streamingActive(): boolean {
    return (
      this.streaming?.enabled === true && (this.streaming.ciMode || process.stdout.isTTY === true)
    );
  }

  /**
   * Creates a streaming display and returns a callback for streaming data.
   * When streaming output is active, also exposes a `pushLine` helper that
   * routes a status line into the display (used by the silence heartbeat) and
   * a `lastChunkAt` getter tracking when model tokens last arrived.
   * Returns undefined callbacks when streaming output is not active.
   */
  private createStreaming(context: string): {
    callback: ((chunk: string) => void) | undefined;
    finish: () => void;
    pushLine: ((line: string) => void) | undefined;
    lastChunkAt: (() => number | undefined) | undefined;
  } {
    if (!this.streamingActive) {
      return {
        callback: undefined,
        finish: () => {},
        pushLine: undefined,
        lastChunkAt: undefined,
      };
    }

    const display = new StreamingDisplay({
      maxLines: this.streaming?.lines ?? 9,
      title: `🤖 ${context}`,
      enabled: true,
      ciMode: this.streaming?.ciMode ?? false,
      ...(this.output ? { output: this.output } : {}),
    });

    let lastChunkAt: number | undefined;
    return {
      callback: (chunk: string) => {
        lastChunkAt = Date.now();
        display.push(chunk);
      },
      finish: () => display.finish(),
      pushLine: (line: string) => display.push(`${line}\n`),
      lastChunkAt: () => lastChunkAt,
    };
  }

  /**
   * Returns a stop function for a "still working" heartbeat shown while a
   * long-running phase runs, so the user always sees progress regardless of
   * terminal support. When streaming is active, the heartbeat only fires when
   * no model tokens have arrived for {@link SILENCE_THRESHOLD_MS} (the model
   * is "thinking" in silence); otherwise it emits plain-text lines every
   * {@link HEARTBEAT_LOG_GAP_MS}.
   */
  private heartbeat(
    label: string,
    streaming?: {
      pushLine: ((line: string) => void) | undefined;
      lastChunkAt: (() => number | undefined) | undefined;
    }
  ): () => void {
    const started = Date.now();
    let lastLogged = 0;
    const timer = setInterval(() => {
      const elapsed = Math.round((Date.now() - started) / 1000);
      if (elapsed - lastLogged < HEARTBEAT_LOG_GAP_MS / 1000) {
        return;
      }
      const lastChunk = streaming?.lastChunkAt?.();
      if (
        streaming?.pushLine &&
        lastChunk !== undefined &&
        Date.now() - lastChunk < SILENCE_THRESHOLD_MS
      ) {
        return;
      }
      lastLogged = elapsed;
      const line = `  ⏳ ${label} still working… (${elapsed}s)`;
      if (streaming?.pushLine) {
        streaming.pushLine(line);
      } else {
        this.log(line);
      }
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(timer);
  }

  private enabledAgents(): AgentRoleId[] {
    if (!this.passes || this.passes.length === 0) {
      return getAllAgentIds();
    }
    return resolveAgentsFromPasses(this.passes);
  }

  private existingCommentsContext(input: MultiAgentReviewInput): string | undefined {
    if (!input.existingComments || input.existingComments.length === 0) {
      return undefined;
    }

    const context = formatExistingCommentsContext(input.existingComments);
    if (
      context === "No existing comments on this PR." ||
      context === "No existing inline comments on this PR."
    ) {
      return undefined;
    }

    return context;
  }

  /**
   * Runs the lightweight LLM pre-classifier to select relevant specialized
   * subagents. The `enabledAgents` passed here are the specialists only — the
   * always-run general baseline is excluded. Falls back to all enabled
   * specialists on any failure or empty selection.
   */
  private async classify(
    enabledAgents: readonly AgentRoleId[],
    input: MultiAgentReviewInput,
    generalEnabled: boolean
  ): Promise<{ agents: readonly AgentRoleId[]; tokenUsage?: TokenUsage }> {
    this.log("Running LLM pre-classifier to select relevant subagents...");
    const prompt = buildPreClassifierPrompt({
      prDetails: input.prDetails,
      files: input.manifest.files,
      enabledAgents,
      generalAlwaysRuns: generalEnabled,
    });

    let selected: string[];
    let tokenUsage: TokenUsage | undefined;
    const streaming = this.createStreaming("Running pre-classifier…");
    const stopHeartbeat = this.heartbeat("pre-classifier", streaming);
    try {
      const response = await this.provider.executePrompt(prompt, {
        workingDirectory: input.repoPath,
        promptType: "multi-agent-classifier",
        ...(streaming.callback ? { onStreamData: streaming.callback } : {}),
      });
      tokenUsage = response.tokenUsage;
      selected = parsePreClassifier(this.logger, response);
    } catch (error) {
      this.logger.warn(
        { error: (error as Error).message },
        "Pre-classifier failed; running all enabled subagents"
      );
      return { agents: enabledAgents };
    } finally {
      stopHeartbeat();
      streaming.finish();
    }

    const filtered = enabledAgents.filter((agent) => selected.includes(agent));
    if (filtered.length === 0) {
      this.logger.info("Pre-classifier selected no subagents; running all enabled subagents");
      return { agents: enabledAgents, tokenUsage };
    }

    return { agents: filtered, tokenUsage };
  }

  private async runAgent(
    agent: AgentRoleId,
    input: MultiAgentReviewInput,
    onStreamData?: (chunk: string) => void
  ): Promise<AgentExecution> {
    const prompt = buildAgentPrompt({
      agent,
      prDetails: input.prDetails,
      manifest: input.manifest,
      existingCommentsContext: this.existingCommentsContext(input),
      repoPath: input.repoPath,
    });

    const response = await this.provider.executePrompt(prompt, {
      workingDirectory: input.repoPath,
      ...(onStreamData ? { onStreamData } : {}),
      ...(input.diffFiles && input.diffFiles.length > 0 ? { diffFiles: [...input.diffFiles] } : {}),
      promptType: "multi-agent-subagent",
    });

    return {
      agent,
      findings: parseAgentReview(this.logger, response),
      tokenUsage: response.tokenUsage,
    };
  }

  private async synthesize(
    input: MultiAgentReviewInput,
    executions: readonly AgentExecution[],
    tokenUsage: TokenUsage | undefined
  ): Promise<MultiAgentReviewOutput> {
    this.log(`Running Lead Synthesizer over ${executions.length} subagent result(s)...`);

    const agentResults: AgentRunResult[] = executions.map((execution) => ({
      agent: execution.agent,
      findings: execution.findings,
    }));

    const prompt = buildSynthesizerPrompt({
      prDetails: input.prDetails,
      files: input.manifest.files,
      agentResults,
      minConfidence: this.minConfidence,
      existingCommentsContext: this.existingCommentsContext(input),
    });

    const streaming = this.createStreaming("Running Lead Synthesizer…");
    const stopHeartbeat = this.heartbeat("Lead Synthesizer", streaming);
    let response: AIResponse;
    try {
      response = await this.provider.executePrompt(prompt, {
        workingDirectory: input.repoPath,
        promptType: "multi-agent-synthesizer",
        ...(streaming.callback ? { onStreamData: streaming.callback } : {}),
      });
    } finally {
      stopHeartbeat();
      streaming.finish();
    }

    const mergedUsage = mergeTokenUsage(tokenUsage, response.tokenUsage);
    const parsed = parseSynthesizedReview(this.logger, response);

    // Hard noise-threshold backstop: the synthesizer is instructed to apply
    // minConfidence, but we also enforce it locally to protect developer trust.
    const filteredResults: FileReviewResult[] = parsed.fileResults.map((result) => ({
      filename: result.filename,
      findings: result.findings.filter(
        (finding) => scoreConfidence(finding.confidence) >= this.minConfidence
      ),
    }));

    // Location reconciliation: the synthesizer frequently drops `line` (and
    // sometimes `file`) from consolidated findings. Recover accurate locations
    // by matching each synthesized finding back to the subagent finding it was
    // derived from (via message similarity), so inline comments land on the
    // correct file:line instead of defaulting to line 1.
    const fileResults = this.reconcileFindingLocations(
      filteredResults,
      executions,
      new Set(input.manifest.files.map((file) => file.filename))
    );

    const crossFileResult: CrossFileReviewResult = {
      overallAssessment: parsed.overallAssessment,
      findings: parsed.crossFileResult.findings.filter(
        (finding) => scoreConfidence(finding.confidence) >= this.minConfidence
      ),
      recommendations: parsed.crossFileResult.recommendations,
    };

    return {
      fileResults,
      crossFileResult,
      dispatchedAgents: executions.map((execution) => execution.agent),
      agentResults,
      tokenUsage: mergedUsage,
    };
  }

  /**
   * Minimum message similarity required before adopting a subagent finding's
   * location for a synthesized finding.
   */
  private static readonly LOCATION_MATCH_THRESHOLD = 0.55;

  /**
   * Recovers accurate file/line locations for synthesized findings.
   *
   * The Lead Synthesizer is asked to consolidate subagent findings, but it often
   * omits `line` (defaulting to 0) or `file` entirely. This step rebuilds the
   * location by matching each synthesized finding to the subagent finding with
   * the highest message similarity and inheriting its file/line. Findings that
   * already carry a valid location on a manifest file are left untouched.
   */
  private reconcileFindingLocations(
    fileResults: readonly FileReviewResult[],
    executions: readonly AgentExecution[],
    manifestFiles: ReadonlySet<string>
  ): FileReviewResult[] {
    // Flatten all subagent findings that have a usable location as candidates.
    const candidates: (FileFinding & { file: string })[] = executions.flatMap((execution) =>
      execution.findings
        .filter(
          (finding) =>
            finding.file !== undefined && finding.line > 0 && manifestFiles.has(finding.file)
        )
        .map((finding) => finding as FileFinding & { file: string })
    );

    if (candidates.length === 0) {
      return [...fileResults];
    }

    const byFilename = new Map<string, FileFinding[]>();

    const pushFinding = (filename: string, finding: FileFinding): void => {
      const existing = byFilename.get(filename);
      if (existing) {
        existing.push(finding);
      } else {
        byFilename.set(filename, [finding]);
      }
    };

    for (const result of fileResults) {
      for (const finding of result.findings) {
        const hasValidLocation = finding.line > 0 && manifestFiles.has(result.filename);

        if (hasValidLocation) {
          pushFinding(result.filename, finding);
          continue;
        }

        const match = this.findBestLocationMatch(finding, candidates);
        if (match) {
          this.logger.info(
            {
              synthesizedFile: result.filename,
              synthesizedLine: finding.line,
              recoveredFile: match.file,
              recoveredLine: match.line,
              category: finding.category,
              similarity: match.similarity,
            },
            "Recovered location for synthesized finding from subagent output"
          );
          pushFinding(match.file, {
            ...finding,
            file: match.file,
            line: match.line,
          });
        } else {
          // No confident match: keep the synthesized attribution as-is so the
          // engine's line-number validator can still attempt placement.
          pushFinding(result.filename, finding);
        }
      }
    }

    return Array.from(byFilename.entries()).map(([filename, findings]) => ({
      filename,
      findings,
    }));
  }

  /**
   * Returns the subagent finding whose message most closely matches the
   * synthesized finding, or undefined when no candidate exceeds the threshold.
   * Candidates from the same file as the synthesized finding receive a small
   * similarity bonus, since the synthesizer often keeps `file` but drops `line`.
   */
  private findBestLocationMatch(
    finding: FileFinding,
    candidates: readonly (FileFinding & {
      file: string;
    })[]
  ): { file: string; line: number; similarity: number } | undefined {
    let best: { file: string; line: number; similarity: number } | undefined;

    for (const candidate of candidates) {
      let similarity = calculateTextSimilarity(finding.message, candidate.message);
      if (finding.file && candidate.file === finding.file) {
        similarity += 0.1;
      }
      if (best && similarity <= best.similarity) continue;
      best = { file: candidate.file, line: candidate.line, similarity };
    }

    if (!best || best.similarity < MultiAgentOrchestrator.LOCATION_MATCH_THRESHOLD) {
      return undefined;
    }

    return best;
  }

  /**
   * Dispatches the selected subagents concurrently (bounded by maxParallel),
   * reporting each agent's start and completion with a plain-text progress line
   * and streaming live output into a shared display when streaming is active.
   * Plain text (via output.log) is used so progress is visible in every
   * environment — TTY, CI, piped, or captured output — regardless of streaming.
   */
  private async runSubagents(
    dispatched: readonly AgentRoleId[],
    input: MultiAgentReviewInput
  ): Promise<{ executions: readonly AgentExecution[]; tokenUsage?: TokenUsage }> {
    const startedAt = new Map<AgentRoleId, number>();
    const running = new Set<AgentRoleId>();
    let tokenUsage: TokenUsage | undefined;

    const streaming = this.createStreaming("Running subagents…");
    const stopHeartbeat = this.subagentHeartbeat(dispatched, running, startedAt, streaming);
    try {
      const executions = await runWithConcurrency(dispatched, this.maxParallel, async (agent) => {
        running.add(agent);
        startedAt.set(agent, Date.now());
        this.log(`  ⏳ [${agent}] analyzing…`);

        const started = Date.now();
        // Concurrent agents share one display; each agent's chunks are prefixed
        // so the user can tell whose output is streaming.
        const onStreamData = streaming.callback
          ? (chunk: string) => streaming.callback?.(`[${agent}] ${chunk}`)
          : undefined;
        const execution = await this.runAgent(agent, input, onStreamData);
        running.delete(agent);

        const duration = Math.max(0, Math.round((Date.now() - started) / 1000));
        this.log(`  ✓ [${agent}] done — ${execution.findings.length} finding(s) in ${duration}s`);
        tokenUsage = mergeTokenUsage(tokenUsage, execution.tokenUsage);
        return execution;
      });

      return { executions, tokenUsage };
    } finally {
      stopHeartbeat();
      streaming.finish();
    }
  }

  /**
   * Returns a stop function for a heartbeat that lists which subagents are
   * still running. Always active: when streaming, the line is routed into the
   * shared display (only when no tokens have arrived for a while, so live
   * output stays the primary signal); otherwise it is emitted as plain text.
   */
  private subagentHeartbeat(
    dispatched: readonly AgentRoleId[],
    running: Set<AgentRoleId>,
    startedAt: Map<AgentRoleId, number>,
    streaming?: {
      pushLine: ((line: string) => void) | undefined;
      lastChunkAt: (() => number | undefined) | undefined;
    }
  ): () => void {
    let lastLogged = Date.now();
    const timer = setInterval(() => {
      const active = dispatched.filter((agent) => running.has(agent));
      if (active.length === 0) {
        return;
      }
      const now = Date.now();
      if (now - lastLogged < HEARTBEAT_LOG_GAP_MS) {
        return;
      }
      const lastChunk = streaming?.lastChunkAt?.();
      if (
        streaming?.pushLine &&
        lastChunk !== undefined &&
        now - lastChunk < SILENCE_THRESHOLD_MS
      ) {
        return;
      }
      lastLogged = now;
      const parts = active.map((agent) => {
        const elapsed = Math.round((now - (startedAt.get(agent) ?? now)) / 1000);
        return `${agent} (${elapsed}s)`;
      });
      const line = `  ⏳ still working: ${parts.join(", ")}…`;
      if (streaming?.pushLine) {
        streaming.pushLine(line);
      } else {
        this.log(line);
      }
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(timer);
  }

  /**
   * Runs the full multi-agent review pipeline for a stored diff manifest.
   *
   * The General Logic & Correctness agent is the always-run baseline: it is
   * exempt from pre-classification and dispatches whenever enabled. Only the
   * specialized agents are subject to the LLM pre-classifier.
   */
  async review(input: MultiAgentReviewInput): Promise<MultiAgentReviewOutput> {
    const enabledAgents = this.enabledAgents();
    const generalEnabled = enabledAgents.includes("general");
    const specialists = enabledAgents.filter((agent) => agent !== "general");
    this.log(
      `Multi-agent review enabled for ${enabledAgents.length} subagent role(s): ${enabledAgents.join(", ")}`
    );

    let dispatched: readonly AgentRoleId[];
    let tokenUsage: TokenUsage | undefined;

    if (specialists.length === 0) {
      // Only the general baseline is enabled; the pre-classifier has nothing to route.
      dispatched = enabledAgents;
    } else {
      const classified = await this.classify(specialists, input, generalEnabled);
      dispatched = generalEnabled ? ["general", ...classified.agents] : classified.agents;
      tokenUsage = classified.tokenUsage;
    }

    this.log(`Dispatching ${dispatched.length} subagent(s): ${dispatched.join(", ")}`);

    const { executions, tokenUsage: subAgentUsage } = await this.runSubagents(dispatched, input);
    tokenUsage = mergeTokenUsage(tokenUsage, subAgentUsage);

    return this.synthesize(input, executions, tokenUsage);
  }
}
