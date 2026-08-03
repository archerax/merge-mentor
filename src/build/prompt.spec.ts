import { describe, expect, it } from "vitest";
import { buildAnalysisPrompt } from "./prompt.js";

describe("buildAnalysisPrompt", () => {
  it("includes bounded tails and directs the agent to complete artifacts", () => {
    const prompt = buildAnalysisPrompt(
      { platform: "github", id: "42", ownerOrOrg: "acme", repository: "app" },
      { id: "42", name: "CI", status: "completed", result: "failed" },
      { blocks: [], truncated: false, redacted: true },
      [{ filename: "001-linux.log", path: "/tmp/logs/001-linux.log", tail: "exit code 1" }]
    );

    expect(prompt).toContain("001-linux.log");
    expect(prompt).toContain("exit code 1");
    expect(prompt).toContain("Search and read them with your file tools");
    expect(prompt).toContain("untrusted-log-tail");
  });
});
