import { ConfigurationError } from "../errors/index.js";
import { CopilotProvider } from "./providers/copilot.js";
import { CursorProvider } from "./providers/cursor.js";
import { OpenAIProvider, type OpenAIProviderOptions } from "./providers/openai.js";
import { OpenCodeProvider } from "./providers/opencode.js";
import type { AIProviderClient, AIProviderOptions, AIProviderType } from "./types.js";

/**
 * Type guard to check if options contain OpenAI-specific properties.
 */
function isOpenAIOptions(options: unknown): options is OpenAIProviderOptions {
  return (
    typeof options === "object" &&
    options !== null &&
    "apiKey" in options &&
    typeof (options as OpenAIProviderOptions).apiKey === "string"
  );
}

/**
 * Creates an AI provider instance based on the specified type.
 *
 * @param type - The type of AI provider to create
 * @param options - Configuration options for the provider
 * @returns An instance of the requested AI provider
 * @throws {ConfigurationError} When an unsupported provider type is specified
 *
 * @example
 * ```typescript
 * // Create a Copilot provider
 * const copilot = createAIProvider("copilot", { model: "gpt-4o" });
 *
 * // Create an OpenCode provider
 * const opencode = createAIProvider("opencode", { model: "claude-3.5-sonnet" });
 *
 * // Create a Cursor provider
 * const cursor = createAIProvider("cursor", { model: "gpt-5" });
 *
 * // Create an OpenAI provider (requires apiKey)
 * const openai = createAIProvider("openai", { apiKey: "sk-...", model: "gpt-4o" });
 * ```
 */
export function createAIProvider(
  type: AIProviderType,
  options?: AIProviderOptions | OpenAIProviderOptions
): AIProviderClient {
  switch (type) {
    case "copilot":
      return new CopilotProvider(options);
    case "opencode":
      return new OpenCodeProvider(options);
    case "cursor":
      return new CursorProvider(options);
    case "openai":
      if (!isOpenAIOptions(options)) {
        throw new ConfigurationError(
          "OPENAI_API_KEY",
          "OpenAI provider requires apiKey. Set via MM_OPENAI_API_KEY or OPENAI_API_KEY environment variable."
        );
      }
      return new OpenAIProvider(options);
    default:
      throw new ConfigurationError(
        "AI_PROVIDER",
        `Unsupported AI provider: ${type as string}. Valid options are: copilot, opencode, cursor, openai`
      );
  }
}
