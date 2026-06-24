import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PermissionHandler, PermissionRequest, SessionEvent } from "@github/copilot-sdk";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import { getAuditLogger } from "../../audit/index.js";
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, RETRY_DELAY_BASE_MS } from "../../constants.js";
import { AIProviderError, JsonParseError, ValidationError } from "../../errors/index.js";
import { createChildLogger } from "../../logger.js";
import type {
  CrossFileFinding,
  CrossFileReviewResult,
  FileFinding,
  FileReviewResult,
} from "../../platforms/types.js";
import {
  type Clock,
  consoleOutputWriter,
  type FileSystem,
  nodeFs,
  type OutputWriter,
  systemClock,
} from "../../ports/index.js";
import { mergeTokenUsage } from "../../utils/tokenUsage.js";
import {
  BatchedFileReviewResponseSchema,
  CrossFileReviewResponseSchema,
  FastReviewResponseSchema,
  FileReviewResponseSchema,
} from "../schemas.js";
import {
  createPostCommentTool,
  FindingsCollector,
  type PostCommentFinding,
} from "../tools/index.js";
import type {
  AIProviderClient,
  AIProviderOptions,
  AIResponse,
  ExecutePromptOptions,
  FastReviewResult,
  ReasoningEffort,
  TokenUsage,
} from "../types.js";

/** Detected prompt type used for audit logging. */
type PromptType =
  | "file-review"
  | "cross-file-review"
  | "batched-file-review"
  | "fast-review"
  | "unknown";

interface CopilotSdkByokProviderConfig {
  readonly type: "openai";
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly wireApi?: "responses";
}

const DENIED_PERMISSION_KINDS: ReadonlySet<PermissionRequest["kind"]> = new Set([
  "shell",
  "write",
  "mcp",
  "url",
  "custom-tool",
  "memory",
  "hook",
]);

const READ_ONLY_REVIEW_TOOLS = ["grep", "glob"] as const;

/**
 * Creates a permission handler for review sessions.
 *
 * Approves read-only workspace access (needed to inspect source files) and
 * denies all other permission categories — shell execution, file writes, MCP
 * calls, URL fetches, custom tools, memory writes, and hooks — so that
 * attacker-controlled content inside a PR cannot trigger destructive side
 * effects.
 *
 * @param logger - Child logger used to emit warn-level entries for denied requests.
 */
export function createReviewPermissionHandler(
  logger: ReturnType<typeof createChildLogger>
): PermissionHandler {
  return (request) => {
    if (DENIED_PERMISSION_KINDS.has(request.kind)) {
      logger.warn(
        { permissionKind: request.kind, toolCallId: request.toolCallId },
        "Blocked tool request during review (tool allowlist)"
      );
      return { kind: "reject" };
    }
    return { kind: "approve-once" };
  };
}

/**
 * AI provider implementation using the @github/copilot-sdk package.
 *
 * Unlike the CLI-based CopilotProvider, this SDK provider:
 * - Sends prompts directly via the SDK (no subprocess spawning or temp files)
 * - Parses JSON from the assistant response content
 * - Reuses the CopilotClient across multiple executePrompt calls for efficiency
 * - Supports streaming via assistant.message_delta events
 */
export class CopilotSdkProvider implements AIProviderClient {
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly model?: string;
  private readonly token?: string;
  private readonly byokBaseUrl?: string;
  private readonly byokApiKey?: string;
  private readonly experimentalTools: boolean;
  private readonly longContext: boolean;
  private readonly reasoningEffort?: ReasoningEffort;
  private readonly findingsCollector = new FindingsCollector();
  private readonly auditLogger = getAuditLogger();
  private readonly logger = createChildLogger({ component: "CopilotSdkProvider" });
  private readonly output: OutputWriter;

  private readonly tempPath: string;
  private readonly fileSystem: FileSystem;
  private readonly clock: Clock;
  private client?: CopilotClient;

  constructor(options?: AIProviderOptions) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.model = options?.model;
    this.token = options?.token;
    this.byokBaseUrl = this.normalizeOptionalString(options?.aiBaseUrl);
    this.byokApiKey = this.normalizeOptionalString(options?.aiApiKey);
    this.experimentalTools = options?.experimentalTools ?? false;
    this.longContext = options?.longContext ?? false;
    this.reasoningEffort = options?.reasoningEffort;
    this.output = options?.output ?? consoleOutputWriter;
    this.tempPath = options?.tempPath ?? path.join(process.cwd(), ".mergementor");
    this.fileSystem = options?.fileSystem ?? nodeFs;
    this.clock = options?.clock ?? systemClock;
    this.validateByokConfig();
  }

  /**
   * Shuts down the cached Copilot CLI process. Safe to call multiple times.
   * Call when the provider instance is no longer needed (e.g. after a review completes).
   */
  destroy(): void {
    if (this.client) {
      try {
        void this.client.stop();
      } catch {
        // Ignore server shutdown errors
      }
      this.client = undefined;
    }
  }

  /**
   * Executes a prompt via the Copilot SDK with automatic retries.
   *
   * @param prompt - The prompt to send
   * @param options - Optional execution context (working directory, diff files, streaming)
   * @returns Response containing raw output and parsed JSON
   * @throws {ValidationError} When prompt is empty or invalid
   * @throws {CopilotSdkError} When SDK execution fails after all retries
   */
  async executePrompt(prompt: string, options?: ExecutePromptOptions): Promise<AIResponse> {
    if (!prompt || prompt.trim().length === 0) {
      throw new ValidationError("prompt", "Prompt cannot be empty.");
    }

    const promptType: PromptType = options?.promptType ?? this.inferPromptType(prompt);
    let lastError: Error | null = null;
    let accumulatedUsage: TokenUsage | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const { raw, parsed } = await this.runSdk(
          prompt,
          options,
          (usage) => {
            accumulatedUsage = mergeTokenUsage(accumulatedUsage, usage);
          },
          attempt + 1
        );
        this.auditLogger.logAIProviderExecution("copilot-sdk", promptType, this.model, "success");
        return { raw, parsed, tokenUsage: accumulatedUsage };
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          {
            attempt: attempt + 1,
            maxRetries: this.maxRetries,
            error: lastError.message,
            willRetry: attempt < this.maxRetries - 1,
          },
          "Copilot SDK execution attempt failed"
        );
        if (attempt < this.maxRetries - 1) {
          await this.delay(RETRY_DELAY_BASE_MS * (attempt + 1));
        }
      }
    }

    this.auditLogger.logAIProviderExecution(
      "copilot-sdk",
      promptType,
      this.model,
      "failure",
      lastError?.message
    );
    throw new AIProviderError(
      "copilot-sdk",
      `Failed after ${this.maxRetries} attempts: ${lastError?.message}`,
      { cause: lastError ?? undefined }
    );
  }

  private inferPromptType(prompt: string): PromptType {
    if (prompt.includes("file_results")) return "batched-file-review";
    if (prompt.includes("cross-file")) return "cross-file-review";
    if (prompt.includes("Review the following file")) return "file-review";
    if (prompt.includes("fast") && prompt.includes("review")) return "fast-review";
    return "unknown";
  }

  private getClient(): CopilotClient {
    if (this.client) return this.client;

    let resolvedCliPath: string | undefined;
    try {
      const sdkUrl = import.meta.resolve("@github/copilot/sdk");
      const sdkPath = fileURLToPath(sdkUrl);

      // Climb up to find the @github/copilot package root directory
      let currentDir = fs.statSync(sdkPath).isDirectory() ? sdkPath : path.dirname(sdkPath);
      while (currentDir && currentDir !== path.dirname(currentDir)) {
        const pkgJsonPath = path.join(currentDir, "package.json");
        if (fs.existsSync(pkgJsonPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
            if (pkg.name === "@github/copilot") {
              resolvedCliPath = path.join(currentDir, "index.js");
              break;
            }
          } catch {
            // Ignore JSON parse errors and keep climbing
          }
        }
        currentDir = path.dirname(currentDir);
      }

      // Fallback to old behavior if climbing fails
      if (!resolvedCliPath) {
        resolvedCliPath = path.join(path.dirname(path.dirname(sdkPath)), "index.js");
      }
    } catch (error) {
      this.logger.debug(
        { error: error instanceof Error ? error.message : String(error) },
        "Could not resolve @github/copilot/sdk path dynamically"
      );
    }

    const config: Record<string, unknown> = {};
    if (this.token) {
      config.gitHubToken = this.token;
    }
    if (process.env.COPILOT_CLI_PATH) {
      config.connection = RuntimeConnection.forStdio({ path: process.env.COPILOT_CLI_PATH });
    } else if (resolvedCliPath) {
      config.connection = RuntimeConnection.forStdio({ path: resolvedCliPath });
    }

    this.client = new CopilotClient(Object.keys(config).length > 0 ? config : undefined);
    return this.client;
  }

  private normalizeOptionalString(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : undefined;
  }

  private validateByokConfig(): void {
    if (!this.byokBaseUrl && this.byokApiKey) {
      throw new ValidationError(
        "aiBaseUrl",
        "AI base URL is required when an AI API key is provided."
      );
    }

    if (!this.byokBaseUrl) {
      return;
    }

    try {
      new URL(this.byokBaseUrl);
    } catch {
      throw new ValidationError("aiBaseUrl", "AI base URL must be a valid URL.");
    }
  }

  private buildByokProviderConfig(): CopilotSdkByokProviderConfig | undefined {
    if (!this.byokBaseUrl) {
      return undefined;
    }

    return {
      type: "openai",
      baseUrl: this.byokBaseUrl,
      ...(this.byokApiKey ? { apiKey: this.byokApiKey } : {}),
      ...(this.model?.trim().toLowerCase().startsWith("gpt-5")
        ? { wireApi: "responses" as const }
        : {}),
    };
  }

  private async runSdk(
    prompt: string,
    options?: ExecutePromptOptions,
    onUsageCollected?: (usage: TokenUsage | undefined) => void,
    attempt = 1
  ): Promise<{ raw: string; parsed: unknown }> {
    let client: CopilotClient;
    try {
      client = this.getClient();
    } catch (error) {
      // Client creation failed; reset cache and let the retry loop handle it
      this.destroy();
      throw error;
    }

    const provider = this.buildByokProviderConfig();
    const postCommentTool = createPostCommentTool(this.findingsCollector, { output: this.output });
    const session = await client.createSession({
      model: this.model,
      workingDirectory: options?.workingDirectory,
      streaming: true,
      includeSubAgentStreamingEvents: false,
      availableTools: this.experimentalTools
        ? [...READ_ONLY_REVIEW_TOOLS, "postComment"]
        : [...READ_ONLY_REVIEW_TOOLS],
      tools: this.experimentalTools ? [postCommentTool] : undefined,
      onPermissionRequest: createReviewPermissionHandler(this.logger),
      contextTier: this.longContext ? "long_context" : undefined,
      reasoningEffort: this.reasoningEffort,
      ...(provider ? { provider } : {}),
    });

    let collectedUsage: TokenUsage | undefined;
    const sessionEvents: SessionEvent[] = [];
    const unsubscribeAllEvents = session.on((event) => {
      sessionEvents.push(event);
    });

    try {
      if (this.experimentalTools) {
        this.findingsCollector.reset();
      }

      const chunks: string[] = [];
      const unsubscribeDelta = session.on("assistant.message_delta", (event) => {
        const delta = event.data.deltaContent;
        if (delta) {
          chunks.push(delta);
          options?.onStreamData?.(delta);
        }
      });

      const unsubscribeUsage = session.on("assistant.usage", (event) => {
        const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, model, duration } =
          event.data;
        const usageEvent: TokenUsage = {
          inputTokens: inputTokens ?? 0,
          outputTokens: outputTokens ?? 0,
          ...(cacheReadTokens !== undefined || cacheWriteTokens !== undefined
            ? { cachedTokens: (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0) }
            : {}),
          ...(model ? { model } : {}),
          ...(duration !== undefined ? { durationApiSeconds: duration / 1000 } : {}),
        };
        collectedUsage = mergeTokenUsage(collectedUsage, usageEvent);
      });

      let unsubscribeToolComplete = () => {};
      if (this.experimentalTools) {
        unsubscribeToolComplete = session.on("tool.execution_complete", (event) => {
          this.logger.debug(
            {
              toolCallId: event.data.toolCallId,
            },
            "Copilot SDK tool execution completed"
          );
        });
      }

      const attachments: Array<{ type: "file"; path: string }> = [];
      if (options?.diffFiles) {
        for (const diffFile of options.diffFiles) {
          attachments.push({ type: "file", path: diffFile });
        }
      }

      try {
        const response = await session.sendAndWait(
          { prompt, ...(attachments.length > 0 ? { attachments } : {}) },
          this.timeoutMs
        );
        const content = response?.data.content ?? chunks.join("");

        if (!content) {
          throw new AIProviderError("copilot-sdk", "No content in response from Copilot SDK");
        }

        let parsed: unknown;
        let jsonParseError: unknown;
        try {
          parsed = this.parseJsonResponse(content);
        } catch (error) {
          jsonParseError = error;
        }

        if (this.experimentalTools) {
          const toolFindings = this.findingsCollector.getAllFindings();
          if (jsonParseError) {
            if (toolFindings.length > 0) {
              this.logger.info(
                { count: toolFindings.length },
                "JSON parse failed but tool calls were made. Returning tool findings."
              );
              parsed = convertFindingsToParsedResponse(toolFindings);
            } else {
              this.logger.info(
                "JSON parse failed and no tool calls were made. Returning empty findings."
              );
              parsed = convertFindingsToParsedResponse([]);
            }
          } else {
            this.logger.info(
              { count: toolFindings.length },
              "Combining findings from both tool calls and JSON response."
            );
            parsed = combineToolAndJsonFindings(parsed, toolFindings);
          }

          await this.saveTranscript({
            prompt,
            events: sessionEvents,
            rawResponse: content,
            jsonOutput: JSON.stringify(parsed, null, 2),
            tokenUsage: collectedUsage,
            success: true,
            attempt,
          });

          return { raw: content, parsed };
        }

        if (jsonParseError) {
          throw jsonParseError;
        }

        await this.saveTranscript({
          prompt,
          events: sessionEvents,
          rawResponse: content,
          jsonOutput: JSON.stringify(parsed, null, 2),
          tokenUsage: collectedUsage,
          success: true,
          attempt,
        });

        return { raw: content, parsed };
      } catch (error) {
        const streamedContent = chunks.join("");
        if (this.isSessionIdleTimeout(error) && streamedContent.trim().length > 0) {
          const recovered = this.tryRecoverTimedOutResponse(streamedContent);
          if (recovered) {
            this.logger.warn(
              {
                streamedLength: streamedContent.length,
                timeoutMs: this.timeoutMs,
              },
              "Recovered Copilot SDK response from streamed output after session.idle timeout"
            );

            await this.saveTranscript({
              prompt,
              events: sessionEvents,
              rawResponse: recovered.raw,
              jsonOutput: JSON.stringify(recovered.parsed, null, 2),
              tokenUsage: collectedUsage,
              success: true,
              attempt,
            });

            return recovered;
          }
        }

        await this.saveTranscript({
          prompt,
          events: sessionEvents,
          rawResponse: streamedContent || undefined,
          tokenUsage: collectedUsage,
          success: false,
          error: (error as Error).message,
          attempt,
        });

        throw error;
      } finally {
        unsubscribeDelta();
        unsubscribeUsage();
        if (this.experimentalTools) {
          unsubscribeToolComplete();
        }
        onUsageCollected?.(collectedUsage);
      }
    } finally {
      unsubscribeAllEvents();
      try {
        await session.disconnect();
      } catch {
        // Best-effort session cleanup
      }
    }
  }

  private async saveTranscript(data: {
    prompt: string;
    events: SessionEvent[];
    rawResponse?: string;
    jsonOutput?: string;
    tokenUsage?: TokenUsage;
    success: boolean;
    error?: string;
    attempt: number;
  }): Promise<void> {
    try {
      const transcriptDir = path.join(this.tempPath, "transcripts");
      await this.fileSystem.mkdir(transcriptDir, { recursive: true });

      const timestamp = this.clock.timestamp().replace(/[:.]/g, "-");
      const status = data.success ? "success" : "failure";
      const filename = `transcript-sdk-${timestamp}-attempt-${data.attempt}-${status}.txt`;
      const filepath = path.join(transcriptDir, filename);

      const transcriptLines: string[] = [
        "=".repeat(80),
        "COPILOT SDK PROVIDER TRANSCRIPT",
        "=".repeat(80),
        `Timestamp: ${this.clock.timestamp()}`,
        `Status: ${status}`,
        `Model: ${this.model || "default"}`,
        `Attempt: ${data.attempt}`,
        data.tokenUsage ? `Token Usage: ${JSON.stringify(data.tokenUsage, null, 2)}` : "",
        "",
        "=".repeat(80),
        "INPUT PROMPT",
        "=".repeat(80),
        data.prompt,
        "",
        "=".repeat(80),
        "SESSION TIMELINE",
        "=".repeat(80),
      ];

      for (const event of data.events) {
        const timeStr = event.timestamp ? `[${event.timestamp}]` : "";
        switch (event.type) {
          case "assistant.reasoning":
            transcriptLines.push(`${timeStr} [REASONING]: ${event.data.content}`);
            break;
          case "assistant.reasoning_delta":
            transcriptLines.push(`${timeStr} [REASONING DELTA]: ${event.data.deltaContent}`);
            break;
          case "assistant.message":
            transcriptLines.push(`${timeStr} [MESSAGE]: ${event.data.content}`);
            break;
          case "assistant.message_delta":
            transcriptLines.push(`${timeStr} [MESSAGE DELTA]: ${event.data.deltaContent}`);
            break;
          case "tool.execution_start":
            transcriptLines.push(
              `${timeStr} [TOOL CALL START] ${event.data.toolName} (Call ID: ${event.data.toolCallId})`,
              `  Arguments: ${JSON.stringify(event.data.arguments || {}, null, 2)}`
            );
            break;
          case "tool.execution_complete":
            transcriptLines.push(
              `${timeStr} [TOOL CALL COMPLETE] (Call ID: ${event.data.toolCallId})`,
              `  Success: ${event.data.success}`,
              `  Result: ${JSON.stringify(event.data.result || {}, null, 2)}`,
              event.data.error ? `  Error: ${JSON.stringify(event.data.error)}` : ""
            );
            break;
          case "session.error":
            transcriptLines.push(
              `${timeStr} [SESSION ERROR] Type: ${event.data.errorType} - Message: ${event.data.message}`,
              event.data.stack ? `  Stack: ${event.data.stack}` : ""
            );
            break;
          default:
            transcriptLines.push(`${timeStr} [EVENT: ${event.type}]`);
            break;
        }
      }

      transcriptLines.push(
        "",
        "=".repeat(80),
        "RAW RESPONSE",
        "=".repeat(80),
        data.rawResponse || "(empty)",
        "",
        "=".repeat(80),
        "JSON OUTPUT",
        "=".repeat(80),
        data.jsonOutput || "(empty)"
      );

      if (data.error) {
        transcriptLines.push("", "=".repeat(80), "ERROR", "=".repeat(80), data.error);
      }

      transcriptLines.push("", "=".repeat(80), "END OF TRANSCRIPT", "=".repeat(80));

      await this.fileSystem.writeFile(
        filepath,
        transcriptLines.filter((line) => line !== undefined).join("\n"),
        "utf-8"
      );

      this.logger.debug(
        { filepath, success: data.success, attempt: data.attempt },
        "Saved Copilot SDK transcript for debugging"
      );
    } catch (err) {
      this.logger.warn({ error: (err as Error).message }, "Failed to save SDK transcript");
    }
  }

  private parseJsonResponse(raw: string): unknown {
    const markdownMatch = raw.match(/```json\n([\s\S]*?)\n```/);
    if (markdownMatch) {
      try {
        return JSON.parse(markdownMatch[1]);
      } catch {
        // Fall through to regex extraction
      }
    }

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new JsonParseError("No JSON object found in response", raw);
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      throw new JsonParseError((error as Error).message, raw);
    }
  }

  private isSessionIdleTimeout(error: unknown): boolean {
    return error instanceof Error && error.message.includes("waiting for session.idle");
  }

  private tryRecoverTimedOutResponse(
    streamedContent: string
  ): { raw: string; parsed: unknown } | undefined {
    try {
      return {
        raw: streamedContent,
        parsed: this.parseJsonResponse(streamedContent),
      };
    } catch {
      return undefined;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private validateReasoning(
    reasoning: string,
    filename: string,
    lineOrLocation: string | number
  ): void {
    const minLength = 20;
    const location = typeof lineOrLocation === "number" ? `line ${lineOrLocation}` : lineOrLocation;

    if (reasoning.length < minLength) {
      this.logger.warn(
        {
          filename,
          location,
          reasoningLength: reasoning.length,
          reasoning: reasoning.substring(0, 100),
        },
        `Reasoning too short (need ${minLength}+ chars) - finding may lack enough evidence`
      );
    }

    const evidencePattern =
      /line|lines|context|call|query|input|output|state|branch|path|file|diff|import|return|value|guard|validation|check|middleware|parameter|request|response|token|cache|loop|dependency|array|object|function/i;
    const impactPattern =
      /crash|error|fail|incorrect|wrong|stale|leak|latency|slow|outage|risk|vulnerab|expos|bypass|break|corrupt|deadlock|race|allow|cause|impact|inconsistent|timeout/i;

    if (!evidencePattern.test(reasoning) || !impactPattern.test(reasoning)) {
      this.logger.warn(
        {
          filename,
          location,
          reasoning: reasoning.substring(0, 150),
        },
        "Reasoning should briefly cite the code evidence and the concrete impact"
      );
    }
  }

  /**
   * Parses a Copilot SDK response into a file review result.
   */
  parseFileReview(filename: string, response: AIResponse): FileReviewResult {
    const result = FileReviewResponseSchema.safeParse(response.parsed);
    if (!result.success) {
      this.logger.warn({ error: result.error.format() }, "File review schema drift detected");
    }

    const data = result.success ? result.data : { findings: [] };
    const findings: FileFinding[] = data.findings.map((finding) => {
      this.validateReasoning(finding.reasoning, filename, finding.line);
      return {
        line: finding.line,
        severity: finding.severity,
        confidence: finding.confidence,
        category: finding.category,
        message: finding.message,
        suggestion: finding.suggestion,
        reasoning: finding.reasoning,
        isPreExisting: finding.isPreExisting,
      };
    });

    return { filename, findings };
  }

  /**
   * Parses a Copilot SDK response into a cross-file review result.
   */
  parseCrossFileReview(response: AIResponse): CrossFileReviewResult {
    const result = CrossFileReviewResponseSchema.safeParse(response.parsed);
    if (!result.success) {
      this.logger.warn({ error: result.error.format() }, "Cross-file review schema drift detected");
    }

    const data = result.success
      ? result.data
      : { overall_assessment: "Review completed", findings: [], recommendations: [] };

    const findings: CrossFileFinding[] = data.findings.map((finding) => {
      const affectedFilesStr = finding.affected_files.join(", ") || "unknown";
      this.validateReasoning(finding.reasoning, "cross-file", affectedFilesStr);
      return {
        severity: finding.severity,
        confidence: finding.confidence,
        category: finding.category,
        message: finding.message,
        reasoning: finding.reasoning,
        affectedFiles: finding.affected_files,
      };
    });

    return {
      overallAssessment: data.overall_assessment,
      findings,
      recommendations: data.recommendations,
    };
  }

  /**
   * Parses a batched Copilot SDK response containing reviews for multiple files.
   */
  parseBatchedFileReview(response: AIResponse): FileReviewResult[] {
    const result = BatchedFileReviewResponseSchema.safeParse(response.parsed);
    if (!result.success) {
      this.logger.warn(
        { error: result.error.format() },
        "Batched file review schema drift detected"
      );
    }

    const data = result.success ? result.data : { file_results: {} };
    const results: FileReviewResult[] = [];

    for (const [filename, fileData] of Object.entries(data.file_results)) {
      const findings: FileFinding[] = fileData.findings.map((finding) => {
        this.validateReasoning(finding.reasoning, filename, finding.line);
        return {
          line: finding.line,
          severity: finding.severity,
          confidence: finding.confidence,
          category: finding.category,
          message: finding.message,
          suggestion: finding.suggestion,
          reasoning: finding.reasoning,
          isPreExisting: finding.isPreExisting,
        };
      });

      results.push({ filename, findings });
    }

    return results;
  }

  /**
   * Parses a fast review response (combined file + cross-file analysis).
   */
  parseFastReview(response: AIResponse): FastReviewResult {
    const result = FastReviewResponseSchema.safeParse(response.parsed);
    if (!result.success) {
      this.logger.warn({ error: result.error.format() }, "Fast review schema drift detected");
    }

    const data = result.success ? result.data : { summary: "Review completed", findings: [] };
    const fileFindings = new Map<string, FileFinding[]>();
    const crossFileFindings: CrossFileFinding[] = [];

    for (const finding of data.findings) {
      const file = finding.file;
      const line = finding.line;
      const context = file ? (line ? `${file}:${line}` : file) : "cross-file";
      this.validateReasoning(finding.reasoning, context, line || "general");

      if (file) {
        if (!fileFindings.has(file)) {
          fileFindings.set(file, []);
        }

        fileFindings.get(file)?.push({
          line: finding.line,
          severity: finding.severity,
          confidence: finding.confidence,
          category: finding.category,
          message: finding.message,
          suggestion: finding.suggestion,
          reasoning: finding.reasoning,
          isPreExisting: finding.isPreExisting,
        });
      } else {
        crossFileFindings.push({
          severity: finding.severity,
          confidence: finding.confidence,
          category: finding.category as unknown as CrossFileFinding["category"],
          message: finding.message,
          reasoning: finding.reasoning,
          affectedFiles: [],
        });
      }
    }

    const fileResults: FileReviewResult[] = Array.from(fileFindings.entries()).map(
      ([filename, findings]) => ({ filename, findings })
    );

    const crossFileResult: CrossFileReviewResult = {
      overallAssessment: data.summary,
      findings: crossFileFindings,
      recommendations: [],
    };

    return { fileResults, crossFileResult };
  }
}

function convertFindingsToParsedResponse(findings: PostCommentFinding[]): unknown {
  return {
    findings: findings.map((f) => ({
      line: f.line,
      severity: f.severity,
      confidence: f.confidence ?? "high",
      category: f.category,
      message: f.body,
      suggestion: f.suggestion ?? "",
      reasoning: f.reasoning ?? "Recorded via tool call.",
      isPreExisting: false,
    })),
    file_results: groupFindingsByFile(findings),
    summary: `Review completed. Collected ${findings.length} findings via tool calls.`,
    overall_assessment: `Review completed. Collected ${findings.length} findings via tool calls.`,
    recommendations: [],
  };
}

function groupFindingsByFile(
  findings: PostCommentFinding[]
): Record<string, { findings: FileFinding[] }> {
  const fileResults: Record<string, { findings: FileFinding[] }> = {};
  for (const f of findings) {
    if (!fileResults[f.file]) {
      fileResults[f.file] = { findings: [] };
    }
    fileResults[f.file].findings.push({
      line: f.line,
      severity: f.severity,
      confidence: f.confidence ?? "high",
      category: f.category,
      message: f.body,
      suggestion: f.suggestion ?? "",
      reasoning: f.reasoning ?? "Recorded via tool call.",
      isPreExisting: false,
    });
  }
  return fileResults;
}

function combineToolAndJsonFindings(parsed: unknown, toolFindings: PostCommentFinding[]): unknown {
  if (!parsed || typeof parsed !== "object") {
    return convertFindingsToParsedResponse(toolFindings);
  }

  const parsedObj = parsed as Record<string, unknown>;

  if ("file_results" in parsedObj) {
    const fileResults = { ...(parsedObj.file_results as Record<string, unknown>) };
    for (const f of toolFindings) {
      if (!fileResults[f.file]) {
        fileResults[f.file] = { findings: [] };
      }
      const fileData = { ...(fileResults[f.file] as Record<string, unknown>) };
      const findings = Array.isArray(fileData.findings) ? [...fileData.findings] : [];
      findings.push({
        line: f.line,
        severity: f.severity,
        confidence: f.confidence ?? "high",
        category: f.category,
        message: f.body,
        suggestion: f.suggestion ?? "",
        reasoning: f.reasoning ?? "Recorded via tool call.",
        isPreExisting: false,
      });
      fileResults[f.file] = { ...fileData, findings };
    }
    return { ...parsedObj, file_results: fileResults };
  }

  if ("summary" in parsedObj) {
    const findings = Array.isArray(parsedObj.findings) ? [...parsedObj.findings] : [];
    for (const f of toolFindings) {
      findings.push({
        file: f.file,
        line: f.line,
        severity: f.severity,
        confidence: f.confidence ?? "high",
        category: f.category,
        message: f.body,
        suggestion: f.suggestion ?? "",
        reasoning: f.reasoning ?? "Recorded via tool call.",
        isPreExisting: false,
      });
    }
    return { ...parsedObj, findings };
  }

  if ("overall_assessment" in parsedObj) {
    const findings = Array.isArray(parsedObj.findings) ? [...parsedObj.findings] : [];
    for (const f of toolFindings) {
      findings.push({
        severity: f.severity,
        confidence: f.confidence ?? "high",
        category: f.category,
        message: f.body,
        reasoning: f.reasoning ?? "Recorded via tool call.",
        affected_files: [f.file],
      });
    }
    return { ...parsedObj, findings };
  }

  if ("findings" in parsedObj) {
    const findings = Array.isArray(parsedObj.findings) ? [...parsedObj.findings] : [];
    for (const f of toolFindings) {
      findings.push({
        line: f.line,
        severity: f.severity,
        confidence: f.confidence ?? "high",
        category: f.category,
        message: f.body,
        suggestion: f.suggestion ?? "",
        reasoning: f.reasoning ?? "Recorded via tool call.",
        isPreExisting: false,
      });
    }
    return { ...parsedObj, findings };
  }

  return parsedObj;
}
