import type { CrossFileReviewResult, FileReviewResult } from "../platforms/types.js";
import type { Clock } from "../ports/clock.js";
import type { ExecutableFinder } from "../ports/executableFinder.js";
import type { FileSystem } from "../ports/fileSystem.js";
import type { ProcessRunner } from "../ports/processRunner.js";

/** Combined result from fast review (single-pass file + cross-file analysis). */
export interface FastReviewResult {
  readonly fileResults: FileReviewResult[];
  readonly crossFileResult: CrossFileReviewResult;
}

/** Supported AI provider types. */
export type AIProviderType = "copilot" | "copilot-sdk" | "opencode" | "opencode-sdk";

/** Token usage statistics from AI provider execution. */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens?: number;
  readonly premiumRequests?: number;
  readonly model?: string;
  readonly durationApiSeconds?: number;
  readonly durationWallSeconds?: number;
}

/** Response from executing an AI prompt. */
export interface AIResponse {
  readonly raw: string;
  readonly parsed: unknown;
  readonly tokenUsage?: TokenUsage;
}

/** Options for configuring AI providers. */
export interface AIProviderOptions {
  readonly maxRetries?: number;
  readonly timeoutMs?: number;
  readonly model?: string;
  readonly token?: string;
  /** Base path for temporary files (temp, transcripts). */
  readonly tempPath?: string;
  /** Finds executables on PATH (defaults to system finder). */
  readonly executableFinder?: ExecutableFinder;
  /** Runs child processes (defaults to node child_process). */
  readonly processRunner?: ProcessRunner;
  /** Filesystem operations (defaults to node fs/promises). */
  readonly fileSystem?: FileSystem;
  /** System clock (defaults to real clock). */
  readonly clock?: Clock;
}

/** Options for executing a prompt with additional context. */
export interface ExecutePromptOptions {
  /** Path to cloned repository for workspace access. */
  readonly workingDirectory?: string;
  /** Paths to diff files for @file references. */
  readonly diffFiles?: string[];
  /** Optional callback invoked with streaming output data chunks. */
  readonly onStreamData?: (chunk: string) => void;
  /** Hint for the type of review prompt being sent (avoids substring inference). */
  readonly promptType?: "file-review" | "cross-file-review" | "batched-file-review" | "fast-review";
}

/**
 * Interface for AI provider implementations.
 * All providers must implement this interface for consistent behavior.
 */
export interface AIProviderClient {
  /**
   * Executes a prompt via the AI provider CLI with automatic retries.
   *
   * @param prompt - The prompt to send to the AI provider
   * @param options - Optional execution context (working directory, diff files)
   * @returns Response containing raw output and parsed JSON
   */
  executePrompt(prompt: string, options?: ExecutePromptOptions): Promise<AIResponse>;

  /**
   * Parses an AI response into a file review result.
   *
   * @param filename - Name of the reviewed file
   * @param response - Raw AI response
   * @returns Structured file review result
   */
  parseFileReview(filename: string, response: AIResponse): FileReviewResult;

  /**
   * Parses an AI response into a cross-file review result.
   *
   * @param response - Raw AI response
   * @returns Structured cross-file review result
   */
  parseCrossFileReview(response: AIResponse): CrossFileReviewResult;

  /**
   * Parses an AI response containing batched file reviews into multiple results.
   * Used for batched review mode where all files are reviewed in a single AI call.
   *
   * @param response - Raw AI response containing results for multiple files
   * @returns Array of structured file review results
   */
  parseBatchedFileReview(response: AIResponse): FileReviewResult[];

  /**
   * Parses an AI response from fast review (combined file + cross-file analysis).
   * Splits the flat findings list into file-level and cross-file results.
   *
   * @param response - Raw AI response containing combined findings
   * @returns Combined file and cross-file review results
   */
  parseFastReview(response: AIResponse): FastReviewResult;
}
