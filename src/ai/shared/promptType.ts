/** Detected prompt type used for schema selection and audit logging. */
export type PromptType =
  | "file-review"
  | "cross-file-review"
  | "batched-file-review"
  | "fast-review"
  | "build-analysis"
  | "multi-agent-classifier"
  | "multi-agent-subagent"
  | "multi-agent-synthesizer"
  | "unknown";

export function inferPromptType(prompt: string): PromptType {
  if (prompt.includes("failed CI build")) return "build-analysis";
  if (prompt.includes("file_results")) return "batched-file-review";
  if (prompt.includes("cross-file")) return "cross-file-review";
  if (prompt.includes("Review the following file")) return "file-review";
  if (prompt.includes("SELECT RELEVANT SUBAGENTS")) return "multi-agent-classifier";
  if (prompt.includes("LEAD SYNTHESIZER")) return "multi-agent-synthesizer";
  if (prompt.includes("SPECIALIZED SUBAGENT")) return "multi-agent-subagent";
  if (prompt.includes("fast") && prompt.includes("review")) return "fast-review";
  return "unknown";
}
