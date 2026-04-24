import type { PermissionHandler, PermissionRequest } from "@github/copilot-sdk";
import { CopilotClient } from "@github/copilot-sdk";
import { getAuditLogger } from "../../audit/index.js";
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, RETRY_DELAY_BASE_MS } from "../../constants.js";
import { CopilotSdkError, JsonParseError, ValidationError } from "../../errors/index.js";
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

/** Raw finding structure from Copilot SDK JSON response. */
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

/** Raw cross-file finding from Copilot SDK JSON response. */
interface RawCrossFileFinding {
  severity?: unknown;
  confidence?: unknown;
  category?: unknown;
  message?: unknown;
  reasoning?: unknown;
  affected_files?: unknown[];
}

/** Raw file review response from Copilot SDK. */
interface RawFileReviewResponse {
  findings?: RawFileFinding[];
}

/** Raw cross-file review response from Copilot SDK. */
interface RawCrossFileReviewResponse {
  overall_assessment?: string;
  findings?: RawCrossFileFinding[];
  recommendations?: unknown[];
}

/** Raw batched file review response from Copilot SDK. */
interface RawBatchedFileReviewResponse {
  file_results?: Record<string, RawFileReviewResponse>;
}

/** Raw fast review finding from Copilot SDK. */
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

/** Raw fast review response from Copilot SDK. */
interface RawFastReviewResponse {
  summary?: string;
  findings?: RawFastReviewFinding[];
}

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
]);

/**
 * Creates a permission handler for review sessions.
 *
 * Approves read-only workspace access (needed to inspect source files) and
 * denies all other tool categories — shell execution, file writes, MCP calls,
 * URL fetches, and custom tools — so that attacker-controlled content inside a
 * PR cannot trigger destructive side effects.
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
      return { kind: "denied-by-permission-request-hook" };
    }
    return { kind: "approved" };
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
  private readonly auditLogger = getAuditLogger();
  private readonly logger = createChildLogger({ component: "CopilotSdkProvider" });

  private client?: CopilotClient;

  constructor(options?: AIProviderOptions) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.model = options?.model;
    this.token = options?.token;
    this.byokBaseUrl = this.normalizeOptionalString(options?.aiBaseUrl);
    this.byokApiKey = this.normalizeOptionalString(options?.aiApiKey);
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

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const { raw, parsed } = await this.runSdk(prompt, options);
        this.auditLogger.logAIProviderExecution("copilot-sdk", promptType, this.model, "success");
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
    throw new CopilotSdkError(
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

  private getClient(): CopilotClient {
    if (this.client) return this.client;

    const config: Record<string, unknown> = {};
    if (this.token) {
      config.githubToken = this.token;
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
    options?: ExecutePromptOptions
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
    const session = await client.createSession({
      model: this.model,
      workingDirectory: options?.workingDirectory,
      streaming: true,
      onPermissionRequest: createReviewPermissionHandler(this.logger),
      ...(provider ? { provider } : {}),
    });

    try {
      const chunks: string[] = [];
      const unsubscribe = session.on("assistant.message_delta", (event) => {
        const delta = event.data.deltaContent;
        if (delta) {
          chunks.push(delta);
          options?.onStreamData?.(delta);
        }
      });

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
          throw new CopilotSdkError("No content in response from Copilot SDK");
        }

        const parsed = this.parseJsonResponse(content);
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
            return recovered;
          }
        }
        throw error;
      } finally {
        unsubscribe();
      }
    } finally {
      try {
        await session.disconnect();
      } catch {
        // Best-effort session cleanup
      }
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
   * Parses a Copilot SDK response into a cross-file review result.
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
   * Parses a batched Copilot SDK response containing reviews for multiple files.
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
