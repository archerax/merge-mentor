import { describe, expect, it } from "vitest";
import { ConfigurationError } from "../errors/index.js";
import { createAIProvider } from "./providerFactory.js";
import { CopilotProvider } from "./providers/copilot.js";
import { CopilotSdkProvider } from "./providers/copilot-sdk.js";
import { OpenCodeProvider } from "./providers/opencode.js";
import { OpenCodeSdkProvider } from "./providers/opencode-sdk.js";
import type { AIProviderType } from "./types.js";

describe("createAIProvider", () => {
  it("should create CopilotProvider for 'copilot' type", () => {
    const provider = createAIProvider("copilot");
    expect(provider).toBeInstanceOf(CopilotProvider);
  });

  it("should create CopilotSdkProvider for 'copilot-sdk' type", () => {
    const provider = createAIProvider("copilot-sdk");
    expect(provider).toBeInstanceOf(CopilotSdkProvider);
  });

  it("should create OpenCodeProvider for 'opencode' type", () => {
    const provider = createAIProvider("opencode");
    expect(provider).toBeInstanceOf(OpenCodeProvider);
  });

  it("should create OpenCodeSdkProvider for 'opencode-sdk' type", () => {
    const provider = createAIProvider("opencode-sdk");
    expect(provider).toBeInstanceOf(OpenCodeSdkProvider);
  });

  it("should pass options to CopilotProvider", () => {
    const provider = createAIProvider("copilot", {
      model: "claude-haiku-4.5",
      timeoutMs: 60000,
      maxRetries: 5,
    });
    expect(provider).toBeInstanceOf(CopilotProvider);
  });

  it("should pass options to CopilotSdkProvider", () => {
    const provider = createAIProvider("copilot-sdk", {
      model: "claude-haiku-4.5",
      timeoutMs: 60000,
      maxRetries: 5,
    });
    expect(provider).toBeInstanceOf(CopilotSdkProvider);
  });

  it("should pass options to OpenCodeProvider", () => {
    const provider = createAIProvider("opencode", {
      model: "claude-haiku-4.5",
      timeoutMs: 120000,
      maxRetries: 3,
    });
    expect(provider).toBeInstanceOf(OpenCodeProvider);
  });

  it("should pass options to OpenCodeSdkProvider", () => {
    const provider = createAIProvider("opencode-sdk", {
      model: "claude-haiku-4.5",
      timeoutMs: 120000,
      maxRetries: 3,
    });
    expect(provider).toBeInstanceOf(OpenCodeSdkProvider);
  });

  it("should throw ConfigurationError for unsupported provider type", () => {
    expect(() => createAIProvider("invalid" as unknown as AIProviderType)).toThrow(
      ConfigurationError
    );
    expect(() => createAIProvider("invalid" as unknown as AIProviderType)).toThrow(
      "Unsupported AI provider: invalid. Valid options are: copilot, copilot-sdk, opencode, opencode-sdk"
    );
  });

  it("should work with undefined options", () => {
    const provider = createAIProvider("copilot", undefined);
    expect(provider).toBeInstanceOf(CopilotProvider);
  });
});
