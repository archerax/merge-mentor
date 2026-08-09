import { describe, expect, it } from "vitest";
import type { PRDetails } from "../../../platforms/types.js";
import type { DiffManifest } from "../../../review/diffStorage.js";
import { buildAgentPrompt, buildPreClassifierPrompt, buildSynthesizerPrompt } from "./prompts.js";

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
      {
        filename: "src/api.ts",
        status: "added",
        diffPath: "src__api.ts.diff",
        additions: 45,
        deletions: 0,
      },
    ],
    createdAt: "2026-08-06T00:00:00.000Z",
  };
}

describe("multi-agent prompts", () => {
  describe("buildPreClassifierPrompt", () => {
    it("asks the model to select relevant subagents", () => {
      const prompt = buildPreClassifierPrompt({
        prDetails: createPRDetails(),
        files: createManifest().files,
        enabledAgents: ["security", "performance", "testing", "architecture"],
      });

      expect(prompt).toContain("SELECT RELEVANT SUBAGENTS");
      expect(prompt).toContain("src/auth.ts");
      expect(prompt).toContain("src/api.ts");
      expect(prompt).toContain("security");
      expect(prompt).toContain("performance");
      expect(prompt).toContain('"agents"');
    });

    it("only lists enabled agents as selectable ids", () => {
      const prompt = buildPreClassifierPrompt({
        prDetails: createPRDetails(),
        files: createManifest().files,
        enabledAgents: ["security", "testing"],
      });

      expect(prompt).toContain("security, testing");
      expect(prompt).not.toContain("performance:");
    });

    it("notes when the general baseline always runs and is excluded", () => {
      const prompt = buildPreClassifierPrompt({
        prDetails: createPRDetails(),
        files: createManifest().files,
        enabledAgents: ["security", "performance", "testing", "architecture"],
        generalAlwaysRuns: true,
      });

      expect(prompt).toContain("General Logic & Correctness Agent always runs");
      expect(prompt).not.toContain("- general:");
      expect(prompt).toContain(
        "Use only these agent ids: security, performance, testing, architecture"
      );
    });

    it("omits the always-run note when the general baseline is not enabled", () => {
      const prompt = buildPreClassifierPrompt({
        prDetails: createPRDetails(),
        files: createManifest().files,
        enabledAgents: ["security", "testing"],
      });

      expect(prompt).not.toContain("always runs");
    });
  });

  describe("buildAgentPrompt", () => {
    it("builds a general agent prompt with its focus areas", () => {
      const prompt = buildAgentPrompt({
        agent: "general",
        prDetails: createPRDetails(),
        manifest: createManifest(),
      });

      expect(prompt).toContain("SPECIALIZED SUBAGENT");
      expect(prompt).toContain("General Logic & Correctness Agent");
      expect(prompt).toContain("edge cases");
      expect(prompt).toContain("error propagation");
      expect(prompt).toContain("src/auth.ts");
    });

    it("builds a security agent prompt with its focus areas", () => {
      const prompt = buildAgentPrompt({
        agent: "security",
        prDetails: createPRDetails(),
        manifest: createManifest(),
      });

      expect(prompt).toContain("SPECIALIZED SUBAGENT");
      expect(prompt).toContain("Security & Trust Agent");
      expect(prompt).toContain("OWASP");
      expect(prompt).toContain("injection");
      expect(prompt).toContain("secret");
      expect(prompt).toContain("src/auth.ts");
    });

    it("builds a performance agent prompt with its focus areas", () => {
      const prompt = buildAgentPrompt({
        agent: "performance",
        prDetails: createPRDetails(),
        manifest: createManifest(),
      });

      expect(prompt).toContain("Performance & Scalability Agent");
      expect(prompt).toContain("N+1");
      expect(prompt).toContain("unindexed");
      expect(prompt).toContain("memory leak");
    });

    it("builds a testing agent prompt with its focus areas", () => {
      const prompt = buildAgentPrompt({
        agent: "testing",
        prDetails: createPRDetails(),
        manifest: createManifest(),
      });

      expect(prompt).toContain("Test Coverage & Quality Agent");
      expect(prompt).toContain("edge cases");
      expect(prompt).toContain("brittle");
    });

    it("builds an architecture agent prompt with its focus areas", () => {
      const prompt = buildAgentPrompt({
        agent: "architecture",
        prDetails: createPRDetails(),
        manifest: createManifest(),
      });

      expect(prompt).toContain("Architecture & Style Agent");
      expect(prompt).toContain("breaking API contract");
      expect(prompt).toContain("naming conventions");
    });

    it("includes existing comments context when provided", () => {
      const prompt = buildAgentPrompt({
        agent: "security",
        prDetails: createPRDetails(),
        manifest: createManifest(),
        existingCommentsContext: "src/auth.ts:12 - SQL injection risk",
      });

      expect(prompt).toContain("EXISTING PR COMMENTS");
      expect(prompt).toContain("SQL injection risk");
    });
  });

  describe("buildSynthesizerPrompt", () => {
    it("instructs deduplication, conflict resolution, and confidence filtering", () => {
      const prompt = buildSynthesizerPrompt({
        prDetails: createPRDetails(),
        files: createManifest().files,
        agentResults: [
          {
            agent: "security",
            findings: [
              {
                file: "src/auth.ts",
                line: 12,
                severity: "high",
                confidence: "high",
                category: "security",
                message: "SQL injection risk",
                suggestion: "Use parameterized queries",
                reasoning: "User input concatenated into a query on added lines.",
              },
            ],
          },
        ],
        minConfidence: 0.7,
      });

      expect(prompt).toContain("LEAD SYNTHESIZER");
      expect(prompt).toContain("DEDUPLICATE");
      expect(prompt).toContain("CONFLICT RESOLUTION");
      expect(prompt).toContain("CONFIDENCE THRESHOLD");
      expect(prompt).toContain("0.7");
      expect(prompt).toContain("SQL injection risk");
      expect(prompt).toContain("high = 1.0, medium = 0.6, low = 0.3");
    });

    it("renders a placeholder when no subagent produced findings", () => {
      const prompt = buildSynthesizerPrompt({
        prDetails: createPRDetails(),
        files: createManifest().files,
        agentResults: [],
        minConfidence: 0.7,
      });

      expect(prompt).toContain("No subagent produced findings.");
    });
  });
});
