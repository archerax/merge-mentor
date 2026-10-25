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

/**
 * Formats provider-reported cost, e.g. `2.50 AI credits (~$0.03)`.
 *
 * @returns `not reported` when the provider reported no cost
 */
export function formatNanoAiuCost(nanoAiu: number | undefined): string {
  if (nanoAiu === undefined) return "not reported";
  return `${nanoAiuToCredits(nanoAiu).toFixed(2)} AI credits (~$${nanoAiuToUsd(nanoAiu).toFixed(2)})`;
}
