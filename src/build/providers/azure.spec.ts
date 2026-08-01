import type { IBuildApi } from "azure-devops-node-api/BuildApi.js";
import { BuildResult, BuildStatus } from "azure-devops-node-api/interfaces/BuildInterfaces.js";
import { describe, expect, it, vi } from "vitest";
import { type AzureBuildConnection, AzureBuildProvider } from "./azure.js";

const reference = {
  platform: "azure" as const,
  id: "42",
  ownerOrOrg: "org",
  project: "project",
  repository: "repo",
};

function connection(api: Partial<IBuildApi>): AzureBuildConnection {
  return { getBuildApi: vi.fn().mockResolvedValue(api as IBuildApi) };
}

describe("AzureBuildProvider", () => {
  it("maps the SDK build and log APIs into analysis data", async () => {
    const api: Partial<IBuildApi> = {
      getBuild: vi.fn().mockResolvedValue({
        id: 42,
        buildNumber: "2026.08.01.1",
        status: BuildStatus.Completed,
        result: BuildResult.Failed,
        sourceBranch: "refs/heads/main",
        sourceVersion: "abc123",
        startTime: new Date("2026-08-01T10:00:00Z"),
        finishTime: new Date("2026-08-01T10:02:00Z"),
      }),
      getBuildLogs: vi.fn().mockResolvedValue([{ id: 7 }]),
      getBuildLogLines: vi.fn().mockResolvedValue(["compile failed", "exit 1"]),
    };
    const provider = new AzureBuildProvider("token", "org", "pat", connection(api));

    await expect(provider.getBuildSummary(reference)).resolves.toMatchObject({
      id: "42",
      name: "2026.08.01.1",
      status: "completed",
      result: "failed",
      sourceBranch: "refs/heads/main",
      commitSha: "abc123",
    });
    await expect(provider.getFailedLogs(reference)).resolves.toEqual([
      { sequence: 7, content: "compile failed\nexit 1", isFailureCandidate: true },
    ]);
    expect(api.getBuildLogLines).toHaveBeenCalledWith("project", 42, 7);
  });

  it("surfaces failures while retrieving a log", async () => {
    const api: Partial<IBuildApi> = {
      getBuildLogs: vi.fn().mockResolvedValue([{ id: 7 }]),
      getBuildLogLines: vi.fn().mockRejectedValue(new Error("forbidden")),
    };
    const provider = new AzureBuildProvider("token", "org", "bearer", connection(api));

    await expect(provider.getFailedLogs(reference)).rejects.toThrow(
      "Failed to retrieve Azure build log 7: forbidden"
    );
  });
});
