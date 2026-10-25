import type { TokenUsage } from "@merge-mentor/domain/ai.js";

/**
 * Hard-coded prices for BYOK models whose providers do not report cost.
 *
 * Prices are US dollars per 1M tokens, copied from the provider's pricing page.
 * Provider-reported cost (for example Copilot's nano-AIU) always wins over an estimate.
 */

/** Per-1M-token prices for one model. */
interface ModelPrice {
  /** Input tokens served from the provider's prompt cache. */
  readonly inputCacheHit: number;
  /** Input tokens not served from cache. */
  readonly inputCacheMiss: number;
  /** Output tokens, including reasoning (thinking) tokens. */
  readonly output: number;
}

/**
 * Date the DeepSeek prices were taken from https://api-docs.deepseek.com/quick_start/pricing/.
 * They are the OFF-PEAK rates; peak-hour pricing is not modelled.
 */
export const DEEPSEEK_PRICES_AS_OF = "2026-10-25";

const DEEPSEEK_V4_1_FLASH: ModelPrice = { inputCacheHit: 0.003, inputCacheMiss: 0.15, output: 0.6 };
const DEEPSEEK_V4_PRO: ModelPrice = { inputCacheHit: 0.022, inputCacheMiss: 0.66, output: 1.98 };

const TOKENS_PER_PRICE_UNIT = 1_000_000;

/** Matches `pro` as a whole word so `deepseek-v4-pro-0813` matches but `prover` does not. */
const PRO_WORD = /(^|[^a-z0-9])pro($|[^a-z0-9])/;
const FLASH_WORD = /(^|[^a-z0-9])flash($|[^a-z0-9])/;

/**
 * Finds the price row for a model id.
 *
 * Matches case-insensitively on `deepseek` plus the `flash` or `pro` word, so dated
 * suffixes (`-1017`) and provider prefixes (`deepseek/`) are tolerated.
 *
 * @param model - Model id as reported by the provider
 * @returns The price row, or `undefined` when the model is not in the table
 */
export function findModelPrice(model: string | undefined): ModelPrice | undefined {
  const id = model?.toLowerCase();
  if (!id?.includes("deepseek")) return undefined;
  if (FLASH_WORD.test(id)) return DEEPSEEK_V4_1_FLASH;
  if (PRO_WORD.test(id)) return DEEPSEEK_V4_PRO;
  return undefined;
}

/**
 * Returns the usage with an estimated dollar cost when the provider reported none.
 *
 * Reported input tokens are treated as cache misses and `cachedTokens` as cache hits;
 * reasoning tokens are billed as output. Usage is returned unchanged when the provider
 * already reported cost, the model is not in the price table, or a cost is already set.
 *
 * @param usage - Usage from one AI call
 */
export function withEstimatedCost(usage: TokenUsage): TokenUsage {
  if (usage.nanoAiu !== undefined || usage.costUsd !== undefined) return usage;
  const price = findModelPrice(usage.model);
  if (!price) return usage;

  const costUsd =
    ((usage.cachedTokens ?? 0) * price.inputCacheHit +
      usage.inputTokens * price.inputCacheMiss +
      (usage.outputTokens + (usage.reasoningTokens ?? 0)) * price.output) /
    TOKENS_PER_PRICE_UNIT;
  return { ...usage, costUsd };
}
