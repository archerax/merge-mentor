import type { DiffManifest } from "@merge-mentor/domain/diff.js";
import type { PRDetails } from "@merge-mentor/domain/platform.js";
import { describe, expect, it } from "vitest";

import { getJsonSchema } from "../shared/jsonSchemas.js";
import { buildAgentPrompt, buildSynthesizerPrompt } from "./multiAgent/prompts.js";
import { buildFastReviewPrompt } from "./specialists/fast.js";
import { buildGeneralFileReviewPrompt } from "./specialists/general.js";

const prDetails: PRDetails = {
  number: 7,
  title: "Add login",
  description: "Adds login",
  author: "dev",
  baseBranch: "main",
  headBranch: "feature/login",
};

const manifest: DiffManifest = {
  prIdentifier: "pr-7",
  files: [
    { filename: "src/a.ts", status: "added", diffPath: "a.diff", additions: 3, deletions: 0 },
    { filename: "src/b.ts", status: "modified", diffPath: "b.diff", additions: 1, deletions: 1 },
  ],
  createdAt: new Date().toISOString(),
};

describe("shared review result contract", () => {
  const prompts = {
    fast: buildFastReviewPrompt(prDetails, manifest),
    deep: buildGeneralFileReviewPrompt(manifest),
    subagent: buildAgentPrompt({ agent: "security", prDetails, manifest }),
    synthesizer: buildSynthesizerPrompt({
      prDetails,
      files: manifest.files,
      agentResults: [],
    }),
  };

  it.each(Object.entries(prompts))(
    "%s asks for the same file_results + cross_file_findings response",
    (_strategy, prompt) => {
      expect(prompt).toContain('"summary"');
      expect(prompt).toContain('"file_results"');
      expect(prompt).toContain('"cross_file_findings"');
      expect(prompt).toContain("MUST contain an entry for EVERY changed file");
      expect(prompt).not.toContain("reviewed_files");
    }
  );

  it("uses one provider JSON schema for every strategy's prompt type", () => {
    const schema = getJsonSchema("fast-review");

    expect(getJsonSchema("batched-file-review")).toBe(schema);
    expect(getJsonSchema("multi-agent-subagent")).toBe(schema);
    expect(getJsonSchema("multi-agent-synthesizer")).toBe(schema);
  });
});
