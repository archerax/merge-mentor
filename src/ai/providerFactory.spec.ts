import { describe, expect, it } from "vitest";
import { ConfigurationError } from "../errors/index.js";
import { createAIProvider } from "./providerFactory.js";
import { CopilotProvider } from "./providers/copilot.js";
import { CursorProvider } from "./providers/cursor.js";
import { OpenCodeProvider } from "./providers/opencode.js";
import { OpenAIProvider } from "./providers/openai.js";

describe("createAIProvider", () => {
  it("should create CopilotProvider for 'copilot' type", () => {
    const provider = createAIProvider("copilot");
    expect(provider).toBeInstanceOf(CopilotProvider);
  });

  it("should create OpenCodeProvider for 'opencode' type", () => {
    const provider = createAIProvider("opencode");
    expect(provider).toBeInstanceOf(OpenCodeProvider);
  });

  it("should create CursorProvider for 'cursor' type", () => {
    const provider = createAIProvider("cursor");
    expect(provider).toBeInstanceOf(CursorProvider);
  });

  it("should create OpenAIProvider for 'openai' type with apiKey", () => {
    const provider = createAIProvider("openai", {
      apiKey: "sk-test-key",
      model: "gpt-4o",
    });
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it("should throw ConfigurationError for 'openai' type without apiKey", () => {
    expect(() => createAIProvider("openai")).toThrow(ConfigurationError);
    expect(() => createAIProvider("openai")).toThrow("OpenAI provider requires apiKey");
  });

  it("should throw ConfigurationError for 'openai' type with empty apiKey", () => {
    expect(() => createAIProvider("openai", { apiKey: "" })).toThrow("OpenAI API key is required");
  });

  it("should pass options to CopilotProvider", () => {
    const provider = createAIProvider("copilot", {
      model: "gpt-4o",
      timeoutMs: 60000,
      maxRetries: 5,
    });
    expect(provider).toBeInstanceOf(CopilotProvider);
  });

  it("should pass options to OpenCodeProvider", () => {
    const provider = createAIProvider("opencode", {
      model: "claude-3.5-sonnet",
      timeoutMs: 120000,
      maxRetries: 3,
    });
    expect(provider).toBeInstanceOf(OpenCodeProvider);
  });

  it("should pass options to CursorProvider", () => {
    const provider = createAIProvider("cursor", {
      model: "gpt-5",
      timeoutMs: 180000,
      maxRetries: 4,
    });
    expect(provider).toBeInstanceOf(CursorProvider);
  });

  it("should pass options to OpenAIProvider", () => {
    const provider = createAIProvider("openai", {
      apiKey: "sk-test-key",
      model: "gpt-4-turbo",
      timeoutMs: 120000,
      maxRetries: 5,
      baseUrl: "https://custom.api.com/v1",
    });
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it("should throw ConfigurationError for unsupported provider type", () => {
    expect(() => createAIProvider("invalid" as any)).toThrow(ConfigurationError);
    expect(() => createAIProvider("invalid" as any)).toThrow(
      "Unsupported AI provider: invalid. Valid options are: copilot, opencode, cursor, openai"
    );
  });

  it("should work with undefined options", () => {
    const provider = createAIProvider("copilot", undefined);
    expect(provider).toBeInstanceOf(CopilotProvider);
  });
});
