import { parseJsonResponse } from "../../ai/shared/parseJsonResponse.js";
import type { AIResponse } from "../../ai/types.js";

/**
 * Returns the JSON payload of an AI response: the provider's parsed value, or
 * a best-effort extraction from the raw text when the provider could not
 * parse it. Returns `undefined` when no JSON can be found.
 */
export function parseAIJson(response: AIResponse): unknown {
  if (response.parsed !== null && response.parsed !== undefined) return response.parsed;
  try {
    return parseJsonResponse(response.raw);
  } catch {
    return undefined;
  }
}
