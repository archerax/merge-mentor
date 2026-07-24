import { describe, expect, it } from "vitest";
import { calculateTextSimilarity } from "./textSimilarity.js";

describe("calculateTextSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(calculateTextSimilarity("hello world", "hello world")).toBe(1.0);
  });

  it("returns 1.0 for identical strings after normalization", () => {
    expect(calculateTextSimilarity("Hello, World!", "hello world")).toBe(1.0);
  });

  it("returns 1.0 for the same code comment with formatting differences", () => {
    const a = "Function `foo()` is missing error handling.";
    const b = "Function foo() is missing error handling.";
    expect(calculateTextSimilarity(a, b)).toBe(1.0);
  });

  it("returns high similarity for slightly reworded findings", () => {
    const a = "The variable name 'x' is not descriptive enough";
    const b = "Variable 'x' is not descriptive enough";
    const score = calculateTextSimilarity(a, b);
    expect(score).toBeGreaterThanOrEqual(0.78);
  });

  it("returns low similarity for completely different text", () => {
    const a = "This function has a security vulnerability";
    const b = "Consider adding input validation";
    const score = calculateTextSimilarity(a, b);
    expect(score).toBeLessThan(0.5);
  });

  it("returns 0.0 for very short strings", () => {
    expect(calculateTextSimilarity("a", "b")).toBe(0.0);
  });

  it("returns 0.0 for empty string against non-empty", () => {
    expect(calculateTextSimilarity("", "hello world")).toBe(0.0);
  });
});
