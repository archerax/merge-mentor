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

export interface MultiAgentOrchestratorOptions {
  /** ReviewPasses that resolve to the enabled subagent set. Default: all agents. */
  readonly passes?: readonly ReviewPass[];
  /** Discard findings whose confidence score is below this threshold. Default: 0.7 */
  readonly minConfidence?: number;
  /** Maximum number of subagents dispatched concurrently. Default: 4 */
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

export interface MultiAgentReviewInput {
  readonly prDetails: PRDetails;
  readonly manifest: DiffManifest;
  /** Absolute paths to the numbered diff files for @file attachment. */
  readonly diffFiles?: readonly string[];
  readonly existingComments?: readonly ExistingComment[];
  readonly repoPath?: string;
}

interface AgentRunResult {
  readonly agent: AgentRoleId;
  readonly findings: readonly FileFinding[];
}

export interface MultiAgentReviewOutput {
  readonly fileResults: readonly FileReviewResult[];
  readonly crossFileResult: CrossFileReviewResult;
  /** Subagents that were actually dispatched (after pre-classification). */
  readonly dispatchedAgents: readonly AgentRoleId[];
  /** Findings each subagent produced before synthesis. */
  readonly agentResults: readonly AgentRunResult[];
  readonly tokenUsage?: TokenUsage;
}

interface AgentExecution {
  readonly agent: AgentRoleId;
  readonly findings: readonly FileFinding[];
  readonly tokenUsage?: TokenUsage;
}

function scoreConfidence(confidence: string): number {
  return CONFIDENCE_SCORES[confidence] ?? 0;
}

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
   * Returns undefined callback when streaming output is not active.
   */
  private createStreaming(context: string): {
    callback: ((chunk: string) => void) | undefined;
    finish: () => void;
  } {
    if (!this.streamingActive) {
      return { callback: undefined, finish: () => {} };
    }

    const display = new StreamingDisplay({
      maxLines: this.streaming?.lines ?? 9,
      title: `🤖 ${context}`,
      enabled: true,
      ciMode: this.streaming?.ciMode ?? false,
      ...(this.output ? { output: this.output } : {}),
    });

    return {
      callback: (chunk: string) => display.push(chunk),
      finish: () => display.finish(),
    };
  }

  /**
   * Returns a stop function for a plain-text "still working" heartbeat shown
   * while a long-running phase runs. Used when streaming output is not active
   * so the user always sees progress regardless of terminal support.
   */
  private heartbeat(label: string): () => void {
    if (this.streamingActive) {
      return () => {};
    }
    const started = Date.now();
    let lastLogged = 0;
    const timer = setInterval(() => {
      const elapsed = Math.round((Date.now() - started) / 1000);
      if (elapsed >= 10 && elapsed - lastLogged >= 10) {
        lastLogged = elapsed;
        this.log(`  ⏳ ${label} still working… (${elapsed}s)`);
      }
    }, 1000);
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
   * Runs the lightweight LLM pre-classifier to select relevant subagents.
   * Falls back to all enabled subagents on any failure or empty selection.
   */
  private async classify(
    enabledAgents: readonly AgentRoleId[],
    input: MultiAgentReviewInput
  ): Promise<{ agents: readonly AgentRoleId[]; tokenUsage?: TokenUsage }> {
    this.log("Running LLM pre-classifier to select relevant subagents...");
    const prompt = buildPreClassifierPrompt({
      prDetails: input.prDetails,
      files: input.manifest.files,
      enabledAgents,
    });

    let selected: string[];
    let tokenUsage: TokenUsage | undefined;
    const streaming = this.createStreaming("Running pre-classifier…");
    const stopHeartbeat = this.heartbeat("pre-classifier");
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
    input: MultiAgentReviewInput
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
    const stopHeartbeat = this.heartbeat("Lead Synthesizer");
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
    const fileResults: FileReviewResult[] = parsed.fileResults.map((result) => ({
      filename: result.filename,
      findings: result.findings.filter(
        (finding) => scoreConfidence(finding.confidence) >= this.minConfidence
      ),
    }));

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
   * Dispatches the selected subagents concurrently (bounded by maxParallel),
   * reporting each agent's start and completion with a plain-text progress line.
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

    const stopHeartbeat = this.subagentHeartbeat(dispatched, running, startedAt);
    try {
      const executions = await runWithConcurrency(dispatched, this.maxParallel, async (agent) => {
        running.add(agent);
        startedAt.set(agent, Date.now());
        this.log(`  ⏳ [${agent}] analyzing…`);

        const started = Date.now();
        const execution = await this.runAgent(agent, input);
        running.delete(agent);

        const duration = Math.max(0, Math.round((Date.now() - started) / 1000));
        this.log(`  ✓ [${agent}] done — ${execution.findings.length} finding(s) in ${duration}s`);
        tokenUsage = mergeTokenUsage(tokenUsage, execution.tokenUsage);
        return execution;
      });

      return { executions, tokenUsage };
    } finally {
      stopHeartbeat();
    }
  }

  /**
   * Returns a stop function for a heartbeat that lists which subagents are
   * still running. Only used when streaming output is not active.
   */
  private subagentHeartbeat(
    dispatched: readonly AgentRoleId[],
    running: Set<AgentRoleId>,
    startedAt: Map<AgentRoleId, number>
  ): () => void {
    if (this.streamingActive) {
      return () => {};
    }
    const timer = setInterval(() => {
      const active = dispatched.filter((agent) => running.has(agent));
      if (active.length === 0) {
        return;
      }
      const now = Date.now();
      const parts = active.map((agent) => {
        const elapsed = Math.round((now - (startedAt.get(agent) ?? now)) / 1000);
        return `${agent} (${elapsed}s)`;
      });
      this.log(`  ⏳ still working: ${parts.join(", ")}…`);
    }, 10000);
    return () => clearInterval(timer);
  }

  /**
   * Runs the full multi-agent review pipeline for a stored diff manifest.
   */
  async review(input: MultiAgentReviewInput): Promise<MultiAgentReviewOutput> {
    const enabledAgents = this.enabledAgents();
    this.log(
      `Multi-agent review enabled for ${enabledAgents.length} subagent role(s): ${enabledAgents.join(", ")}`
    );

    const classified = await this.classify(enabledAgents, input);
    const dispatched = classified.agents;
    let tokenUsage = classified.tokenUsage;
    this.log(`Dispatching ${dispatched.length} subagent(s): ${dispatched.join(", ")}`);

    const { executions, tokenUsage: subAgentUsage } = await this.runSubagents(dispatched, input);
    tokenUsage = mergeTokenUsage(tokenUsage, subAgentUsage);

    return this.synthesize(input, executions, tokenUsage);
  }
}
