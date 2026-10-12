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
      getBuildLogs: vi.fn().mockResolvedValue([{ id: 7 }, { id: 8 }]),
      getBuildLogLines: vi
        .fn()
        .mockImplementation((_project, _build, id) =>
          Promise.resolve(
            id === 7 ? ["compile failed", "exit 1"] : ["Build completed successfully"]
          )
        ),
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
    expect(api.getBuildLogLines).toHaveBeenCalledWith("project", 42, 8);
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

  it("selects logs from failed timeline records", async () => {
    const api: Partial<IBuildApi> = {
      getBuildLogs: vi.fn().mockResolvedValue([{ id: 7 }, { id: 8 }]),
      getBuildTimeline: vi.fn().mockResolvedValue({
        records: [
          { result: "failed", log: { id: 7 } },
          { result: "succeeded", log: { id: 8 } },
          { result: "canceled", log: { id: undefined } },
        ],
      }),
      getBuildLogLines: vi
        .fn()
        .mockImplementation((_project, _build, id) =>
          Promise.resolve(id === 7 ? ["boom"] : ["ok"])
        ),
    };
    const provider = new AzureBuildProvider("token", "org", "pat", connection(api));

    await expect(provider.getFailedLogs(reference)).resolves.toEqual([
      { sequence: 7, content: "boom", isFailureCandidate: true },
    ]);
  });

  it("falls back to pattern matching when no failed timeline records exist", async () => {
    const api: Partial<IBuildApi> = {
      getBuildLogs: vi.fn().mockResolvedValue([{ id: 7 }, { id: 8 }]),
      getBuildTimeline: vi.fn().mockResolvedValue({
        records: [{ result: "succeeded", log: { id: 8 } }],
      }),
      getBuildLogLines: vi
        .fn()
        .mockImplementation((_project, _build, id) =>
          Promise.resolve(id === 7 ? ["npm ERR! failed"] : ["ok"])
        ),
    };
    const provider = new AzureBuildProvider("token", "org", "pat", connection(api));

    await expect(provider.getFailedLogs(reference)).resolves.toEqual([
      { sequence: 7, content: "npm ERR! failed", isFailureCandidate: true },
    ]);
  });

  it("skips log entries without an id", async () => {
    const api: Partial<IBuildApi> = {
      getBuildLogs: vi.fn().mockResolvedValue([{ id: undefined }, { id: 7 }]),
      getBuildTimeline: vi.fn().mockResolvedValue({ records: [] }),
      getBuildLogLines: vi.fn().mockResolvedValue(["failed"]),
    };
    const provider = new AzureBuildProvider("token", "org", "pat", connection(api));

    await expect(provider.getFailedLogs(reference)).resolves.toHaveLength(1);
    expect(api.getBuildLogLines).toHaveBeenCalledTimes(1);
  });

  it("creates a real connection for pat and bearer auth modes", () => {
    expect(new AzureBuildProvider("token", "org", "pat")).toBeInstanceOf(AzureBuildProvider);
    expect(new AzureBuildProvider("token", "org", "bearer")).toBeInstanceOf(AzureBuildProvider);
  });
});
