import { CopilotClient, type SessionEvent } from "@github/copilot-sdk";
import { getAuditLogger } from "../../audit/index.js";
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, RETRY_DELAY_BASE_MS } from "../../constants.js";
import { CopilotSDKError, ValidationError } from "../../errors/index.js";
import { createChildLogger } from "../../logger.js";
import type { CrossFileReviewResult, FileReviewResult } from "../../platforms/types.js";
import {
  parseBatchedFileReview,
  parseCrossFileReview,
  parseFileReview,
  parseJsonFromContent,
} from "../responseParser.js";
import type {
  AIProviderClient,
  AIProviderOptions,
  AIResponse,
  ExecutePromptOptions,
  StreamingCallback,
  TokenUsage,
} from "../types.js";

/**
 * AI provider implementation using the official GitHub Copilot SDK.
 * Provides structured API access without CLI subprocess spawning.
 */
export class CopilotSDKProvider implements AIProviderClient {
  private client: CopilotClient | null = null;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly model?: string;
  private readonly auditLogger = getAuditLogger();
  private readonly logger = createChildLogger({ component: "CopilotSDKProvider" });
  private currentWorkingDirectory?: string;

  constructor(options?: AIProviderOptions) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.model = options?.model;
  }

  /**
   * Gets or creates the Copilot SDK client.
   * Recreates the client if the working directory changes.
   *
   * @param workingDirectory - Optional working directory for workspace access
   */
  private async getClient(workingDirectory?: string): Promise<CopilotClient> {
    // Recreate client if working directory changed
    if (this.client && this.currentWorkingDirectory !== workingDirectory) {
      this.logger.debug(
        { oldCwd: this.currentWorkingDirectory, newCwd: workingDirectory },
        "Working directory changed, recreating client"
      );
      await this.stop();
    }

    if (!this.client) {
      this.client = new CopilotClient(
        workingDirectory ? { cwd: workingDirectory } : undefined
      );
      this.currentWorkingDirectory = workingDirectory;
      this.logger.debug({ cwd: workingDirectory }, "CopilotClient initialized");
    }
    return this.client;
  }

  /**
   * Executes a prompt via the Copilot SDK with automatic retries.
   *
   * @param prompt - The prompt to send to Copilot
   * @param options - Optional execution context
   * @returns Response containing raw output and parsed JSON
   * @throws {ValidationError} When prompt is empty or invalid
   * @throws {CopilotSDKError} When SDK execution fails after all retries
   */
  async executePrompt(prompt: string, options?: ExecutePromptOptions): Promise<AIResponse> {
    if (!prompt || prompt.trim().length === 0) {
      throw new ValidationError("prompt", "Prompt cannot be empty.");
    }

    const promptType = this.inferPromptType(prompt);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const result = await this.executeWithTimeout(prompt, options);

        this.auditLogger.logAIProviderExecution(
          "copilot-sdk",
          promptType,
          this.model,
          "success",
          undefined,
          result.tokenUsage
        );

        return result;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          { attempt: attempt + 1, maxRetries: this.maxRetries, error: lastError.message },
          "SDK execution attempt failed"
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

    throw new CopilotSDKError(
      `Failed after ${this.maxRetries} attempts: ${lastError?.message}`,
      lastError ?? undefined
    );
  }

  /**
   * Executes a prompt with streaming callback for real-time output.
   *
   * @param prompt - The prompt to send to Copilot
   * @param onChunk - Callback invoked for each content chunk
   * @param options - Optional execution context
   * @returns Response containing full output and parsed JSON
   */
  async executePromptWithStreaming(
    prompt: string,
    onChunk: StreamingCallback,
    options?: ExecutePromptOptions
  ): Promise<AIResponse> {
    if (!prompt || prompt.trim().length === 0) {
      throw new ValidationError("prompt", "Prompt cannot be empty.");
    }

    const promptType = this.inferPromptType(prompt);

    try {
      const client = await this.getClient(options?.workingDirectory);
      const session = await client.createSession({
        model: this.model ?? "gpt-4.1",
        streaming: true,
      });

      let fullContent = "";

      session.on((event: SessionEvent) => {
        if (event.type === "assistant.message_delta") {
          const delta = event.data.deltaContent;
          fullContent += delta;
          onChunk(delta);
        }
      });

      // Convert attachments from options
      const attachments = this.buildAttachments(options);

      const response = await session.sendAndWait(
        { prompt, attachments },
        this.timeoutMs
      );

      // If sendAndWait provides final content, prefer it
      const content = response?.data?.content ?? fullContent;
      const parsed = parseJsonFromContent(content);
      const tokenUsage = this.extractTokenUsage(response);

      this.auditLogger.logAIProviderExecution(
        "copilot-sdk",
        promptType,
        this.model,
        "success",
        undefined,
        tokenUsage
      );

      return { raw: content, parsed, tokenUsage };
    } catch (error) {
      this.auditLogger.logAIProviderExecution(
        "copilot-sdk",
        promptType,
        this.model,
        "failure",
        (error as Error).message
      );
      throw new CopilotSDKError(
        `Streaming execution failed: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  /**
   * Stops the SDK client and releases resources.
   * Should be called when done with all operations.
   */
  async stop(): Promise<void> {
    if (this.client) {
      try {
        await this.client.stop();
        this.logger.debug("CopilotClient stopped");
      } catch (error) {
        this.logger.warn({ error: (error as Error).message }, "Error stopping CopilotClient");
      } finally {
        this.client = null;
      }
    }
  }

  private async executeWithTimeout(
    prompt: string,
    options?: ExecutePromptOptions
  ): Promise<AIResponse> {
    const client = await this.getClient(options?.workingDirectory);

    // Create session with non-streaming mode for structured JSON responses
    const session = await client.createSession({
      model: this.model ?? "gpt-4.1",
      streaming: false,
    });

    // Convert attachments from options
    const attachments = this.buildAttachments(options);

    // Pass timeout directly to sendAndWait - it has built-in timeout support
    const response = await session.sendAndWait(
      { prompt, attachments },
      this.timeoutMs
    );

    const content = response?.data?.content ?? "";
    const parsed = parseJsonFromContent(content);
    const tokenUsage = this.extractTokenUsage(response);

    return { raw: content, parsed, tokenUsage };
  }

  private extractTokenUsage(response: unknown): TokenUsage | undefined {
    // SDK provides token usage in response metadata
    // The exact structure depends on SDK version
    const res = response as {
      usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
      };
      data?: {
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
        };
      };
    } | null;

    if (!res) return undefined;

    // Try SDK usage format
    if (res.usage) {
      return {
        inputTokens: res.usage.promptTokens ?? 0,
        outputTokens: res.usage.completionTokens ?? 0,
        model: this.model,
      };
    }

    // Try alternative format from data
    if (res.data?.usage) {
      return {
        inputTokens: res.data.usage.input_tokens ?? 0,
        outputTokens: res.data.usage.output_tokens ?? 0,
        model: this.model,
      };
    }

    return undefined;
  }

  /**
   * Builds SDK attachment array from ExecutePromptOptions.
   * Converts diffFiles paths or attachments into SDK format.
   */
  private buildAttachments(
    options?: ExecutePromptOptions
  ): Array<{ type: "file"; path: string; displayName?: string }> | undefined {
    // Prefer explicit attachments if provided
    if (options?.attachments && options.attachments.length > 0) {
      return options.attachments.map((att) => ({
        type: att.type,
        path: att.path,
        displayName: att.displayName,
      }));
    }

    // Fall back to diffFiles for backward compatibility
    if (options?.diffFiles && options.diffFiles.length > 0) {
      return options.diffFiles.map((path) => ({
        type: "file" as const,
        path,
        displayName: path.split("/").pop() || path,
      }));
    }

    return undefined;
  }

  private inferPromptType(prompt: string): string {
    if (prompt.includes("cross-file")) return "cross-file-review";
    if (prompt.includes("Review the following file") || prompt.includes("Files to Review")) {
      return "file-review";
    }
    return "unknown";
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Parses an AI response into a file review result.
   * Delegates to shared parsing logic.
   */
  parseFileReview(filename: string, response: AIResponse): FileReviewResult {
    return parseFileReview(filename, response);
  }

  /**
   * Parses an AI response into a cross-file review result.
   * Delegates to shared parsing logic.
   */
  parseCrossFileReview(response: AIResponse): CrossFileReviewResult {
    return parseCrossFileReview(response);
  }

  /**
   * Parses a batched AI response containing reviews for multiple files.
   * Delegates to shared parsing logic.
   */
  parseBatchedFileReview(response: AIResponse): FileReviewResult[] {
    return parseBatchedFileReview(response);
  }
}
