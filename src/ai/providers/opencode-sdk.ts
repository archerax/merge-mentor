import path from "node:path";
import { pathToFileURL } from "node:url";
import { createOpencode } from "@opencode-ai/sdk";
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
import { saveTranscript } from "../shared/saveTranscript.js";
import {
  combineToolAndJsonFindings,
  convertFindingsToParsedResponse,
  createOpencodePostCommentTool,
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

/** Timeout for OpenCode server startup (connection), separate from prompt execution timeout. */
const SERVER_STARTUP_TIMEOUT_MS = 30_000;

/**
 * AI provider implementation using the @opencode-ai/sdk package.
 *
 * Unlike the CLI-based OpenCodeProvider, this SDK provider:
 * - Sends prompts directly via the SDK (no subprocess spawning)
 * - Uses native structured JSON output (no regex-based JSON extraction)
 * - Manages the opencode server lifecycle automatically
 * - Reuses the server across multiple executePrompt calls for efficiency
 */
export class OpenCodeSdkProvider implements AIProviderClient {
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly model?: string;
  private readonly reasoningEffort?: ReasoningEffort;
  private readonly experimentalTools: boolean;
  private readonly enableWriteTools: boolean;
  private readonly enableShellTools: boolean;
  private readonly findingsCollector = new FindingsCollector();
  private readonly auditLogger = getAuditLogger();
  private readonly logger = createChildLogger({ component: "OpenCodeSdkProvider" });
  private readonly output: OutputWriter;

  private readonly tempPath: string;
  private readonly fileSystem: FileSystem;
  private readonly clock: Clock;

  private sdkClient?: Awaited<ReturnType<typeof createOpencode>>["client"];
  private sdkServer?: Awaited<ReturnType<typeof createOpencode>>["server"];

  constructor(options?: AIProviderOptions) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.model = options?.model;
    this.reasoningEffort = options?.reasoningEffort;
    this.experimentalTools = options?.experimentalTools ?? false;
    this.enableWriteTools = options?.enableWriteTools ?? false;
    this.enableShellTools = options?.enableShellTools ?? false;
    this.output = options?.output ?? consoleOutputWriter;
    this.tempPath = options?.tempPath ?? path.join(process.cwd(), ".mergementor");
    this.fileSystem = options?.fileSystem ?? nodeFs;
    this.clock = options?.clock ?? systemClock;
    if (options?.aiBaseUrl || options?.aiApiKey) {
      throw new ValidationError(
        "aiBaseUrl",
        'BYOK options ("aiBaseUrl" and "aiApiKey") are not supported by "opencode-sdk". Configure the OpenCode provider externally.'
      );
    }
  }

  /**
   * Shuts down the cached OpenCode server. Safe to call multiple times.
   * Call when the provider instance is no longer needed (e.g. after a review completes).
   */
  destroy(): void {
    if (this.sdkServer) {
      try {
        this.sdkServer.close();
      } catch {
        // Ignore server shutdown errors
      }
      this.sdkServer = undefined;
      this.sdkClient = undefined;
    }
  }

  /**
   * Executes a prompt via the OpenCode SDK with automatic retries.
   *
   * @param prompt - The prompt to send to OpenCode
   * @param options - Optional execution context (working directory, diff files)
   * @returns Response containing raw output and parsed JSON
   * @throws {ValidationError} When prompt is empty or invalid
   * @throws {OpenCodeSdkError} When SDK execution fails after all retries
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
        const { raw, parsed } = await this.runSdk(prompt, schema, options, attempt + 1, (usage) => {
          accumulatedUsage = mergeTokenUsage(accumulatedUsage, usage);
        });
        this.auditLogger.logAIProviderExecution("opencode-sdk", promptType, this.model, "success");
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
          "OpenCode SDK execution attempt failed"
        );
        if (attempt < this.maxRetries - 1) {
          await delay(RETRY_DELAY_BASE_MS * (attempt + 1));
        }
      }
    }

    this.auditLogger.logAIProviderExecution(
      "opencode-sdk",
      promptType,
      this.model,
      "failure",
      lastError?.message
    );
    throw new AIProviderError(
      "opencode-sdk",
      `Failed after ${this.maxRetries} attempts: ${lastError?.message}`,
      { cause: lastError ?? undefined }
    );
  }

  private async getClient(): Promise<{
    client: Awaited<ReturnType<typeof createOpencode>>["client"];
    server: Awaited<ReturnType<typeof createOpencode>>["server"];
  }> {
    if (this.sdkClient && this.sdkServer) {
      return { client: this.sdkClient, server: this.sdkServer };
    }

    const opencodeConfig: Record<string, unknown> = {};
    if (this.model) {
      opencodeConfig.model = this.model;
    }

    if (this.experimentalTools) {
      const postCommentTool = createOpencodePostCommentTool(this.findingsCollector, {
        output: this.output,
      });
      opencodeConfig.tools = {
        [postCommentTool.name]: postCommentTool,
      };
    }

    const reasoningConfig = this.buildReasoningConfig();
    if (Object.keys(reasoningConfig).length > 0) {
      Object.assign(opencodeConfig, reasoningConfig);
    }

    // Restrict the agent to read-only access by default. File edits are allowed
    // when enableWriteTools is true; bash execution only when enableShellTools
    // is explicitly enabled — never for flows whose prompts contain untrusted
    // input (e.g. PR review comments in the fix command).
    opencodeConfig.permission = {
      edit: this.enableWriteTools ? "allow" : "deny",
      bash: this.enableShellTools ? "allow" : "deny",
      webfetch: "deny",
      doom_loop: "deny",
      external_directory: "deny",
    };

    const { client, server } = await createOpencode({
      timeout: SERVER_STARTUP_TIMEOUT_MS,
      config: opencodeConfig,
    });

    this.sdkClient = client;
    this.sdkServer = server;
    return { client, server };
  }

  private async runSdk(
    prompt: string,
    schema: Record<string, unknown> | undefined,
    options?: ExecutePromptOptions,
    attempt = 1,
    onUsageCollected?: (usage: TokenUsage | undefined) => void
  ): Promise<{ raw: string; parsed: unknown }> {
    let client: Awaited<ReturnType<typeof createOpencode>>["client"];
    try {
      ({ client } = await this.getClient());
    } catch (error) {
      // Server may have died; reset cache and let the retry loop handle it
      this.destroy();
      throw error;
    }

    if (this.experimentalTools) {
      this.findingsCollector.reset();
    }

    const directoryQuery = options?.workingDirectory
      ? { directory: options.workingDirectory }
      : undefined;

    let sessionId: string | undefined;
    try {
      const session = await client.session.create({
        body: { title: "merge-mentor-review" },
        query: directoryQuery,
      });

      sessionId =
        (session as { data?: { id: string }; id?: string }).data?.id ??
        (session as { id?: string }).id;

      if (!sessionId) {
        throw new AIProviderError(
          "opencode-sdk",
          "Failed to create session: no session ID returned"
        );
      }

      const promptParts: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
      for (const diffFile of options?.diffFiles ?? []) {
        promptParts.push({
          type: "file",
          mime: "text/plain",
          filename: path.basename(diffFile),
          url: pathToFileURL(diffFile).href,
        });
      }

      const body: {
        parts: Array<Record<string, unknown>>;
        format?: { type: string; schema: Record<string, unknown> };
      } = { parts: promptParts };

      if (schema) {
        body.format = {
          type: "json_schema",
          schema,
        };
      }

      const stopStreaming = options?.onStreamData
        ? await this.subscribeToStream(client, directoryQuery, sessionId, options.onStreamData)
        : undefined;

      const promptCall = client.session.prompt({
        path: { id: sessionId },
        body: body as Parameters<typeof client.session.prompt>[0]["body"],
        query: directoryQuery,
      });

      try {
        const result = await this.withTimeout(promptCall, this.timeoutMs);

        // Extract structured output if available (native JSON, no parsing needed)
        const resultData = result as {
          data?: {
            info?: { structured_output?: unknown; error?: { name?: string; message?: string } };
            parts?: Array<{ type: string; text?: string }>;
          };
          info?: { structured_output?: unknown; error?: { name?: string; message?: string } };
          parts?: Array<{ type: string; text?: string }>;
        };

        const info = resultData.data?.info ?? resultData.info;
        const tokenUsage = this.extractTokenUsage(info);
        onUsageCollected?.(tokenUsage);
        const parts = resultData.data?.parts ?? resultData.parts ?? [];

        // Check for structured output errors
        if (info?.error?.name === "StructuredOutputError") {
          const err = new AIProviderError(
            "opencode-sdk",
            `Structured output failed: ${info.error.message ?? "unknown error"}`
          );

          await this.saveTranscript({
            prompt,
            rawResponse: JSON.stringify(result, null, 2),
            success: false,
            error: err.message,
            attempt,
          });

          throw err;
        }

        if (info?.structured_output != null) {
          let structured: unknown = info.structured_output;
          if (this.experimentalTools) {
            const toolFindings = this.findingsCollector.getAllFindings();
            this.logger.info(
              { count: toolFindings.length },
              "Combining findings from tool calls and structured output."
            );
            structured = combineToolAndJsonFindings(structured, toolFindings);
          }
          const raw = typeof structured === "string" ? structured : JSON.stringify(structured);

          await this.saveTranscript({
            prompt,
            rawResponse: JSON.stringify(result, null, 2),
            jsonOutput: raw,
            tokenUsage,
            success: true,
            attempt,
          });

          return { raw, parsed: structured };
        }

        // Fall back to extracting text from response parts
        const rawText = parts
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("");

        if (!rawText) {
          if (this.experimentalTools) {
            const toolFindings = this.findingsCollector.getAllFindings();
            if (toolFindings.length > 0) {
              const parsed = convertFindingsToParsedResponse(toolFindings);
              await this.saveTranscript({
                prompt,
                rawResponse: JSON.stringify(result, null, 2),
                jsonOutput: JSON.stringify(parsed, null, 2),
                tokenUsage,
                success: true,
                attempt,
              });
              return { raw: "", parsed };
            }
          }
          throw new AIProviderError("opencode-sdk", "No content in response from OpenCode SDK");
        }

        let parsed: unknown;
        let jsonParseError: unknown;
        try {
          parsed = parseJsonResponse(rawText);
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
            rawResponse: JSON.stringify(result, null, 2),
            jsonOutput: JSON.stringify(parsed, null, 2),
            tokenUsage,
            success: true,
            attempt,
          });

          return { raw: rawText, parsed };
        }

        if (jsonParseError) {
          throw jsonParseError;
        }

        await this.saveTranscript({
          prompt,
          rawResponse: JSON.stringify(result, null, 2),
          jsonOutput: JSON.stringify(parsed, null, 2),
          tokenUsage,
          success: true,
          attempt,
        });

        return { raw: rawText, parsed };
      } finally {
        stopStreaming?.();
      }
    } catch (error) {
      await this.saveTranscript({
        prompt,
        success: false,
        error: (error as Error).message,
        attempt,
      });
      throw error;
    } finally {
      if (sessionId) {
        try {
          await client.session.delete({ path: { id: sessionId }, query: directoryQuery });
        } catch {
          // Best-effort session cleanup
        }
      }
    }
  }

  private async saveTranscript(data: {
    prompt: string;
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
        providerLabel: "OPENCODE SDK PROVIDER TRANSCRIPT",
        filePrefix: "transcript-opencode",
        displayName: "OpenCode SDK",
        model: this.model,
      },
      data
    );
  }

  private buildReasoningConfig(): Record<string, unknown> {
    if (!this.reasoningEffort) return {};

    const separator = this.model?.indexOf("/") ?? -1;
    if (separator <= 0) {
      this.logger.warn(
        { model: this.model, reasoningEffort: this.reasoningEffort },
        "OpenCode reasoning effort was requested but the model provider is unknown; continuing without it"
      );
      return {};
    }

    const providerId = this.model?.slice(0, separator);
    if (!providerId) return {};

    return {
      provider: {
        [providerId]: {
          options: { reasoningEffort: this.reasoningEffort },
        },
      },
    };
  }

  private async subscribeToStream(
    client: Awaited<ReturnType<typeof createOpencode>>["client"],
    query: { directory: string } | undefined,
    sessionId: string,
    onStreamData: (chunk: string) => void
  ): Promise<() => void> {
    try {
      const eventStream = await client.event.subscribe({ query });
      let active = true;
      void (async () => {
        try {
          for await (const event of eventStream.stream) {
            if (!active || event.type !== "message.part.updated") continue;
            const properties = event.properties as {
              part?: { sessionID?: string; type?: string };
              delta?: string;
            };
            if (
              properties.part?.sessionID === sessionId &&
              properties.part.type === "text" &&
              properties.delta
            ) {
              onStreamData(properties.delta);
            }
          }
        } catch (error) {
          this.logger.debug({ error: (error as Error).message }, "OpenCode stream ended");
        }
      })();

      return () => {
        active = false;
        void eventStream.stream.return?.(undefined);
      };
    } catch (error) {
      this.logger.warn(
        { error: (error as Error).message },
        "OpenCode streaming unavailable; continuing without streamed output"
      );
      return () => {};
    }
  }

  private extractTokenUsage(info: unknown): TokenUsage | undefined {
    const message = info as {
      tokens?: {
        input?: number;
        output?: number;
        reasoning?: number;
        cache?: { read?: number; write?: number };
      };
      providerID?: string;
      modelID?: string;
      time?: { created?: number; completed?: number };
    };
    const tokens = message?.tokens;
    if (!tokens) return undefined;

    return {
      inputTokens: tokens.input ?? 0,
      outputTokens: (tokens.output ?? 0) + (tokens.reasoning ?? 0),
      ...(tokens.cache
        ? { cachedTokens: (tokens.cache.read ?? 0) + (tokens.cache.write ?? 0) }
        : {}),
      ...(message.providerID && message.modelID
        ? { model: `${message.providerID}/${message.modelID}` }
        : {}),
      ...(message.time?.created !== undefined && message.time.completed !== undefined
        ? { durationWallSeconds: (message.time.completed - message.time.created) / 1000 }
        : {}),
    };
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new AIProviderError("opencode-sdk", `Prompt timed out after ${ms}ms`)),
        ms
      );
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Parses an OpenCode SDK response into a file review result.
   */
  /**
   * Parses an OpenCode SDK response into a file review result.
   */
  parseFileReview(filename: string, response: AIResponse): FileReviewResult {
    return parseFileReviewShared(this.logger, filename, response);
  }

  /**
   * Parses an OpenCode SDK response into a cross-file review result.
   */
  parseCrossFileReview(response: AIResponse): CrossFileReviewResult {
    return parseCrossFileReviewShared(this.logger, response);
  }

  /**
   * Parses a batched OpenCode SDK response containing reviews for multiple files.
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
