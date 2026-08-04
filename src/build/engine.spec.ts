import { describe, expect, it, vi } from "vitest";
import type { AIProviderClient } from "../ai/types.js";
import type { FileSystem } from "../ports/fileSystem.js";
import { analyzeBuild } from "./engine.js";
import { BuildAnalysisError } from "./errors.js";
import type { BuildAnalysisProvider, BuildReference } from "./types.js";

const reference: BuildReference = {
  platform: "github",
  id: "42",
  ownerOrOrg: "acme",
  repository: "widget",
};

function provider(overrides: Partial<BuildAnalysisProvider> = {}): BuildAnalysisProvider {
  return {
    getBuildSummary: vi.fn().mockResolvedValue({
      id: "42",
      name: "CI",
      status: "completed",
      result: "failed",
    }),
    getFailedLogs: vi
      .fn()
      .mockResolvedValue([{ jobName: "tests", content: "FAIL test", isFailureCandidate: true }]),
    ...overrides,
  };
}

function fileSystem(): FileSystem {
  return {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  } as unknown as FileSystem;
}

describe("analyzeBuild", () => {
  it.each([
    ["inProgress", "still running"],
    ["succeeded", "completed successfully"],
  ] as const)("rejects a build that is %s", async (result, message) => {
    const buildProvider = provider({
      getBuildSummary: vi.fn().mockResolvedValue({
        id: "42",
        name: "CI",
        status: result === "inProgress" ? "inProgress" : "completed",
        result,
      }),
    });

    await expect(analyzeBuild(reference, buildProvider)).rejects.toThrow(message);
    await expect(analyzeBuild(reference, buildProvider)).rejects.toBeInstanceOf(BuildAnalysisError);
  });

  it("creates a fallback report when no AI provider is configured", async () => {
    const result = await analyzeBuild(reference, provider(), {
      tempPath: ".tmp-test",
      fileSystem: fileSystem(),
    });

    expect(result.diagnosis.failureType).toBe("unknown");
    expect(result.diagnosis.limitations).toContain("No AI provider was configured.");
    expect(result.report).toContain("CI Build Failure Analysis");
    expect(result.logDirectory).toMatch(/\.tmp-test/);
  });

  it("falls back when the AI response is invalid", async () => {
    const aiProvider = {
      executePrompt: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    } as unknown as AIProviderClient;

    const result = await analyzeBuild(reference, provider(), {
      aiProvider,
      fileSystem: fileSystem(),
    });

    expect(aiProvider.executePrompt).toHaveBeenCalledWith(
      expect.stringContaining("You are diagnosing one failed CI build"),
      expect.objectContaining({ promptType: "build-analysis" })
    );
    expect(result.diagnosis.limitations[0]).toContain("provider unavailable");
  });
});
