import { execSync, spawn } from "node:child_process";
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
} from "../../platforms/types.js";
import type {
  AIProviderClient,
  AIProviderOptions,
  AIResponse,
  ExecutePromptOptions,
  FastReviewResult,
  TokenUsage,
} from "../types.js";

/**
 * Cache for resolved executable paths.
 * Avoids repeated `where`/`which` lookups during a session.
 */
const executablePathCache = new Map<string, string>();

/**
 * Resolves the full path to an executable by searching PATH.
 * Uses `where` on Windows, `which` on Unix-like systems.
 * Caches results to avoid repeated lookups.
 *
 * @param command - The command name to resolve (e.g., "copilot")
 * @returns The full path to the executable (or original command if not found/Windows batch file)
 */
function resolveExecutablePath(command: string): string {
  const cached = executablePathCache.get(command);
  if (cached) {
    return cached;
  }

  // On Windows, batch files (.bat, .cmd) cannot be executed with shell: false
  // In this case, just return the command name and we'll use shell: true
  if (process.platform === "win32") {
    try {
      const result = execSync(`where ${command}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5000,
      }).trim();

      // `where` on Windows may return multiple lines; use the first one
      const executablePath = result.split(/\r?\n/)[0].trim();

      // If it's a batch file, return the command name (will use shell: true)
      if (
        executablePath.toLowerCase().endsWith(".bat") ||
        executablePath.toLowerCase().endsWith(".cmd")
      ) {
        executablePathCache.set(command, command);
        return command;
      }

      executablePathCache.set(command, executablePath);
      return executablePath;
    } catch {
      // If where fails, still try the command name with shell
      executablePathCache.set(command, command);
      return command;
    }
  }

  // Unix-like systems: resolve the full path
  try {
    const result = execSync(`which ${command}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    }).trim();

    const executablePath = result.split(/\r?\n/)[0].trim();
    executablePathCache.set(command, executablePath);
    return executablePath;
  } catch {
    throw new Error(`Command "${command}" not found in PATH`);
  }
}

/** Raw finding structure from Copilot JSON response. */
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

/** Raw cross-file finding from Copilot JSON response. */
interface RawCrossFileFinding {
  severity?: unknown;
  confidence?: unknown;
  category?: unknown;
  message?: unknown;
  reasoning?: unknown;
  affected_files?: unknown[];
}

/** Raw file review response from Copilot. */
interface RawFileReviewResponse {
  findings?: RawFileFinding[];
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

/** Raw fast review finding from Copilot. */
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

/** Raw fast review response from Copilot. */
interface RawFastReviewResponse {
  summary?: string;
  findings?: RawFastReviewFinding[];
}

/**
 * AI provider implementation for GitHub Copilot CLI.
 * Handles retries, JSON parsing, and response validation.
 */
export class CopilotProvider implements AIProviderClient {
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly model?: string;
  private readonly token?: string;
  private readonly auditLogger = getAuditLogger();
  private readonly logger = createChildLogger({ component: "CopilotProvider" });
  private readonly defaultTempDir: string;

  constructor(options?: AIProviderOptions) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.model = options?.model;
    this.token = options?.token;
    this.defaultTempDir = path.join(process.cwd(), ".merge-mentor", "temp");
  }

  /**
   * Executes a prompt via Copilot CLI with automatic retries.
   *
   * @param prompt - The prompt to send to Copilot
   * @param options - Optional execution context (working directory, diff files)
   * @returns Response containing raw output and parsed JSON
   * @throws {ValidationError} When prompt is empty or invalid
   * @throws {CopilotCliError} When CLI execution fails after all retries
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
          // Store prompt in temp file and have agent write JSON to output file
          // This allows the agent to think, explore, and use tools freely
          tempFile = await this.createTempPromptFile(prompt, options?.workingDirectory);
          outputFile = await this.createTempOutputFile(options?.workingDirectory);

          // Use relative path if inside workspace, otherwise absolute path
          const fileRef = options?.workingDirectory
            ? `.merge-mentor/temp/${path.basename(tempFile)}`
            : tempFile;
          const outputRef = options?.workingDirectory
            ? `.merge-mentor/temp/${path.basename(outputFile)}`
            : outputFile;

          const shortPrompt = `Please follow the instructions in @${fileRef} and write your JSON output to ${outputRef}. You may use tools to explore and analyze, but your final JSON response must be written to the output file.`;
          const { stdout, stderr } = await this.runCli(shortPrompt, options, tempFile);

          // Read JSON from output file instead of parsing stdout
          const jsonContent = await this.readOutputFile(outputFile);
          const parsed = this.parseJsonResponse(jsonContent);
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
        } catch (error) {
          lastError = error as Error;
          this.logger.warn(
            {
              attempt: attempt + 1,
              maxRetries: this.maxRetries,
              error: lastError.message,
              willRetry: attempt < this.maxRetries - 1,
            },
            "Copilot CLI execution attempt failed"
          );
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
      // Clean up temp files
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

  /**
   * Creates a temporary file for the prompt.
   * When workspaceDir is provided, creates the file inside the workspace's .merge-mentor directory
   * so that Copilot CLI can access it via @file reference.
   */
  private async createTempPromptFile(prompt: string, workspaceDir?: string): Promise<string> {
    // If workspaceDir is provided, store temp files inside the repo so Copilot can access them
    const tempDir = workspaceDir
      ? path.join(workspaceDir, ".merge-mentor", "temp")
      : this.defaultTempDir;

    await fs.mkdir(tempDir, { recursive: true });
    const filename = `prompt-${Date.now()}-${Math.random().toString(36).substring(7)}.md`;
    const filepath = path.join(tempDir, filename);
    await fs.writeFile(filepath, prompt, "utf-8");
    return filepath;
  }

  /**
   * Creates a temporary output file for the agent to write JSON results.
   * Uses the same directory logic as prompt files.
   */
  private async createTempOutputFile(workspaceDir?: string): Promise<string> {
    const tempDir = workspaceDir
      ? path.join(workspaceDir, ".merge-mentor", "temp")
      : this.defaultTempDir;

    await fs.mkdir(tempDir, { recursive: true });
    const filename = `output-${Date.now()}-${Math.random().toString(36).substring(7)}.json`;
    const filepath = path.join(tempDir, filename);
    // Create empty file
    await fs.writeFile(filepath, "", "utf-8");
    return filepath;
  }

  /**
   * Reads JSON content from the output file written by the agent.
   */
  private async readOutputFile(filepath: string): Promise<string> {
    try {
      const content = await fs.readFile(filepath, "utf-8");
      if (!content || content.trim().length === 0) {
        throw new Error("Output file is empty");
      }
      return content;
    } catch (error) {
      throw new CopilotCliError(
        `Failed to read output file: ${(error as Error).message}`,
        error as Error
      );
    }
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
    options?: ExecutePromptOptions,
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
      const env = this.token ? { ...process.env, GITHUB_TOKEN: this.token } : process.env;

      // Determine working directory:
      // - If workingDirectory provided in options, use it (enables @workspace access to cloned repo)
      // - Otherwise, use current working directory
      // Note: We now use absolute paths for @file references, so temp files work regardless of cwd
      const cwd = options?.workingDirectory;

      // Resolve the full path to the copilot executable before spawning.
      // This ensures the command is found even when cwd is different from the current process.
      let executablePath: string;
      try {
        executablePath = resolveExecutablePath("copilot");
      } catch {
        reject(new CopilotCliError("Copilot CLI is not installed or not in PATH."));
        return;
      }

      this.logger.debug(
        {
          command: executablePath,
          args: args,
          cwd: cwd || process.cwd(),
          hasToken: !!this.token,
          model: this.model,
          tempFilePath,
        },
        "Spawning Copilot CLI process"
      );

      // On Windows, batch files (.bat, .cmd) require shell: true
      // If executablePath is just the command name (e.g., "copilot"), use shell: true
      // If it's a full path to an .exe, use shell: false
      const needsShell =
        process.platform === "win32" &&
        (executablePath === "copilot" || !executablePath.toLowerCase().endsWith(".exe"));

      // When using shell: true, pass command and args as a single string to avoid
      // DEP0190 warning and ensure proper escaping
      const proc = needsShell
        ? spawn(
            executablePath,
            [
              args
                .map((arg) => {
                  // Quote arguments that contain spaces or special characters
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
              cwd,
              env,
            }
          )
        : spawn(executablePath, args, {
            stdio: ["inherit", "pipe", "pipe"],
            timeout: this.timeoutMs,
            shell: false,
            cwd,
            env,
          });

      proc.stdout?.on("data", (data: Buffer) => {
        chunks.push(data);
        options?.onStreamData?.(data.toString("utf-8"));
      });
      proc.stderr?.on("data", (data: Buffer) => errorChunks.push(data));

      proc.on("error", (error) => {
        const errorCode = (error as NodeJS.ErrnoException).code;

        this.logger.error(
          {
            error: error.message,
            errorCode,
            command: executablePath,
            args: args,
            cwd: cwd || process.cwd(),
            platform: process.platform,
          },
          "Copilot CLI process error"
        );

        reject(new CopilotCliError(`CLI execution failed: ${error.message}`, error));
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

      this.logger.debug(
        {
          filename,
          findingsCount: findings.length,
        },
        "Final file review result"
      );

      results.push({
        filename,
        findings,
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

  /**
   * Parses a fast review response (combined file + cross-file analysis).
   * Splits findings by attribution type into file and cross-file results.
   *
   * @param response - Raw Copilot response with flat findings list
   * @returns Combined file and cross-file review results
   */
  parseFastReview(response: AIResponse): FastReviewResult {
    const data = response.parsed as RawFastReviewResponse;

    // Group findings by file, separating general findings
    const fileFindings = new Map<string, FileFinding[]>();
    const crossFileFindings: CrossFileFinding[] = [];

    if (Array.isArray(data.findings)) {
      for (const finding of data.findings) {
        const file = finding.file ? String(finding.file) : undefined;
        const line = typeof finding.line === "number" ? finding.line : undefined;

        const reasoning = finding.reasoning
          ? String(finding.reasoning)
          : "Reasoning not provided by the model.";

        // Validate reasoning quality
        if (finding.reasoning) {
          const context = file ? (line ? `${file}:${line}` : file) : "cross-file";
          this.validateReasoning(reasoning, context, line || "general");
        }

        // Determine if this is a file-level or cross-file finding
        if (file) {
          // File-level finding (with or without line number)
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
          // Cross-file/general finding
          crossFileFindings.push({
            severity: this.validateSeverity(finding.severity),
            confidence: this.validateConfidence(finding.confidence),
            category: this.validateCrossFileCategory(finding.category),
            message: String(finding.message || ""),
            reasoning,
            affectedFiles: [], // No specific files attributed
          });
        }
      }
    }

    // Convert map to file results array
    const fileResults: FileReviewResult[] = Array.from(fileFindings.entries()).map(
      ([filename, findings]) => ({
        filename,
        findings,
      })
    );

    // Build cross-file result
    const crossFileResult: CrossFileReviewResult = {
      overallAssessment: String(data.summary || "Review completed"),
      findings: crossFileFindings,
      recommendations: [], // Fast review doesn't separate recommendations
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
