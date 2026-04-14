import { ConfigurationError } from "../errors/index.js";
import { CopilotProvider } from "./providers/copilot.js";
import { CopilotSdkProvider } from "./providers/copilot-sdk.js";
import { CursorProvider } from "./providers/cursor.js";
import { OpenCodeProvider } from "./providers/opencode.js";
import { OpenCodeSdkProvider } from "./providers/opencode-sdk.js";
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
 * // Create a Copilot provider
 * const copilot = createAIProvider("copilot", { model: "claude-sonnet-4.6" });
 *
 * // Create a Copilot SDK provider
 * const copilotSdk = createAIProvider("copilot-sdk", { model: "claude-sonnet-4.6" });
 *
 * // Create an OpenCode provider
 * const opencode = createAIProvider("opencode", { model: "claude-sonnet-4.6" });
 *
 * // Create an OpenCode SDK provider
 * const opencodeSdk = createAIProvider("opencode-sdk", { model: "claude-sonnet-4.6" });
 *
 * // Create a Cursor provider
 * const cursor = createAIProvider("cursor", { model: "claude-sonnet-4.6" });
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
      return new CopilotSdkProvider(options);
    case "opencode":
      return new OpenCodeProvider(options);
    case "opencode-sdk":
      return new OpenCodeSdkProvider(options);
    case "cursor":
      return new CursorProvider(options);
    default:
      throw new ConfigurationError(
        "AI_PROVIDER",
        `Unsupported AI provider: ${type as string}. Valid options are: copilot, copilot-sdk, opencode, opencode-sdk, cursor`
      );
  }
}
