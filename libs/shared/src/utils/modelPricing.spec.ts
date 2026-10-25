import type { TokenUsage } from "@merge-mentor/domain/ai.js";
import { describe, expect, it } from "vitest";

import { findModelPrice, withEstimatedCost } from "./modelPricing.js";

describe("findModelPrice", () => {
  it.each([
    "deepseek-v4.1-flash-1017",
    "DeepSeek-V4.1-Flash-1017",
    "deepseek/deepseek-v4.1-flash",
    "deepseek-flash",
  ])("matches the Flash row for %s", (model) => {
    expect(findModelPrice(model)?.output).toBe(0.6);
  });

  it.each(["deepseek-v4-pro-0813", "deepseek/deepseek-v4-pro", "DEEPSEEK-PRO"])(
    "matches the Pro row for %s",
    (model) => {
      expect(findModelPrice(model)?.output).toBe(1.98);
    }
  );

  it.each([undefined, "", "gpt-4.1", "claude-sonnet", "deepseek-chat", "deepseek-prover", "pro"])(
    "has no price for %s",
    (model) => {
      expect(findModelPrice(model)).toBeUndefined();
    }
  );
});

describe("withEstimatedCost", () => {
  it("prices cache hits, cache misses and output per 1M tokens (Flash)", () => {
    const usage: TokenUsage = {
      inputTokens: 1_000_000,
      cachedTokens: 2_000_000,
      outputTokens: 500_000,
      model: "deepseek-v4.1-flash",
    };
    // 1M miss * 0.15 + 2M hit * 0.003 + 0.5M out * 0.6
    expect(withEstimatedCost(usage).costUsd).toBeCloseTo(0.15 + 0.006 + 0.3);
  });

  it("prices the Pro row and bills reasoning tokens as output", () => {
    const usage: TokenUsage = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      reasoningTokens: 1_000_000,
      model: "deepseek/deepseek-v4-pro",
    };
    // 1M miss * 0.66 + 2M out * 1.98
    expect(withEstimatedCost(usage).costUsd).toBeCloseTo(0.66 + 3.96);
  });

  it("returns the same object when the model is not priced", () => {
    const usage: TokenUsage = { inputTokens: 10, outputTokens: 5, model: "gpt-4.1" };
    expect(withEstimatedCost(usage)).toBe(usage);
    const noModel: TokenUsage = { inputTokens: 10, outputTokens: 5 };
    expect(withEstimatedCost(noModel)).toBe(noModel);
  });

  it("never overrides provider-reported cost or an existing estimate", () => {
    const reported: TokenUsage = {
      inputTokens: 10,
      outputTokens: 5,
      nanoAiu: 1,
      model: "deepseek-v4.1-flash",
    };
    expect(withEstimatedCost(reported)).toBe(reported);
    const priced: TokenUsage = {
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 9,
      model: "deepseek-v4.1-flash",
    };
    expect(withEstimatedCost(priced)).toBe(priced);
  });
});
