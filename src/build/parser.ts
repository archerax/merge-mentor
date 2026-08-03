import { z } from "zod";
import { parseJsonResponse } from "../ai/shared/parseJsonResponse.js";
import type { BuildDiagnosis, LogArtifact, PreparedEvidence } from "./types.js";

const DiagnosisSchema = z.object({
  failureType: z.enum([
    "compilation",
    "test",
    "lint",
    "dependency",
    "infrastructure",
    "timeout",
    "unknown",
  ]),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1),
  rootCause: z.string().min(1),
  evidence: z.array(z.string()),
  affectedFiles: z.array(
    z.object({
      path: z.string(),
      line: z.number().int().positive().optional(),
      column: z.number().int().positive().optional(),
    })
  ),
  recommendations: z.array(z.string()),
  limitations: z.array(z.string()),
});

export function parseDiagnosis(
  raw: string,
  evidence: PreparedEvidence,
  artifacts: readonly LogArtifact[] = []
): BuildDiagnosis {
  const parsed = DiagnosisSchema.parse(parseJsonResponse(raw));
  const validIds = new Set(evidence.blocks.map((block) => block.id));
  const validArtifactCitations = artifacts.map((artifact) => `${artifact.filename}:`);
  const cited = parsed.evidence.filter(
    (id) => validIds.has(id) || validArtifactCitations.some((prefix) => id.startsWith(prefix))
  );
  const limitations = [...parsed.limitations];
  if (cited.length !== parsed.evidence.length)
    limitations.push("The provider cited evidence blocks that were not supplied.");
  if (evidence.truncated) limitations.push("The captured evidence was truncated before analysis.");
  if (cited.length === 0) {
    return {
      ...parsed,
      failureType: "unknown",
      confidence: 0,
      evidence: [],
      limitations: [...limitations, "No validated evidence citation supported a diagnosis."],
    };
  }
  return { ...parsed, evidence: cited, limitations };
}

export function fallbackDiagnosis(evidence: PreparedEvidence, reason: string): BuildDiagnosis {
  const first = evidence.blocks[0];
  return {
    failureType: first?.category ?? "unknown",
    confidence: first?.confidence ?? 0,
    summary: "The failure could not be fully diagnosed automatically.",
    rootCause: "The available evidence is insufficient to establish a confirmed root cause.",
    evidence: first ? [first.id] : [],
    affectedFiles: [],
    recommendations: ["Inspect the cited CI log evidence and rerun the failed step manually."],
    limitations: [reason, ...(evidence.truncated ? ["The captured evidence was truncated."] : [])],
  };
}
