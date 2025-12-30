import type { CrossFileReviewResult, FileReviewResult } from "../platforms/types.js";

/** Supported AI provider types. */
export type AIProviderType = "copilot" | "opencode" | "cursor";

/** Response from executing an AI prompt. */
export interface AIResponse {
  readonly raw: string;
  readonly parsed: unknown;
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
}
