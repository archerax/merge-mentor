import { describe, expect, it } from "vitest";
import { prepareEvidence } from "./logNormalizer.js";

describe("prepareEvidence", () => {
  it("prioritizes useful failure signals and redacts secrets", () => {
    const result = prepareEvidence([
      { content: "installing packages\nall done", isFailureCandidate: false },
      {
        jobName: "typecheck",
        content: "src/app.ts:4:2 - error TS2339: Property token is missing\nTOKEN=secret-value",
        isFailureCandidate: true,
      },
    ]);

    expect(result.blocks[0]).toMatchObject({
      id: "E1",
      category: "compilation",
      jobName: "typecheck",
    });
    expect(result.blocks[0]?.content).toContain("[REDACTED]");
    expect(result.redacted).toBe(true);
  });

  it("bounds evidence and reports truncation", () => {
    const result = prepareEvidence(
      [{ content: `error TS9999: ${"x".repeat(200)}`, isFailureCandidate: true }],
      20
    );
    expect(Buffer.byteLength(result.blocks[0]?.content ?? "")).toBeLessThanOrEqual(20);
    expect(result.truncated).toBe(true);
  });
});
