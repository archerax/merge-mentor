import path from "node:path";
import type {
  GetAuthStatusResponse,
  PermissionHandler,
  PermissionRequest,
  SessionEvent,
} from "@github/copilot-sdk";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import { getAuditLogger } from "../../audit/index.js";
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, RETRY_DELAY_BASE_MS } from "../../constants.js";
import { AIProviderError, ValidationError } from "../../errors/index.js";
import { createChildLogger } from "../../logger.js";
import type { CrossFileReviewResult, FileReviewResult } from "../../platforms/types.js";
import {
  type Clock,
  consoleOutputWriter,
  type FileSystem,
  nodeFs,
  type OutputWriter,
  systemClock,
} from "../../ports/index.js";
import { resolveCopilotCliPath } from "../../utils/copilotCliResolver.js";
import { mergeTokenUsage } from "../../utils/tokenUsage.js";
import { delay } from "../shared/delay.js";
import { parseJsonResponse } from "../shared/parseJsonResponse.js";
import { inferPromptType, type PromptType } from "../shared/promptType.js";
import {
  parseBatchedFileReview as parseBatchedFileReviewShared,
  parseCrossFileReview as parseCrossFileReviewShared,
  parseFastReview as parseFastReviewShared,
  parseFileReview as parseFileReviewShared,
} from "../shared/responseParsers.js";
import { saveTranscript } from "../shared/saveTranscript.js";
import {
  combineToolAndJsonFindings,
  convertFindingsToParsedResponse,
  createPostCommentTool,
  FindingsCollector,
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
 * effects. File writes and shell execution can be enabled separately via
 * `enableWriteTools` / `enableShellTools` for agentic flows; shell execution
 * must never be enabled when the prompt contains untrusted input.
 *
 * @param logger - Child logger used to emit warn-level entries for denied requests.
 * @param enableWriteTools - Allow file write/edit permission requests.
 * @param enableShellTools - Allow shell execution permission requests.
 */
export function createReviewPermissionHandler(
  logger: ReturnType<typeof createChildLogger>,
  enableWriteTools = false,
  enableShellTools = false
): PermissionHandler {
  return (request) => {
    const blockedKinds = new Set(DENIED_PERMISSION_KINDS);
    if (enableWriteTools) {
      blockedKinds.delete("write");
    }
    if (enableShellTools) {
      blockedKinds.delete("shell");
    }
    if (blockedKinds.has(request.kind)) {
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
  private readonly enableWriteTools: boolean;
  private readonly enableShellTools: boolean;
  private readonly findingsCollector = new FindingsCollector();
  private readonly auditLogger = getAuditLogger();
  private readonly logger = createChildLogger({ component: "CopilotSdkProvider" });
  private readonly output: OutputWriter;

  private readonly tempPath: string;
  private readonly fileSystem: FileSystem;
  private readonly clock: Clock;
  private client?: CopilotClient;
  private isAuthVerified = false;

  constructor(options?: AIProviderOptions) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.model = options?.model ?? "Auto";
    this.token = options?.token;
    this.byokBaseUrl = this.normalizeOptionalString(options?.aiBaseUrl);
    this.byokApiKey = this.normalizeOptionalString(options?.aiApiKey);
    this.experimentalTools = options?.experimentalTools ?? false;
    this.longContext = options?.longContext ?? false;
    this.reasoningEffort = options?.reasoningEffort;
    this.enableWriteTools = options?.enableWriteTools ?? false;
    this.enableShellTools = options?.enableShellTools ?? false;
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
      this.isAuthVerified = false;
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

    const promptType: PromptType = options?.promptType ?? inferPromptType(prompt);
    let lastError: Error | null = null;
    let accumulatedUsage: TokenUsage | undefined;
    let actualAttempts = 0;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      actualAttempts++;
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
        if (
          lastError.message.includes("Copilot authentication failed") ||
          lastError.message.includes("Failed to retrieve Copilot authentication status")
        ) {
          break;
        }
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
          await delay(RETRY_DELAY_BASE_MS * (attempt + 1));
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

    if (
      lastError instanceof AIProviderError &&
      (lastError.message.includes("Copilot authentication failed") ||
        lastError.message.includes("Failed to retrieve Copilot authentication status"))
    ) {
      throw lastError;
    }

    let errorMessage = lastError?.message ?? "Unknown error";
    if (lastError instanceof AIProviderError) {
      const prefix = `${lastError.provider} error: `;
      if (errorMessage.startsWith(prefix)) {
        errorMessage = errorMessage.slice(prefix.length);
      }
    }

    throw new AIProviderError(
      "copilot-sdk",
      `Failed after ${actualAttempts} ${actualAttempts === 1 ? "attempt" : "attempts"}: ${errorMessage}`,
      { cause: lastError ?? undefined }
    );
  }

  private getClient(): CopilotClient {
    if (this.client) return this.client;

    const resolvedCliPath = resolveCopilotCliPath();
    if (!resolvedCliPath) {
      this.logger.debug("Could not resolve @github/copilot path dynamically");
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

    if (!this.byokBaseUrl && !this.isAuthVerified) {
      this.logger.debug("Verifying Copilot authentication status...");
      let authStatus: GetAuthStatusResponse;
      try {
        await client.start();
        authStatus = await client.getAuthStatus();
      } catch (error) {
        const originalMessage = (error as Error).message;
        let msg = `Failed to retrieve Copilot authentication status: ${originalMessage}`;
        if (originalMessage.includes("Client not connected")) {
          msg +=
            "\n\nTroubleshooting:\n" +
            "  1. Ensure Copilot CLI is installed globally (e.g., 'npm install -g @github/copilot') or configured via COPILOT_CLI_PATH.\n" +
            "  2. Ensure you have an active GitHub Copilot subscription.\n" +
            "  3. If using a personal token, ensure MM_COPILOT_TOKEN starts with 'github_pat_' and is set correctly.\n" +
            "  4. If using local credentials (e.g. GitHub CLI), make sure you are logged in: 'gh auth login' and 'gh copilot auth'";
        }
        throw new AIProviderError("copilot-sdk", msg, { cause: error as Error });
      }

      if (!authStatus.isAuthenticated) {
        let msg = `Copilot authentication failed: ${authStatus.statusMessage || "User is not logged in."}`;
        msg +=
          "\n\nTroubleshooting:\n" +
          "  1. Ensure Copilot CLI is installed globally (e.g., 'npm install -g @github/copilot') or configured via COPILOT_CLI_PATH.\n" +
          "  2. Ensure you have an active GitHub Copilot subscription.\n" +
          "  3. If using a personal token, ensure MM_COPILOT_TOKEN starts with 'github_pat_' and is set correctly.\n" +
          "  4. If using local credentials (e.g. GitHub CLI), make sure you are logged in: 'gh auth login' and 'gh copilot auth'";
        throw new AIProviderError("copilot-sdk", msg);
      }
      this.isAuthVerified = true;
      this.logger.debug("Copilot authentication verified successfully.");
    }

    const provider = this.buildByokProviderConfig();
    const postCommentTool = createPostCommentTool(this.findingsCollector, { output: this.output });
    const session = await client.createSession({
      model: this.model,
      workingDirectory: options?.workingDirectory,
      streaming: true,
      includeSubAgentStreamingEvents: false,
      availableTools: [
        ...READ_ONLY_REVIEW_TOOLS,
        ...(this.experimentalTools ? ["postComment" as const] : []),
        ...(this.enableWriteTools ? ["write" as const, "edit" as const] : []),
        ...(this.enableShellTools ? ["shell" as const] : []),
      ],
      tools: this.experimentalTools ? [postCommentTool] : undefined,
      onPermissionRequest: createReviewPermissionHandler(
        this.logger,
        this.enableWriteTools,
        this.enableShellTools
      ),
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
          parsed = parseJsonResponse(content);
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

  private formatSessionTimeline(events: SessionEvent[]): string[] {
    const lines: string[] = [];
    for (const event of events) {
      const timeStr = event.timestamp ? `[${event.timestamp}]` : "";
      switch (event.type) {
        case "assistant.reasoning":
          lines.push(`${timeStr} [REASONING]: ${event.data.content}`);
          break;
        case "assistant.reasoning_delta":
          lines.push(`${timeStr} [REASONING DELTA]: ${event.data.deltaContent}`);
          break;
        case "assistant.message":
          lines.push(`${timeStr} [MESSAGE]: ${event.data.content}`);
          break;
        case "assistant.message_delta":
          lines.push(`${timeStr} [MESSAGE DELTA]: ${event.data.deltaContent}`);
          break;
        case "tool.execution_start":
          lines.push(
            `${timeStr} [TOOL CALL START] ${event.data.toolName} (Call ID: ${event.data.toolCallId})`,
            `  Arguments: ${JSON.stringify(event.data.arguments || {}, null, 2)}`
          );
          break;
        case "tool.execution_complete":
          lines.push(
            `${timeStr} [TOOL CALL COMPLETE] (Call ID: ${event.data.toolCallId})`,
            `  Success: ${event.data.success}`,
            `  Result: ${JSON.stringify(event.data.result || {}, null, 2)}`,
            event.data.error ? `  Error: ${JSON.stringify(event.data.error)}` : ""
          );
          break;
        case "session.error":
          lines.push(
            `${timeStr} [SESSION ERROR] Type: ${event.data.errorType} - Message: ${event.data.message}`,
            event.data.stack ? `  Stack: ${event.data.stack}` : ""
          );
          break;
        default:
          lines.push(`${timeStr} [EVENT: ${event.type}]`);
          break;
      }
    }
    return lines;
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
    return saveTranscript(
      {
        fileSystem: this.fileSystem,
        clock: this.clock,
        logger: this.logger,
        tempPath: this.tempPath,
        providerLabel: "COPILOT SDK PROVIDER TRANSCRIPT",
        filePrefix: "transcript-sdk",
        displayName: "Copilot SDK",
        model: this.model,
      },
      {
        ...data,
        timeline: this.formatSessionTimeline(data.events),
      }
    );
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
        parsed: parseJsonResponse(streamedContent),
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Parses a Copilot SDK response into a file review result.
   */
  parseFileReview(filename: string, response: AIResponse): FileReviewResult {
    return parseFileReviewShared(this.logger, filename, response);
  }

  /**
   * Parses a Copilot SDK response into a cross-file review result.
   */
  parseCrossFileReview(response: AIResponse): CrossFileReviewResult {
    return parseCrossFileReviewShared(this.logger, response);
  }

  /**
   * Parses a batched Copilot SDK response containing reviews for multiple files.
   */
  parseBatchedFileReview(response: AIResponse): FileReviewResult[] {
    return parseBatchedFileReviewShared(this.logger, response);
  }

  /**
   * Parses a fast review response (combined file + cross-file analysis).
   */
  parseFastReview(response: AIResponse): FastReviewResult {
    return parseFastReviewShared(this.logger, response);
  }
}
