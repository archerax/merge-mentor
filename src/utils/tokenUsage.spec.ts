import { describe, expect, it } from "vitest";
import type { TokenUsage } from "../ai/types.js";
import { formatTokenUsage, mergeTokenUsage, sumOptional } from "./tokenUsage.js";

describe("sumOptional", () => {
  it("returns undefined when both are undefined", () => {
    expect(sumOptional(undefined, undefined)).toBeUndefined();
  });

  it("returns a when only a is defined", () => {
    expect(sumOptional(10, undefined)).toBe(10);
  });

  it("returns b when only b is defined", () => {
    expect(sumOptional(undefined, 5)).toBe(5);
  });

  it("sums both when both are defined", () => {
    expect(sumOptional(10, 5)).toBe(15);
  });

  it("returns 0 when one is 0 and the other is undefined", () => {
    expect(sumOptional(0, undefined)).toBe(0);
  });

  it("returns 0 when both are 0", () => {
    expect(sumOptional(0, 0)).toBe(0);
  });
});

describe("mergeTokenUsage", () => {
  it("returns undefined when both inputs are undefined", () => {
    expect(mergeTokenUsage(undefined, undefined)).toBeUndefined();
  });

  it("returns b when a is undefined", () => {
    const b: TokenUsage = { inputTokens: 10, outputTokens: 5 };
    expect(mergeTokenUsage(undefined, b)).toBe(b);
  });

  it("returns a when b is undefined", () => {
    const a: TokenUsage = { inputTokens: 10, outputTokens: 5 };
    expect(mergeTokenUsage(a, undefined)).toBe(a);
  });

  it("sums inputTokens and outputTokens", () => {
    const a: TokenUsage = { inputTokens: 100, outputTokens: 50 };
    const b: TokenUsage = { inputTokens: 40, outputTokens: 20 };

    const result = mergeTokenUsage(a, b);

    expect(result?.inputTokens).toBe(140);
    expect(result?.outputTokens).toBe(70);
  });

  it("sums cachedTokens when both are defined", () => {
    const a: TokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 10,
    };
    const b: TokenUsage = {
      inputTokens: 40,
      outputTokens: 20,
      cachedTokens: 5,
    };

    const result = mergeTokenUsage(a, b);

    expect(result?.cachedTokens).toBe(15);
  });

  it("includes cachedTokens when only one side defines it", () => {
    const a: TokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 10,
    };
    const b: TokenUsage = { inputTokens: 40, outputTokens: 20 };

    const result = mergeTokenUsage(a, b);

    expect(result?.cachedTokens).toBe(10);
  });

  it("leaves cachedTokens undefined when neither side defines it", () => {
    const a: TokenUsage = { inputTokens: 100, outputTokens: 50 };
    const b: TokenUsage = { inputTokens: 40, outputTokens: 20 };

    const result = mergeTokenUsage(a, b);

    expect(result?.cachedTokens).toBeUndefined();
  });

  it("sums durationApiSeconds", () => {
    const a: TokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
      durationApiSeconds: 1.2,
    };
    const b: TokenUsage = {
      inputTokens: 40,
      outputTokens: 20,
      durationApiSeconds: 0.8,
    };

    const result = mergeTokenUsage(a, b);

    expect(result?.durationApiSeconds).toBeCloseTo(2.0);
  });

  it("leaves durationApiSeconds undefined when neither side defines it", () => {
    const a: TokenUsage = { inputTokens: 100, outputTokens: 50 };
    const b: TokenUsage = { inputTokens: 40, outputTokens: 20 };

    const result = mergeTokenUsage(a, b);

    expect(result?.durationApiSeconds).toBeUndefined();
  });

  it("prefers first model when merging", () => {
    const a: TokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
      model: "gpt-4.1",
    };
    const b: TokenUsage = { inputTokens: 40, outputTokens: 20, model: "gpt-5" };

    const result = mergeTokenUsage(a, b);

    expect(result?.model).toBe("gpt-4.1");
  });

  it("falls back to second model when first has no model", () => {
    const a: TokenUsage = { inputTokens: 100, outputTokens: 50 };
    const b: TokenUsage = { inputTokens: 40, outputTokens: 20, model: "gpt-5" };

    const result = mergeTokenUsage(a, b);

    expect(result?.model).toBe("gpt-5");
  });
});

describe("formatTokenUsage", () => {
  it("includes input and output tokens", () => {
    const usage: TokenUsage = { inputTokens: 1000, outputTokens: 500 };

    const lines = formatTokenUsage(usage);

    expect(lines.some((l) => l.includes("1,000"))).toBe(true);
    expect(lines.some((l) => l.includes("500"))).toBe(true);
  });

  it("includes total tokens", () => {
    const usage: TokenUsage = { inputTokens: 1000, outputTokens: 500 };

    const lines = formatTokenUsage(usage);

    expect(lines.some((l) => l.includes("Total") && l.includes("1,500"))).toBe(true);
  });

  it("includes cached tokens when defined", () => {
    const usage: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      cachedTokens: 200,
    };

    const lines = formatTokenUsage(usage);

    expect(lines.some((l) => l.includes("Cached") && l.includes("200"))).toBe(true);
  });

  it("omits cached tokens when undefined", () => {
    const usage: TokenUsage = { inputTokens: 1000, outputTokens: 500 };

    const lines = formatTokenUsage(usage);

    expect(lines.every((l) => !l.includes("Cached"))).toBe(true);
  });

  it("includes model when defined", () => {
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
      model: "gpt-4.1",
    };

    const lines = formatTokenUsage(usage);

    expect(lines.some((l) => l.includes("gpt-4.1"))).toBe(true);
  });

  it("includes API time when durationApiSeconds is positive", () => {
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
      durationApiSeconds: 2.5,
    };

    const lines = formatTokenUsage(usage);

    expect(lines.some((l) => l.includes("API time") && l.includes("2.5s"))).toBe(true);
  });

  it("omits API time when durationApiSeconds is zero", () => {
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
      durationApiSeconds: 0,
    };

    const lines = formatTokenUsage(usage);

    expect(lines.every((l) => !l.includes("API time"))).toBe(true);
  });
});
