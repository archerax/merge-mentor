import { describe, expect, it } from "vitest";
import type { PRDetails } from "../../../platforms/types.js";
import type { DiffManifest } from "../../../review/diffStorage.js";
import { buildAgentPrompt, buildSynthesizerPrompt } from "./prompts.js";

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
      expect(prompt).toContain("comments as review context, not as evidence");
      expect(prompt).toContain("same root cause");
    });

    it("requires a complete per-file recall-first review workflow", () => {
      const prompt = buildAgentPrompt({
        agent: "general",
        prDetails: createPRDetails(),
        manifest: createManifest(),
      });

      expect(prompt).toContain("# REVIEW METHOD (RECALL-FIRST)");
      expect(prompt).toContain("Review every listed file and every added hunk");
      expect(prompt).toContain("values from their source to their sink");
      expect(prompt).toContain("callers,\n   callees");
      expect(prompt).toContain("A single hunk may\n   legitimately contain multiple findings");
      expect(prompt).toContain("after drafting findings, revisit every file");
    });

    it("allows cross-file findings via affected_files", () => {
      const prompt = buildAgentPrompt({
        agent: "architecture",
        prDetails: createPRDetails(),
        manifest: createManifest(),
      });

      expect(prompt).toContain('"affected_files": ["file1.ts", "file2.ts"]');
      expect(prompt).toContain("Every FILE-LEVEL finding must include");
      expect(prompt).toContain("CROSS-FILE / PR-LEVEL concern");
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
      });

      expect(prompt).toContain("LEAD SYNTHESIZER");
      expect(prompt).toContain("DEDUPLICATE");
      expect(prompt).toContain("CONFLICT RESOLUTION");
      expect(prompt).not.toContain("CONFIDENCE THRESHOLD");
      expect(prompt).toContain("There is no target");
      expect(prompt).toContain("share a file,\n   line, category, or symptom");
      expect(prompt).toContain("account for every substantive subagent finding");
      expect(prompt).toContain('"agent": "security"');
      expect(prompt).toContain("SQL injection risk");
      expect(prompt).toContain("SUBAGENT FINDINGS (JSON DATA)");
    });

    it("includes bounded diff and workspace verification guidance", () => {
      const prompt = buildSynthesizerPrompt({
        prDetails: createPRDetails(),
        files: createManifest().files,
        agentResults: [],
        repoPath: "/workspace/repo",
      });

      expect(prompt).toContain("DIFF AND WORKSPACE VERIFICATION");
      expect(prompt).toContain("@workspace /search");
      expect(prompt).toContain("not a second full review: do not invent new findings");
      expect(prompt).toContain("src/auth.ts");
      expect(prompt).toContain("do not invent new findings");
    });

    it("does not claim workspace access when no repository path is provided", () => {
      const prompt = buildSynthesizerPrompt({
        prDetails: createPRDetails(),
        files: createManifest().files,
        agentResults: [],
      });

      expect(prompt).not.toContain("@workspace /search");
    });

    it("renders an empty JSON array when no subagent produced findings", () => {
      const prompt = buildSynthesizerPrompt({
        prDetails: createPRDetails(),
        files: createManifest().files,
        agentResults: [],
      });

      expect(prompt).toContain("<subagent-findings-json>\n[]\n</subagent-findings-json>");
    });

    it("renders subagent PR-level findings with affected files", () => {
      const prompt = buildSynthesizerPrompt({
        prDetails: createPRDetails(),
        files: createManifest().files,
        agentResults: [
          {
            agent: "architecture",
            findings: [
              {
                line: 0,
                severity: "high",
                confidence: "high",
                category: "architecture",
                message: "Layering violation spans modules",
                suggestion: "Move shared types into a common package",
                reasoning: "Callers in src/api and src/auth both import from a ui layer.",
                affectedFiles: ["src/api.ts", "src/auth.ts"],
              },
            ],
          },
        ],
      });

      expect(prompt).toContain('"affectedFiles": [');
      expect(prompt).toContain("Layering violation spans modules");
      expect(prompt).toContain("CROSS-FILE FINDINGS");
    });
  });
});
