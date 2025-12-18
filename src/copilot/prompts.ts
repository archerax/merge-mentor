import type { FileReviewResult, PRDetails, PRFile } from "../platforms/types.js";

/**
 * Builds a prompt for reviewing a single file.
 *
 * @param filename - Name of the file being reviewed
 * @param patch - Git diff/patch content for the file
 * @returns Formatted prompt for Copilot CLI
 */
export function buildFileReviewPrompt(filename: string, patch: string): string {
  return `You are an expert code reviewer. Analyze the following code changes and provide a detailed review.

FILE: ${filename}
DIFF:
${patch}

Review the code for:
- Code quality and readability
- Adherence to coding standards
- Potential bugs or logical errors
- Performance considerations
- Security vulnerabilities
- Test coverage and adequacy
- Documentation and comments

Respond ONLY with valid JSON in this exact format:
{
  "findings": [
    {
      "line": <line_number>,
      "severity": "critical|high|medium|low",
      "category": "bug|security|performance|quality|documentation",
      "message": "Description of the issue",
      "suggestion": "Recommended fix or improvement"
    }
  ]
}

If there are no issues, return: {"findings": []}`;
}

/**
 * Builds a prompt for cross-file analysis.
 *
 * @param prDetails - Pull request metadata
 * @param filesSummary - Summary of changed files
 * @param fileReviewResults - Results from individual file reviews
 * @returns Formatted prompt for Copilot CLI
 */
export function buildCrossFilePrompt(
  prDetails: PRDetails,
  filesSummary: string,
  fileReviewResults: readonly FileReviewResult[]
): string {
  const findingsSummary = fileReviewResults
    .filter((r) => r.findings.length > 0)
    .map((r) => `${r.filename}: ${r.findings.length} finding(s)`)
    .join("\n");

  return `You are an expert code reviewer performing a holistic analysis of a pull request.

PR TITLE: ${prDetails.title}
PR DESCRIPTION: ${prDetails.description || "No description provided"}

CHANGED FILES SUMMARY:
${filesSummary}

INDIVIDUAL FILE REVIEW FINDINGS:
${findingsSummary || "No individual issues found"}

Analyze the overall changes for:
- Design and architectural issues
- Cross-file dependencies and coupling
- Missing tests or documentation
- Overall code organization

Respond ONLY with valid JSON in this exact format:
{
  "overall_assessment": "Summary of the PR quality",
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "category": "architecture|design|testing|documentation",
      "message": "Description of the issue",
      "affected_files": ["file1.ts", "file2.ts"]
    }
  ],
  "recommendations": ["Recommendation 1", "Recommendation 2"]
}`;
}

/**
 * Builds a summary of changed files for prompt context.
 *
 * @param files - Array of PR files
 * @returns Formatted file summary string
 */
export function buildFilesSummary(files: readonly PRFile[]): string {
  return files
    .map((f) => `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`)
    .join("\n");
}
