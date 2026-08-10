import { describe, expect, it, vi } from "vitest";
import type { AIProviderClient, AIResponse, ExecutePromptOptions } from "../../ai/types.js";
import type { PRDetails } from "../../platforms/types.js";
import type { OutputWriter } from "../../ports/index.js";
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
  getCalls: () => { promptType: string; prompt: string; streamed: boolean }[];
} {
  const calls: { promptType: string; prompt: string; streamed: boolean }[] = [];
  let responder: (prompt: string, options?: ExecutePromptOptions) => Promise<AIResponse> =
    async () => createResponse({});

  const execute = vi.fn(async (prompt: string, options?: ExecutePromptOptions) => {
    calls.push({
      promptType: options?.promptType ?? "unknown",
      prompt,
      streamed: options?.onStreamData !== undefined,
    });
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
  it("classifies, dispatches the general baseline plus selected subagents, then synthesizes", async () => {
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

    // The classifier-selected specialists plus the always-run general baseline.
    expect(calls.filter((c) => c.promptType === "multi-agent-subagent")).toHaveLength(3);
    expect(output.dispatchedAgents).toEqual(["general", "security", "testing"]);

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

  it("carries subagent cross-file findings into the synthesizer and surfaces them in the cross-file report", async () => {
    const { provider, getCalls, setResponder } = createMockProvider();

    setResponder(async (_prompt: string, options?: ExecutePromptOptions) => {
      switch (options?.promptType) {
        case "multi-agent-classifier":
          return createResponse({ agents: ["architecture"] });
        case "multi-agent-subagent":
          return createResponse({
            findings: [
              {
                severity: "high",
                confidence: "high",
                category: "architecture",
                message: "Layering violation spans modules",
                suggestion: "Move shared types into a common package",
                reasoning:
                  "Callers across multiple modules break the API contract; system-level impact.",
                affected_files: ["src/auth.ts", "src/api.ts"],
              },
            ],
          });
        case "multi-agent-synthesizer":
          return createResponse({
            overall_assessment: "Architecture concerns found.",
            findings: [
              {
                severity: "high",
                confidence: "high",
                category: "architecture",
                message: "Layering violation spans modules",
                reasoning:
                  "Callers across multiple modules break the API contract; system-level impact.",
                affected_files: ["src/auth.ts", "src/api.ts"],
              },
            ],
            recommendations: ["Restructure the modules"],
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

    const synthesizerPrompt = getCalls().find(
      (c) => c.promptType === "multi-agent-synthesizer"
    )?.prompt;
    expect(synthesizerPrompt).toContain("PR-level (files: src/auth.ts, src/api.ts)");
    expect(synthesizerPrompt).toContain("Layering violation spans modules");

    expect(output.fileResults).toEqual([]);
    expect(output.crossFileResult.findings).toEqual([
      expect.objectContaining({
        message: "Layering violation spans modules",
        affectedFiles: ["src/auth.ts", "src/api.ts"],
      }),
    ]);
    expect(output.agentResults[0].findings[0].affectedFiles).toEqual(["src/auth.ts", "src/api.ts"]);
  });

  it("runs all five agents with no passes and falls back to all when classifier fails", async () => {
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
    expect(subagentCalls).toHaveLength(5);
    expect(output.dispatchedAgents).toEqual([
      "general",
      "security",
      "performance",
      "testing",
      "architecture",
    ]);
  });

  it("resolves enabled agents from passes", async () => {
    const { provider, getCalls, setResponder } = createMockProvider();

    setResponder(async (_prompt: string, options?: ExecutePromptOptions) => {
      if (options?.promptType === "multi-agent-classifier") {
        return createResponse({
          agents: ["general", "security", "performance", "testing", "architecture"],
        });
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

    // The general baseline is not enabled for these passes, so it is not dispatched.
    expect(output.dispatchedAgents).toEqual(["security", "performance"]);
    const subagentCalls = getCalls().filter((c) => c.promptType === "multi-agent-subagent");
    expect(subagentCalls).toHaveLength(2);
  });

  it("skips the pre-classifier and dispatches only general when only general passes are enabled", async () => {
    const { provider, getCalls, setResponder } = createMockProvider();

    setResponder(async (_prompt: string, options?: ExecutePromptOptions) => {
      if (options?.promptType === "multi-agent-subagent") {
        return createResponse({ findings: [] });
      }
      return createResponse({
        overall_assessment: "Review completed",
        findings: [],
        recommendations: [],
      });
    });

    const orchestrator = new MultiAgentOrchestrator(provider, { passes: ["logic", "scan"] });
    const output = await orchestrator.review({
      prDetails: createPRDetails(),
      manifest: createManifest(),
    });

    expect(output.dispatchedAgents).toEqual(["general"]);
    const promptTypes = getCalls().map((c) => c.promptType);
    expect(promptTypes).not.toContain("multi-agent-classifier");
  });

  it("always dispatches the general baseline even when the classifier selects only specialists", async () => {
    const { provider, getCalls, setResponder } = createMockProvider();

    setResponder(async (_prompt: string, options?: ExecutePromptOptions) => {
      switch (options?.promptType) {
        case "multi-agent-classifier":
          return createResponse({ agents: ["security"] });
        case "multi-agent-subagent":
          return createResponse({ findings: [] });
        case "multi-agent-synthesizer":
          return createResponse({
            overall_assessment: "Review completed",
            findings: [],
            recommendations: [],
          });
        default:
          return createResponse({});
      }
    });

    const orchestrator = new MultiAgentOrchestrator(provider);
    const output = await orchestrator.review({
      prDetails: createPRDetails(),
      manifest: createManifest(),
    });

    expect(output.dispatchedAgents).toEqual(["general", "security"]);
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

    // classifier (100/50) + general subagent (100/50) + security subagent (100/50) + synthesizer (100/50)
    expect(output.tokenUsage?.inputTokens).toBe(400);
    expect(output.tokenUsage?.outputTokens).toBe(200);
  });

  it("streams live feedback for each phase when streaming is enabled", async () => {
    const { provider, setResponder, getCalls } = createMockProvider();

    setResponder(async (_prompt: string, options?: ExecutePromptOptions) => {
      if (options?.onStreamData) {
        options.onStreamData('{"streamed":');
      }
      switch (options?.promptType) {
        case "multi-agent-classifier":
          return createResponse({ agents: ["security", "performance"] });
        case "multi-agent-subagent":
          return createResponse({ findings: [createFinding()] });
        case "multi-agent-synthesizer":
          return createResponse({
            overall_assessment: "Review completed",
            findings: [],
            recommendations: [],
          });
        default:
          return createResponse({});
      }
    });

    const logLines: string[] = [];
    const written: string[] = [];
    const output: OutputWriter = {
      log: (message) => logLines.push(message),
      error: (message) => logLines.push(`ERROR: ${message}`),
      write: (data) => {
        written.push(data);
        return true;
      },
    };

    const orchestrator = new MultiAgentOrchestrator(provider, {
      output,
      streaming: { enabled: true, lines: 9, ciMode: true },
    });

    const result = await orchestrator.review({
      prDetails: createPRDetails(),
      manifest: createManifest(),
    });

    expect(result.dispatchedAgents).toEqual(["general", "security", "performance"]);

    // Every phase receives onStreamData: classifier and synthesizer stream
    // into their own display, subagents stream into the shared display.
    const calls = getCalls();
    expect(calls.find((c) => c.promptType === "multi-agent-classifier")?.streamed).toBe(true);
    expect(calls.find((c) => c.promptType === "multi-agent-synthesizer")?.streamed).toBe(true);
    for (const call of calls.filter((c) => c.promptType === "multi-agent-subagent")) {
      expect(call.streamed).toBe(true);
    }

    // Streamed model output reaches the output writer in CI mode.
    const allWritten = written.join("");
    expect(allWritten).toContain('{"streamed":');

    // Subagent chunks are prefixed with their agent id in the shared display.
    expect(allWritten).toContain('[general] {"streamed":');
    expect(allWritten).toContain('[security] {"streamed":');

    // Plain-text subagent progress reports agent activity.
    expect(logLines).toContain("  ⏳ [general] analyzing…");
    expect(logLines).toContain("  ⏳ [security] analyzing…");
    expect(logLines).toContain("  ⏳ [performance] analyzing…");
    expect(logLines.some((l) => l.includes("  ✓ [general] done — 1 finding(s) in"))).toBe(true);
    expect(logLines.some((l) => l.includes("  ✓ [security] done — 1 finding(s) in"))).toBe(true);
    expect(logLines.some((l) => l.includes("  ✓ [performance] done — 1 finding(s) in"))).toBe(true);

    // Static phase logs remain.
    expect(logLines).toContain("Running LLM pre-classifier to select relevant subagents...");
    expect(logLines).toContain("Dispatching 3 subagent(s): general, security, performance");
    expect(logLines).toContain("Running Lead Synthesizer over 3 subagent result(s)...");
  });

  it("passes no onStreamData when streaming is disabled", async () => {
    const { provider, setResponder, getCalls } = createMockProvider();

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

    const logLines: string[] = [];
    const output: OutputWriter = {
      log: (message) => logLines.push(message),
      error: (message) => logLines.push(`ERROR: ${message}`),
      write: () => true,
    };

    const orchestrator = new MultiAgentOrchestrator(provider, { output });
    const result = await orchestrator.review({
      prDetails: createPRDetails(),
      manifest: createManifest(),
    });

    expect(result.dispatchedAgents).toEqual(["general", "security"]);
    expect(getCalls().every((c) => !c.streamed)).toBe(true);
    expect(logLines).toContain("Dispatching 2 subagent(s): general, security");
    expect(logLines).toContain("  ⏳ [security] analyzing…");
    expect(logLines.some((l) => l.includes("  ✓ [security] done — 0 finding(s) in"))).toBe(true);
  });

  it("logs a still-working heartbeat while subagents run when streaming is inactive", async () => {
    vi.useFakeTimers();
    try {
      const { provider, setResponder } = createMockProvider();

      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      setResponder(async (_prompt: string, options?: ExecutePromptOptions) => {
        if (options?.promptType === "multi-agent-classifier") {
          return createResponse({ agents: ["security"] });
        }
        if (options?.promptType === "multi-agent-subagent") {
          await gate;
          return createResponse({ findings: [] });
        }
        return createResponse({
          overall_assessment: "Review completed",
          findings: [],
          recommendations: [],
        });
      });

      const logLines: string[] = [];
      const output: OutputWriter = {
        log: (message) => logLines.push(message),
        error: (message) => logLines.push(`ERROR: ${message}`),
        write: () => true,
      };

      const orchestrator = new MultiAgentOrchestrator(provider, { output });
      const reviewPromise = orchestrator.review({
        prDetails: createPRDetails(),
        manifest: createManifest(),
      });

      // Advance past the 10s heartbeat threshold while the subagent is still running.
      await vi.advanceTimersByTimeAsync(12_000);
      const heartbeatLines = logLines.filter((l) => l.includes("still working:"));
      expect(heartbeatLines.some((l) => l.includes("general"))).toBe(true);
      expect(heartbeatLines.some((l) => l.includes("security"))).toBe(true);

      release?.();
      const result = await reviewPromise;
      expect(result.dispatchedAgents).toEqual(["general", "security"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits a still-working heartbeat for silent subagents when streaming is active", async () => {
    vi.useFakeTimers();
    try {
      const { provider, setResponder } = createMockProvider();

      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      setResponder(async (_prompt: string, options?: ExecutePromptOptions) => {
        switch (options?.promptType) {
          case "multi-agent-classifier":
            return createResponse({ agents: ["security"] });
          case "multi-agent-subagent":
            await gate;
            return createResponse({ findings: [] });
          case "multi-agent-synthesizer":
            return createResponse({
              overall_assessment: "Review completed",
              findings: [],
              recommendations: [],
            });
          default:
            return createResponse({});
        }
      });

      const written: string[] = [];
      const output: OutputWriter = {
        log: (message) => written.push(message),
        error: (message) => written.push(`ERROR: ${message}`),
        write: (data) => {
          written.push(data);
          return true;
        },
      };

      const orchestrator = new MultiAgentOrchestrator(provider, {
        output,
        streaming: { enabled: true, lines: 9, ciMode: true },
      });
      const reviewPromise = orchestrator.review({
        prDetails: createPRDetails(),
        manifest: createManifest(),
      });

      // The gated subagents emit no tokens; the silence detector should
      // surface a "still working" line inside the shared display output.
      await vi.advanceTimersByTimeAsync(20_000);
      const displayOutput = written.join("");
      expect(displayOutput).toContain("still working:");
      expect(displayOutput).toContain("general");
      expect(displayOutput).toContain("security");

      release?.();
      const result = await reviewPromise;
      expect(result.dispatchedAgents).toEqual(["general", "security"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits a still-working heartbeat for a silent classifier when streaming is active", async () => {
    vi.useFakeTimers();
    try {
      const { provider, setResponder } = createMockProvider();

      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      setResponder(async (_prompt: string, options?: ExecutePromptOptions) => {
        switch (options?.promptType) {
          case "multi-agent-classifier":
            await gate;
            return createResponse({ agents: ["security"] });
          case "multi-agent-subagent":
            return createResponse({ findings: [] });
          case "multi-agent-synthesizer":
            return createResponse({
              overall_assessment: "Review completed",
              findings: [],
              recommendations: [],
            });
          default:
            return createResponse({});
        }
      });

      const written: string[] = [];
      const output: OutputWriter = {
        log: (message) => written.push(message),
        error: (message) => written.push(`ERROR: ${message}`),
        write: (data) => {
          written.push(data);
          return true;
        },
      };

      const orchestrator = new MultiAgentOrchestrator(provider, {
        output,
        streaming: { enabled: true, lines: 9, ciMode: true },
      });
      const reviewPromise = orchestrator.review({
        prDetails: createPRDetails(),
        manifest: createManifest(),
      });

      // The gated classifier emits no tokens; the silence detector should
      // surface a "still working" line inside its display output.
      await vi.advanceTimersByTimeAsync(20_000);
      expect(written.join("")).toContain("pre-classifier still working");

      release?.();
      const result = await reviewPromise;
      expect(result.dispatchedAgents).toEqual(["general", "security"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconciles synthesized findings that lost line numbers back to subagent locations", async () => {
    const { provider, setResponder } = createMockProvider();

    setResponder(async (_prompt: string, options?: ExecutePromptOptions) => {
      switch (options?.promptType) {
        case "multi-agent-classifier":
          return createResponse({ agents: ["security"] });
        case "multi-agent-subagent":
          return createResponse({
            findings: [
              createFinding({
                file: "src/auth.ts",
                line: 12,
                message: "SQL injection risk via string interpolation",
              }),
              createFinding({
                file: "src/db.ts",
                line: 45,
                category: "performance",
                message: "N+1 query pattern in user listing",
              }),
            ],
          });
        case "multi-agent-synthesizer":
          // The synthesizer drops the line number (defaults to 0) on one finding.
          return createResponse({
            overall_assessment: "Review completed",
            findings: [
              {
                file: "src/auth.ts",
                line: 0,
                severity: "high",
                confidence: "high",
                category: "security",
                message: "SQL injection risk via string interpolation",
                suggestion: "Use parameterized queries",
                reasoning: "User input is concatenated into a SQL query.",
                isPreExisting: false,
              },
              {
                file: "src/db.ts",
                line: 45,
                severity: "high",
                confidence: "high",
                category: "performance",
                message: "N+1 query pattern in user listing",
                suggestion: "Batch the queries",
                reasoning: "The listing triggers one query per user.",
                isPreExisting: false,
              },
            ],
            recommendations: [],
          });
        default:
          return createResponse({});
      }
    });

    const orchestrator = new MultiAgentOrchestrator(provider);
    const output = await orchestrator.review({
      prDetails: createPRDetails(),
      manifest: createManifest(),
    });

    const authFindings = output.fileResults.find((r) => r.filename === "src/auth.ts");
    const dbFindings = output.fileResults.find((r) => r.filename === "src/db.ts");

    // The line was recovered from the subagent finding by message similarity.
    expect(authFindings?.findings[0].line).toBe(12);
    // The finding that already carried a valid location is untouched.
    expect(dbFindings?.findings[0].line).toBe(45);
  });

  it("keeps synthesized findings that cannot be reconciled to a confident location", async () => {
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
              {
                file: "src/auth.ts",
                line: 0,
                severity: "high",
                confidence: "high",
                category: "security",
                message: "Something completely unrelated to subagent output",
                suggestion: "Fix it",
                reasoning: "No matching subagent finding exists.",
                isPreExisting: false,
              },
            ],
            recommendations: [],
          });
        default:
          return createResponse({});
      }
    });

    const orchestrator = new MultiAgentOrchestrator(provider);
    const output = await orchestrator.review({
      prDetails: createPRDetails(),
      manifest: createManifest(),
    });

    // No confident match: the synthesized finding survives with its original line.
    expect(output.fileResults[0].filename).toBe("src/auth.ts");
    expect(output.fileResults[0].findings).toHaveLength(1);
  });
});
