import path from "node:path";
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
import { type Clock, type FileSystem, nodeFs, systemClock } from "../../ports/index.js";
import type {
  AIProviderClient,
  AIProviderOptions,
  AIResponse,
  ExecutePromptOptions,
  FastReviewResult,
  TokenUsage,
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

/**
 * AI provider implementation using the @github/copilot-sdk package.
 *
 * Uses the same file-on-disk pattern as the CopilotProvider:
 * 1. Writes the full prompt to a temp `.md` file
 * 2. Creates an empty output `.json` file
 * 3. Creates a CopilotClient session and sends a short prompt referencing those files
 * 4. Reads the JSON result from the output file
 *
 * This avoids subprocess spawning while keeping the same review logic.
 */
export class CopilotSdkProvider implements AIProviderClient {
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly model?: string;
  private readonly auditLogger = getAuditLogger();
  private readonly logger = createChildLogger({ component: "CopilotSdkProvider" });
  private readonly defaultTempDir: string;
  private readonly transcriptDir: string;
  private readonly fileSystem: FileSystem;
  private readonly clock: Clock;

  constructor(options?: AIProviderOptions) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.model = options?.model;
    const tempPath = options?.tempPath ?? path.join(process.cwd(), ".mergementor");
    this.defaultTempDir = path.join(tempPath, "temp");
    this.transcriptDir = path.join(tempPath, "transcripts");
    this.fileSystem = options?.fileSystem ?? nodeFs;
    this.clock = options?.clock ?? systemClock;
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

    const promptType = this.inferPromptType(prompt);
    let lastError: Error | null = null;
    let tempFile: string | undefined;
    let outputFile: string | undefined;

    try {
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          tempFile = await this.createTempPromptFile(prompt, options?.workingDirectory);
          outputFile = await this.createTempOutputFile(options?.workingDirectory);

          const fileRef = options?.workingDirectory
            ? `.mergementor/temp/${path.basename(tempFile)}`
            : tempFile;
          const outputRef = options?.workingDirectory
            ? `.mergementor/temp/${path.basename(outputFile)}`
            : outputFile;

          const shortPrompt = `Please follow the instructions in @${fileRef} and write your JSON output to ${outputRef}. You may use tools to explore and analyze, but your final JSON response must be written to the output file.`;

          const { content, tokenUsage } = await this.runSdk(shortPrompt, options, tempFile);

          const jsonContent = await this.readOutputFile(outputFile);
          const parsed = this.parseJsonResponse(jsonContent);

          await this.saveTranscript({
            prompt,
            content,
            jsonOutput: jsonContent,
            tokenUsage,
            success: true,
          });

          this.auditLogger.logAIProviderExecution(
            "copilot-sdk",
            promptType,
            this.model,
            "success",
            undefined,
            tokenUsage
          );
          return { raw: content, parsed, tokenUsage };
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

      await this.saveTranscript({
        prompt,
        content: "",
        jsonOutput: "",
        success: false,
        error: lastError?.message,
      });

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
    } finally {
      if (tempFile) {
        await this.deleteTempFile(tempFile);
      }
      if (outputFile) {
        await this.deleteTempFile(outputFile);
      }
    }
  }

  private inferPromptType(prompt: string): string {
    if (prompt.includes("cross-file")) return "cross-file-review";
    if (prompt.includes("Review the following file")) return "file-review";
    return "unknown";
  }

  private async runSdk(
    prompt: string,
    options?: ExecutePromptOptions,
    tempFilePath?: string
  ): Promise<{ content: string; tokenUsage?: TokenUsage }> {
    const client = new CopilotClient();
    try {
      const sessionConfig: Parameters<CopilotClient["createSession"]>[0] = {
        model: this.model,
        workingDirectory: options?.workingDirectory,
        streaming: true,
      };

      const session = await client.createSession(sessionConfig);

      const chunks: string[] = [];
      const unsubscribe = session.on("assistant.message_delta", (event) => {
        const delta = event.data.deltaContent;
        if (delta) {
          chunks.push(delta);
          options?.onStreamData?.(delta);
        }
      });

      const attachments: Array<{ type: "file"; path: string }> = [];
      if (tempFilePath) {
        attachments.push({ type: "file", path: tempFilePath });
      }
      if (options?.diffFiles) {
        for (const diffFile of options.diffFiles) {
          attachments.push({ type: "file", path: diffFile });
        }
      }

      const response = await session.sendAndWait(
        { prompt, ...(attachments.length > 0 ? { attachments } : {}) },
        this.timeoutMs
      );

      unsubscribe();
      await session.destroy();

      const content = response?.data.content ?? chunks.join("");
      return { content };
    } finally {
      await client.stop();
    }
  }

  private async createTempPromptFile(prompt: string, workspaceDir?: string): Promise<string> {
    const tempDir = workspaceDir
      ? path.join(workspaceDir, ".mergementor", "temp")
      : this.defaultTempDir;

    await this.fileSystem.mkdir(tempDir, { recursive: true });
    const filename = `prompt-${this.clock.epochMs()}-${Math.random().toString(36).substring(7)}.md`;
    const filepath = path.join(tempDir, filename);
    await this.fileSystem.writeFile(filepath, prompt, "utf-8");
    return filepath;
  }

  private async createTempOutputFile(workspaceDir?: string): Promise<string> {
    const tempDir = workspaceDir
      ? path.join(workspaceDir, ".mergementor", "temp")
      : this.defaultTempDir;

    await this.fileSystem.mkdir(tempDir, { recursive: true });
    const filename = `output-${this.clock.epochMs()}-${Math.random().toString(36).substring(7)}.json`;
    const filepath = path.join(tempDir, filename);
    await this.fileSystem.writeFile(filepath, "", "utf-8");
    return filepath;
  }

  private async readOutputFile(filepath: string): Promise<string> {
    try {
      const content = await this.fileSystem.readFile(filepath, "utf-8");
      if (!content || content.trim().length === 0) {
        throw new Error("Output file is empty");
      }
      return content;
    } catch (error) {
      throw new CopilotSdkError(
        `Failed to read output file: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  private async deleteTempFile(filepath: string): Promise<void> {
    try {
      await this.fileSystem.unlink(filepath);
    } catch {
      // Ignore deletion errors - temp files will be cleaned up eventually
    }
  }

  private async saveTranscript(data: {
    prompt: string;
    content: string;
    jsonOutput: string;
    tokenUsage?: TokenUsage;
    success: boolean;
    error?: string;
  }): Promise<void> {
    try {
      await this.fileSystem.mkdir(this.transcriptDir, { recursive: true });

      const timestamp = this.clock.timestamp().replace(/[:.]/g, "-");
      const status = data.success ? "success" : "failure";
      const filename = `transcript-sdk-${timestamp}-${status}.txt`;
      const filepath = path.join(this.transcriptDir, filename);

      const transcript = [
        "=".repeat(80),
        "COPILOT SDK PROVIDER TRANSCRIPT",
        "=".repeat(80),
        `Timestamp: ${this.clock.timestamp()}`,
        `Status: ${status}`,
        `Model: ${this.model || "default"}`,
        data.tokenUsage ? `Token Usage: ${JSON.stringify(data.tokenUsage, null, 2)}` : "",
        "",
        "=".repeat(80),
        "INPUT PROMPT",
        "=".repeat(80),
        data.prompt,
        "",
        "=".repeat(80),
        "SDK RESPONSE",
        "=".repeat(80),
        data.content || "(empty)",
        "",
        "=".repeat(80),
        "JSON OUTPUT",
        "=".repeat(80),
        data.jsonOutput || "(empty)",
      ];

      if (data.error) {
        transcript.push("", "=".repeat(80), "ERROR", "=".repeat(80), data.error);
      }

      transcript.push("", "=".repeat(80), "END OF TRANSCRIPT", "=".repeat(80));

      await this.fileSystem.writeFile(filepath, transcript.filter(Boolean).join("\n"), "utf-8");
    } catch (error) {
      this.logger.warn({ error: (error as Error).message }, "Failed to save SDK transcript");
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
