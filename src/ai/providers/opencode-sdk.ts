import path from "node:path";
import { createOpencode } from "@opencode-ai/sdk";
import { getAuditLogger } from "../../audit/index.js";
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, RETRY_DELAY_BASE_MS } from "../../constants.js";
import { AIProviderError, ValidationError } from "../../errors/index.js";
import { createChildLogger } from "../../logger.js";
import type { CrossFileReviewResult, FileReviewResult } from "../../platforms/types.js";
import { type Clock, type FileSystem, nodeFs, systemClock } from "../../ports/index.js";
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
  private readonly enableWriteTools: boolean;
  private readonly enableShellTools: boolean;
  private readonly auditLogger = getAuditLogger();
  private readonly logger = createChildLogger({ component: "OpenCodeSdkProvider" });

  private readonly tempPath: string;
  private readonly fileSystem: FileSystem;
  private readonly clock: Clock;

  private sdkClient?: Awaited<ReturnType<typeof createOpencode>>["client"];
  private sdkServer?: Awaited<ReturnType<typeof createOpencode>>["server"];

  constructor(options?: AIProviderOptions) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.model = options?.model;
    this.enableWriteTools = options?.enableWriteTools ?? false;
    this.enableShellTools = options?.enableShellTools ?? false;
    this.tempPath = options?.tempPath ?? path.join(process.cwd(), ".mergementor");
    this.fileSystem = options?.fileSystem ?? nodeFs;
    this.clock = options?.clock ?? systemClock;
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

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const { raw, parsed } = await this.runSdk(prompt, schema, options, attempt + 1);
        this.auditLogger.logAIProviderExecution("opencode-sdk", promptType, this.model, "success");
        return { raw, parsed };
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
    attempt = 1
  ): Promise<{ raw: string; parsed: unknown }> {
    let client: Awaited<ReturnType<typeof createOpencode>>["client"];
    try {
      ({ client } = await this.getClient());
    } catch (error) {
      // Server may have died; reset cache and let the retry loop handle it
      this.destroy();
      throw error;
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

      const promptParts: Array<{ type: "text"; text: string }> = [{ type: "text", text: prompt }];

      const body: {
        parts: Array<{ type: "text"; text: string }>;
        format?: { type: string; schema: Record<string, unknown> };
      } = { parts: promptParts };

      if (schema) {
        body.format = {
          type: "json_schema",
          schema,
        };
      }

      const promptCall = client.session.prompt({
        path: { id: sessionId },
        body: body as Parameters<typeof client.session.prompt>[0]["body"],
        query: directoryQuery,
      });

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
        const structured = info.structured_output;
        const raw = typeof structured === "string" ? structured : JSON.stringify(structured);

        await this.saveTranscript({
          prompt,
          rawResponse: JSON.stringify(result, null, 2),
          jsonOutput: raw,
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
        throw new AIProviderError("opencode-sdk", "No content in response from OpenCode SDK");
      }

      const parsed = parseJsonResponse(rawText);

      await this.saveTranscript({
        prompt,
        rawResponse: JSON.stringify(result, null, 2),
        jsonOutput: JSON.stringify(parsed, null, 2),
        success: true,
        attempt,
      });

      return { raw: rawText, parsed };
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
    success: boolean;
    error?: string;
    attempt: number;
  }): Promise<void> {
    try {
      const transcriptDir = path.join(this.tempPath, "transcripts");
      await this.fileSystem.mkdir(transcriptDir, { recursive: true });

      const timestamp = this.clock.timestamp().replace(/[:.]/g, "-");
      const status = data.success ? "success" : "failure";
      const filename = `transcript-opencode-${timestamp}-attempt-${data.attempt}-${status}.txt`;
      const filepath = path.join(transcriptDir, filename);

      const transcriptLines: string[] = [
        "=".repeat(80),
        "OPENCODE SDK PROVIDER TRANSCRIPT",
        "=".repeat(80),
        `Timestamp: ${this.clock.timestamp()}`,
        `Status: ${status}`,
        `Model: ${this.model || "default"}`,
        `Attempt: ${data.attempt}`,
        "",
        "=".repeat(80),
        "INPUT PROMPT",
        "=".repeat(80),
        data.prompt,
        "",
        "=".repeat(80),
        "RAW API RESPONSE",
        "=".repeat(80),
        data.rawResponse || "(empty)",
        "",
        "=".repeat(80),
        "JSON OUTPUT",
        "=".repeat(80),
        data.jsonOutput || "(empty)",
      ];

      if (data.error) {
        transcriptLines.push("", "=".repeat(80), "ERROR", "=".repeat(80), data.error);
      }

      transcriptLines.push("", "=".repeat(80), "END OF TRANSCRIPT", "=".repeat(80));

      await this.fileSystem.writeFile(filepath, transcriptLines.join("\n"), "utf-8");

      this.logger.debug(
        { filepath, success: data.success, attempt: data.attempt },
        "Saved OpenCode SDK transcript for debugging"
      );
    } catch (err) {
      this.logger.warn({ error: (err as Error).message }, "Failed to save OpenCode SDK transcript");
    }
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
