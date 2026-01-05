import { createChildLogger } from "../logger.js";

/**
 * Rate limit handling utilities for API requests.
 */

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30000;

const logger = createChildLogger({ component: "RateLimitHandler" });

export interface RateLimitOptions {
  /** Maximum number of retry attempts. Default: 3 */
  readonly maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff. Default: 1000 */
  readonly baseDelayMs?: number;
  /** Maximum delay in milliseconds. Default: 30000 */
  readonly maxDelayMs?: number;
  /** Custom function to check if error is rate limit related. */
  readonly isRateLimitError?: (error: unknown) => boolean;
  /** Custom function to extract retry-after value from error. */
  readonly extractRetryAfter?: (error: unknown) => number | undefined;
}

interface RateLimitInfo {
  readonly retryAfterMs: number;
  readonly isRateLimit: boolean;
}

/**
 * Checks if an error is a rate limit error (HTTP 429 or similar).
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  // GitHub Octokit errors
  if ("status" in error && error.status === 403) {
    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    return message.toLowerCase().includes("rate limit");
  }

  // Standard 429 responses
  if ("status" in error && error.status === 429) {
    return true;
  }

  // Azure DevOps errors
  if ("statusCode" in error && error.statusCode === 429) {
    return true;
  }

  return false;
}

/**
 * Extracts Retry-After value from error response.
 * Returns milliseconds to wait, or undefined if not available.
 */
export function extractRetryAfter(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;

  // Check response headers for Retry-After
  if ("response" in error && error.response && typeof error.response === "object") {
    const response = error.response;

    if ("headers" in response && response.headers && typeof response.headers === "object") {
      const headers = response.headers as Record<string, unknown>;

      // Retry-After can be in seconds or HTTP-date
      const retryAfter = headers["retry-after"] || headers["Retry-After"];
      if (typeof retryAfter === "string") {
        const seconds = parseInt(retryAfter, 10);
        if (!Number.isNaN(seconds)) {
          return seconds * 1000; // Convert to milliseconds
        }
      }
      if (typeof retryAfter === "number") {
        return retryAfter * 1000;
      }

      // X-RateLimit-Reset (GitHub-style, Unix timestamp)
      const rateLimitReset = headers["x-ratelimit-reset"] || headers["X-RateLimit-Reset"];
      if (typeof rateLimitReset === "string" || typeof rateLimitReset === "number") {
        const resetTime = parseInt(rateLimitReset.toString(), 10);
        if (!Number.isNaN(resetTime)) {
          const now = Math.floor(Date.now() / 1000);
          const delaySeconds = Math.max(0, resetTime - now);
          return delaySeconds * 1000;
        }
      }
    }
  }

  return undefined;
}

/**
 * Analyzes an error to extract rate limit information.
 */
function getRateLimitInfo(error: unknown, options: RateLimitOptions): RateLimitInfo {
  const checkRateLimit = options.isRateLimitError || isRateLimitError;
  const extractRetry = options.extractRetryAfter || extractRetryAfter;

  const isRateLimit = checkRateLimit(error);
  if (!isRateLimit) {
    return { isRateLimit: false, retryAfterMs: 0 };
  }

  const retryAfterMs = extractRetry(error) || 0;
  return { isRateLimit: true, retryAfterMs };
}

/**
 * Calculates exponential backoff delay with jitter.
 */
function calculateBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponentialDelay = baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
  const delay = Math.min(exponentialDelay + jitter, maxDelayMs);
  return Math.floor(delay);
}

/**
 * Waits for specified milliseconds.
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an async function with rate limit handling and retry logic.
 *
 * @param fn - The async function to execute
 * @param options - Rate limit configuration options
 * @returns The result of the function
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```typescript
 * const result = await withRateLimitHandling(
 *   () => octokit.pulls.get({ owner, repo, pull_number: 123 }),
 *   { maxRetries: 3 }
 * );
 * ```
 */
export async function withRateLimitHandling<T>(
  fn: () => Promise<T>,
  options: RateLimitOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const rateLimitInfo = getRateLimitInfo(error, options);

      if (!rateLimitInfo.isRateLimit) {
        throw error; // Not a rate limit error, throw immediately
      }

      if (attempt >= maxRetries) {
        throw error; // Out of retries
      }

      // Calculate delay
      let delayMs: number;
      if (rateLimitInfo.retryAfterMs > 0) {
        // Use server-provided retry-after value
        delayMs = Math.min(rateLimitInfo.retryAfterMs, maxDelayMs);
      } else {
        // Use exponential backoff
        delayMs = calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs);
      }

      logger.warn(
        { attempt: attempt + 1, maxAttempts: maxRetries + 1, delayMs },
        "Rate limit encountered, retrying after delay"
      );

      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Creates a rate-limit-aware wrapper around API methods.
 *
 * @example
 * ```typescript
 * const rateLimitedOctokit = {
 *   pulls: {
 *     get: withRateLimit((params) => octokit.pulls.get(params))
 *   }
 * };
 * ```
 */
export function withRateLimit<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RateLimitOptions = {}
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    return withRateLimitHandling(() => fn(...args), options);
  };
}
