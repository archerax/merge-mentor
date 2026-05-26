import { ConfigurationError } from "../errors/index.js";
import { CopilotSdkProvider } from "./providers/copilot-sdk.js";
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
 * // Create a Copilot SDK provider
 * const copilotSdk = createAIProvider("copilot-sdk", { model: "claude-sonnet-4.6" });
 *
 * // Create an OpenCode SDK provider
 * const opencodeSdk = createAIProvider("opencode-sdk", { model: "claude-sonnet-4.6" });
 * ```
 */
export function createAIProvider(
  type: AIProviderType,
  options?: AIProviderOptions
): AIProviderClient {
  switch (type) {
    case "copilot-sdk":
      return new CopilotSdkProvider(options);
    case "opencode-sdk":
      return new OpenCodeSdkProvider(options);
    default:
      throw new ConfigurationError(
        "AI_PROVIDER",
        `Unsupported AI provider: ${type as string}. Valid options are: copilot-sdk, opencode-sdk`
      );
  }
}
