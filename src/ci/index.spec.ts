import { describe, expect, test } from "vitest";
import { createStubEnvironment } from "../ports/environment.test-helper.js";
import { resolveAzurePipelinesContext } from "./azure-pipelines.js";
import { detectCIEnvironment } from "./detector.js";
import { resolveGitHubActionsContext } from "./github-actions.js";
import { extractAzureOrg } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGitHubEnv(overrides: Record<string, string> = {}) {
  return createStubEnvironment({
    GITHUB_ACTIONS: "true",
    GITHUB_TOKEN: "gh-token",
    GITHUB_REPOSITORY: "myorg/myrepo",
    GITHUB_REF: "refs/pull/42/merge",
    ...overrides,
  });
}

function makeAzureEnv(overrides: Record<string, string> = {}) {
  return createStubEnvironment({
    TF_BUILD: "True",
    SYSTEM_ACCESSTOKEN: "az-token",
    SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: "https://dev.azure.com/myorg/",
    SYSTEM_TEAMPROJECT: "MyProject",
    BUILD_REPOSITORY_NAME: "MyRepo",
    SYSTEM_PULLREQUEST_PULLREQUESTID: "99",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// extractAzureOrg
// ---------------------------------------------------------------------------

describe("extractAzureOrg", () => {
  test("extracts org from modern dev.azure.com URL with trailing slash", () => {
    expect(extractAzureOrg("https://dev.azure.com/myorg/")).toBe("myorg");
  });

  test("extracts org from modern dev.azure.com URL without trailing slash", () => {
    expect(extractAzureOrg("https://dev.azure.com/myorg")).toBe("myorg");
  });

  test("extracts org from legacy visualstudio.com URL", () => {
    expect(extractAzureOrg("https://myorg.visualstudio.com/")).toBe("myorg");
  });

  test("returns undefined for unrecognised URL format", () => {
    expect(extractAzureOrg("https://example.com/something")).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(extractAzureOrg("")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveGitHubActionsContext
// ---------------------------------------------------------------------------

describe("resolveGitHubActionsContext", () => {
  test("returns null when GITHUB_ACTIONS is not set", () => {
    const env = createStubEnvironment({});
    expect(resolveGitHubActionsContext(env)).toBeNull();
  });

  test("returns null when GITHUB_ACTIONS is not exactly 'true'", () => {
    const env = createStubEnvironment({ GITHUB_ACTIONS: "1" });
    expect(resolveGitHubActionsContext(env)).toBeNull();
  });

  test("resolves PR number from GITHUB_REF", () => {
    const env = makeGitHubEnv({ GITHUB_REF: "refs/pull/42/merge" });
    const ctx = resolveGitHubActionsContext(env);
    expect(ctx?.prNumber).toBe(42);
  });

  test("resolves PR number from GITHUB_REF with /head suffix", () => {
    const env = makeGitHubEnv({ GITHUB_REF: "refs/pull/7/head" });
    const ctx = resolveGitHubActionsContext(env);
    expect(ctx?.prNumber).toBe(7);
  });

  test("resolves PR number from event payload file (top-level .number)", () => {
    const env = createStubEnvironment({
      GITHUB_ACTIONS: "true",
      GITHUB_TOKEN: "gh-token",
      GITHUB_REPOSITORY: "myorg/myrepo",
      GITHUB_EVENT_PATH: "/tmp/event.json",
    });
    const fileReader = () => JSON.stringify({ number: 55 });
    const ctx = resolveGitHubActionsContext(env, fileReader);
    expect(ctx?.prNumber).toBe(55);
  });

  test("resolves PR number from event payload pull_request.number", () => {
    const env = createStubEnvironment({
      GITHUB_ACTIONS: "true",
      GITHUB_TOKEN: "gh-token",
      GITHUB_REPOSITORY: "myorg/myrepo",
      GITHUB_EVENT_PATH: "/tmp/event.json",
    });
    const fileReader = () => JSON.stringify({ pull_request: { number: 88 } });
    const ctx = resolveGitHubActionsContext(env, fileReader);
    expect(ctx?.prNumber).toBe(88);
  });

  test("falls back to GITHUB_REF when event payload file read fails", () => {
    const env = makeGitHubEnv({
      GITHUB_EVENT_PATH: "/tmp/event.json",
      GITHUB_REF: "refs/pull/12/merge",
    });
    const fileReader = () => {
      throw new Error("file not found");
    };
    const ctx = resolveGitHubActionsContext(env, fileReader);
    expect(ctx?.prNumber).toBe(12);
  });

  test("throws when GitHub Actions detected but PR number cannot be resolved", () => {
    const env = createStubEnvironment({
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "myorg/myrepo",
    });
    expect(() => resolveGitHubActionsContext(env)).toThrow("could not determine PR number");
  });

  test("splits GITHUB_REPOSITORY into owner and repo", () => {
    const env = makeGitHubEnv({ GITHUB_REPOSITORY: "acme/widget" });
    const ctx = resolveGitHubActionsContext(env);
    expect(ctx?.githubOwner).toBe("acme");
    expect(ctx?.githubRepo).toBe("widget");
  });

  test("populates token from GITHUB_TOKEN", () => {
    const env = makeGitHubEnv({ GITHUB_TOKEN: "secret-token" });
    const ctx = resolveGitHubActionsContext(env);
    expect(ctx?.githubToken).toBe("secret-token");
  });

  test("returns platform as github", () => {
    const env = makeGitHubEnv();
    const ctx = resolveGitHubActionsContext(env);
    expect(ctx?.platform).toBe("github");
  });

  test("returns ciSystem as github-actions", () => {
    const env = makeGitHubEnv();
    const ctx = resolveGitHubActionsContext(env);
    expect(ctx?.ciSystem).toBe("github-actions");
  });
});

// ---------------------------------------------------------------------------
// resolveAzurePipelinesContext
// ---------------------------------------------------------------------------

describe("resolveAzurePipelinesContext", () => {
  test("returns null when TF_BUILD is not set", () => {
    const env = createStubEnvironment({});
    expect(resolveAzurePipelinesContext(env)).toBeNull();
  });

  test("returns null when TF_BUILD is not exactly 'True'", () => {
    const env = createStubEnvironment({ TF_BUILD: "true" });
    expect(resolveAzurePipelinesContext(env)).toBeNull();
  });

  test("throws when Azure Pipelines detected but PR number is missing", () => {
    const env = createStubEnvironment({ TF_BUILD: "True" });
    expect(() => resolveAzurePipelinesContext(env)).toThrow("could not determine PR number");
  });

  test("throws when SYSTEM_PULLREQUEST_PULLREQUESTID is not a valid number", () => {
    const env = makeAzureEnv({ SYSTEM_PULLREQUEST_PULLREQUESTID: "not-a-number" });
    expect(() => resolveAzurePipelinesContext(env)).toThrow("could not determine PR number");
  });

  test("resolves PR number from SYSTEM_PULLREQUEST_PULLREQUESTID", () => {
    const env = makeAzureEnv({ SYSTEM_PULLREQUEST_PULLREQUESTID: "99" });
    const ctx = resolveAzurePipelinesContext(env);
    expect(ctx?.prNumber).toBe(99);
  });

  test("extracts org from modern dev.azure.com collection URI", () => {
    const env = makeAzureEnv({
      SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: "https://dev.azure.com/contoso/",
    });
    const ctx = resolveAzurePipelinesContext(env);
    expect(ctx?.azureOrg).toBe("contoso");
  });

  test("extracts org from legacy visualstudio.com collection URI", () => {
    const env = makeAzureEnv({
      SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: "https://contoso.visualstudio.com/",
    });
    const ctx = resolveAzurePipelinesContext(env);
    expect(ctx?.azureOrg).toBe("contoso");
  });

  test("populates token from SYSTEM_ACCESSTOKEN", () => {
    const env = makeAzureEnv({ SYSTEM_ACCESSTOKEN: "pipeline-token" });
    const ctx = resolveAzurePipelinesContext(env);
    expect(ctx?.azureToken).toBe("pipeline-token");
  });

  test("populates project from SYSTEM_TEAMPROJECT", () => {
    const env = makeAzureEnv({ SYSTEM_TEAMPROJECT: "AlphaProject" });
    const ctx = resolveAzurePipelinesContext(env);
    expect(ctx?.azureProject).toBe("AlphaProject");
  });

  test("populates repo from BUILD_REPOSITORY_NAME", () => {
    const env = makeAzureEnv({ BUILD_REPOSITORY_NAME: "alpha-repo" });
    const ctx = resolveAzurePipelinesContext(env);
    expect(ctx?.azureRepo).toBe("alpha-repo");
  });

  test("returns platform as azure", () => {
    const env = makeAzureEnv();
    const ctx = resolveAzurePipelinesContext(env);
    expect(ctx?.platform).toBe("azure");
  });

  test("returns ciSystem as azure-pipelines", () => {
    const env = makeAzureEnv();
    const ctx = resolveAzurePipelinesContext(env);
    expect(ctx?.ciSystem).toBe("azure-pipelines");
  });
});

// ---------------------------------------------------------------------------
// detectCIEnvironment
// ---------------------------------------------------------------------------

describe("detectCIEnvironment", () => {
  test("returns null when not in any CI environment", () => {
    const env = createStubEnvironment({});
    expect(detectCIEnvironment(env)).toBeNull();
  });

  test("detects GitHub Actions", () => {
    const env = makeGitHubEnv();
    const ctx = detectCIEnvironment(env);
    expect(ctx?.ciSystem).toBe("github-actions");
  });

  test("detects Azure Pipelines", () => {
    const env = makeAzureEnv();
    const ctx = detectCIEnvironment(env);
    expect(ctx?.ciSystem).toBe("azure-pipelines");
  });

  test("prefers GitHub Actions over Azure Pipelines when both signals present", () => {
    const env = createStubEnvironment({
      GITHUB_ACTIONS: "true",
      GITHUB_TOKEN: "gh-token",
      GITHUB_REPOSITORY: "myorg/myrepo",
      GITHUB_REF: "refs/pull/1/merge",
      TF_BUILD: "True",
      SYSTEM_PULLREQUEST_PULLREQUESTID: "2",
    });
    const ctx = detectCIEnvironment(env);
    expect(ctx?.ciSystem).toBe("github-actions");
  });

  test("passes fileReader through to GitHub Actions resolver", () => {
    const env = createStubEnvironment({
      GITHUB_ACTIONS: "true",
      GITHUB_TOKEN: "gh-token",
      GITHUB_REPOSITORY: "myorg/myrepo",
      GITHUB_EVENT_PATH: "/tmp/event.json",
    });
    const fileReader = () => JSON.stringify({ number: 77 });
    const ctx = detectCIEnvironment(env, fileReader);
    expect(ctx?.prNumber).toBe(77);
  });
});
