import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeBuildAnalyze } from "./build.js";

const {
  mockCreateAIProvider,
  mockAnalyzeBuild,
  mockCreateBuildReference,
  mockGithubProvider,
  mockAzureProvider,
  mockWriteFile,
} = vi.hoisted(() => ({
  mockCreateAIProvider: vi.fn(),
  mockAnalyzeBuild: vi.fn(),
  mockCreateBuildReference: vi.fn(),
  mockGithubProvider: vi.fn(),
  mockAzureProvider: vi.fn(),
  mockWriteFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  writeFile: mockWriteFile,
}));

vi.mock("../ai/providerFactory.js", () => ({
  createAIProvider: mockCreateAIProvider,
}));

vi.mock("../build/index.js", () => ({
  analyzeBuild: mockAnalyzeBuild,
  createBuildReference: mockCreateBuildReference,
  GithubBuildProvider: mockGithubProvider,
  AzureBuildProvider: mockAzureProvider,
}));

const output = {
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  write: vi.fn(),
};

function environment(values: Record<string, string | undefined>) {
  return { get: (name: string) => values[name] };
}

describe("build command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateBuildReference.mockImplementation((reference) => reference);
    mockCreateAIProvider.mockReturnValue({ executePrompt: vi.fn() });
    mockAnalyzeBuild.mockResolvedValue({ report: "# diagnosis" });
  });

  it("rejects write mode before creating providers", async () => {
    await expect(executeBuildAnalyze({ write: true }, { output })).rejects.toThrow(
      "--write is not supported"
    );

    expect(mockCreateAIProvider).not.toHaveBeenCalled();
    expect(mockAnalyzeBuild).not.toHaveBeenCalled();
  });

  it("rejects unsupported output formats", async () => {
    await expect(executeBuildAnalyze({ format: "json" }, { output })).rejects.toThrow(
      "Only --format markdown is supported"
    );
  });

  it("resolves Azure CI context and uses the pipeline bearer token", async () => {
    await executeBuildAnalyze(
      { ci: true, provider: "opencode-sdk" },
      {
        env: environment({
          TF_BUILD: "True",
          SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: "https://dev.azure.com/acme/",
          SYSTEM_TEAMPROJECT: "payments",
          BUILD_REPOSITORY_NAME: "checkout",
          BUILD_BUILDID: "42",
          SYSTEM_ACCESSTOKEN: "pipeline-token",
        }),
        output,
      }
    );

    expect(mockCreateBuildReference).toHaveBeenCalledWith({
      platform: "azure",
      runId: undefined,
      buildId: "42",
      owner: undefined,
      repo: "checkout",
      org: "acme",
      project: "payments",
    });
    expect(mockAzureProvider).toHaveBeenCalledWith("pipeline-token", "acme", "bearer");
    expect(mockCreateAIProvider).toHaveBeenCalledWith("opencode-sdk", expect.any(Object));
    expect(mockAnalyzeBuild).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "azure", buildId: "42" }),
      expect.anything(),
      expect.objectContaining({ aiProvider: expect.anything() })
    );
    expect(output.log).toHaveBeenCalledWith("# diagnosis");
  });

  it("writes a GitHub report to the requested output path", async () => {
    await executeBuildAnalyze(
      {
        platform: "github",
        runId: "99",
        githubToken: "github-token",
        githubRepoOwner: "acme",
        githubRepoName: "checkout",
        output: "post-mortem.md",
        maxLogBytes: 1200,
      },
      { output }
    );

    expect(mockGithubProvider).toHaveBeenCalledWith("github-token");
    expect(mockAnalyzeBuild).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "github", runId: "99" }),
      expect.anything(),
      expect.objectContaining({ maxLogBytes: 1200, aiProvider: expect.anything() })
    );
    expect(mockWriteFile).toHaveBeenCalledWith("post-mortem.md", "# diagnosis", "utf8");
    expect(output.log).not.toHaveBeenCalled();
  });

  it("loads shared MM configuration from the environment", async () => {
    await executeBuildAnalyze(
      { platform: "github", runId: "99" },
      {
        env: environment({
          MM_GITHUB_TOKEN: "env-github-token",
          MM_GITHUB_REPO_OWNER: "env-owner",
          MM_GITHUB_REPO_NAME: "env-repo",
          MM_AI_PROVIDER: "opencode-sdk",
          MM_AI_MODEL: "env-model",
          MM_AI_TIMEOUT: "45000",
          MM_AI_BASE_URL: "https://ai.example.test/v1",
          MM_AI_API_KEY: "env-api-key",
        }),
        output,
      }
    );

    expect(mockCreateBuildReference).toHaveBeenCalledWith({
      platform: "github",
      runId: "99",
      buildId: undefined,
      owner: "env-owner",
      repo: "env-repo",
      org: undefined,
      project: undefined,
    });
    expect(mockGithubProvider).toHaveBeenCalledWith("env-github-token");
    expect(mockCreateAIProvider).toHaveBeenCalledWith("opencode-sdk", {
      model: "env-model",
      token: undefined,
      timeoutMs: 45000,
      aiBaseUrl: "https://ai.example.test/v1",
      aiApiKey: "env-api-key",
      tempPath: resolve(".mergementor"),
    });
  });

  it("uses MM_PLATFORM when no platform flag is provided", async () => {
    await executeBuildAnalyze(
      { buildId: "42" },
      {
        env: environment({
          MM_PLATFORM: "azure",
          MM_AZURE_TOKEN: "env-azure-token",
          MM_AZURE_ORG: "env-org",
          MM_AZURE_PROJECT: "env-project",
          MM_AZURE_REPO: "env-repo",
        }),
        output,
      }
    );

    expect(mockCreateBuildReference).toHaveBeenCalledWith({
      platform: "azure",
      runId: undefined,
      buildId: "42",
      owner: undefined,
      repo: "env-repo",
      org: "env-org",
      project: "env-project",
    });
    expect(mockAzureProvider).toHaveBeenCalledWith("env-azure-token", "env-org", "pat");
  });
});
