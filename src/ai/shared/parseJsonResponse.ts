import { JsonParseError } from "../../errors/index.js";

/**
 * Extracts and parses JSON from a raw AI response. Tries markdown code blocks,
 * a direct parse, then object/array substrings before falling back to a final
 * brace-matching attempt.
 *
 * @param raw - The raw response text from the AI model.
 * @returns The parsed JSON value.
 * @throws {JsonParseError} When no valid JSON can be extracted from the response.
 */
export function parseJsonResponse(raw: string): unknown {
  // 1. Try markdown code block with json tag
  const markdownMatches = raw.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/gi);
  for (const match of markdownMatches) {
    try {
      return JSON.parse(match[1].trim());
    } catch {
      // Continue to next block
    }
  }

  // 2. Direct JSON parse (if raw is pure JSON)
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Continue to extracted JSON search
    }
  }

  // 3. Search for JSON object substring from '{' to matching '}'
  const braceIndices: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "{") braceIndices.push(i);
  }

  for (const startIdx of braceIndices) {
    let endIdx = raw.lastIndexOf("}");
    while (endIdx > startIdx) {
      const candidate = raw.slice(startIdx, endIdx + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        endIdx = raw.lastIndexOf("}", endIdx - 1);
      }
    }
  }

  // 4. Search for JSON array substring from '[' to matching ']'
  const bracketIndices: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "[") bracketIndices.push(i);
  }

  for (const startIdx of bracketIndices) {
    let endIdx = raw.lastIndexOf("]");
    while (endIdx > startIdx) {
      const candidate = raw.slice(startIdx, endIdx + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        endIdx = raw.lastIndexOf("]", endIdx - 1);
      }
    }
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new JsonParseError("No JSON object found in response", raw);
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    throw new JsonParseError((error as Error).message, raw);
  }
}
