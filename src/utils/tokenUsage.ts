import type { TokenUsage } from "../ai/types.js";

/**
 * Merges two TokenUsage objects by summing all numeric fields.
 *
 * - `inputTokens` and `outputTokens` are always summed.
 * - `cachedTokens` and `durationApiSeconds` are summed when at least one side is defined.
 * - `durationWallSeconds` is summed when at least one side is defined.
 * - `model` prefers the first non-undefined value; falls back to the second.
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

  const cachedSum = (a.cachedTokens ?? 0) + (b.cachedTokens ?? 0);
  const apiDurSum = (a.durationApiSeconds ?? 0) + (b.durationApiSeconds ?? 0);
  const wallDurSum = (a.durationWallSeconds ?? 0) + (b.durationWallSeconds ?? 0);

  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedTokens:
      cachedSum > 0 || a.cachedTokens !== undefined || b.cachedTokens !== undefined
        ? cachedSum
        : undefined,
    durationApiSeconds:
      apiDurSum > 0 || a.durationApiSeconds !== undefined || b.durationApiSeconds !== undefined
        ? apiDurSum
        : undefined,
    durationWallSeconds:
      wallDurSum > 0 || a.durationWallSeconds !== undefined || b.durationWallSeconds !== undefined
        ? wallDurSum
        : undefined,
    model: a.model ?? b.model,
    premiumRequests:
      a.premiumRequests !== undefined || b.premiumRequests !== undefined
        ? (a.premiumRequests ?? 0) + (b.premiumRequests ?? 0)
        : undefined,
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
