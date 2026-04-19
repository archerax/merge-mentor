import { createChildLogger } from "../logger.js";
import { type Clock, systemClock } from "../ports/index.js";

/**
 * Rate limit handling utilities for API requests.
 *
 * Provides automatic retry logic with exponential backoff and jitter for rate-limited API calls.
 * Supports multiple error formats from GitHub, Azure DevOps, and standard HTTP responses.
 *
 * Key features:
 * - Automatic detection of rate limit errors from various platforms
 * - Exponential backoff with jitter to prevent thundering herd
 * - Server-provided retry-after values when available
 * - Configurable max retries and delay bounds
 * - Custom error detection and retry-after extraction
 *
 * @example
 * ```typescript
 * // Wrap a single async call
 * const result = await withRateLimitHandling(
 *   () => octokit.pulls.get({ owner, repo, pull_number: 123 })
 * );
 *
 * // Create a reusable wrapper
 * const rateLimitedFetch = withRateLimit(
 *   (url: string) => fetch(url).then(r => r.json()),
 *   { maxRetries: 5, baseDelayMs: 1000 }
 * );
 * const data = await rateLimitedFetch("https://api.example.com/data");
 * ```
 */

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30000;

const logger = createChildLogger({ component: "RateLimitHandler" });

interface RateLimitOptions {
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
  /** Clock for time-based calculations. Default: systemClock */
  readonly clock?: Clock;
}

interface RateLimitInfo {
  readonly retryAfterMs: number;
  readonly isRateLimit: boolean;
}

/**
 * Checks if an error is a rate limit error (HTTP 429 or similar).
 *
 * Detects rate limit errors from multiple sources:
 * - GitHub/Octokit: HTTP 403 with "rate limit" in message
 * - Standard HTTP: HTTP 429 status code
 * - Azure DevOps: HTTP 429 via statusCode property
 *
 * @param error - The error object to check
 * @returns True if the error is rate limit related, false otherwise
 *
 * @example
 * ```typescript
 * try {
 *   await fetchData();
 * } catch (error) {
 *   if (isRateLimitError(error)) {
 *     console.log("Hit rate limit, retrying...");
 *   }
 * }
 * ```
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
 * Extracts retry-after delay from error response headers.
 *
 * Supports multiple retry strategies:
 * - Retry-After header (in seconds or HTTP-date)
 * - X-RateLimit-Reset header (GitHub, Unix timestamp in seconds)
 *
 * Returns the delay in milliseconds if available, or undefined if not present.
 *
 * @param error - The error object containing response headers
 * @param clock - Clock for time calculations (defaults to system clock)
 * @returns Milliseconds to wait before retrying, or undefined if not available
 *
 * @example
 * ```typescript
 * try {
 *   await fetchData();
 * } catch (error) {
 *   const delayMs = extractRetryAfter(error);
 *   if (delayMs) {
 *     await sleep(delayMs);
 *     // Retry now
 *   }
 * }
 * ```
 */
export function extractRetryAfter(error: unknown, clock: Clock = systemClock): number | undefined {
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
          const now = Math.floor(clock.epochMs() / 1000);
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
 *
 * Determines if an error is rate limit related and extracts the retry delay
 * from either server headers or defaults to exponential backoff calculation.
 *
 * @param error - The error to analyze
 * @param options - Configuration including custom rate limit checks
 * @returns Object with isRateLimit flag and retryAfterMs delay
 */
function getRateLimitInfo(error: unknown, options: RateLimitOptions): RateLimitInfo {
  const checkRateLimit = options.isRateLimitError || isRateLimitError;
  const clock = options.clock ?? systemClock;
  const extractRetry = options.extractRetryAfter || ((e: unknown) => extractRetryAfter(e, clock));

  const isRateLimit = checkRateLimit(error);
  if (!isRateLimit) {
    return { isRateLimit: false, retryAfterMs: 0 };
  }

  const retryAfterMs = extractRetry(error) || 0;
  return { isRateLimit: true, retryAfterMs };
}

/**
 * Calculates exponential backoff delay with jitter.
 *
 * Uses the formula: delay = min(baseDelay * 2^attempt + jitter, maxDelayMs)
 * Jitter is 0-30% of exponential delay to prevent thundering herd problems.
 *
 * @param attempt - The retry attempt number (0-based)
 * @param baseDelayMs - Base delay in milliseconds
 * @param maxDelayMs - Maximum delay cap in milliseconds
 * @returns Calculated delay in milliseconds
 *
 * @example
 * ```typescript
 * calculateBackoffDelay(0, 1000, 30000); // ~1000-1300ms
 * calculateBackoffDelay(3, 1000, 30000); // ~8000-10400ms (capped at 30s)
 * ```
 */
function calculateBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponentialDelay = baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
  const delay = Math.min(exponentialDelay + jitter, maxDelayMs);
  return Math.floor(delay);
}

/**
 * Waits for specified milliseconds.
 *
 * Used internally for retry delays. Wraps setTimeout in a Promise for async/await usage.
 *
 * @param ms - Milliseconds to wait
 * @returns Promise that resolves after the specified delay
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
 * Creates a rate-limit-aware wrapper around async functions.
 *
 * Automatically retries the wrapped function on rate limit errors with exponential backoff.
 * Non-rate-limit errors are thrown immediately without retry.
 *
 * @param fn - Async function to wrap
 * @param options - Rate limit configuration (retries, delays, custom detectors)
 * @returns Wrapped function with the same signature and automatic retry logic
 *
 * @example
 * ```typescript
 * const rateLimitedFetch = withRateLimit(
 *   (url: string) => fetch(url).then(r => r.json()),
 *   { maxRetries: 3, baseDelayMs: 1000 }
 * );
 * const data = await rateLimitedFetch("https://api.example.com/data");
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
