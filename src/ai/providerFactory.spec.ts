import { describe, expect, it } from "vitest";
import { ConfigurationError, ValidationError } from "../errors/index.js";
import { createAIProvider } from "./providerFactory.js";
import { ClaudeAgentSdkProvider } from "./providers/claude-agent-sdk.js";
import { CopilotSdkProvider } from "./providers/copilot-sdk.js";
import { OpenCodeSdkProvider } from "./providers/opencode-sdk.js";
import type { AIProviderType } from "./types.js";

describe("createAIProvider", () => {
  it("should create CopilotSdkProvider for 'copilot-sdk' type", () => {
    const provider = createAIProvider("copilot-sdk");
    expect(provider).toBeInstanceOf(CopilotSdkProvider);
  });

  it("should create OpenCodeSdkProvider for 'opencode-sdk' type", () => {
    const provider = createAIProvider("opencode-sdk");
    expect(provider).toBeInstanceOf(OpenCodeSdkProvider);
  });

  it("should create ClaudeAgentSdkProvider for 'claude-agent-sdk' type", () => {
    const provider = createAIProvider("claude-agent-sdk");
    expect(provider).toBeInstanceOf(ClaudeAgentSdkProvider);
  });

  it("should pass options to CopilotSdkProvider", () => {
    const provider = createAIProvider("copilot-sdk", {
      model: "claude-haiku-4.5",
      timeoutMs: 60000,
      maxRetries: 5,
      longContext: true,
    });
    expect(provider).toBeInstanceOf(CopilotSdkProvider);
  });

  it("should pass options to OpenCodeSdkProvider", () => {
    const provider = createAIProvider("opencode-sdk", {
      model: "claude-haiku-4.5",
      timeoutMs: 120000,
      maxRetries: 3,
    });
    expect(provider).toBeInstanceOf(OpenCodeSdkProvider);
  });

  it("should pass options to ClaudeAgentSdkProvider", () => {
    const provider = createAIProvider("claude-agent-sdk", {
      model: "claude-3-5-sonnet",
      timeoutMs: 90000,
      maxRetries: 4,
    });
    expect(provider).toBeInstanceOf(ClaudeAgentSdkProvider);
  });

  it("should throw ValidationError if experimentalTools is requested on non-copilot-sdk", () => {
    expect(() =>
      createAIProvider("opencode-sdk", {
        experimentalTools: true,
      })
    ).toThrow(ValidationError);
    expect(() =>
      createAIProvider("opencode-sdk", {
        experimentalTools: true,
      })
    ).toThrow(
      'Structured tool calling (--experimental-tools) is only supported by the "copilot-sdk" provider. Got: "opencode-sdk"'
    );
  });

  it("should throw ConfigurationError for unsupported provider type", () => {
    expect(() => createAIProvider("invalid" as unknown as AIProviderType)).toThrow(
      ConfigurationError
    );
    expect(() => createAIProvider("invalid" as unknown as AIProviderType)).toThrow(
      "Unsupported AI provider: invalid. Valid options are: copilot-sdk, opencode-sdk, claude-agent-sdk"
    );
  });

  it("should work with undefined options", () => {
    const provider = createAIProvider("copilot-sdk", undefined);
    expect(provider).toBeInstanceOf(CopilotSdkProvider);
  });
});
