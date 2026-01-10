import OpenAI from "openai";
import { getAuditLogger } from "../../audit/index.js";
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS } from "../../constants.js";
import {
  JsonParseError,
  OpenAIAuthenticationError,
  OpenAIProviderError,
  OpenAIRateLimitError,
  ValidationError,
} from "../../errors/index.js";
import { createChildLogger } from "../../logger.js";
import type {
  CrossFileFinding,
  CrossFileReviewResult,
  FileFinding,
  FileReviewResult,
  FindingConfidence,
  ResolvedComment,
} from "../../platforms/types.js";
import type { AIProviderClient, AIProviderOptions, AIResponse, TokenUsage } from "../types.js";

/** Raw finding structure from OpenAI JSON response. */
interface RawFileFinding {
  line?: unknown;
  severity?: unknown;
  category?: unknown;
  message?: unknown;
  suggestion?: unknown;
  confidence?: unknown;
  isPreExisting?: unknown;
}

/** Raw cross-file finding from OpenAI JSON response. */
interface RawCrossFileFinding {
  severity?: unknown;
  category?: unknown;
  message?: unknown;
  affected_files?: unknown[];
}

/** Raw resolved comment from OpenAI JSON response. */
interface RawResolvedComment {
  line?: unknown;
  reason?: unknown;
}

/** Raw file review response from OpenAI. */
interface RawFileReviewResponse {
  findings?: RawFileFinding[];
  resolved_comments?: RawResolvedComment[];
}

/** Raw cross-file review response from OpenAI. */
interface RawCrossFileReviewResponse {
  overall_assessment?: string;
  findings?: RawCrossFileFinding[];
  recommendations?: unknown[];
}

/** Raw batched file review response from OpenAI. */
interface RawBatchedFileReviewResponse {
  file_results?: Record<string, RawFileReviewResponse>;
}

/** OpenAI-specific provider options. */
export interface OpenAIProviderOptions extends AIProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

/**
 * AI provider implementation for OpenAI API.
 * Uses the official OpenAI SDK for API calls with inline diff content.
 */
export class OpenAIProvider implements AIProviderClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly auditLogger = getAuditLogger();
  private readonly logger = createChildLogger({ component: "OpenAIProvider" });

  constructor(options: OpenAIProviderOptions) {
    if (!options.apiKey) {
      throw new OpenAIAuthenticationError(
        "OpenAI API key is required. Set via MM_OPENAI_API_KEY or OPENAI_API_KEY environment variable."
      );
    }

    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    });

    this.model = options.model ?? "gpt-4o";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Executes a prompt via OpenAI API.
   *
   * @param prompt - The prompt to send to OpenAI
   * @returns Response containing raw output and parsed JSON
   * @throws {ValidationError} When prompt is empty or invalid
   * @throws {OpenAIProviderError} When API call fails
   */
  async executePrompt(prompt: string): Promise<AIResponse> {
    if (!prompt || prompt.trim().length === 0) {
      throw new ValidationError("prompt", "Prompt cannot be empty.");
    }

    const promptType = this.inferPromptType(prompt);
    const startTime = Date.now();

    try {
      this.logger.debug(
        {
          promptLength: prompt.length,
          promptPreview: prompt.substring(0, 500),
          model: this.model,
        },
        "Executing OpenAI prompt"
      );

      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2, // Lower temperature for consistent reviews
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new OpenAIProviderError("Empty response from OpenAI");
      }

      const usage = completion.usage;
      const tokenUsage: TokenUsage | undefined = usage
        ? {
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            model: this.model,
            durationWallSeconds: (Date.now() - startTime) / 1000,
          }
        : undefined;

      const parsed = this.parseJsonResponse(content);

      this.auditLogger.logAIProviderExecution(
        "openai",
        promptType,
        this.model,
        "success",
        undefined,
        tokenUsage
      );

      return { raw: content, parsed, tokenUsage };
    } catch (error) {
      const durationSeconds = (Date.now() - startTime) / 1000;
      this.logger.error(
        {
          error: (error as Error).message,
          durationSeconds,
          model: this.model,
        },
        "OpenAI API call failed"
      );

      this.auditLogger.logAIProviderExecution(
        "openai",
        promptType,
        this.model,
        "failure",
        (error as Error).message
      );

      throw this.handleError(error);
    }
  }

  private inferPromptType(prompt: string): string {
    if (prompt.includes("cross-file")) return "cross-file-review";
    if (prompt.includes("Review the following file")) return "file-review";
    return "unknown";
  }

  private parseJsonResponse(raw: string): unknown {
    this.logger.debug(
      {
        responseLength: raw.length,
        responsePreview: raw.substring(0, 500),
        responseSuffix: raw.substring(Math.max(0, raw.length - 500)),
      },
      "Parsing JSON response"
    );

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      this.logger.error({ fullResponse: raw }, "No JSON object found in response");
      throw new JsonParseError("No JSON object found in response.", raw);
    }

    this.logger.debug(
      {
        jsonLength: jsonMatch[0].length,
        jsonPreview: jsonMatch[0].substring(0, 300),
      },
      "Extracted JSON for parsing"
    );

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      this.logger.debug({ parsedKeys: Object.keys(parsed) }, "JSON parsing successful");
      return parsed;
    } catch (error) {
      this.logger.error(
        {
          error: (error as Error).message,
          failedJson: jsonMatch[0],
        },
        "JSON parsing failed"
      );
      throw new JsonParseError((error as Error).message, raw);
    }
  }

  private handleError(error: unknown): Error {
    if (error instanceof OpenAIProviderError) {
      return error;
    }

    // Duck-type check for OpenAI APIError (has status property)
    if (this.isAPIError(error)) {
      if (error.status === 401) {
        return new OpenAIAuthenticationError(error.message);
      }
      if (error.status === 429) {
        const retryAfter =
          error.headers && "retry-after" in error.headers
            ? Number.parseInt(error.headers["retry-after"] as string, 10)
            : undefined;
        return new OpenAIRateLimitError(error.message, retryAfter);
      }
      // Create a proper Error to pass as cause
      const cause = error instanceof Error ? error : new Error(error.message);
      return new OpenAIProviderError(error.message, error.status, cause);
    }

    if (error instanceof Error) {
      return new OpenAIProviderError(error.message, undefined, error);
    }

    return new OpenAIProviderError("Unknown OpenAI error");
  }

  /**
   * Duck-type check for OpenAI APIError.
   * Checks for common properties rather than using instanceof.
   */
  private isAPIError(
    error: unknown
  ): error is { status: number; message: string; headers?: Record<string, unknown> } {
    return (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status: unknown }).status === "number" &&
      "message" in error &&
      typeof (error as { message: unknown }).message === "string"
    );
  }

  /**
   * Parses an OpenAI response into a file review result.
   *
   * @param filename - Name of the reviewed file
   * @param response - Raw OpenAI response
   * @returns Structured file review result
   */
  parseFileReview(filename: string, response: AIResponse): FileReviewResult {
    const data = response.parsed as RawFileReviewResponse;
    const findings: FileFinding[] = [];
    const resolvedComments: ResolvedComment[] = [];

    if (Array.isArray(data.findings)) {
      for (const finding of data.findings) {
        findings.push({
          line: typeof finding.line === "number" ? finding.line : 0,
          severity: this.validateSeverity(finding.severity),
          category: this.validateCategory(finding.category),
          message: String(finding.message || ""),
          suggestion: String(finding.suggestion || ""),
          confidence: this.validateConfidence(finding.confidence),
          isPreExisting: typeof finding.isPreExisting === "boolean" ? finding.isPreExisting : false,
        });
      }
    }

    if (Array.isArray(data.resolved_comments)) {
      for (const resolved of data.resolved_comments) {
        if (typeof resolved.line === "number" && resolved.line > 0) {
          resolvedComments.push({
            line: resolved.line,
            reason: String(resolved.reason || "Issue addressed"),
          });
        }
      }
    }

    return {
      filename,
      findings,
      resolvedComments: resolvedComments.length > 0 ? resolvedComments : undefined,
    };
  }

  /**
   * Parses an OpenAI response into a cross-file review result.
   *
   * @param response - Raw OpenAI response
   * @returns Structured cross-file review result
   */
  parseCrossFileReview(response: AIResponse): CrossFileReviewResult {
    const data = response.parsed as RawCrossFileReviewResponse;
    const findings: CrossFileFinding[] = [];

    if (Array.isArray(data.findings)) {
      for (const finding of data.findings) {
        findings.push({
          severity: this.validateSeverity(finding.severity),
          category: this.validateCrossFileCategory(finding.category),
          message: String(finding.message || ""),
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
   * Parses a batched OpenAI response containing reviews for multiple files.
   *
   * @param response - Raw OpenAI response with file_results object
   * @returns Array of structured file review results
   */
  parseBatchedFileReview(response: AIResponse): FileReviewResult[] {
    this.logger.debug(
      {
        rawResponseLength: response.raw?.length || 0,
        rawResponsePreview: response.raw?.substring(0, 1000),
        parsedResponse: response.parsed,
      },
      "OpenAI response details"
    );

    const data = response.parsed as RawBatchedFileReviewResponse;
    const results: FileReviewResult[] = [];

    if (!data.file_results || typeof data.file_results !== "object") {
      this.logger.debug(
        {
          fileResultsExists: !!data.file_results,
          fileResultsType: typeof data.file_results,
          parsedDataKeys: Object.keys(data),
        },
        "Missing or invalid file_results"
      );
      return results;
    }

    this.logger.debug(
      {
        fileCount: Object.keys(data.file_results).length,
        fileNames: Object.keys(data.file_results),
      },
      "Processing file_results"
    );

    for (const [filename, fileData] of Object.entries(data.file_results)) {
      this.logger.debug({ filename, fileData }, "Processing individual file");

      const rawFileData = fileData as RawFileReviewResponse;
      const findings: FileFinding[] = [];
      const resolvedComments: ResolvedComment[] = [];

      this.logger.debug(
        {
          filename,
          findingsExists: Array.isArray(rawFileData.findings),
          findingsCount: rawFileData.findings?.length || 0,
        },
        "Processing file findings"
      );

      if (Array.isArray(rawFileData.findings)) {
        for (const finding of rawFileData.findings) {
          findings.push({
            line: typeof finding.line === "number" ? finding.line : 0,
            severity: this.validateSeverity(finding.severity),
            category: this.validateCategory(finding.category),
            message: String(finding.message || ""),
            suggestion: String(finding.suggestion || ""),
            confidence: this.validateConfidence(finding.confidence),
            isPreExisting:
              typeof finding.isPreExisting === "boolean" ? finding.isPreExisting : false,
          });
        }
      }

      if (Array.isArray(rawFileData.resolved_comments)) {
        for (const resolved of rawFileData.resolved_comments) {
          if (typeof resolved.line === "number" && resolved.line > 0) {
            resolvedComments.push({
              line: resolved.line,
              reason: String(resolved.reason || "Issue addressed"),
            });
          }
        }
      }

      this.logger.debug(
        {
          filename,
          findingsCount: findings.length,
          resolvedCommentsCount: resolvedComments.length,
        },
        "Final file review result"
      );

      results.push({
        filename,
        findings,
        resolvedComments: resolvedComments.length > 0 ? resolvedComments : undefined,
      });
    }

    this.logger.debug(
      {
        filesProcessed: results.length,
        totalFindings: results.reduce((sum, r) => sum + r.findings.length, 0),
      },
      "Final batched results"
    );

    return results;
  }

  private validateSeverity(value: unknown): FileFinding["severity"] {
    const validSeverities = ["critical", "high", "medium", "low"] as const;
    const stringValue = String(value);
    return validSeverities.includes(stringValue as (typeof validSeverities)[number])
      ? (stringValue as FileFinding["severity"])
      : "medium";
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

  private validateConfidence(value: unknown): FindingConfidence {
    const validConfidences = ["high", "medium", "low"] as const;
    const stringValue = String(value);
    return validConfidences.includes(stringValue as (typeof validConfidences)[number])
      ? (stringValue as FindingConfidence)
      : "medium";
  }
}
