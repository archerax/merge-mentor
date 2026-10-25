import { describe, expect, it } from "vitest";

import { formatUsageCost, formatUsd, nanoAiuToCredits, nanoAiuToUsd } from "./aiCredits.js";

describe("aiCredits", () => {
  it("converts nano-AIU to credits and dollars at $0.01 per credit", () => {
    expect(nanoAiuToCredits(2.5e9)).toBe(2.5);
    expect(nanoAiuToUsd(2.5e9)).toBeCloseTo(0.025);
  });

  it("formats dollars compactly", () => {
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(12.345)).toBe("$12.35");
  });

  it("formats provider-reported credits, estimated dollars, or both", () => {
    expect(formatUsageCost({ nanoAiu: 2.5e9 })).toBe("2.50 AI credits (~$0.0250)");
    expect(formatUsageCost({ costUsd: 0.0042 })).toBe("$0.0042");
    expect(formatUsageCost({ nanoAiu: 1e9, costUsd: 0.5 })).toBe(
      "1.00 AI credits (~$0.0100) + $0.5000"
    );
  });

  it("says not reported when there is no cost", () => {
    expect(formatUsageCost({})).toBe("not reported");
  });
});
