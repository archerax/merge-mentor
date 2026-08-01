import { describe, expect, it } from "vitest";
import { createBuildReference } from "./reference.js";

describe("createBuildReference", () => {
  it("requires the identifier for the selected platform", () => {
    expect(() => createBuildReference({ platform: "github", owner: "o", repo: "r" })).toThrow(
      "run-id"
    );
    expect(() =>
      createBuildReference({ platform: "azure", org: "o", project: "p", repo: "r" })
    ).toThrow("build-id");
  });

  it("rejects ambiguous identifiers", () => {
    expect(() =>
      createBuildReference({
        platform: "github",
        runId: 1,
        buildId: 2,
        owner: "o",
        repo: "r",
      })
    ).toThrow("cannot be combined");
  });

  it("normalizes a valid Azure reference", () => {
    expect(
      createBuildReference({
        platform: "azure",
        buildId: 42,
        org: "org",
        project: "project",
        repo: "repo",
      })
    ).toEqual({
      platform: "azure",
      id: "42",
      ownerOrOrg: "org",
      project: "project",
      repository: "repo",
    });
  });
});
