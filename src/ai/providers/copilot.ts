import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { getAuditLogger } from "../../audit/index.js";
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, RETRY_DELAY_BASE_MS } from "../../constants.js";
import { CopilotCliError, ValidationError } from "../../errors/index.js";
import type { CrossFileReviewResult, FileReviewResult } from "../../platforms/types.js";
import {
  parseBatchedFileReview,
  parseCrossFileReview,
  parseFileReview,
  parseJsonFromContent,
  parseTokenUsageFromStderr,
} from "../responseParser.js";
import type {
  AIProviderClient,
  AIProviderOptions,
  AIResponse,
  ExecutePromptOptions,
} from "../types.js";

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
  private readonly token?: string;
  private readonly auditLogger = getAuditLogger();
  private readonly tempDir: string;

  constructor(options?: AIProviderOptions) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.model = options?.model;
    this.token = options?.token;
    this.tempDir = path.join(process.cwd(), ".merge-mentor", "temp");
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

    // Log the full input prompt for debugging
    const logger = await import("../../logger.js").then((m) => m.createChildLogger({ component: "CopilotProvider" }));
    logger.info(
      {
        promptType,
        promptLength: prompt.length,
        fullPrompt: prompt,
      },
      "FULL INPUT PROMPT - Executing Copilot CLI"
    );

    try {
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          // Use temp file for large prompts to avoid CLI argument length limits
          if (prompt.length > PROMPT_LENGTH_THRESHOLD) {
            tempFile = await this.createTempPromptFile(prompt);
            const shortPrompt = `Please follow the instructions in @${path.basename(tempFile)}`;
            logger.info(
              {
                tempFile,
                shortPrompt,
                originalPromptLength: prompt.length,
              },
              "Using temp file for large prompt"
            );
            const { stdout, stderr } = await this.runCli(shortPrompt, options, tempFile);
            
            // Log the full output for debugging
            logger.info(
              {
                stdoutLength: stdout.length,
                stderrLength: stderr.length,
                fullStdout: stdout,
                fullStderr: stderr,
              },
              "FULL OUTPUT TEXT - Copilot CLI response"
            );
            
            const parsed = parseJsonFromContent(stdout);
            const tokenUsage = parseTokenUsageFromStderr(stderr);
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
            const { stdout, stderr } = await this.runCli(prompt, options);
            
            // Log the full output for debugging
            logger.info(
              {
                stdoutLength: stdout.length,
                stderrLength: stderr.length,
                fullStdout: stdout,
                fullStderr: stderr,
              },
              "FULL OUTPUT TEXT - Copilot CLI response"
            );
            
            const parsed = parseJsonFromContent(stdout);
            const tokenUsage = parseTokenUsageFromStderr(stderr);
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
          logger.error(
            {
              attempt: attempt + 1,
              maxRetries: this.maxRetries,
              error: (error as Error).message,
              errorStack: (error as Error).stack,
            },
            "Execution attempt failed"
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
      // Node.js will automatically handle .exe extension on Windows
      const env = this.token ? { ...process.env, GITHUB_TOKEN: this.token } : process.env;

      // Determine working directory:
      // 1. If workingDirectory provided in options, use it (enables @workspace access)
      // 2. If tempFilePath provided, use temp dir (for @file references to temp files)
      // 3. Otherwise, use current working directory
      const cwd = options?.workingDirectory ?? (tempFilePath ? this.tempDir : undefined);

      const proc = spawn("copilot", args, {
        stdio: ["inherit", "pipe", "pipe"],
        timeout: this.timeoutMs,
        shell: false, // Explicit shell: false ensures consistent cross-platform behavior
        cwd,
        env,
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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Parses a Copilot response into a file review result.
   * Delegates to shared parsing logic.
   */
  parseFileReview(filename: string, response: AIResponse): FileReviewResult {
    return parseFileReview(filename, response);
  }

  /**
   * Parses a Copilot response into a cross-file review result.
   * Delegates to shared parsing logic.
   */
  parseCrossFileReview(response: AIResponse): CrossFileReviewResult {
    return parseCrossFileReview(response);
  }

  /**
   * Parses a batched Copilot response containing reviews for multiple files.
   * Delegates to shared parsing logic.
   */
  parseBatchedFileReview(response: AIResponse): FileReviewResult[] {
    return parseBatchedFileReview(response);
  }
}
