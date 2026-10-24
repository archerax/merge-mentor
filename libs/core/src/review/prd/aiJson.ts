import { parseJsonResponse } from "../../ai/shared/parseJsonResponse.js";
import type { AIResponse } from "../../ai/types.js";

function tryParse(text: string): unknown {
  try {
    return parseJsonResponse(text);
  } catch {
    return undefined;
  }
}

/**
 * Returns the JSON payload of an AI response: the provider's parsed value, or
 * a best-effort extraction from the raw text when the provider could not
 * parse it. A parsed value that is itself serialised JSON text (a provider
 * can hand back its structured output as a string) is parsed once more.
 * Returns `undefined` when no JSON can be found.
 */
export function parseAIJson(response: AIResponse): unknown {
  const { parsed } = response;
  if (parsed !== null && parsed !== undefined) {
    if (typeof parsed !== "string") return parsed;
    const fromParsed = tryParse(parsed);
    if (fromParsed !== undefined) return fromParsed;
  }
  return tryParse(response.raw);
}
