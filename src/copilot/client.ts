import { spawn } from "node:child_process";
import { getAuditLogger } from "../audit/index.js";
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, RETRY_DELAY_BASE_MS } from "../constants.js";
import { CopilotCliError, JsonParseError, ValidationError } from "../errors/index.js";
import type {
  CrossFileFinding,
  CrossFileReviewResult,
  FileFinding,
  FileReviewResult,
  FindingConfidence,
  ResolvedComment,
} from "../platforms/types.js";

/** Response from executing a Copilot prompt. */
export interface CopilotResponse {
  readonly raw: string;
  readonly parsed: unknown;
}

/** Options for configuring CopilotClient. */
export interface CopilotClientOptions {
  readonly maxRetries?: number;
  readonly timeoutMs?: number;
  readonly model?: string;
}

/** Raw finding structure from Copilot JSON response. */
interface RawFileFinding {
  line?: unknown;
  severity?: unknown;
  category?: unknown;
  message?: unknown;
  suggestion?: unknown;
  confidence?: unknown;
  isPreExisting?: unknown;
}

/** Raw cross-file finding from Copilot JSON response. */
interface RawCrossFileFinding {
  severity?: unknown;
  category?: unknown;
  message?: unknown;
  affected_files?: unknown[];
}

/** Raw resolved comment from Copilot JSON response. */
interface RawResolvedComment {
  line?: unknown;
  reason?: unknown;
}

/** Raw file review response from Copilot. */
interface RawFileReviewResponse {
  findings?: RawFileFinding[];
  resolved_comments?: RawResolvedComment[];
}

/** Raw cross-file review response from Copilot. */
interface RawCrossFileReviewResponse {
  overall_assessment?: string;
  findings?: RawCrossFileFinding[];
  recommendations?: unknown[];
}

/**
 * Client for executing prompts via the GitHub Copilot CLI.
 * Handles retries, JSON parsing, and response validation.
 */
export class CopilotClient {
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly model?: string;
  private readonly auditLogger = getAuditLogger();

  constructor(options?: CopilotClientOptions) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.model = options?.model;
  }

  /**
   * Executes a prompt via Copilot CLI with automatic retries.
   *
   * @param prompt - The prompt to send to Copilot
   * @returns Response containing raw output and parsed JSON
   * @throws {ValidationError} When prompt is empty or invalid
   * @throws {CopilotCliError} When CLI execution fails after all retries
   */
  async executePrompt(prompt: string): Promise<CopilotResponse> {
    if (!prompt || prompt.trim().length === 0) {
      throw new ValidationError("prompt", "Prompt cannot be empty");
    }

    const promptType = this.inferPromptType(prompt);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const raw = await this.runCopilotCli(prompt);
        const parsed = this.parseJsonResponse(raw);
        this.auditLogger.logCopilotExecution(promptType, this.model, "success");
        return { raw, parsed };
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.maxRetries - 1) {
          await this.delay(RETRY_DELAY_BASE_MS * (attempt + 1));
        }
      }
    }

    this.auditLogger.logCopilotExecution(promptType, this.model, "failure", lastError?.message);
    throw new CopilotCliError(
      `Failed after ${this.maxRetries} attempts: ${lastError?.message}`,
      lastError ?? undefined
    );
  }

  private inferPromptType(prompt: string): string {
    if (prompt.includes("cross-file")) return "cross-file-review";
    if (prompt.includes("Review the following file")) return "file-review";
    return "unknown";
  }

  private runCopilotCli(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const errorChunks: Buffer[] = [];

      const args = ["-p", prompt];
      if (this.model) {
        args.push("--model", this.model);
      }

      // Using array-based args with spawn handles escaping correctly on all platforms (Windows, macOS, Linux)
      // Node.js will automatically handle .exe extension on Windows
      const proc = spawn("copilot", args, {
        stdio: ["inherit", "pipe", "pipe"],
        timeout: this.timeoutMs,
        shell: false, // Explicit shell: false ensures consistent cross-platform behavior
      });

      proc.stdout?.on("data", (data: Buffer) => chunks.push(data));
      proc.stderr?.on("data", (data: Buffer) => errorChunks.push(data));

      proc.on("error", (error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new CopilotCliError("Copilot CLI is not installed or not in PATH"));
        } else {
          reject(new CopilotCliError("CLI execution failed", error));
        }
      });

      proc.on("close", (code) => {
        const stdout = Buffer.concat(chunks).toString("utf-8");
        const stderr = Buffer.concat(errorChunks).toString("utf-8");

        if (code === 0) {
          resolve(stdout);
        } else if (code === null) {
          reject(
            new CopilotCliError(
              `CLI process timed out after ${this.timeoutMs}ms. Consider increasing the timeout or simplifying the review scope.`
            )
          );
        } else {
          reject(new CopilotCliError(`Exited with code ${code}: ${stderr || stdout}`));
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
   * Parses a Copilot response into a file review result.
   *
   * @param filename - Name of the reviewed file
   * @param response - Raw Copilot response
   * @returns Structured file review result
   *
   * @example
   * ```typescript
   * const client = new CopilotClient();
   * const response = await client.executePrompt(prompt);
   * const review = client.parseFileReview('src/app.ts', response);
   * console.log(`Found ${review.findings.length} issues in ${review.filename}`);
   * ```
   */
  parseFileReview(filename: string, response: CopilotResponse): FileReviewResult {
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
   * Parses a Copilot response into a cross-file review result.
   *
   * @param response - Raw Copilot response
   * @returns Structured cross-file review result
   *
   * @example
   * ```typescript
   * const client = new CopilotClient();
   * const response = await client.executePrompt(crossFilePrompt);
   * const review = client.parseCrossFileReview(response);
   * console.log(review.overallAssessment);
   * console.log(`${review.recommendations.length} recommendations`);
   * ```
   */
  parseCrossFileReview(response: CopilotResponse): CrossFileReviewResult {
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
