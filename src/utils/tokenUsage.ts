import type { TokenUsage } from "../ai/types.js";

/**
 * Sums two optional numeric values. When at least one is defined, returns the
 * sum (treating the other as 0). When both are undefined, returns undefined.
 */
export function sumOptional(a: number | undefined, b: number | undefined): number | undefined {
  return a !== undefined || b !== undefined ? (a ?? 0) + (b ?? 0) : undefined;
}

/**
 * Merges two TokenUsage objects by summing all numeric fields.
 *
 * - `inputTokens` and `outputTokens` are always summed.
 * - `cachedTokens`, `durationApiSeconds`, `durationWallSeconds`, and
 *   `premiumRequests` are summed when at least one side is defined.
 * - `model` prefers the first non-undefined value, falling back to the second.
 *
 * @param a - First token usage (may be undefined)
 * @param b - Second token usage (may be undefined)
 * @returns Merged TokenUsage, or undefined if both inputs are undefined
 */
export function mergeTokenUsage(
  a: TokenUsage | undefined,
  b: TokenUsage | undefined
): TokenUsage | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;

  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedTokens: sumOptional(a.cachedTokens, b.cachedTokens),
    durationApiSeconds: sumOptional(a.durationApiSeconds, b.durationApiSeconds),
    durationWallSeconds: sumOptional(a.durationWallSeconds, b.durationWallSeconds),
    model: a.model ?? b.model,
    premiumRequests: sumOptional(a.premiumRequests, b.premiumRequests),
  };
}

/**
 * Formats token usage for human-readable CLI output.
 * Returns an array of lines to display.
 */
export function formatTokenUsage(usage: TokenUsage): string[] {
  const lines: string[] = [];
  const fmt = (n: number) => n.toLocaleString("en-US");

  lines.push(`Input tokens:   ${fmt(usage.inputTokens)}`);
  lines.push(`Output tokens:  ${fmt(usage.outputTokens)}`);
  if (usage.cachedTokens !== undefined) {
    lines.push(`Cached tokens:  ${fmt(usage.cachedTokens)}`);
  }
  const total = usage.inputTokens + usage.outputTokens;
  lines.push(`Total tokens:   ${fmt(total)}`);
  if (usage.model) {
    lines.push(`Model:          ${usage.model}`);
  }
  if (usage.durationApiSeconds !== undefined && usage.durationApiSeconds > 0) {
    lines.push(`API time:       ${usage.durationApiSeconds.toFixed(1)}s`);
  }
  if (usage.durationWallSeconds !== undefined && usage.durationWallSeconds > 0) {
    lines.push(`Wall time:      ${usage.durationWallSeconds.toFixed(1)}s`);
  }
  return lines;
}
