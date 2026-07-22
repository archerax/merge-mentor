import path from "node:path";
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
  ReasoningEffort,
  TokenUsage,
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

/**
 * AI provider implementation using the @anthropic-ai/claude-agent-sdk package.
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

    const promptType: PromptType = options?.promptType ?? this.inferPromptType(prompt);
    const schema = this.getJsonSchema(promptType);
    let lastError: Error | null = null;
    let accumulatedUsage: TokenUsage | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const { raw, parsed, usage } = await this.runSdk(prompt, schema, options, attempt + 1);
        if (usage) {
          accumulatedUsage = this.mergeTokenUsage(accumulatedUsage, usage);
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
          await this.delay(RETRY_DELAY_BASE_MS * (attempt + 1));
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

    const agentOptions: Record<string, unknown> = {
      tools: toolsList,
      allowedTools: toolsList,
      permissionMode: "dontAsk",
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

      const parsed = this.parseJsonResponse(rawText);

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

  private mergeTokenUsage(current?: TokenUsage, incoming?: TokenUsage): TokenUsage | undefined {
    if (!current) return incoming;
    if (!incoming) return current;
    return {
      inputTokens: current.inputTokens + incoming.inputTokens,
      outputTokens: current.outputTokens + incoming.outputTokens,
      cachedTokens: (current.cachedTokens ?? 0) + (incoming.cachedTokens ?? 0),
      model: current.model || incoming.model,
    };
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
   * Parses a Claude Agent SDK response into a file review result.
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
   * Parses a Claude Agent SDK response into a cross-file review result.
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
   * Parses a batched Claude Agent SDK response containing reviews for multiple files.
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
