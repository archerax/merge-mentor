import { describe, expect, it } from "vitest";
import { parseWorkItemUrl } from "./workItemUrl.js";

describe("parseWorkItemUrl", () => {
  it("parses a GitHub issue URL", () => {
    expect(parseWorkItemUrl("https://github.com/owner/repo/issues/42")).toEqual({
      platform: "github",
      id: "42",
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses an Azure DevOps work-item URL", () => {
    expect(parseWorkItemUrl("https://dev.azure.com/org/project/_workitems/edit/99")).toEqual({
      platform: "azure",
      id: "99",
      org: "org",
      project: "project",
    });
  });

  it("parses a legacy Azure DevOps work-item URL", () => {
    expect(parseWorkItemUrl("https://org.visualstudio.com/project/_workitems/edit/99")).toEqual({
      platform: "azure",
      id: "99",
      org: "org",
      project: "project",
    });
  });

  it("rejects unsupported URLs", () => {
    expect(() => parseWorkItemUrl("https://github.com/owner/repo/pull/42")).toThrow(
      "Invalid GitHub work item URL"
    );
  });
});
