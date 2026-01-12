import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { getAuditLogger } from "../../audit/index.js";
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, RETRY_DELAY_BASE_MS } from "../../constants.js";
import { CopilotCliError, JsonParseError, ValidationError } from "../../errors/index.js";
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

/** Raw batched file review response from Copilot. */
interface RawBatchedFileReviewResponse {
  file_results?: Record<string, RawFileReviewResponse>;
}

/**
 * Threshold for prompt length - prompts longer than this will use temp files.
 * CLI arguments have platform-specific limits (typically 8KB-128KB).
 */
const PROMPT_LENGTH_THRESHOLD = 100;

/**
 * AI provider implementation for GitHub Copilot CLI.
 * Handles retries, JSON parsing, and response validation.
 */
export class CopilotProvider implements AIProviderClient {
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly model?: string;
  private readonly auditLogger = getAuditLogger();
  private readonly logger = createChildLogger({ component: "CopilotProvider" });
  private readonly tempDir: string;

  constructor(options?: AIProviderOptions) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.model = options?.model;
    this.tempDir = path.join(process.cwd(), ".merge-mentor", "temp");
  }

  /**
   * Executes a prompt via Copilot CLI with automatic retries.
   *
   * @param prompt - The prompt to send to Copilot
   * @returns Response containing raw output and parsed JSON
   * @throws {ValidationError} When prompt is empty or invalid
   * @throws {CopilotCliError} When CLI execution fails after all retries
   */
  async executePrompt(prompt: string): Promise<AIResponse> {
    if (!prompt || prompt.trim().length === 0) {
      throw new ValidationError("prompt", "Prompt cannot be empty.");
    }

    const promptType = this.inferPromptType(prompt);
    let lastError: Error | null = null;
    let tempFile: string | undefined;

    try {
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          // Use temp file for large prompts to avoid CLI argument length limits
          if (prompt.length > PROMPT_LENGTH_THRESHOLD) {
            tempFile = await this.createTempPromptFile(prompt);
            const shortPrompt = `Please follow the instructions in @${path.basename(tempFile)}`;
            const { stdout, stderr } = await this.runCli(shortPrompt, tempFile);
            const parsed = this.parseJsonResponse(stdout);
            const tokenUsage = this.parseTokenUsage(stderr);
            this.auditLogger.logAIProviderExecution(
              "copilot",
              promptType,
              this.model,
              "success",
              undefined,
              tokenUsage
            );
            return { raw: stdout, parsed, tokenUsage };
          } else {
            const { stdout, stderr } = await this.runCli(prompt);
            const parsed = this.parseJsonResponse(stdout);
            const tokenUsage = this.parseTokenUsage(stderr);
            this.auditLogger.logAIProviderExecution(
              "copilot",
              promptType,
              this.model,
              "success",
              undefined,
              tokenUsage
            );
            return { raw: stdout, parsed, tokenUsage };
          }
        } catch (error) {
          lastError = error as Error;
          if (attempt < this.maxRetries - 1) {
            await this.delay(RETRY_DELAY_BASE_MS * (attempt + 1));
          }
        }
      }

      this.auditLogger.logAIProviderExecution(
        "copilot",
        promptType,
        this.model,
        "failure",
        lastError?.message
      );
      throw new CopilotCliError(
        `Failed after ${this.maxRetries} attempts: ${lastError?.message}`,
        lastError ?? undefined
      );
    } finally {
      // Clean up temp file
      if (tempFile) {
        await this.deleteTempFile(tempFile);
      }
    }
  }

  private inferPromptType(prompt: string): string {
    if (prompt.includes("cross-file")) return "cross-file-review";
    if (prompt.includes("Review the following file")) return "file-review";
    return "unknown";
  }

  private async createTempPromptFile(prompt: string): Promise<string> {
    await fs.mkdir(this.tempDir, { recursive: true });
    const filename = `prompt-${Date.now()}-${Math.random().toString(36).substring(7)}.md`;
    const filepath = path.join(this.tempDir, filename);
    await fs.writeFile(filepath, prompt, "utf-8");
    return filepath;
  }

  private async deleteTempFile(filepath: string): Promise<void> {
    try {
      await fs.unlink(filepath);
    } catch (_error) {
      // Ignore deletion errors - temp files will be cleaned up eventually
    }
  }

  private runCli(
    prompt: string,
    tempFilePath?: string
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const errorChunks: Buffer[] = [];

      const args = ["-p", prompt];
      if (this.model) {
        args.push("--model", this.model);
      }

      // Add --allow-all-tools when using temp files so Copilot can read them
      if (tempFilePath) {
        args.push("--allow-all-tools");
      }

      // Using array-based args with spawn handles escaping correctly on all platforms (Windows, macOS, Linux)
      // Node.js will automatically handle .exe extension on Windows
      const proc = spawn("copilot", args, {
        stdio: ["inherit", "pipe", "pipe"],
        timeout: this.timeoutMs,
        shell: false, // Explicit shell: false ensures consistent cross-platform behavior
        cwd: tempFilePath ? this.tempDir : undefined, // Run from temp dir to use relative paths
      });

      proc.stdout?.on("data", (data: Buffer) => chunks.push(data));
      proc.stderr?.on("data", (data: Buffer) => errorChunks.push(data));

      proc.on("error", (error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new CopilotCliError("Copilot CLI is not installed or not in PATH."));
        } else {
          reject(new CopilotCliError("CLI execution failed.", error));
        }
      });

      proc.on("close", (code) => {
        const stdout = Buffer.concat(chunks).toString("utf-8");
        const stderr = Buffer.concat(errorChunks).toString("utf-8");

        if (code === 0) {
          resolve({ stdout, stderr });
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
    this.logger.debug(
      {
        responseLength: raw.length,
        responsePreview: raw.substring(0, 500),
        responseSuffix: raw.substring(Math.max(0, raw.length - 500)),
      },
      "Parsing JSON response"
    );

    // Try to extract JSON from markdown code blocks first
    const markdownMatch = raw.match(/```json\n([\s\S]*?)\n```/);
    if (markdownMatch) {
      this.logger.debug(
        {
          jsonLength: markdownMatch[1].length,
          jsonPreview: markdownMatch[1].substring(0, 300),
        },
        "Extracted JSON from markdown code block"
      );
      try {
        const parsed = JSON.parse(markdownMatch[1]);
        this.logger.debug({ parsedKeys: Object.keys(parsed) }, "JSON parsing successful");
        return parsed;
      } catch (error) {
        this.logger.warn(
          { error: (error as Error).message },
          "Failed to parse JSON from markdown block, falling back to regex"
        );
      }
    }

    // Fallback: finding the first '{' and last '}'
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
      "Extracted JSON for parsing (regex fallback)"
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

  /**
   * Parses token usage statistics from Copilot CLI stderr output.
   *
   * Example output:
   * ```
   * Total usage est:       0 Premium requests
   * Total duration (API):  21s
   * Total duration (wall): 26s
   * Usage by model:
   *     gpt-5-mini           33.0k input, 773 output, 22.0k cache read (Est. 0 Premium requests)
   * ```
   *
   * @param stderr - Stderr output from Copilot CLI
   * @returns Parsed token usage statistics, or undefined if not found
   */
  private parseTokenUsage(stderr: string): TokenUsage | undefined {
    if (!stderr || stderr.trim().length === 0) {
      return undefined;
    }

    try {
      let premiumRequests: number | undefined;
      let durationApiSeconds: number | undefined;
      let durationWallSeconds: number | undefined;
      let model: string | undefined;
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let cachedTokens: number | undefined;

      // Parse premium requests: "Total usage est:       0 Premium requests"
      const premiumMatch = stderr.match(/Total usage est:\s+(\d+)\s+Premium requests/);
      if (premiumMatch) {
        premiumRequests = Number.parseInt(premiumMatch[1], 10);
      }

      // Parse API duration: "Total duration (API):  21s"
      const apiDurationMatch = stderr.match(/Total duration \(API\):\s+(\d+)s/);
      if (apiDurationMatch) {
        durationApiSeconds = Number.parseInt(apiDurationMatch[1], 10);
      }

      // Parse wall duration: "Total duration (wall): 26s"
      const wallDurationMatch = stderr.match(/Total duration \(wall\):\s+(\d+)s/);
      if (wallDurationMatch) {
        durationWallSeconds = Number.parseInt(wallDurationMatch[1], 10);
      }

      // Parse usage by model: "gpt-5-mini           33.0k input, 773 output, 22.0k cache read"
      const usageMatch = stderr.match(
        /^\s+([a-z0-9-]+)\s+([\d.]+[kKmM]?)\s+input,\s+(\d+)\s+output(?:,\s+([\d.]+[kKmM]?)\s+cache read)?/m
      );
      if (usageMatch) {
        model = usageMatch[1];
        inputTokens = this.parseTokenCount(usageMatch[2]);
        outputTokens = Number.parseInt(usageMatch[3], 10);
        if (usageMatch[4]) {
          cachedTokens = this.parseTokenCount(usageMatch[4]);
        }
      }

      // Return undefined if no usage data was found
      if (inputTokens === undefined && outputTokens === undefined) {
        return undefined;
      }

      // Return TokenUsage object with all parsed data
      return {
        inputTokens: inputTokens ?? 0,
        outputTokens: outputTokens ?? 0,
        cachedTokens,
        premiumRequests,
        model,
        durationApiSeconds,
        durationWallSeconds,
      };
    } catch (error) {
      this.logger.warn({ error: (error as Error).message, stderr }, "Failed to parse token usage");
      return undefined;
    }
  }

  /**
   * Parses token count strings like "33.0k" or "22.0k" into numbers.
   */
  private parseTokenCount(value: string): number {
    const num = Number.parseFloat(value);
    if (value.toLowerCase().includes("k")) {
      return Math.round(num * 1000);
    }
    if (value.toLowerCase().includes("m")) {
      return Math.round(num * 1000000);
    }
    return Math.round(num);
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
   * Parses a Copilot response into a cross-file review result.
   *
   * @param response - Raw Copilot response
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
   * Parses a batched Copilot response containing reviews for multiple files.
   *
   * @param response - Raw Copilot response with file_results object
   * @returns Array of structured file review results
   */
  parseBatchedFileReview(response: AIResponse): FileReviewResult[] {
    // DEBUG: Log raw response for debugging
    this.logger.debug(
      {
        rawResponseLength: response.raw?.length || 0,
        rawResponsePreview: response.raw?.substring(0, 1000),
        parsedResponse: response.parsed,
      },
      "Copilot response details"
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
