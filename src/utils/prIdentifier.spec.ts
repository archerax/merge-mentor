import { describe, expect, it } from "vitest";
import { generatePRIdentifier, parsePRNumber, sanitizeProjectName } from "./prIdentifier.js";

describe("generatePRIdentifier", () => {
  it("generates identifier for GitHub PR", () => {
    expect(generatePRIdentifier("github", "my-repo", 123)).toBe("Github-my-repo-PR123");
  });

  it("generates identifier for Azure PR", () => {
    expect(generatePRIdentifier("azure", "MyProject", 456)).toBe("Azure-MyProject-PR456");
  });
});

describe("parsePRNumber", () => {
  it("parses PR number from GitHub identifier", () => {
    const id = generatePRIdentifier("github", "my-repo", 123);
    expect(parsePRNumber(id)).toBe(123);
  });

  it("parses PR number from Azure identifier", () => {
    const id = generatePRIdentifier("azure", "my-project", 456);
    expect(parsePRNumber(id)).toBe(456);
  });

  it("parses nested project names", () => {
    const id = generatePRIdentifier("github", "org/sub/dir", 789);
    expect(parsePRNumber(id)).toBe(789);
  });

  it("parses large PR numbers", () => {
    expect(parsePRNumber("Azure-org-project-PR999999")).toBe(999999);
  });

  it("throws when identifier is missing PR suffix", () => {
    expect(() => parsePRNumber("Github-myrepo")).toThrow(
      "Cannot parse PR number from identifier: Github-myrepo"
    );
  });

  it("throws when identifier has PR but no digits", () => {
    expect(() => parsePRNumber("Github-myrepo-PR")).toThrow(
      "Cannot parse PR number from identifier: Github-myrepo-PR"
    );
  });

  it("throws when identifier has PR in wrong position", () => {
    expect(() => parsePRNumber("PR123-suffix")).toThrow(
      "Cannot parse PR number from identifier: PR123-suffix"
    );
  });

  it("throws for empty string", () => {
    expect(() => parsePRNumber("")).toThrow("Cannot parse PR number from identifier: ");
  });
});

describe("sanitizeProjectName", () => {
  it("replaces spaces with hyphens", () => {
    expect(sanitizeProjectName("My Project")).toBe("My-Project");
  });

  it("replaces invalid filename characters", () => {
    expect(sanitizeProjectName("project/name")).toBe("project_name");
    expect(sanitizeProjectName("repo<special>name")).toBe("repo_special_name");
  });

  it("truncates long names", () => {
    const long = "a".repeat(100);
    expect(sanitizeProjectName(long).length).toBe(50);
  });
});
