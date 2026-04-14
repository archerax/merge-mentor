import { createOpencode } from "@opencode-ai/sdk";
import { getAuditLogger } from "../../audit/index.js";
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, RETRY_DELAY_BASE_MS } from "../../constants.js";
import { JsonParseError, OpenCodeSdkError, ValidationError } from "../../errors/index.js";
import { createChildLogger } from "../../logger.js";
import type {
  CrossFileFinding,
  CrossFileReviewResult,
  FileFinding,
  FileReviewResult,
} from "../../platforms/types.js";
import type {
  AIProviderClient,
  AIProviderOptions,
  AIResponse,
  ExecutePromptOptions,
  FastReviewResult,
} from "../types.js";

/** Raw finding structure from OpenCode SDK JSON response. */
interface RawFileFinding {
  line?: unknown;
  severity?: unknown;
  confidence?: unknown;
  category?: unknown;
  message?: unknown;
  suggestion?: unknown;
  reasoning?: unknown;
  isPreExisting?: unknown;
}

/** Raw cross-file finding from OpenCode SDK JSON response. */
interface RawCrossFileFinding {
  severity?: unknown;
  confidence?: unknown;
  category?: unknown;
  message?: unknown;
  reasoning?: unknown;
  affected_files?: unknown[];
}

/** Raw file review response from OpenCode SDK. */
interface RawFileReviewResponse {
  findings?: RawFileFinding[];
}

/** Raw cross-file review response from OpenCode SDK. */
interface RawCrossFileReviewResponse {
  overall_assessment?: string;
  findings?: RawCrossFileFinding[];
  recommendations?: unknown[];
}

/** Raw batched file review response from OpenCode SDK. */
interface RawBatchedFileReviewResponse {
  file_results?: Record<string, RawFileReviewResponse>;
}

/** Raw fast review finding from OpenCode SDK. */
interface RawFastReviewFinding {
  file?: unknown;
  line?: unknown;
  severity?: unknown;
  confidence?: unknown;
  category?: unknown;
  message?: unknown;
  suggestion?: unknown;
  reasoning?: unknown;
  isPreExisting?: unknown;
}

/** Raw fast review response from OpenCode SDK. */
interface RawFastReviewResponse {
  summary?: string;
  findings?: RawFastReviewFinding[];
}

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
          reasoning: { type: "string", description: "Detailed reasoning with verification" },
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
          reasoning: { type: "string", description: "Detailed reasoning with verification" },
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
  private readonly auditLogger = getAuditLogger();
  private readonly logger = createChildLogger({ component: "OpenCodeSdkProvider" });

  private sdkClient?: Awaited<ReturnType<typeof createOpencode>>["client"];
  private sdkServer?: Awaited<ReturnType<typeof createOpencode>>["server"];

  constructor(options?: AIProviderOptions) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.model = options?.model;
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
        const { raw, parsed } = await this.runSdk(prompt, schema, options);
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
    throw new OpenCodeSdkError(
      `Failed after ${this.maxRetries} attempts: ${lastError?.message}`,
      lastError ?? undefined
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
    options?: ExecutePromptOptions
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
        throw new OpenCodeSdkError("Failed to create session: no session ID returned");
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
        throw new OpenCodeSdkError(
          `Structured output failed: ${info.error.message ?? "unknown error"}`
        );
      }

      if (info?.structured_output != null) {
        const structured = info.structured_output;
        const raw = typeof structured === "string" ? structured : JSON.stringify(structured);
        return { raw, parsed: structured };
      }

      // Fall back to extracting text from response parts
      const rawText = parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("");

      if (!rawText) {
        throw new OpenCodeSdkError("No content in response from OpenCode SDK");
      }

      const parsed = this.parseJsonResponse(rawText);
      return { raw: rawText, parsed };
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

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new OpenCodeSdkError(`Prompt timed out after ${ms}ms`)), ms);
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
    const minLength = 50;
    const location = typeof lineOrLocation === "number" ? `line ${lineOrLocation}` : lineOrLocation;

    if (reasoning.length < minLength) {
      this.logger.warn(
        {
          filename,
          location,
          reasoningLength: reasoning.length,
          reasoning: reasoning.substring(0, 100),
        },
        `Reasoning too short (need ${minLength}+ chars) - finding may lack proper verification`
      );
    }

    const verificationPattern = /verified|checked|confirmed|scanned|✓/i;
    if (!verificationPattern.test(reasoning)) {
      this.logger.warn(
        {
          filename,
          location,
          reasoning: reasoning.substring(0, 150),
        },
        "Reasoning lacks verification keywords (verified/checked/confirmed/scanned) - may be low quality"
      );
    }
  }

  /**
   * Parses an OpenCode SDK response into a file review result.
   */
  parseFileReview(filename: string, response: AIResponse): FileReviewResult {
    const data = response.parsed as RawFileReviewResponse;
    const findings: FileFinding[] = [];

    if (Array.isArray(data.findings)) {
      for (const finding of data.findings) {
        const reasoning = finding.reasoning
          ? String(finding.reasoning)
          : "Reasoning not provided by the model.";

        if (finding.reasoning) {
          const line = typeof finding.line === "number" ? finding.line : "unknown";
          this.validateReasoning(reasoning, filename, line);
        }

        findings.push({
          line: typeof finding.line === "number" ? finding.line : 0,
          severity: this.validateSeverity(finding.severity),
          confidence: this.validateConfidence(finding.confidence),
          category: this.validateCategory(finding.category),
          message: String(finding.message || ""),
          suggestion: String(finding.suggestion || ""),
          reasoning,
          isPreExisting: typeof finding.isPreExisting === "boolean" ? finding.isPreExisting : false,
        });
      }
    }

    return { filename, findings };
  }

  /**
   * Parses an OpenCode SDK response into a cross-file review result.
   */
  parseCrossFileReview(response: AIResponse): CrossFileReviewResult {
    const data = response.parsed as RawCrossFileReviewResponse;
    const findings: CrossFileFinding[] = [];

    if (Array.isArray(data.findings)) {
      for (const finding of data.findings) {
        const reasoning = finding.reasoning
          ? String(finding.reasoning)
          : "Reasoning not provided by the model.";

        if (finding.reasoning) {
          const affectedFiles = Array.isArray(finding.affected_files)
            ? finding.affected_files.map(String).join(", ")
            : "unknown";
          this.validateReasoning(reasoning, "cross-file", affectedFiles);
        }

        findings.push({
          severity: this.validateSeverity(finding.severity),
          confidence: this.validateConfidence(finding.confidence),
          category: this.validateCrossFileCategory(finding.category),
          message: String(finding.message || ""),
          reasoning,
          affectedFiles: Array.isArray(finding.affected_files)
            ? finding.affected_files.map(String)
            : [],
        });
      }
    }

    return {
      overallAssessment: String(data.overall_assessment || "Review completed"),
      findings,
      recommendations: Array.isArray(data.recommendations) ? data.recommendations.map(String) : [],
    };
  }

  /**
   * Parses a batched OpenCode SDK response containing reviews for multiple files.
   */
  parseBatchedFileReview(response: AIResponse): FileReviewResult[] {
    const data = response.parsed as RawBatchedFileReviewResponse;
    const results: FileReviewResult[] = [];

    if (!data.file_results || typeof data.file_results !== "object") {
      return results;
    }

    for (const [filename, fileData] of Object.entries(data.file_results)) {
      const rawFileData = fileData as RawFileReviewResponse;
      const findings: FileFinding[] = [];

      if (Array.isArray(rawFileData.findings)) {
        for (const finding of rawFileData.findings) {
          const reasoning = finding.reasoning
            ? String(finding.reasoning)
            : "Reasoning not provided by the model.";

          if (finding.reasoning) {
            const line = typeof finding.line === "number" ? finding.line : "unknown";
            this.validateReasoning(reasoning, filename, line);
          }

          findings.push({
            line: typeof finding.line === "number" ? finding.line : 0,
            severity: this.validateSeverity(finding.severity),
            confidence: this.validateConfidence(finding.confidence),
            category: this.validateCategory(finding.category),
            message: String(finding.message || ""),
            suggestion: String(finding.suggestion || ""),
            reasoning,
            isPreExisting:
              typeof finding.isPreExisting === "boolean" ? finding.isPreExisting : false,
          });
        }
      }

      results.push({ filename, findings });
    }

    return results;
  }

  /**
   * Parses a fast review response (combined file + cross-file analysis).
   */
  parseFastReview(response: AIResponse): FastReviewResult {
    const data = response.parsed as RawFastReviewResponse;

    const fileFindings = new Map<string, FileFinding[]>();
    const crossFileFindings: CrossFileFinding[] = [];

    if (Array.isArray(data.findings)) {
      for (const finding of data.findings) {
        const file = finding.file ? String(finding.file) : undefined;
        const line = typeof finding.line === "number" ? finding.line : undefined;

        const reasoning = finding.reasoning
          ? String(finding.reasoning)
          : "Reasoning not provided by the model.";

        if (finding.reasoning) {
          const context = file ? (line ? `${file}:${line}` : file) : "cross-file";
          this.validateReasoning(reasoning, context, line || "general");
        }

        if (file) {
          if (!fileFindings.has(file)) {
            fileFindings.set(file, []);
          }

          const findings = fileFindings.get(file);
          if (findings) {
            findings.push({
              line: line || 0,
              severity: this.validateSeverity(finding.severity),
              confidence: this.validateConfidence(finding.confidence),
              category: this.validateCategory(finding.category),
              message: String(finding.message || ""),
              suggestion: String(finding.suggestion || ""),
              reasoning,
              isPreExisting:
                typeof finding.isPreExisting === "boolean" ? finding.isPreExisting : false,
            });
          }
        } else {
          crossFileFindings.push({
            severity: this.validateSeverity(finding.severity),
            confidence: this.validateConfidence(finding.confidence),
            category: this.validateCrossFileCategory(finding.category),
            message: String(finding.message || ""),
            reasoning,
            affectedFiles: [],
          });
        }
      }
    }

    const fileResults: FileReviewResult[] = Array.from(fileFindings.entries()).map(
      ([filename, findings]) => ({ filename, findings })
    );

    const crossFileResult: CrossFileReviewResult = {
      overallAssessment: String(data.summary || "Review completed"),
      findings: crossFileFindings,
      recommendations: [],
    };

    return { fileResults, crossFileResult };
  }

  private validateSeverity(value: unknown): FileFinding["severity"] {
    const validSeverities = ["critical", "high", "medium", "low"] as const;
    const stringValue = String(value);
    return validSeverities.includes(stringValue as (typeof validSeverities)[number])
      ? (stringValue as FileFinding["severity"])
      : "medium";
  }

  private validateConfidence(value: unknown): FileFinding["confidence"] {
    const validConfidence = ["high", "medium", "low"] as const;
    const stringValue = String(value);
    return validConfidence.includes(stringValue as (typeof validConfidence)[number])
      ? (stringValue as FileFinding["confidence"])
      : "high";
  }

  private validateCategory(value: unknown): FileFinding["category"] {
    const validCategories = ["bug", "security", "performance", "quality", "documentation"] as const;
    const stringValue = String(value);
    return validCategories.includes(stringValue as (typeof validCategories)[number])
      ? (stringValue as FileFinding["category"])
      : "quality";
  }

  private validateCrossFileCategory(value: unknown): CrossFileFinding["category"] {
    const validCategories = [
      "architecture",
      "design",
      "testing",
      "documentation",
      "bug",
      "security",
      "performance",
      "quality",
    ] as const;
    const stringValue = String(value);
    return validCategories.includes(stringValue as (typeof validCategories)[number])
      ? (stringValue as CrossFileFinding["category"])
      : "design";
  }
}
