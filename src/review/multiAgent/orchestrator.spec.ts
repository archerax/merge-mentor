import { describe, expect, it, vi } from "vitest";
import type { AIProviderClient, AIResponse, ExecutePromptOptions } from "../../ai/types.js";
import type { PRDetails } from "../../platforms/types.js";
import type { DiffManifest } from "../diffStorage.js";
import { MultiAgentOrchestrator } from "./orchestrator.js";

function createPRDetails(): PRDetails {
  return {
    number: 123,
    title: "Test PR",
    description: "A test description",
    author: "testuser",
    baseBranch: "main",
    headBranch: "feature/test",
  };
}

function createManifest(): DiffManifest {
  return {
    prIdentifier: "GitHub-owner-repo-PR123",
    files: [
      {
        filename: "src/auth.ts",
        status: "modified",
        diffPath: "src__auth.ts.diff",
        additions: 20,
        deletions: 5,
      },
    ],
    createdAt: "2026-08-06T00:00:00.000Z",
  };
}

function createFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    file: "src/auth.ts",
    line: 12,
    severity: "high",
    confidence: "high",
    category: "security",
    message: "SQL injection risk",
    suggestion: "Use parameterized queries",
    reasoning: "User input is concatenated into a SQL query on an added line, enabling injection.",
    isPreExisting: false,
    ...overrides,
  };
}

function createResponse(parsed: unknown): AIResponse {
  return {
    raw: JSON.stringify(parsed),
    parsed,
    tokenUsage: { inputTokens: 100, outputTokens: 50 },
  };
}

function createMockProvider(): {
  provider: AIProviderClient;
  execute: ReturnType<typeof vi.fn>;
  setResponder: (
    fn: (prompt: string, options?: ExecutePromptOptions) => Promise<AIResponse>
  ) => void;
  getCalls: () => { promptType: string; prompt: string }[];
} {
  const calls: { promptType: string; prompt: string }[] = [];
  let responder: (prompt: string, options?: ExecutePromptOptions) => Promise<AIResponse> =
    async () => createResponse({});

  const execute = vi.fn(async (prompt: string, options?: ExecutePromptOptions) => {
    calls.push({ promptType: options?.promptType ?? "unknown", prompt });
    return responder(prompt, options);
  });

  const provider: AIProviderClient = {
    executePrompt: execute,
    parseFileReview: vi.fn(),
    parseCrossFileReview: vi.fn(),
    parseBatchedFileReview: vi.fn(),
    parseFastReview: vi.fn(),
  };

  return {
    provider,
    execute,
    setResponder: (fn) => {
      responder = fn;
    },
    getCalls: () => calls,
  };
}

describe("MultiAgentOrchestrator", () => {
  it("classifies, dispatches selected subagents, then synthesizes", async () => {
    const { provider, getCalls, setResponder } = createMockProvider();

    setResponder(async (_prompt: string, options?: ExecutePromptOptions) => {
      switch (options?.promptType) {
        case "multi-agent-classifier":
          return createResponse({ agents: ["security", "testing"] });
        case "multi-agent-subagent":
          return createResponse({ findings: [createFinding()] });
        case "multi-agent-synthesizer":
          return createResponse({
            overall_assessment: "Solid PR with minor concerns.",
            findings: [createFinding()],
            recommendations: ["Add integration tests"],
          });
        default:
          return createResponse({});
      }
    });

    const orchestrator = new MultiAgentOrchestrator(provider, {
      minConfidence: 0.7,
      maxParallel: 2,
    });

    const output = await orchestrator.review({
      prDetails: createPRDetails(),
      manifest: createManifest(),
    });

    const calls = getCalls();
    const promptTypes = calls.map((c) => c.promptType);
    expect(promptTypes).toContain("multi-agent-classifier");
    expect(promptTypes).toContain("multi-agent-subagent");
    expect(promptTypes).toContain("multi-agent-synthesizer");

    // Only the classifier-selected agents were dispatched.
    expect(calls.filter((c) => c.promptType === "multi-agent-subagent")).toHaveLength(2);
    expect(output.dispatchedAgents).toEqual(["security", "testing"]);

    expect(output.fileResults).toEqual([
      {
        filename: "src/auth.ts",
        findings: [expect.objectContaining({ message: "SQL injection risk", line: 12 })],
      },
    ]);
    expect(output.crossFileResult.overallAssessment).toBe("Solid PR with minor concerns.");
    expect(output.crossFileResult.recommendations).toEqual(["Add integration tests"]);
    expect(output.tokenUsage).toBeDefined();
  });

  it("runs all four agents with no passes and falls back to all when classifier fails", async () => {
    const { provider, getCalls, setResponder } = createMockProvider();

    setResponder(async (_prompt: string, options?: ExecutePromptOptions) => {
      if (options?.promptType === "multi-agent-classifier") {
        throw new Error("classifier unavailable");
      }
      if (options?.promptType === "multi-agent-subagent") {
        return createResponse({ findings: [] });
      }
      return createResponse({
        overall_assessment: "Review completed",
        findings: [],
        recommendations: [],
      });
    });

    const orchestrator = new MultiAgentOrchestrator(provider);
    const output = await orchestrator.review({
      prDetails: createPRDetails(),
      manifest: createManifest(),
    });

    const subagentCalls = getCalls().filter((c) => c.promptType === "multi-agent-subagent");
    expect(subagentCalls).toHaveLength(4);
    expect(output.dispatchedAgents).toEqual(["security", "performance", "testing", "architecture"]);
  });

  it("resolves enabled agents from passes", async () => {
    const { provider, getCalls, setResponder } = createMockProvider();

    setResponder(async (_prompt: string, options?: ExecutePromptOptions) => {
      if (options?.promptType === "multi-agent-classifier") {
        return createResponse({ agents: ["security", "performance", "testing", "architecture"] });
      }
      if (options?.promptType === "multi-agent-subagent") {
        return createResponse({ findings: [] });
      }
      return createResponse({
        overall_assessment: "Review completed",
        findings: [],
        recommendations: [],
      });
    });

    const orchestrator = new MultiAgentOrchestrator(provider, { passes: ["security", "database"] });
    const output = await orchestrator.review({
      prDetails: createPRDetails(),
      manifest: createManifest(),
    });

    expect(output.dispatchedAgents).toEqual(["security", "performance"]);
    const subagentCalls = getCalls().filter((c) => c.promptType === "multi-agent-subagent");
    expect(subagentCalls).toHaveLength(2);
  });

  it("drops findings below the configured minConfidence", async () => {
    const { provider, setResponder } = createMockProvider();

    setResponder(async (_prompt: string, options?: ExecutePromptOptions) => {
      switch (options?.promptType) {
        case "multi-agent-classifier":
          return createResponse({ agents: ["security"] });
        case "multi-agent-subagent":
          return createResponse({ findings: [] });
        case "multi-agent-synthesizer":
          return createResponse({
            overall_assessment: "Review completed",
            findings: [
              createFinding({ confidence: "high", message: "high confidence issue" }),
              createFinding({ confidence: "medium", message: "medium confidence issue" }),
              createFinding({ confidence: "low", message: "low confidence issue" }),
            ],
            recommendations: [],
          });
        default:
          return createResponse({});
      }
    });

    const orchestrator = new MultiAgentOrchestrator(provider, { minConfidence: 0.7 });
    const output = await orchestrator.review({
      prDetails: createPRDetails(),
      manifest: createManifest(),
    });

    expect(output.fileResults[0].findings).toHaveLength(1);
    expect(output.fileResults[0].findings[0].message).toBe("high confidence issue");
  });

  it("applies the confidence threshold to cross-file findings as well", async () => {
    const { provider, setResponder } = createMockProvider();

    setResponder(async (_prompt: string, options?: ExecutePromptOptions) => {
      switch (options?.promptType) {
        case "multi-agent-classifier":
          return createResponse({ agents: ["architecture"] });
        case "multi-agent-subagent":
          return createResponse({ findings: [] });
        case "multi-agent-synthesizer":
          return createResponse({
            overall_assessment: "Review completed",
            findings: [
              {
                severity: "high",
                confidence: "medium",
                category: "architecture",
                message: "layering violation",
                reasoning: "The new module reaches across layers on added lines.",
                affected_files: ["src/auth.ts"],
              },
            ],
            recommendations: [],
          });
        default:
          return createResponse({});
      }
    });

    const orchestrator = new MultiAgentOrchestrator(provider, { minConfidence: 0.7 });
    const output = await orchestrator.review({
      prDetails: createPRDetails(),
      manifest: createManifest(),
    });

    expect(output.crossFileResult.findings).toHaveLength(0);
  });

  it("keeps cross-file findings above the confidence threshold", async () => {
    const { provider, setResponder } = createMockProvider();

    setResponder(async (_prompt: string, options?: ExecutePromptOptions) => {
      switch (options?.promptType) {
        case "multi-agent-classifier":
          return createResponse({ agents: ["architecture"] });
        case "multi-agent-subagent":
          return createResponse({ findings: [] });
        case "multi-agent-synthesizer":
          return createResponse({
            overall_assessment: "Review completed",
            findings: [
              {
                severity: "high",
                confidence: "high",
                category: "architecture",
                message: "layering violation",
                reasoning: "The new module reaches across layers on added lines.",
                affected_files: ["src/auth.ts"],
              },
            ],
            recommendations: ["Restructure the module"],
          });
        default:
          return createResponse({});
      }
    });

    const orchestrator = new MultiAgentOrchestrator(provider, { minConfidence: 0.7 });
    const output = await orchestrator.review({
      prDetails: createPRDetails(),
      manifest: createManifest(),
    });

    expect(output.crossFileResult.findings).toHaveLength(1);
    expect(output.crossFileResult.findings[0].affectedFiles).toEqual(["src/auth.ts"]);
    expect(output.crossFileResult.recommendations).toEqual(["Restructure the module"]);
  });

  it("aggregates token usage across agent and synthesizer calls", async () => {
    const { provider, setResponder } = createMockProvider();

    setResponder(async (_prompt: string, options?: ExecutePromptOptions) => {
      if (options?.promptType === "multi-agent-classifier") {
        return createResponse({ agents: ["security"] });
      }
      if (options?.promptType === "multi-agent-subagent") {
        return createResponse({ findings: [] });
      }
      return createResponse({
        overall_assessment: "Review completed",
        findings: [],
        recommendations: [],
      });
    });

    const orchestrator = new MultiAgentOrchestrator(provider);
    const output = await orchestrator.review({
      prDetails: createPRDetails(),
      manifest: createManifest(),
    });

    // classifier (100/50) + subagent (100/50) + synthesizer (100/50)
    expect(output.tokenUsage?.inputTokens).toBe(300);
    expect(output.tokenUsage?.outputTokens).toBe(150);
  });
});
