import path from "node:path";
import { getAuditLogger } from "../../audit/index.js";
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, RETRY_DELAY_BASE_MS } from "../../constants.js";
import { AIProviderError, ValidationError } from "../../errors/index.js";
import { createChildLogger } from "../../logger.js";
import type { CrossFileReviewResult, FileReviewResult } from "../../platforms/types.js";
import { type Clock, type FileSystem, nodeFs, systemClock } from "../../ports/index.js";
import { mergeTokenUsage } from "../../utils/tokenUsage.js";
import { delay } from "../shared/delay.js";
import { getJsonSchema } from "../shared/jsonSchemas.js";
import { parseJsonResponse } from "../shared/parseJsonResponse.js";
import { inferPromptType, type PromptType } from "../shared/promptType.js";
import {
  parseBatchedFileReview as parseBatchedFileReviewShared,
  parseCrossFileReview as parseCrossFileReviewShared,
  parseFastReview as parseFastReviewShared,
  parseFileReview as parseFileReviewShared,
} from "../shared/responseParsers.js";
import type {
  AIProviderClient,
  AIProviderOptions,
  AIResponse,
  ExecutePromptOptions,
  FastReviewResult,
  ReasoningEffort,
  TokenUsage,
} from "../types.js";

/**
 * AI provider implementation using the @anthropic-ai/claude-agent-sdk package.
 *
 * @deprecated The "claude-agent-sdk" provider is deprecated and will be removed
 *   in the next major version. Migrate to "copilot-sdk" or "opencode-sdk".
 */
export class ClaudeAgentSdkProvider implements AIProviderClient {
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly model?: string;
  private readonly token?: string;
  private readonly aiApiKey?: string;
  private readonly aiBaseUrl?: string;
  private readonly reasoningEffort?: ReasoningEffort;
  private readonly longContext: boolean;
  private readonly enableWriteTools: boolean;
  private readonly enableShellTools: boolean;
  private readonly auditLogger = getAuditLogger();
  private readonly logger = createChildLogger({ component: "ClaudeAgentSdkProvider" });

  private readonly tempPath: string;
  private readonly fileSystem: FileSystem;
  private readonly clock: Clock;

  private sessionId?: string;

  constructor(options?: AIProviderOptions) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.model = options?.model;
    this.token = options?.token;
    this.aiApiKey = options?.aiApiKey;
    this.aiBaseUrl = options?.aiBaseUrl;
    this.reasoningEffort = options?.reasoningEffort;
    this.longContext = options?.longContext ?? false;
    this.enableWriteTools = options?.enableWriteTools ?? false;
    this.enableShellTools = options?.enableShellTools ?? false;
    this.tempPath = options?.tempPath ?? path.join(process.cwd(), ".mergementor");
    this.fileSystem = options?.fileSystem ?? nodeFs;
    this.clock = options?.clock ?? systemClock;
  }

  /**
   * Resets the cached session ID. Safe to call multiple times.
   */
  destroy(): void {
    this.sessionId = undefined;
  }

  /**
   * Executes a prompt via the Claude Agent SDK with automatic retries.
   *
   * @param prompt - The prompt to send
   * @param options - Optional execution context (working directory, diff files, streaming)
   * @returns Response containing raw output and parsed JSON
   */
  async executePrompt(prompt: string, options?: ExecutePromptOptions): Promise<AIResponse> {
    if (!prompt || prompt.trim().length === 0) {
      throw new ValidationError("prompt", "Prompt cannot be empty.");
    }

    const promptType: PromptType = options?.promptType ?? inferPromptType(prompt);
    const schema = getJsonSchema(promptType);
    let lastError: Error | null = null;
    let accumulatedUsage: TokenUsage | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const { raw, parsed, usage } = await this.runSdk(prompt, schema, options, attempt + 1);
        if (usage) {
          accumulatedUsage = mergeTokenUsage(accumulatedUsage, usage);
        }
        this.auditLogger.logAIProviderExecution(
          "claude-agent-sdk",
          promptType,
          this.model,
          "success"
        );
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
          "Claude Agent SDK execution attempt failed"
        );
        if (attempt < this.maxRetries - 1) {
          await delay(RETRY_DELAY_BASE_MS * (attempt + 1));
        }
      }
    }

    this.auditLogger.logAIProviderExecution(
      "claude-agent-sdk",
      promptType,
      this.model,
      "failure",
      lastError?.message
    );
    throw new AIProviderError(
      "claude-agent-sdk",
      `Failed after ${this.maxRetries} attempts: ${lastError?.message}`,
      { cause: lastError ?? undefined }
    );
  }

  private async getQueryFn() {
    try {
      const sdk = await import("@anthropic-ai/claude-agent-sdk");
      return sdk.query;
    } catch (error) {
      throw new AIProviderError(
        "claude-agent-sdk",
        "The optional dependency '@anthropic-ai/claude-agent-sdk' is not installed. " +
          "Please run 'pnpm add @anthropic-ai/claude-agent-sdk' or 'npm install @anthropic-ai/claude-agent-sdk'.",
        { cause: error as Error }
      );
    }
  }

  private async runSdk(
    prompt: string,
    schema: Record<string, unknown> | undefined,
    options?: ExecutePromptOptions,
    attempt = 1
  ): Promise<{ raw: string; parsed: unknown; usage?: TokenUsage }> {
    const queryFn = await this.getQueryFn();

    const apiKey = this.aiApiKey || this.token;
    const environment: Record<string, string | undefined> = {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: "merge-mentor",
    };

    if (apiKey) {
      environment.ANTHROPIC_API_KEY = apiKey;
    }

    if (this.aiBaseUrl) {
      // Handle BYOK base URL mapping if needed
      // Anthropic SDK reads ANTHROPIC_BASE_URL (or similar for Bedrock/Vertex env vars)
      environment.ANTHROPIC_BASE_URL = this.aiBaseUrl;
    }

    // Read-only tools are always available. Write/Edit are enabled for agentic
    // flows (e.g. fix); Bash only when shell execution is explicitly enabled —
    // never for flows whose prompts contain untrusted input (PR comments).
    const readOnlyTools = ["Read", "Glob", "Grep"];
    const toolsList = [
      ...readOnlyTools,
      ...(this.enableWriteTools ? ["Write", "Edit"] : []),
      ...(this.enableShellTools ? ["Bash"] : []),
    ];

    // Confine file access to the review workspace: a successful prompt injection
    // embedded in PR content must not be able to read sensitive files elsewhere
    // on disk (e.g. ~/.aws/credentials) and exfiltrate them into posted comments.
    // Enforced twice: rule-scoped allowedTools (evaluated by the SDK permission
    // engine, which denies anything not pre-approved under "dontAsk") and a
    // canUseTool path-containment check.
    const workspaceRoot = path.resolve(options?.workingDirectory ?? process.cwd());
    const workspacePattern = "./**";
    const allowedTools = [
      `Read(${workspacePattern})`,
      "Glob",
      "Grep",
      ...(this.enableWriteTools ? [`Write(${workspacePattern})`, `Edit(${workspacePattern})`] : []),
      ...(this.enableShellTools ? ["Bash"] : []),
    ];

    const pathInputFields: Record<string, string> = {
      Read: "file_path",
      Write: "file_path",
      Edit: "file_path",
      Glob: "path",
      Grep: "path",
    };

    const canUseTool = async (toolName: string, input: Record<string, unknown>) => {
      const field = pathInputFields[toolName];
      const target = field ? input[field] : undefined;
      if (typeof target !== "string" || target.length === 0) {
        return { behavior: "allow" as const };
      }
      const resolved = path.resolve(workspaceRoot, target);
      const relative = path.relative(workspaceRoot, resolved);
      if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
        return { behavior: "allow" as const };
      }
      this.logger.warn(
        { toolName, target, workspaceRoot },
        "Denied tool access outside review workspace"
      );
      return {
        behavior: "deny" as const,
        message: `${toolName} is restricted to the review workspace; access outside ${workspaceRoot} is not permitted.`,
      };
    };

    const agentOptions: Record<string, unknown> = {
      tools: toolsList,
      allowedTools,
      permissionMode: "dontAsk",
      canUseTool,
      includePartialMessages: true,
      persistSession: true,
      cwd: options?.workingDirectory,
      env: environment,
    };

    if (this.model) {
      agentOptions.model = this.model;
    }

    if (this.reasoningEffort) {
      agentOptions.effort = this.reasoningEffort;
    }

    if (this.longContext) {
      agentOptions.betas = ["context-1m-2025-08-07"];
    }

    if (schema) {
      agentOptions.outputFormat = {
        type: "json_schema",
        schema,
      };
    }

    if (this.sessionId) {
      agentOptions.resume = this.sessionId;
    }

    let augmentedPrompt = prompt;
    if (options?.diffFiles && options.diffFiles.length > 0) {
      const diffContents: string[] = [];
      for (const diffFile of options.diffFiles) {
        try {
          const content = await this.fileSystem.readFile(diffFile, "utf-8");
          const relativePath = path.relative(options.workingDirectory ?? process.cwd(), diffFile);
          diffContents.push(`File: ${relativePath}\n\`\`\`diff\n${content}\n\`\`\``);
        } catch (error) {
          this.logger.warn(
            { diffFile, error: (error as Error).message },
            "Failed to read diff file for context"
          );
        }
      }
      if (diffContents.length > 0) {
        augmentedPrompt = `${prompt}\n\n=== ADDITIONAL DIFF CONTEXT ===\nUse the following diff file contents for reference during your review:\n\n${diffContents.join("\n\n")}`;
      }
    }

    let queryInstance: unknown = null;
    const abortController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abortController.abort();
        if (queryInstance) {
          try {
            void (queryInstance as { close: () => void }).close();
          } catch {
            // Ignore close error
          }
        }
        reject(
          new AIProviderError("claude-agent-sdk", `Prompt timed out after ${this.timeoutMs}ms`)
        );
      }, this.timeoutMs);
    });

    agentOptions.abortController = abortController;

    let rawText = "";
    let structuredOutput: unknown;
    let finalUsage: TokenUsage | undefined;
    const sessionEvents: unknown[] = [];

    const run = async () => {
      const agentStream = queryFn({
        prompt: augmentedPrompt,
        options: agentOptions,
      });
      queryInstance = agentStream;

      for await (const message of agentStream) {
        sessionEvents.push(message as unknown);

        if (!this.sessionId && message.session_id) {
          this.sessionId = message.session_id;
        }

        if (message.type === "stream_event") {
          const event = message.event;
          if (
            event.type === "content_block_delta" &&
            event.delta?.type === "text_delta" &&
            event.delta.text
          ) {
            if (options?.onStreamData) {
              options.onStreamData(event.delta.text);
            }
          }
        }

        if (message.type === "result") {
          if (message.subtype === "success") {
            structuredOutput = message.structured_output;
            rawText = message.result || "";
            if (message.usage) {
              const usageRecord = message.usage as Record<string, unknown>;
              const cachedCount = (usageRecord.cache_read_input_tokens as number) ?? 0;
              finalUsage = {
                inputTokens: message.usage.input_tokens || 0,
                outputTokens: message.usage.output_tokens || 0,
                cachedTokens: cachedCount,
                model: this.model,
              };
            }
          } else {
            const errs =
              (message as { errors?: string[] }).errors?.join(", ") || "execution failed";
            throw new Error(
              `Claude Agent SDK query failed with subtype "${message.subtype}": ${errs}`
            );
          }
        }
      }
    };

    try {
      await Promise.race([run(), timeoutPromise]);

      if (structuredOutput != null) {
        const raw =
          typeof structuredOutput === "string"
            ? structuredOutput
            : JSON.stringify(structuredOutput);

        await this.saveTranscript({
          prompt: augmentedPrompt,
          events: sessionEvents,
          rawResponse: raw,
          jsonOutput: raw,
          tokenUsage: finalUsage,
          success: true,
          attempt,
        });

        return { raw, parsed: structuredOutput, usage: finalUsage };
      }

      if (!rawText) {
        throw new AIProviderError(
          "claude-agent-sdk",
          "No content in response from Claude Agent SDK"
        );
      }

      const parsed = parseJsonResponse(rawText);

      await this.saveTranscript({
        prompt: augmentedPrompt,
        events: sessionEvents,
        rawResponse: rawText,
        jsonOutput: JSON.stringify(parsed, null, 2),
        tokenUsage: finalUsage,
        success: true,
        attempt,
      });

      return { raw: rawText, parsed, usage: finalUsage };
    } catch (error) {
      await this.saveTranscript({
        prompt: augmentedPrompt,
        events: sessionEvents,
        success: false,
        error: (error as Error).message,
        attempt,
      });
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      if (queryInstance) {
        try {
          void (queryInstance as { close: () => void }).close();
        } catch {
          // Ignore close error
        }
      }
    }
  }

  private async saveTranscript(data: {
    prompt: string;
    events?: unknown[];
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
      const filename = `transcript-claude-agent-${timestamp}-attempt-${data.attempt}-${status}.txt`;
      const filepath = path.join(transcriptDir, filename);

      const transcriptLines: string[] = [
        "=".repeat(80),
        "CLAUDE AGENT SDK PROVIDER TRANSCRIPT",
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
      ];

      if (data.events && data.events.length > 0) {
        transcriptLines.push("", "=".repeat(80), "SESSION TIMELINE", "=".repeat(80));
        for (const event of data.events) {
          const ev = event as Record<string, unknown>;
          const timeStr = typeof ev.timestamp === "string" ? `[${ev.timestamp}]` : "";
          if (ev.type === "stream_event") {
            const streamEvent = ev.event as Record<string, unknown> | undefined;
            if (streamEvent && streamEvent.type === "content_block_delta") {
              const delta = streamEvent.delta as Record<string, unknown> | undefined;
              if (delta && typeof delta.text === "string") {
                transcriptLines.push(`${timeStr} [STREAM DELTA]: ${delta.text}`);
              }
            } else if (streamEvent && streamEvent.type === "content_block_start") {
              const contentBlock = streamEvent.content_block as Record<string, unknown> | undefined;
              const blockType = (contentBlock?.type as string) ?? "unknown";
              transcriptLines.push(`${timeStr} [STREAM START]: block type ${blockType}`);
            } else if (streamEvent) {
              transcriptLines.push(`${timeStr} [STREAM EVENT]: ${streamEvent.type as string}`);
            }
          } else if (ev.type === "result") {
            transcriptLines.push(
              `${timeStr} [RESULT]: subtype=${(ev.subtype as string) ?? "unknown"}`
            );
          } else if (ev.type === "tool_use") {
            transcriptLines.push(
              `${timeStr} [TOOL USE] ${(ev.name as string) ?? "unknown"} (Call ID: ${(ev.id as string) ?? "unknown"})`,
              `  Arguments: ${JSON.stringify((ev.input as Record<string, unknown>) || {}, null, 2)}`
            );
          } else if (ev.type === "tool_result") {
            transcriptLines.push(
              `${timeStr} [TOOL RESULT] (Call ID: ${(ev.tool_use_id as string) ?? "unknown"})`,
              `  Output: ${JSON.stringify(ev.output || {}, null, 2)}`
            );
          } else {
            transcriptLines.push(
              `${timeStr} [MESSAGE: ${ev.type as string}] ${JSON.stringify(ev)}`
            );
          }
        }
      }

      transcriptLines.push(
        "",
        "=".repeat(80),
        "RAW API RESPONSE",
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

      await this.fileSystem.writeFile(filepath, transcriptLines.join("\n"), "utf-8");

      this.logger.debug(
        { filepath, success: data.success, attempt: data.attempt },
        "Saved Claude Agent SDK transcript for debugging"
      );
    } catch (err) {
      this.logger.warn(
        { error: (err as Error).message },
        "Failed to save Claude Agent SDK transcript"
      );
    }
  }

  /**
   * Parses a Claude Agent SDK response into a file review result.
   */
  parseFileReview(filename: string, response: AIResponse): FileReviewResult {
    return parseFileReviewShared(this.logger, filename, response);
  }

  /**
   * Parses a Claude Agent SDK response into a cross-file review result.
   */
  parseCrossFileReview(response: AIResponse): CrossFileReviewResult {
    return parseCrossFileReviewShared(this.logger, response);
  }

  /**
   * Parses a batched Claude Agent SDK response containing reviews for multiple files.
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
