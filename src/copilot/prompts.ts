import type { FileReviewResult, PRDetails, PRFile } from "../platforms/types.js";

/**
 * Builds a prompt for reviewing a single file.
 *
 * @param filename - Name of the file being reviewed
 * @param patch - Git diff/patch content for the file
 * @param allFilesContext - Optional summary of all files changed in the PR for context
 * @returns Formatted prompt for Copilot CLI
 */
export function buildFileReviewPrompt(
  filename: string,
  patch: string,
  allFilesContext?: string
): string {
  const contextSection = allFilesContext ? `\nFILES CHANGED IN THIS PR:\n${allFilesContext}\n` : "";

  return `You are an expert code reviewer analyzing changes made by senior developers. Focus on substantive issues that would impact correctness, security, or maintainability.
${contextSection}
FILE: ${filename}
DIFF:
${patch}

FOCUS ON SUBSTANTIVE ISSUES:
- Actual bugs: logic errors, race conditions, edge cases not handled
- Security vulnerabilities: injection flaws, authentication issues, data exposure
- Performance problems: algorithmic inefficiency, memory leaks, unnecessary operations
- Breaking changes: API incompatibilities, contract violations
- Critical architectural concerns: tight coupling, violated principles

DO NOT flag:
- Obvious best practices that any senior developer knows (e.g., "breaking changes may occur")
- Stylistic preferences unless they violate established patterns in the codebase
- Trivial suggestions that don't materially improve the code
- Well-known trade-offs without explaining why the choice is problematic in this context
- Documentation for self-evident code

GUIDELINES:
- Only report findings if you can explain a specific negative consequence
- Assume the developer is experienced and made intentional choices
- If suggesting a change, explain the concrete benefit, not just what's "better"
- Skip findings about configuration or dependency updates unless there's a specific compatibility issue
- Focus on "what could go wrong" not "what could be different"

IMPORTANT: The "line" field must reference a line number that appears in the diff above.
- For added lines (starting with +), use the NEW line number (right side of the diff)
- For context lines (no prefix), use the NEW line number
- For removed lines (starting with -), do NOT create findings - focus on what was added/changed
- Line numbers should match the @@ hunk headers in the diff (e.g., @@ -10,5 +15,7 @@ means new lines start at 15)

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

  return `You are an expert code reviewer performing a holistic analysis of a pull request by experienced developers.

PR TITLE: ${prDetails.title}
PR DESCRIPTION: ${prDetails.description || "No description provided"}

CHANGED FILES SUMMARY:
${filesSummary}

INDIVIDUAL FILE REVIEW FINDINGS:
${findingsSummary || "No individual issues found"}

FOCUS ON HIGH-LEVEL SUBSTANTIVE ISSUES:
- Architectural problems: poor separation of concerns, circular dependencies, violated design principles
- System-level concerns: missing error handling patterns, incomplete transaction management
- Cross-cutting issues: inconsistent approach across files, missing integration points
- Testing gaps: critical paths without coverage, integration test needs

DO NOT flag:
- Issues already caught in individual file reviews (avoid duplication)
- General suggestions without specific actionable improvements
- Best practices that are obvious to experienced developers
- Documentation for standard patterns

GUIDELINES:
- Only provide recommendations that would prevent production issues or significantly improve maintainability
- Assume the team has good reasons for their choices unless there's clear evidence of a problem
- Focus on what could fail or cause confusion, not what could be "nicer"

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
