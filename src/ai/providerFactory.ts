import { ConfigurationError } from "../errors/index.js";
import { CopilotProvider } from "./providers/copilot.js";
import { CopilotSDKProvider } from "./providers/copilotSDK.js";
import { CursorProvider } from "./providers/cursor.js";
import { OpenCodeProvider } from "./providers/opencode.js";
import type { AIProviderClient, AIProviderOptions, AIProviderType } from "./types.js";

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
 * // Create a Copilot provider (CLI-based, legacy)
 * const copilot = createAIProvider("copilot", { model: "gpt-4o" });
 *
 * // Create a Copilot SDK provider (recommended)
 * const copilotSDK = createAIProvider("copilot-sdk", { model: "gpt-4.1" });
 *
 * // Create an OpenCode provider
 * const opencode = createAIProvider("opencode", { model: "claude-3.5-sonnet" });
 *
 * // Create a Cursor provider
 * const cursor = createAIProvider("cursor", { model: "gpt-5" });
 * ```
 */
export function createAIProvider(
  type: AIProviderType,
  options?: AIProviderOptions
): AIProviderClient {
  switch (type) {
    case "copilot":
      return new CopilotProvider(options);
    case "copilot-sdk":
      return new CopilotSDKProvider(options);
    case "opencode":
      return new OpenCodeProvider(options);
    case "cursor":
      return new CursorProvider(options);
    default:
      throw new ConfigurationError(
        "AI_PROVIDER",
        `Unsupported AI provider: ${type as string}. Valid options are: copilot, copilot-sdk, opencode, cursor`
      );
  }
}
