/**
 * Token redaction utilities for secure logging.
 *
 * Replaces secret tokens and credentials in strings before logging or error handling.
 * Critical for preventing accidental exposure of authentication tokens, API keys,
 * and other sensitive data in logs and error messages.
 *
 * @example
 * ```typescript
 * const gitUrl = "https://token123abc@github.com/user/repo.git";
 * const safe = redactToken(gitUrl, "token123abc");
 * // "https://[REDACTED]@github.com/user/repo.git"
 *
 * // In error handling
 * try {
 *   await cloneRepo(url, token);
 * } catch (error) {
 *   const safeMessage = redactToken(error.message, token);
 *   logger.error(safeMessage); // Safe to log
 * }
 * ```
 */

/**
 * Replaces all occurrences of a secret token within a string with `[REDACTED]`.
 *
 * Returns the original string unchanged if the token is empty, avoiding spurious
 * replacements and data corruption.
 *
 * @param input - The string that may contain the token
 * @param token - The secret value to redact (if empty, returns input unchanged)
 * @returns The input string with every occurrence of `token` replaced by `[REDACTED]`
 *
 * @example
 * ```typescript
 * redactToken("https://abc123@github.com/repo", "abc123");
 * // "https://[REDACTED]@github.com/repo"
 *
 * redactToken("Bearer token123 in request", "token123");
 * // "Bearer [REDACTED] in request"
 *
 * redactToken("no secrets here", "");
 * // "no secrets here" (unchanged)
 * ```
 */
export function redactToken(input: string, token: string): string {
  if (!token) return input;
  return input.replaceAll(token, "[REDACTED]");
}
