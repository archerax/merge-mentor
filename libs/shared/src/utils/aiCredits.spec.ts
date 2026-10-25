import { describe, expect, it } from "vitest";

import { formatNanoAiuCost, nanoAiuToCredits, nanoAiuToUsd } from "./aiCredits.js";

describe("aiCredits", () => {
  it("converts nano-AIU to credits and dollars at $0.01 per credit", () => {
    expect(nanoAiuToCredits(2.5e9)).toBe(2.5);
    expect(nanoAiuToUsd(2.5e9)).toBeCloseTo(0.025);
  });

  it("formats cost, or says not reported", () => {
    expect(formatNanoAiuCost(2.5e9)).toBe("2.50 AI credits (~$0.03)");
    expect(formatNanoAiuCost(undefined)).toBe("not reported");
  });
});
