import { vi } from "vitest";

import type { AIProviderClient, AIResponse, ExecutePromptOptions } from "../../ai/types.js";

/** Handles one prompt for {@link createFakeAIClient}; return a value or throw. */
type PromptHandler = (
  prompt: string,
  options: ExecutePromptOptions | undefined
) => AIResponse | Promise<AIResponse>;

/** Builds an AI response whose parsed JSON is `value`. */
export function jsonResponse(value: unknown, tokens = 10): AIResponse {
  return {
    raw: `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``,
    parsed: value,
    tokenUsage: { inputTokens: tokens, outputTokens: tokens },
  };
}

/** Creates an AI client whose `executePrompt` delegates to `handler`. */
export function createFakeAIClient(handler: PromptHandler): AIProviderClient & {
  executePrompt: ReturnType<typeof vi.fn>;
} {
  return {
    executePrompt: vi.fn(async (prompt: string, options?: ExecutePromptOptions) =>
      handler(prompt, options)
    ),
    parseFileReview: vi.fn(),
    parseCrossFileReview: vi.fn(),
    parseBatchedFileReview: vi.fn(),
    parseFastReview: vi.fn(),
  };
}
