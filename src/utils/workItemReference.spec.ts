import { describe, expect, it } from "vitest";
import { resolveWorkItemReference } from "./workItemReference.js";

describe("resolveWorkItemReference", () => {
  it("supports a positional ID", () => {
    expect(resolveWorkItemReference({ positionalId: "42" })).toEqual({ id: "42" });
  });

  it("supports an explicit ID", () => {
    expect(resolveWorkItemReference({ id: "42" })).toEqual({ id: "42" });
  });

  it("derives GitHub context from a URL", () => {
    expect(resolveWorkItemReference({ url: "https://github.com/owner/repo/issues/42" })).toEqual({
      id: "42",
      platform: "github",
      githubRepoOwner: "owner",
      githubRepoName: "repo",
    });
  });

  it("retains the explicit Azure repository with a work-item URL", () => {
    expect(
      resolveWorkItemReference({
        url: "https://dev.azure.com/org/project/_workitems/edit/42",
        azureRepo: "repo",
      })
    ).toEqual({
      id: "42",
      platform: "azure",
      azureOrg: "org",
      azureProject: "project",
      azureRepo: "repo",
    });
  });

  it("rejects conflicting identifiers", () => {
    expect(() =>
      resolveWorkItemReference({ id: "42", url: "https://github.com/o/r/issues/1" })
    ).toThrow("--url cannot be combined with --id");
  });
});
