import type { CrossFileReviewResult, FileReviewResult } from "../platforms/types.js";

/** Supported AI provider types. */
export type AIProviderType = "copilot" | "opencode" | "cursor";

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
   * @returns Response containing raw output and parsed JSON
   */
  executePrompt(prompt: string): Promise<AIResponse>;

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
}
