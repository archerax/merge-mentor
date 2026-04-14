import { describe, expect, it } from "vitest";
import { redactToken } from "./redact.js";

describe("redactToken", () => {
  it("replaces a token with [REDACTED]", () => {
    const result = redactToken("https://ghp_abc123@github.com/owner/repo.git", "ghp_abc123");

    expect(result).toBe("https://[REDACTED]@github.com/owner/repo.git");
  });

  it("replaces all occurrences when the token appears multiple times", () => {
    const token = "secret";
    const result = redactToken("token=secret, also secret here", token);

    expect(result).toBe("token=[REDACTED], also [REDACTED] here");
  });

  it("returns the input unchanged when token is an empty string", () => {
    const input = "no token here";

    const result = redactToken(input, "");

    expect(result).toBe(input);
  });

  it("returns the input unchanged when the token does not appear in the input", () => {
    const result = redactToken("https://github.com/owner/repo.git", "ghp_abc123");

    expect(result).toBe("https://github.com/owner/repo.git");
  });

  it("handles an Azure DevOps authenticated URL", () => {
    const result = redactToken(
      "fatal: repository 'https://myPAT@dev.azure.com/org/project/_git/repo' not found",
      "myPAT"
    );

    expect(result).toBe(
      "fatal: repository 'https://[REDACTED]@dev.azure.com/org/project/_git/repo' not found"
    );
  });

  it("handles an empty input string", () => {
    const result = redactToken("", "ghp_abc123");

    expect(result).toBe("");
  });
});
