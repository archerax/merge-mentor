/** Detected prompt type used for schema selection and audit logging. */
export type PromptType =
  | "file-review"
  | "cross-file-review"
  | "batched-file-review"
  | "fast-review"
  | "unknown";

export function inferPromptType(prompt: string): PromptType {
  if (prompt.includes("file_results")) return "batched-file-review";
  if (prompt.includes("cross-file")) return "cross-file-review";
  if (prompt.includes("Review the following file")) return "file-review";
  if (prompt.includes("fast") && prompt.includes("review")) return "fast-review";
  return "unknown";
}
