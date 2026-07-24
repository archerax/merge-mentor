import { describe, expect, it } from "vitest";
import type { CIContext } from "../../ci/index.js";
import { createStubEnvironment } from "../../ports/environment.test-helper.js";
import { createCapturingOutputWriter } from "../../ports/outputWriter.test-helper.js";
import type { ReviewOptions } from "../types.js";
import { ensureCIContext, mergeCIContext } from "./ci.js";

describe("mergeCIContext", () => {
  const sampleCI: CIContext = {
    ciSystem: "github-actions",
    platform: "github",
    prNumber: 42,
    workspacePath: "/github/workspace",
    githubToken: "ci-gh-token",
    githubOwner: "owner",
    githubRepo: "repo",
  };

  it("populates missing values from CI context", () => {
    const baseOptions: ReviewOptions = { ci: true };
    const merged = mergeCIContext(baseOptions, sampleCI);

    expect(merged.pr).toBe(42);
    expect(merged.platform).toBe("github");
    expect(merged.write).toBe(true);
    expect(merged.localWorkspacePath).toBe("/github/workspace");
    expect(merged.githubToken).toBe("ci-gh-token");
    expect(merged.githubRepoOwner).toBe("owner");
    expect(merged.githubRepoName).toBe("repo");
  });

  it("preserves explicit CLI flags over CI values", () => {
    const baseOptions: ReviewOptions = {
      ci: true,
      pr: 99,
      write: false,
      githubToken: "explicit-token",
    };
    const merged = mergeCIContext(baseOptions, sampleCI);

    expect(merged.pr).toBe(99);
    expect(merged.write).toBe(false);
    expect(merged.githubToken).toBe("explicit-token");
  });
});

describe("ensureCIContext", () => {
  it("returns options unchanged if ci flag is false", () => {
    const output = createCapturingOutputWriter();
    const env = createStubEnvironment({});
    const options: ReviewOptions = { ci: false, pr: 1 };

    const result = ensureCIContext(options, { output, env });
    expect(result).toEqual(options);
    expect(output.output).toHaveLength(0);
  });

  it("throws error when ci flag is true but no CI environment is detected", () => {
    const output = createCapturingOutputWriter();
    const env = createStubEnvironment({});
    const options: ReviewOptions = { ci: true };

    expect(() => ensureCIContext(options, { output, env })).toThrow(
      "--ci flag was set but no supported CI environment was detected."
    );
  });

  it("detects CI environment, logs message, pre-loads MM_* tokens, and merges context", () => {
    const output = createCapturingOutputWriter();
    const env = createStubEnvironment({
      GITHUB_ACTIONS: "true",
      GITHUB_REF: "refs/pull/123/merge",
      GITHUB_WORKSPACE: "/workspace",
      GITHUB_REPOSITORY: "org/repo",
      MM_GITHUB_TOKEN: "custom-mm-token",
    });
    const options: ReviewOptions = { ci: true };

    const result = ensureCIContext(options, { output, env });

    expect(
      output.output.some((entry) => entry.data.includes("🤖 CI mode: detected github-actions"))
    ).toBe(true);
    expect(result.pr).toBe(123);
    expect(result.githubToken).toBe("custom-mm-token");
    expect(result.githubRepoOwner).toBe("org");
    expect(result.githubRepoName).toBe("repo");
  });
});
