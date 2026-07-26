import { describe, expect, it } from "vitest";
import { buildPBIAlignmentPrompt } from "./alignment.js";

describe("buildPBIAlignmentPrompt", () => {
  it("formats prompt with provided PBI details and diff content", () => {
    const prompt = buildPBIAlignmentPrompt(
      "PBI-101",
      "User Authentication",
      "Allow users to log in",
      "Must validate JWT token",
      "diff --git a/auth.ts b/auth.ts\n+const token = parseJwt();"
    );

    expect(prompt).toContain("Verify whether the pull request changes satisfy");
    expect(prompt).toContain("PBI ID: PBI-101");
    expect(prompt).toContain("Title: User Authentication");
    expect(prompt).toContain("Description: Allow users to log in");
    expect(prompt).toContain("Acceptance Criteria: Must validate JWT token");
    expect(prompt).toContain("diff --git a/auth.ts b/auth.ts");
    expect(prompt).toContain("<untrusted-pbi-details>");
    expect(prompt).toContain("</untrusted-pbi-details>");
    expect(prompt).toContain("<untrusted-pr-diff>");
    expect(prompt).toContain("</untrusted-pr-diff>");
  });

  it("uses fallback text when acceptance criteria is empty", () => {
    const prompt = buildPBIAlignmentPrompt(
      "PBI-102",
      "Fix Bug",
      "Fix memory leak",
      "",
      "diff text"
    );

    expect(prompt).toContain("Acceptance Criteria: None specified");
  });
});
