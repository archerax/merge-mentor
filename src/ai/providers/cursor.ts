import { getAuditLogger } from "../../audit/index.js";
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, RETRY_DELAY_BASE_MS } from "../../constants.js";
import { JsonParseError, ValidationError } from "../../errors/index.js";
import { createChildLogger } from "../../logger.js";
import type {
  CrossFileFinding,
  CrossFileReviewResult,
  FileFinding,
  FileReviewResult,
} from "../../platforms/types.js";
import {
  createSystemExecutableFinder,
  type ExecutableFinder,
  nodeProcessRunner,
  type ProcessRunner,
} from "../../ports/index.js";
import type {
  AIProviderClient,
  AIProviderOptions,
  AIResponse,
  ExecutePromptOptions,
  FastReviewResult,
} from "../types.js";

/**
 * Error thrown when the Cursor CLI fails or is unavailable.
 */
export class CursorCliError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "CursorCliError";
  }
}

/** Raw finding structure from Cursor JSON response. */
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

/** Raw cross-file finding from Cursor JSON response. */
interface RawCrossFileFinding {
  severity?: unknown;
  confidence?: unknown;
  category?: unknown;
  message?: unknown;
  reasoning?: unknown;
  affected_files?: unknown[];
}

/** Raw file review response from Cursor. */
interface RawFileReviewResponse {
  findings?: RawFileFinding[];
}

/** Raw cross-file review response from Cursor. */
interface RawCrossFileReviewResponse {
  overall_assessment?: string;
  findings?: RawCrossFileFinding[];
  recommendations?: unknown[];
}

/** Raw batched file review response from Cursor. */
interface RawBatchedFileReviewResponse {
  file_results?: Record<string, RawFileReviewResponse>;
}

/** Raw fast review finding from Cursor. */
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

/** Raw fast review response from Cursor. */
interface RawFastReviewResponse {
  summary?: string;
  findings?: RawFastReviewFinding[];
}

/**
 * AI provider implementation for Cursor CLI (cursor-agent).
 * Handles retries, JSON parsing, and response validation.
 *
 * Cursor CLI is invoked as: cursor-agent -p "prompt" [--model <model>]
 */
export class CursorProvider implements AIProviderClient {
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly model?: string;
  private readonly auditLogger = getAuditLogger();
  private readonly logger = createChildLogger({ component: "CursorProvider" });
  private readonly executableFinder: ExecutableFinder;
  private readonly processRunner: ProcessRunner;

  constructor(options?: AIProviderOptions) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.model = options?.model;
    this.executableFinder = options?.executableFinder ?? createSystemExecutableFinder();
    this.processRunner = options?.processRunner ?? nodeProcessRunner;
  }

  /**
   * Executes a prompt via Cursor CLI with automatic retries.
   *
   * @param prompt - The prompt to send to Cursor
   * @param options - Optional execution context (working directory, diff files)
   * @returns Response containing raw output and parsed JSON
   * @throws {ValidationError} When prompt is empty or invalid
   * @throws {CursorCliError} When CLI execution fails after all retries
   */
  async executePrompt(prompt: string, options?: ExecutePromptOptions): Promise<AIResponse> {
    if (!prompt || prompt.trim().length === 0) {
      throw new ValidationError("prompt", "Prompt cannot be empty");
    }

    const promptType = this.inferPromptType(prompt);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const raw = await this.runCli(prompt, options);
        const parsed = this.parseJsonResponse(raw);
        this.auditLogger.logAIProviderExecution("cursor", promptType, this.model, "success");
        return { raw, parsed };
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.maxRetries - 1) {
          await this.delay(RETRY_DELAY_BASE_MS * (attempt + 1));
        }
      }
    }

    this.auditLogger.logAIProviderExecution(
      "cursor",
      promptType,
      this.model,
      "failure",
      lastError?.message
    );
    throw new CursorCliError(
      `Failed after ${this.maxRetries} attempts: ${lastError?.message}`,
      lastError ?? undefined
    );
  }

  private inferPromptType(prompt: string): string {
    if (prompt.includes("cross-file")) return "cross-file-review";
    if (prompt.includes("Review the following file")) return "file-review";
    return "unknown";
  }

  private runCli(prompt: string, options?: ExecutePromptOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const errorChunks: Buffer[] = [];

      const args = ["-p", prompt];
      if (this.model) {
        args.push("--model", this.model);
      }

      // Resolve the full path to the cursor-agent executable before spawning.
      const executablePath = this.executableFinder.find("cursor-agent");
      if (!executablePath) {
        reject(new CursorCliError("Cursor CLI is not installed or not in PATH"));
        return;
      }

      // On Windows, batch files require shell: true
      const needsShell =
        process.platform === "win32" &&
        (executablePath === "cursor-agent" || !executablePath.toLowerCase().endsWith(".exe"));

      // When using shell: true, pass command and args as a single string
      const proc = needsShell
        ? this.processRunner.spawn(
            executablePath,
            [
              args
                .map((arg) => {
                  if (arg.includes(" ") || arg.includes("&") || arg.includes("|")) {
                    return `"${arg.replace(/"/g, '\\"')}"`;
                  }
                  return arg;
                })
                .join(" "),
            ],
            {
              stdio: ["inherit", "pipe", "pipe"],
              timeout: this.timeoutMs,
              shell: true,
              cwd: options?.workingDirectory,
            }
          )
        : this.processRunner.spawn(executablePath, args, {
            stdio: ["inherit", "pipe", "pipe"],
            timeout: this.timeoutMs,
            shell: false,
            cwd: options?.workingDirectory,
          });

      proc.stdout?.on("data", (data: Buffer) => {
        chunks.push(data);
        options?.onStreamData?.(data.toString("utf-8"));
      });
      proc.stderr?.on("data", (data: Buffer) => errorChunks.push(data));

      proc.on("error", (error) => {
        reject(new CursorCliError(`CLI execution failed: ${error.message}`, error));
      });

      proc.on("close", (code) => {
        const stdout = Buffer.concat(chunks).toString("utf-8");
        const stderr = Buffer.concat(errorChunks).toString("utf-8");

        if (code === 0) {
          resolve(stdout);
        } else if (code === null) {
          reject(
            new CursorCliError(
              `CLI process timed out after ${this.timeoutMs}ms. Consider increasing the timeout or simplifying the review scope.`
            )
          );
        } else {
          reject(new CursorCliError(`Exited with code ${code}: ${stderr || stdout}`));
        }
      });
    });
  }

  private parseJsonResponse(raw: string): unknown {
    // Try to extract JSON from markdown code blocks first
    const markdownMatch = raw.match(/```json\n([\s\S]*?)\n```/);
    if (markdownMatch) {
      try {
        return JSON.parse(markdownMatch[1]);
      } catch (_error) {
        // Fall back to regex if markdown parsing fails
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

  /**
   * Validates the quality of reasoning provided by the AI.
   * Logs warnings for reasoning that doesn't meet verification standards.
   *
   * @param reasoning - The reasoning text to validate
   * @param filename - The file being reviewed (for context in logs)
   * @param lineOrLocation - Line number or location description (for context in logs)
   */
  private validateReasoning(
    reasoning: string,
    filename: string,
    lineOrLocation: string | number
  ): void {
    const minLength = 50;
    const location = typeof lineOrLocation === "number" ? `line ${lineOrLocation}` : lineOrLocation;

    // Check minimum length
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

    // Check for verification keywords
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
   * Parses a Cursor response into a file review result.
   *
   * @param filename - Name of the reviewed file
   * @param response - Raw Cursor response
   * @returns Structured file review result
   */
  parseFileReview(filename: string, response: AIResponse): FileReviewResult {
    const data = response.parsed as RawFileReviewResponse;
    const findings: FileFinding[] = [];

    if (Array.isArray(data.findings)) {
      for (const finding of data.findings) {
        const reasoning = finding.reasoning
          ? String(finding.reasoning)
          : "Reasoning not provided by the model.";

        // Validate reasoning quality
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

    return {
      filename,
      findings,
    };
  }

  /**
   * Parses a Cursor response into a cross-file review result.
   *
   * @param response - Raw Cursor response
   * @returns Structured cross-file review result
   */
  parseCrossFileReview(response: AIResponse): CrossFileReviewResult {
    const data = response.parsed as RawCrossFileReviewResponse;
    const findings: CrossFileFinding[] = [];

    if (Array.isArray(data.findings)) {
      for (const finding of data.findings) {
        const reasoning = finding.reasoning
          ? String(finding.reasoning)
          : "Reasoning not provided by the model.";

        // Validate reasoning quality
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
   * Parses a batched Cursor response containing reviews for multiple files.
   *
   * @param response - Raw Cursor response with file_results object
   * @returns Array of structured file review results
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

          // Validate reasoning quality
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

      results.push({
        filename,
        findings,
      });
    }

    return results;
  }

  /**
   * Parses a fast review response (combined file + cross-file analysis).
   * Splits findings by attribution type into file and cross-file results.
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

          fileFindings.get(file)!.push({
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
      ([filename, findings]) => ({
        filename,
        findings,
      })
    );

    const crossFileResult: CrossFileReviewResult = {
      overallAssessment: String(data.summary || "Review completed"),
      findings: crossFileFindings,
      recommendations: [],
    };

    return {
      fileResults,
      crossFileResult,
    };
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
