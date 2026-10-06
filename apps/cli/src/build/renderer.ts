import type { BuildDiagnosis, BuildReference, BuildSummary, PreparedEvidence } from "./types.js";

/**
 * Renders the final markdown report for a build analysis.
 *
 * Combines the build summary, diagnosis, evidence blocks, affected files,
 * recommendations, and limitations into a single human-readable report.
 *
 * @param reference - The analyzed build.
 * @param summary - Summary metadata of the build.
 * @param evidence - The evidence captured from the build logs.
 * @param diagnosis - The diagnosis reached for the build.
 * @returns The rendered markdown report string.
 */
export function renderReport(
  reference: BuildReference,
  summary: BuildSummary,
  evidence: PreparedEvidence,
  diagnosis: BuildDiagnosis
): string {
  const files =
    diagnosis.affectedFiles.length > 0
      ? diagnosis.affectedFiles
          .map((file) => `- \`${file.path}${file.line ? `:${file.line}` : ""}\``)
          .join("\n")
      : "- None identified";
  const blocks =
    evidence.blocks.length > 0
      ? evidence.blocks
          .map(
            (block) => `### ${block.id} (${block.category})\n\n\`\`\`text\n${block.content}\n\`\`\``
          )
          .join("\n\n")
      : "No usable log evidence was captured.";
  return `# CI Build Failure Analysis\n\n**Platform:** ${reference.platform}  \n**Build:** [${summary.name} #${summary.id}](${summary.webUrl ?? ""})  \n**Result:** ${summary.result}\n\n## Diagnosis\n\n**Failure type:** ${diagnosis.failureType}  \n**Confidence:** ${(diagnosis.confidence * 100).toFixed(0)}%\n\n${diagnosis.summary}\n\n### Root Cause\n\n${diagnosis.rootCause}\n\n## Evidence\n\n${blocks}\n\n## Affected Files\n\n${files}\n\n## Recommendations\n\n${diagnosis.recommendations.map((item) => `- ${item}`).join("\n") || "- None"}\n\n## Limitations\n\n${diagnosis.limitations.map((item) => `- ${item}`).join("\n") || "- None reported"}\n`;
}
