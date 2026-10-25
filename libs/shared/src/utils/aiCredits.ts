/**
 * AI credit conversions for provider-reported cost.
 *
 * Kept free of Node imports so browser code can use it.
 */

/** One AI credit costs $0.01. */
const USD_PER_AI_CREDIT = 0.01;
const NANO_AIU_PER_AI_CREDIT = 1e9;

/** Converts provider-reported nano-AIU to AI credits. */
export function nanoAiuToCredits(nanoAiu: number): number {
  return nanoAiu / NANO_AIU_PER_AI_CREDIT;
}

/** Converts provider-reported nano-AIU to US dollars (1 AI credit = $0.01). */
export function nanoAiuToUsd(nanoAiu: number): number {
  return nanoAiuToCredits(nanoAiu) * USD_PER_AI_CREDIT;
}

/** Formats dollars compactly: sub-dollar amounts keep four decimals (`$0.0042`). */
export function formatUsd(usd: number): string {
  return `$${usd < 1 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

/** Cost figures from a usage record or summary. */
interface UsageCost {
  /** Provider-reported cost in nano-AIU (Copilot). */
  readonly nanoAiu?: number;
  /** Estimated dollars from the built-in price table (BYOK). */
  readonly costUsd?: number;
}

/**
 * Formats cost, e.g. `2.50 AI credits (~$0.03)`, `$0.0042`, or both joined with ` + `.
 *
 * @returns `not reported` when neither a provider-reported nor an estimated cost exists
 */
export function formatUsageCost(cost: UsageCost): string {
  const parts: string[] = [];
  if (cost.nanoAiu !== undefined) {
    parts.push(
      `${nanoAiuToCredits(cost.nanoAiu).toFixed(2)} AI credits (~${formatUsd(nanoAiuToUsd(cost.nanoAiu))})`
    );
  }
  if (cost.costUsd !== undefined) parts.push(formatUsd(cost.costUsd));
  return parts.length > 0 ? parts.join(" + ") : "not reported";
}
