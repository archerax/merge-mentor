import { JsonParseError } from "../../errors/index.js";

export function parseJsonResponse(raw: string): unknown {
  const markdownMatch = raw.match(/```json\n([\s\S]*?)\n```/);
  if (markdownMatch) {
    try {
      return JSON.parse(markdownMatch[1]);
    } catch {
      // Fall through to regex extraction
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
