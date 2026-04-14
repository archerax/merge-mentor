/**
 * Replaces all occurrences of a secret token within a string with `[REDACTED]`.
 * Use this before logging or re-throwing errors that may contain embedded credentials
 * (e.g. authenticated git clone URLs of the form `https://<token>@host/...`).
 *
 * When `token` is empty the original string is returned unchanged to avoid
 * corrupting output with spurious replacements.
 *
 * @param input - The string that may contain the token
 * @param token - The secret value to redact
 * @returns The input string with every occurrence of `token` replaced by `[REDACTED]`
 */
export function redactToken(input: string, token: string): string {
  if (!token) return input;
  return input.replaceAll(token, "[REDACTED]");
}
