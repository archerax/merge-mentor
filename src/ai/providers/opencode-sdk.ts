import path from "node:path";
import { createOpencode } from "@opencode-ai/sdk";
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
import { type Clock, type FileSystem, nodeFs, systemClock } from "../../ports/index.js";
import {
  BatchedFileReviewResponseSchema,
  CrossFileReviewResponseSchema,
  FastReviewResponseSchema,
  FileReviewResponseSchema,
} from "../schemas.js";
import type {
  AIProviderClient,
  AIProviderOptions,
  AIResponse,
  ExecutePromptOptions,
  FastReviewResult,
} from "../types.js";

/** Detected prompt type used for schema selection and audit logging. */
type PromptType =
  | "file-review"
  | "cross-file-review"
  | "batched-file-review"
  | "fast-review"
  | "unknown";

/** JSON schema for file review structured output. */
const FILE_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line: { type: "number", description: "Line number in the file" },
          severity: {
            type: "string",
            description: "Finding severity: critical, high, medium, or low",
          },
          confidence: { type: "string", description: "Confidence level: high, medium, or low" },
          category: {
            type: "string",
            description: "Finding category: bug, security, performance, quality, or documentation",
          },
          message: { type: "string", description: "Description of the finding" },
          suggestion: { type: "string", description: "Suggested fix or improvement" },
          reasoning: {
            type: "string",
            description: "Concise rationale citing code evidence, checked context, and impact",
          },
          isPreExisting: {
            type: "boolean",
            description: "Whether this issue existed before the PR changes",
          },
        },
        required: ["line", "severity", "category", "message"],
      },
    },
  },
  required: ["findings"],
} as const;

/** JSON schema for cross-file review structured output. */
const CROSS_FILE_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    overall_assessment: { type: "string", description: "Overall assessment of the PR" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: {
            type: "string",
            description: "Finding severity: critical, high, medium, or low",
          },
          confidence: { type: "string", description: "Confidence level: high, medium, or low" },
          category: {
            type: "string",
            description:
              "Category: architecture, design, testing, documentation, bug, security, performance, or quality",
          },
          message: { type: "string", description: "Description of the finding" },
          reasoning: {
            type: "string",
            description:
              "Concise rationale citing cross-file evidence, checked context, and impact",
          },
          affected_files: {
            type: "array",
            items: { type: "string" },
            description: "List of affected file paths",
          },
        },
        required: ["severity", "category", "message"],
      },
    },
    recommendations: {
      type: "array",
      items: { type: "string" },
      description: "Actionable recommendations",
    },
  },
  required: ["findings"],
} as const;

/** JSON schema for batched file review structured output. */
const BATCHED_FILE_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    file_results: {
      type: "object",
      description: "Map of filename to review results",
      additionalProperties: {
        type: "object",
        properties: {
          findings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                line: { type: "number" },
                severity: { type: "string" },
                confidence: { type: "string" },
                category: { type: "string" },
                message: { type: "string" },
                suggestion: { type: "string" },
                reasoning: { type: "string" },
                isPreExisting: { type: "boolean" },
              },
              required: ["line", "severity", "category", "message"],
            },
          },
        },
        required: ["findings"],
      },
    },
  },
  required: ["file_results"],
} as const;

/** JSON schema for fast review structured output. */
const FAST_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Brief summary of the review" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string", description: "File path (omit for cross-file findings)" },
          line: { type: "number", description: "Line number in the file" },
          severity: { type: "string" },
          confidence: { type: "string" },
          category: { type: "string" },
          message: { type: "string" },
          suggestion: { type: "string" },
          reasoning: { type: "string" },
          isPreExisting: { type: "boolean" },
        },
        required: ["severity", "category", "message"],
      },
    },
  },
  required: ["findings"],
} as const;

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

    const promptType: PromptType = options?.promptType ?? this.inferPromptType(prompt);
    const schema = this.getJsonSchema(promptType);
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
          await this.delay(RETRY_DELAY_BASE_MS * (attempt + 1));
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

  private inferPromptType(prompt: string): PromptType {
    if (prompt.includes("file_results")) return "batched-file-review";
    if (prompt.includes("cross-file")) return "cross-file-review";
    if (prompt.includes("Review the following file")) return "file-review";
    if (prompt.includes("fast") && prompt.includes("review")) return "fast-review";
    return "unknown";
  }

  private getJsonSchema(promptType: PromptType): Record<string, unknown> | undefined {
    switch (promptType) {
      case "file-review":
        return FILE_REVIEW_SCHEMA as unknown as Record<string, unknown>;
      case "cross-file-review":
        return CROSS_FILE_REVIEW_SCHEMA as unknown as Record<string, unknown>;
      case "batched-file-review":
        return BATCHED_FILE_REVIEW_SCHEMA as unknown as Record<string, unknown>;
      case "fast-review":
        return FAST_REVIEW_SCHEMA as unknown as Record<string, unknown>;
      default:
        return undefined;
    }
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

    // Restrict the agent to read-only access by default. Allow file edits and bash
    // command execution when enableWriteTools is true.
    opencodeConfig.permission = {
      edit: this.enableWriteTools ? "allow" : "deny",
      bash: this.enableWriteTools ? "allow" : "deny",
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

      const parsed = this.parseJsonResponse(rawText);

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
   * Parses an OpenCode SDK response into a file review result.
   */
  /**
   * Parses an OpenCode SDK response into a file review result.
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
   * Parses an OpenCode SDK response into a cross-file review result.
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
   * Parses a batched OpenCode SDK response containing reviews for multiple files.
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
