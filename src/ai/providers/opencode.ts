import { spawn } from "node:child_process";
import { getAuditLogger } from "../../audit/index.js";
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, RETRY_DELAY_BASE_MS } from "../../constants.js";
import { JsonParseError, ValidationError } from "../../errors/index.js";
import type {
  CrossFileFinding,
  CrossFileReviewResult,
  FileFinding,
  FileReviewResult,
  FindingConfidence,
  ResolvedComment,
} from "../../platforms/types.js";
import type { AIProviderClient, AIProviderOptions, AIResponse } from "../types.js";

/**
 * Error thrown when the OpenCode CLI fails or is unavailable.
 */
export class OpenCodeCliError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "OpenCodeCliError";
  }
}

/** Raw finding structure from OpenCode JSON response. */
interface RawFileFinding {
  line?: unknown;
  severity?: unknown;
  category?: unknown;
  message?: unknown;
  suggestion?: unknown;
  confidence?: unknown;
  isPreExisting?: unknown;
}

/** Raw cross-file finding from OpenCode JSON response. */
interface RawCrossFileFinding {
  severity?: unknown;
  category?: unknown;
  message?: unknown;
  affected_files?: unknown[];
}

/** Raw resolved comment from OpenCode JSON response. */
interface RawResolvedComment {
  line?: unknown;
  reason?: unknown;
}

/** Raw file review response from OpenCode. */
interface RawFileReviewResponse {
  findings?: RawFileFinding[];
  resolved_comments?: RawResolvedComment[];
}

/** Raw cross-file review response from OpenCode. */
interface RawCrossFileReviewResponse {
  overall_assessment?: string;
  findings?: RawCrossFileFinding[];
  recommendations?: unknown[];
}

/**
 * AI provider implementation for OpenCode CLI.
 * Handles retries, JSON parsing, and response validation.
 *
 * OpenCode CLI is invoked as: opencode -p "prompt" [--model <model>]
 */
export class OpenCodeProvider implements AIProviderClient {
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly model?: string;
  private readonly auditLogger = getAuditLogger();

  constructor(options?: AIProviderOptions) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.model = options?.model;
  }

  /**
   * Executes a prompt via OpenCode CLI with automatic retries.
   *
   * @param prompt - The prompt to send to OpenCode
   * @returns Response containing raw output and parsed JSON
   * @throws {ValidationError} When prompt is empty or invalid
   * @throws {OpenCodeCliError} When CLI execution fails after all retries
   */
  async executePrompt(prompt: string): Promise<AIResponse> {
    if (!prompt || prompt.trim().length === 0) {
      throw new ValidationError("prompt", "Prompt cannot be empty");
    }

    const promptType = this.inferPromptType(prompt);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const raw = await this.runCli(prompt);
        const parsed = this.parseJsonResponse(raw);
        this.auditLogger.logAIProviderExecution("opencode", promptType, this.model, "success");
        return { raw, parsed };
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.maxRetries - 1) {
          await this.delay(RETRY_DELAY_BASE_MS * (attempt + 1));
        }
      }
    }

    this.auditLogger.logAIProviderExecution(
      "opencode",
      promptType,
      this.model,
      "failure",
      lastError?.message
    );
    throw new OpenCodeCliError(
      `Failed after ${this.maxRetries} attempts: ${lastError?.message}`,
      lastError ?? undefined
    );
  }

  private inferPromptType(prompt: string): string {
    if (prompt.includes("cross-file")) return "cross-file-review";
    if (prompt.includes("Review the following file")) return "file-review";
    return "unknown";
  }

  private runCli(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const errorChunks: Buffer[] = [];

      const args = ["-p", prompt];
      if (this.model) {
        args.push("--model", this.model);
      }

      // Using array-based args with spawn handles escaping correctly on all platforms
      const proc = spawn("opencode", args, {
        stdio: ["inherit", "pipe", "pipe"],
        timeout: this.timeoutMs,
        shell: false,
      });

      proc.stdout?.on("data", (data: Buffer) => chunks.push(data));
      proc.stderr?.on("data", (data: Buffer) => errorChunks.push(data));

      proc.on("error", (error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new OpenCodeCliError("OpenCode CLI is not installed or not in PATH"));
        } else {
          reject(new OpenCodeCliError("CLI execution failed", error));
        }
      });

      proc.on("close", (code) => {
        const stdout = Buffer.concat(chunks).toString("utf-8");
        const stderr = Buffer.concat(errorChunks).toString("utf-8");

        if (code === 0) {
          resolve(stdout);
        } else if (code === null) {
          reject(
            new OpenCodeCliError(
              `CLI process timed out after ${this.timeoutMs}ms. Consider increasing the timeout or simplifying the review scope.`
            )
          );
        } else {
          reject(new OpenCodeCliError(`Exited with code ${code}: ${stderr || stdout}`));
        }
      });
    });
  }

  private parseJsonResponse(raw: string): unknown {
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

  /**
   * Parses an OpenCode response into a file review result.
   *
   * @param filename - Name of the reviewed file
   * @param response - Raw OpenCode response
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
   * Parses an OpenCode response into a cross-file review result.
   *
   * @param response - Raw OpenCode response
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
